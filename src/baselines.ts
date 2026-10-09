import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Viewport } from "./config";
import type { RunResult, Summary, StepDiffVerdict } from "./types";

// The baselines manifest is the ONLY file vigress trusts for approved
// baselines. It points at artifacts in place (no copying) — paths are
// relative to the repo root (= process cwd). Its schemaVersion is
// independent of the run-output SCHEMA_VERSION.
export const MANIFEST_VERSION = 1;
export const MANIFEST_PATH = "baselines/manifest.json";

// One approved version of a baseline.
export interface BaselineVersion {
  storage: "local"; // reserved: "remote" (future dashboard artifact store)
  approvedAt: string; // ISO timestamp
  approvedFrom: string; // run dir, relative to repo root (provenance)
  viewport: Viewport;
  sourceUrl: string;
  fullPage?: true; // absent = viewport capture (also how pre-fullPage entries read)
  artifacts: {
    main: string; // relative to repo root
    steps: Record<string, string>; // shot name -> path relative to repo root
  };
}

// The current baseline plus the versions it replaced (newest first). Additive to the
// manifest format: an entry without `history` reads exactly as before.
export interface ManifestEntry extends BaselineVersion {
  history?: BaselineVersion[];
}

export const MAX_HISTORY = 10;

export interface Manifest {
  schemaVersion: number;
  baselines: Record<string, ManifestEntry>;
}

export function emptyManifest(): Manifest {
  return { schemaVersion: MANIFEST_VERSION, baselines: {} };
}

export function parseManifest(jsonText: string): Manifest {
  const m = JSON.parse(jsonText) as Manifest;
  if (m.schemaVersion !== MANIFEST_VERSION) {
    throw new Error(
      `vigress baselines: manifest schemaVersion ${m.schemaVersion} not supported (expected ${MANIFEST_VERSION})`,
    );
  }
  if (!m.baselines || typeof m.baselines !== "object" || Array.isArray(m.baselines)) {
    throw new Error("vigress baselines: manifest 'baselines' field must be a plain object");
  }
  return m;
}

// Written to a temp file and renamed into place, so a reader (the dashboard reads the manifest
// on every request) never sees a half-written file. Callers that read-modify-write should hold
// withManifestLock (manifestLock.ts) around the whole sequence.
export function writeManifest(file: string, manifest: Manifest): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  renameSync(tmp, file);
}

// "baseline:<name>" -> "<name>"; null for anything else (incl. empty names).
export function parseBaselineRef(against: string): string | null {
  if (!against.startsWith("baseline:")) return null;
  const name = against.slice("baseline:".length).trim();
  return name.length ? name : null;
}

// Maps an approved run's artifacts into a manifest entry. Wholesale: steps
// removed from the config drop out because we rebuild from the run's shots.
export function buildManifestEntry(run: RunResult, runDirRel: string, approvedAt: string): ManifestEntry {
  if (!run.target) {
    throw new Error(`vigress approve: run '${run.name}' has no target capture — cannot approve`);
  }
  const steps: Record<string, string> = {};
  for (const shot of run.shots) steps[shot.name] = join(runDirRel, shot.path);
  return {
    storage: "local",
    approvedAt,
    approvedFrom: runDirRel,
    viewport: run.viewport,
    sourceUrl: run.targetUrl,
    ...(run.fullPage ? { fullPage: true as const } : {}),
    artifacts: { main: join(runDirRel, run.target), steps },
  };
}

// Approving a name again keeps the version it replaces in `history` (newest first, at
// most MAX_HISTORY) so "before" is not lost — unless it is the very same run being
// re-approved. The history's artifacts stay in place under out/, so their run dirs
// are manifest-locked like the current one (see referencedRunDirs).
export function upsertBaseline(manifest: Manifest, name: string, entry: ManifestEntry): Manifest {
  let next: ManifestEntry = entry;
  if (Object.hasOwn(manifest.baselines, name)) {
    const { history: prevHistory = [], ...prevVersion } = manifest.baselines[name];
    const isSameRun = (v: BaselineVersion): boolean => v.approvedFrom === entry.approvedFrom && v.artifacts.main === entry.artifacts.main;
    // The new current version never also sits in history (it can, after a rollback and a
    // re-approve of the newer run), and re-approving the current run keeps history as is.
    const kept = prevHistory.filter((v) => !isSameRun(v));
    const history = isSameRun(prevVersion) ? kept : [prevVersion, ...kept].slice(0, MAX_HISTORY);
    next = { ...entry, ...(history.length ? { history } : {}) };
  }
  return { ...manifest, baselines: { ...manifest.baselines, [name]: next } };
}

export function versionArtifacts(v: BaselineVersion): string[] {
  return [...new Set([v.artifacts.main, ...Object.values(v.artifacts.steps)])];
}

// Forget all but the newest `keep` previous versions. Nothing is deleted from disk: the
// dropped versions' run dirs simply stop being manifest-locked (the caller reports them),
// so they can be cleaned up like any other run. The current version is never touched.
export function pruneHistory(
  manifest: Manifest,
  name: string,
  keep: number,
): { ok: true; manifest: Manifest; dropped: BaselineVersion[] } | { ok: false; message: string } {
  if (!Object.hasOwn(manifest.baselines, name)) return { ok: false, message: `no approved baseline '${name}'` };
  if (!Number.isInteger(keep) || keep < 0) return { ok: false, message: "keep must be a whole number, 0 or more" };
  const { history = [], ...current } = manifest.baselines[name];
  const kept = history.slice(0, keep);
  const entry: ManifestEntry = kept.length ? { ...current, history: kept } : current;
  return { ok: true, manifest: { ...manifest, baselines: { ...manifest.baselines, [name]: entry } }, dropped: history.slice(keep) };
}

// Make a previous version (index into `history`, 0 = the one just before) the current
// baseline again. The version it replaces goes into history, so a rollback can itself
// be undone. Refuses when the target's files are gone — rolling back onto missing
// artifacts would leave a baseline that fails at run time.
export function rollbackBaseline(
  manifest: Manifest,
  name: string,
  to: number,
  exists: (relPath: string) => boolean,
): { ok: true; manifest: Manifest; restored: BaselineVersion } | { ok: false; message: string } {
  if (!Object.hasOwn(manifest.baselines, name)) return { ok: false, message: `no approved baseline '${name}'` };
  const { history = [], ...current } = manifest.baselines[name];
  if (!history.length) return { ok: false, message: `baseline '${name}' has no previous version to roll back to` };
  if (!Number.isInteger(to) || to < 0 || to >= history.length) {
    return { ok: false, message: `version ${to} does not exist — '${name}' has ${history.length} previous version(s)` };
  }
  const target = history[to];
  const missing = versionArtifacts(target).filter((p) => !exists(p));
  if (missing.length) {
    return { ok: false, message: `cannot roll back '${name}': ${missing.join(", ")} no longer exist (was the run dir deleted?)` };
  }
  const nextHistory = [current, ...history.filter((_, i) => i !== to)].slice(0, MAX_HISTORY);
  return {
    ok: true,
    manifest: { ...manifest, baselines: { ...manifest.baselines, [name]: { ...target, history: nextHistory } } },
    restored: target,
  };
}

// Summaries older than this don't record how they were captured (fullPage), so
// approving them could bless a baseline that later never matches.
export const MIN_APPROVE_SCHEMA = 8;

export type ApproveResult =
  | { ok: true; manifest: Manifest; approved: RunResult[] }
  | { ok: false; message: string };

// The one set of approve rules, shared by `vigress approve` and the dashboard.
// `which` is a run name, or null for every run in the summary; `targetExists` gets the run's target path
// (relative to the run dir) so the disk check stays with the caller.
export function approveRuns(
  manifest: Manifest,
  summary: Summary,
  runDirRel: string,
  which: string | null,
  targetExists: (targetRel: string) => boolean,
  approvedAt: string,
): ApproveResult {
  if (summary.schemaVersion < MIN_APPROVE_SCHEMA) {
    return {
      ok: false,
      message: `${runDirRel} was written by an older vigress (schema ${summary.schemaVersion}) — re-run the comparison first`,
    };
  }
  const approved = which === null ? summary.runs : summary.runs.filter((r) => r.name === which);
  if (!approved.length) {
    return {
      ok: false,
      message: which === null
        ? `no runs found in ${runDirRel}`
        : `run '${which}' not in ${runDirRel} — has: ${summary.runs.map((r) => r.name).join(", ")}`,
    };
  }
  let next = manifest;
  for (const run of approved) {
    if (!targetExists(run.target)) {
      return { ok: false, message: `target capture missing for '${run.name}' (${join(runDirRel, run.target)})` };
    }
    next = upsertBaseline(next, run.name, buildManifestEntry(run, runDirRel, approvedAt));
  }
  return { ok: true, manifest: next, approved };
}

export type ResolveResult =
  | { ok: true; entry: ManifestEntry }
  | { ok: false; code: 1 | 2; missingEntry?: true; message: string };

// Pure guards for a baseline: run. File existence is the caller's job (I/O).
export function resolveBaselineArtifacts(
  manifest: Manifest | null,
  name: string,
  viewport: Viewport,
  fullPage = false,
): ResolveResult {
  const entry = manifest?.baselines[name];
  if (!entry) {
    return {
      ok: false, code: 2, missingEntry: true,
      message: `no approved baseline '${name}' — bootstrap it with --update-baseline`,
    };
  }
  if (entry.viewport.width !== viewport.width || entry.viewport.height !== viewport.height) {
    return {
      ok: false, code: 2,
      message:
        `viewport ${viewport.width}x${viewport.height} does not match approved baseline ` +
        `${entry.viewport.width}x${entry.viewport.height} for '${name}' — re-approve at the new viewport`,
    };
  }
  // A viewport capture diffed against a full-page baseline (or vice versa) would
  // silently compare only the top slice, so the capture mode must match too.
  const approvedFullPage = entry.fullPage === true;
  if (approvedFullPage !== fullPage) {
    const mode = (on: boolean): string => (on ? "on" : "off");
    return {
      ok: false, code: 2,
      message:
        `full-page capture (${mode(fullPage)}) does not match approved baseline (${mode(approvedFullPage)}) ` +
        `for '${name}' — ${approvedFullPage ? "pass" : "drop"} --full-page, or re-approve with the new setting`,
    };
  }
  return { ok: true, entry };
}

export interface RunDirCandidate {
  dir: string;
  mtimeMs: number;
  summary: Summary;
}

// Newest = latest dir mtime among candidates whose runs[] include the name.
export function pickNewestRun(candidates: RunDirCandidate[], name: string): RunDirCandidate | null {
  const matches = candidates.filter((c) => c.summary.runs.some((r) => r.name === name));
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0] ?? null;
}

// The verdict matrix. "new" never trips a gate (adding a step must not break
// CI until re-approval); "missing" is a promised state that disappeared.
// Without --max-mismatch the % stays a noisy signal, never a failure.
export function stepDiffVerdict(
  inRun: boolean,
  inManifest: boolean,
  mismatchPercent: number,
  maxMismatch?: number,
): StepDiffVerdict {
  if (inRun && !inManifest) return "new";
  if (!inRun && inManifest) return "missing";
  if (maxMismatch !== undefined && mismatchPercent > maxMismatch) return "mismatch";
  return "ok";
}
