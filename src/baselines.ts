import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Viewport } from "./config";
import type { RunResult, Summary, StepDiffVerdict } from "./types";

// The baselines manifest is the ONLY file vigress trusts for approved
// baselines. It points at artifacts in place (no copying) — paths are
// relative to the repo root (= process cwd). Its schemaVersion is
// independent of the run-output SCHEMA_VERSION.
export const MANIFEST_VERSION = 1;
export const MANIFEST_PATH = "baselines/manifest.json";

export interface ManifestEntry {
  storage: "local"; // reserved: "remote" (future dashboard artifact store)
  approvedAt: string; // ISO timestamp
  approvedFrom: string; // run dir, relative to repo root (provenance)
  viewport: Viewport;
  sourceUrl: string;
  artifacts: {
    main: string; // relative to repo root
    steps: Record<string, string>; // shot name -> path relative to repo root
  };
}

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

export function writeManifest(file: string, manifest: Manifest): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
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
    artifacts: { main: join(runDirRel, run.target), steps },
  };
}

export function upsertBaseline(manifest: Manifest, name: string, entry: ManifestEntry): Manifest {
  return { ...manifest, baselines: { ...manifest.baselines, [name]: entry } };
}

export type ResolveResult =
  | { ok: true; entry: ManifestEntry }
  | { ok: false; code: 1 | 2; missingEntry?: true; message: string };

// Pure guards for a baseline: run. File existence is the caller's job (I/O).
export function resolveBaselineArtifacts(
  manifest: Manifest | null,
  name: string,
  viewport: Viewport,
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
