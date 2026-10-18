import { dirname, normalize, join, isAbsolute } from "node:path";
import { versionArtifacts, type Manifest, type BaselineVersion } from "./baselines";
import type { RunResult, Summary, StepDiffVerdict, RegionVerdict, GitInfo, BaselineRef } from "./types";
import { sanitizeGitInfo } from "./gitinfo";
import { sidesFor, isCardStep, validatePicks, type KeepSide, type PromptStep, type StepPromptInput } from "./stepPrompt";
import { buildRerunCommand, buildCompareCheckCommand } from "./rerun";

// Pure view-model + guard logic for the dashboard. The server (server.ts)
// does the I/O (scanning out/, markers, deletes) and feeds plain data in;
// everything here is unit-testable without a server or filesystem.

export interface RunDirInfo {
  dirName: string; // basename under out/, e.g. "2026-07-06_15-11-50"
  relPath: string; // repo-root-relative, e.g. "out/2026-07-06_15-11-50" — same style as manifest paths
  mtimeMs: number;
  sizeBytes: number;
  keep: boolean; // .keep marker present
  summary: Summary | null; // null = unreadable summary.json (crashed/legacy run)
}

export interface RunIndexEntry {
  dirName: string;
  mtimeMs: number;
  sizeBytes: number;
  keep: boolean;
  unreadable: boolean;
  lockedBy: string[]; // baseline names whose artifacts live in this dir; [] = deletable
  entries: { name: string; mismatchPercent?: number; bootstrap?: boolean }[];
  worstMismatch: number;
  issues: number; // failed check steps + missing stepDiffs + style mismatches
  thumbnail?: string; // outDir-relative artifact path (worst entry's diff, else its target)
  git?: GitInfo; // commit/branch the run started from, sanitized for display
}

// A run dir is precious when any manifest entry's artifacts live inside it.
// approvedFrom is the provenance dir and, by construction (buildManifestEntry),
// also the parent of every artifact path — but derive from the artifacts too,
// defensively, in case a manifest was hand-edited.
export function referencedRunDirs(manifest: Manifest | null): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  if (!manifest) return refs;
  const add = (dir: string, name: string): void => {
    if (dir === ".") return; // bare filename → no dir info to lock on
    const list = refs.get(dir) ?? [];
    if (!list.includes(name)) list.push(name);
    refs.set(dir, list);
  };
  for (const [name, entry] of Object.entries(manifest.baselines)) {
    // The current version and every kept previous version: a rollback target's run dir
    // must not be deletable either.
    for (const v of [entry, ...(entry.history ?? [])]) {
      add(v.approvedFrom, name);
      add(dirname(v.artifacts.main), name);
      for (const p of Object.values(v.artifacts.steps)) add(dirname(p), name);
    }
  }
  return refs;
}

// Issues = failed check steps + missing step diffs + style mismatches. One
// definition, shared by the run list badge and the detail panel.
export function countIssues(r: RunResult): number {
  return (
    r.steps.filter((s) => s.check && s.status === "failed").length +
    r.stepDiffs.filter((sd) => sd.verdict === "missing").length +
    r.regions.reduce((k, rg) => k + (rg.styleDiff?.filter((s) => !s.match).length ?? 0), 0)
  );
}

// URL of an artifact the server's /files/ route serves: each segment encoded,
// slashes kept. The one place that rule lives (the page gets finished URLs).
export function fileUrl(dirName: string, relPath: string): string {
  return "/files/" + [dirName, ...relPath.split("/")].map(encodeURIComponent).join("/");
}

// Maps a repo-root-relative artifact path from the manifest ("out/<dir>/<rest>") to the
// /files/ URL for it. null when the path is not inside a run dir under the out dir (a
// hand-edited manifest), so the page never gets a URL the server would refuse anyway.
export function repoPathUrl(repoRel: string, outDirRel: string): string | null {
  const prefix = outDirRel.replace(/\/+$/, "") + "/";
  if (!repoRel.startsWith(prefix)) return null;
  const segments = repoRel.slice(prefix.length).split("/");
  if (segments.length < 2 || segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return fileUrl(segments[0], segments.slice(1).join("/"));
}

// Prompts and absolute paths go only to requests that did not come through
// `tailscale serve` (which adds the caller's login header).
export function isPromptAllowed(tailscaleLogin: string | null): boolean {
  return tailscaleLogin === null;
}

export const BASELINE_CHANGED_WARNING = "the baseline changed after this run; before images may not be what this run was compared against";

// Which approved version a run was compared against. A baseline can be re-approved after the
// run, so look the run's recorded approvedAt up in the current entry, then in its history.
// A pruned version (or a run that recorded none) falls back to the current entry, with a warning.
export function resolveRunBaseline(
  manifest: Manifest | null,
  ref: BaselineRef | undefined,
  runName: string,
): { version: BaselineVersion | null; warning?: string } {
  const name = ref?.name ?? runName;
  const entry = manifest && Object.hasOwn(manifest.baselines, name) ? manifest.baselines[name] : undefined;
  if (!entry) return { version: null, warning: `baseline '${name}' is no longer approved` };
  if (ref) {
    if (entry.approvedAt === ref.approvedAt) return { version: entry };
    const past = (entry.history ?? []).find((v) => v.approvedAt === ref.approvedAt);
    if (past) return { version: past };
  }
  return { version: entry, warning: BASELINE_CHANGED_WARNING };
}

export interface RunDetailStepDiff {
  name: string;
  verdict: StepDiffVerdict;
  mismatchPercent: number;
  images: { before?: string; after?: string; diff?: string }; // /files/ URLs
  sides: KeepSide[]; // which images can be marked "keep"
}

export interface RunDetailEntry {
  name: string;
  images: { target: string; baseline?: string; diff?: string; video?: string };
  mismatchPercent?: number;
  heightDelta?: number; // px of page height that was not compared
  bootstrap?: true;
  issues: number;
  failedSteps: { index: number; action: string; selector?: string; error?: string }[];
  regions: {
    name: string;
    verdict: RegionVerdict;
    reason: string;
    mismatchPercent: number;
    styleMismatches: { property: string; target: string | null; baseline: string | null }[];
  }[];
  stepDiffs: RunDetailStepDiff[];
  baselineWarning?: string; // set when the "before" images may not be what the run was compared against
  promptAllowed: boolean; // false for requests that came through `tailscale serve`
}

export interface RunDetailContext {
  manifest: Manifest | null;
  outDirRel: string; // out dir relative to the repo root, e.g. "out"
  promptAllowed: boolean;
}

// What the dashboard shows when a run is expanded: the parts of summary.json a
// reviewer acts on, without the artifact paths (those are served via /files/).
export function buildRunDetail(summary: Summary, dirName: string, ctx: RunDetailContext): RunDetailEntry[] {
  return summary.runs.map((r) => {
    // Step diffs need the approved version's step images; other runs have nothing to resolve.
    const resolved = r.stepDiffs.length > 0 ? resolveRunBaseline(ctx.manifest, r.baselineRef, r.name) : null;
    const shotPaths = new Map(r.shots.map((sh) => [sh.name, sh.path])); // duplicate names: last one wins
    return {
      name: r.name,
      images: {
        target: fileUrl(dirName, r.target),
        ...(r.baseline ? { baseline: fileUrl(dirName, r.baseline) } : {}),
        ...(r.diff ? { diff: fileUrl(dirName, r.diff) } : {}),
        ...(r.video ? { video: fileUrl(dirName, r.video) } : {}),
      },
      mismatchPercent: r.mismatchPercent,
      heightDelta: r.heightDelta,
      bootstrap: r.bootstrap,
      issues: countIssues(r),
      failedSteps: r.steps
        .filter((s) => s.check && s.status === "failed")
        .map((s) => ({ index: s.index, action: s.action, selector: s.selector, error: s.error })),
      regions: r.regions.map((rg) => ({
        name: rg.name,
        verdict: rg.verdict,
        reason: rg.reason,
        mismatchPercent: rg.mismatchPercent,
        styleMismatches: (rg.styleDiff ?? [])
          .filter((s) => !s.match)
          .map((s) => ({ property: s.property, target: s.target, baseline: s.baseline })),
      })),
      stepDiffs: r.stepDiffs.map((d) => {
        const beforeRel = resolved?.version && Object.hasOwn(resolved.version.artifacts.steps, d.name) ? resolved.version.artifacts.steps[d.name] : undefined;
        const before = beforeRel === undefined ? null : repoPathUrl(beforeRel, ctx.outDirRel);
        const afterRel = shotPaths.get(d.name);
        return {
          name: d.name,
          verdict: d.verdict,
          mismatchPercent: d.mismatchPercent,
          images: {
            ...(before ? { before } : {}),
            ...(afterRel !== undefined ? { after: fileUrl(dirName, afterRel) } : {}),
            ...(d.diff ? { diff: fileUrl(dirName, d.diff) } : {}),
          },
          sides: sidesFor(d),
        };
      }),
      ...(resolved?.warning ? { baselineWarning: resolved.warning } : {}),
      promptAllowed: ctx.promptAllowed,
    };
  });
}

// A run-dir URL segment must be a single, non-dotted path component.
export function dirSegment(raw: string): string | null {
  const name = safeDecode(raw);
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) return null;
  return name;
}

// The /api/compare step list: images as URLs (the diff inline, since compare writes no file),
// and which sides can be marked. Buffers and run-relative paths never reach the JSON.
export function compareStepDiffsPayload(
  stepDiffs: { name: string; mismatchPercent: number; verdict: StepDiffVerdict; aRel?: string; bRel?: string; diffPng?: Buffer }[],
  aDir: string,
  bDir: string,
): RunDetailStepDiff[] {
  return stepDiffs.map((s) => ({
    name: s.name,
    verdict: s.verdict,
    mismatchPercent: s.mismatchPercent,
    images: {
      ...(s.aRel !== undefined ? { before: fileUrl(aDir, s.aRel) } : {}),
      ...(s.bRel !== undefined ? { after: fileUrl(bDir, s.bRel) } : {}),
      ...(s.diffPng ? { diff: "data:image/png;base64," + s.diffPng.toString("base64") } : {}),
    },
    sides: sidesFor(s),
  }));
}

export interface StepPromptBody {
  mode: "baseline" | "compare";
  dir?: string; // baseline mode: the run
  a?: string; // compare mode: before run
  b?: string; // compare mode: after run
  name: string;
  picks: Record<string, KeepSide>;
  hideBelow: number;
}

// Shape check of the POST /api/step-prompt body. Whether the picks make sense for the run is
// checked later, against the steps the run actually has.
export function parseStepPromptBody(raw: unknown): { ok: true; body: StepPromptBody } | { ok: false; message: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, message: "expected a JSON object" };
  const b = raw as Record<string, unknown>;
  if (b.mode !== "baseline" && b.mode !== "compare") return { ok: false, message: 'mode must be "baseline" or "compare"' };
  if (typeof b.name !== "string" || b.name === "") return { ok: false, message: "name must be a comparison name" };
  if (typeof b.hideBelow !== "number" || !Number.isFinite(b.hideBelow) || b.hideBelow < 0) {
    return { ok: false, message: "hideBelow must be a number, 0 or more" };
  }
  if (typeof b.picks !== "object" || b.picks === null || Array.isArray(b.picks)) return { ok: false, message: "picks must be an object" };
  const picks: Record<string, KeepSide> = {};
  for (const [step, side] of Object.entries(b.picks)) {
    if (side !== "before" && side !== "after") return { ok: false, message: `pick for "${step}" must be "before" or "after"` };
    picks[step] = side;
  }
  const seg = (v: unknown, what: string): { ok: true; value: string } | { ok: false; message: string } => {
    const d = typeof v === "string" ? dirSegment(v) : null;
    return d ? { ok: true, value: d } : { ok: false, message: `${what} must be a run dir name` };
  };
  if (b.mode === "baseline") {
    const dir = seg(b.dir, "dir");
    if (!dir.ok) return dir;
    return { ok: true, body: { mode: "baseline", dir: dir.value, name: b.name, picks, hideBelow: b.hideBelow } };
  }
  const a = seg(b.a, "a");
  if (!a.ok) return a;
  const after = seg(b.b, "b");
  if (!after.ok) return after;
  return { ok: true, body: { mode: "compare", a: a.value, b: after.value, name: b.name, picks, hideBelow: b.hideBelow } };
}

// One step as the prompt may use it. Paths are absolute and present only when the image
// can actually be read, so a pick on a side without an image is refused.
export interface PromptCandidate {
  name: string;
  verdict: StepDiffVerdict;
  mismatchPercent: number;
  before?: string;
  after?: string;
  diff?: string;
}

export interface PromptPaths {
  rootDir: string;
  outDirAbs: string;
  outDirRel: string;
}

// Baseline mode: before = the approved version's step image, after/diff = this run's files.
export function baselineCandidates(
  run: RunResult,
  runDirAbs: string,
  manifest: Manifest | null,
  paths: PromptPaths,
  exists: (abs: string) => boolean,
): { candidates: PromptCandidate[]; beforeLabel: string; warning?: string } {
  const resolved = resolveRunBaseline(manifest, run.baselineRef, run.name);
  const version = resolved.version;
  const shotPaths = new Map(run.shots.map((sh) => [sh.name, sh.path]));
  const inRun = (rel: string | undefined): string | undefined => {
    if (rel === undefined) return undefined;
    const abs = safeChildPath(runDirAbs, rel);
    return abs && exists(abs) ? abs : undefined;
  };
  const candidates = run.stepDiffs.map((d): PromptCandidate => {
    const beforeRel = version && Object.hasOwn(version.artifacts.steps, d.name) ? version.artifacts.steps[d.name] : undefined;
    // Only a path the page could also show (under out/) counts, so a hand-edited manifest can't aim the prompt elsewhere.
    const beforeAbs = beforeRel !== undefined && repoPathUrl(beforeRel, paths.outDirRel) !== null ? join(paths.rootDir, beforeRel) : undefined;
    const before = beforeAbs !== undefined && exists(beforeAbs) ? beforeAbs : undefined;
    const after = inRun(shotPaths.get(d.name));
    const diff = d.verdict === "missing" ? undefined : inRun(d.diff);
    return {
      name: d.name,
      verdict: d.verdict,
      mismatchPercent: d.mismatchPercent,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
      ...(diff ? { diff } : {}),
    };
  });
  const label = version
    ? `approved baseline ${run.baselineRef?.name ?? run.name} (approved ${version.approvedAt})`
    : `approved baseline ${run.baselineRef?.name ?? run.name} (no longer approved)`;
  return { candidates, beforeLabel: label, ...(resolved.warning ? { warning: resolved.warning } : {}) };
}

// Compare mode: both runs' shots were already read by compareRuns, so the paths exist.
// There is no diff file on disk (the Compare panel writes none).
export function compareCandidates(
  stepDiffs: { name: string; mismatchPercent: number; verdict: StepDiffVerdict; aRel?: string; bRel?: string }[],
  aDirAbs: string,
  bDirAbs: string,
): PromptCandidate[] {
  return stepDiffs.map((s) => ({
    name: s.name,
    verdict: s.verdict,
    mismatchPercent: s.mismatchPercent,
    ...(s.aRel !== undefined && safeChildPath(aDirAbs, s.aRel) ? { before: safeChildPath(aDirAbs, s.aRel)! } : {}),
    ...(s.bRel !== undefined && safeChildPath(bDirAbs, s.bRel) ? { after: safeChildPath(bDirAbs, s.bRel)! } : {}),
  }));
}

export interface PlanPromptInput {
  mode: "baseline" | "compare";
  name: string;
  picks: Record<string, KeepSide>;
  hideBelow: number;
  candidates: PromptCandidate[];
  afterRun: RunResult;
  afterSummary: Summary;
  afterDirAbs: string;
  beforeLabel: string; // baseline mode: the approved-baseline label; compare mode: the absolute "a" run dir
  warning?: string;
  rootDir: string;
  cliPath: string;
  compareBeforeDirAbs?: string; // compare mode only
}

// Turns the user's picks into the prompt input, or the reason they can't be used (a 400).
export function planStepPrompt(i: PlanPromptInput): { ok: true; input: StepPromptInput } | { ok: false; message: string } {
  const valid = validatePicks(i.candidates, i.picks);
  if (!valid.ok) return valid;
  const steps: PromptStep[] = [];
  // Steps keep their run order, whatever order the picks arrived in.
  for (const c of i.candidates) {
    if (!Object.hasOwn(i.picks, c.name)) continue;
    const side = i.picks[c.name];
    if (!isCardStep(c, i.hideBelow)) return { ok: false, message: `step "${c.name}" is hidden at ${i.hideBelow}%; it cannot be marked` };
    if (c[side] === undefined) return { ok: false, message: `step "${c.name}" has no ${side} image to keep` };
    steps.push({
      name: c.name,
      side,
      verdict: c.verdict,
      mismatchPercent: c.mismatchPercent,
      ...(c.before ? { before: c.before } : {}),
      ...(c.after ? { after: c.after } : {}),
      ...(i.mode === "baseline" && c.diff ? { diff: c.diff } : {}),
    });
  }
  return {
    ok: true,
    input: {
      mode: i.mode,
      comparison: i.name,
      targetUrl: i.afterRun.targetUrl,
      beforeLabel: i.beforeLabel,
      afterDir: i.afterDirAbs,
      ...(i.warning ? { warning: i.warning } : {}),
      steps,
      hideBelow: i.hideBelow,
      rerun: buildRerunCommand(i.afterSummary.invocation, i.cliPath),
      ...(i.mode === "compare" && i.compareBeforeDirAbs
        ? { compareCheck: buildCompareCheckCommand(i.afterSummary.invocation?.cwd ?? i.rootDir, i.cliPath, i.compareBeforeDirAbs, i.name) }
        : {}),
    },
  };
}

export function buildRunIndex(dirs: RunDirInfo[], refs: Map<string, string[]>): RunIndexEntry[] {
  const index = dirs.map((d): RunIndexEntry => {
    const runs = d.summary?.runs ?? [];
    const worst = runs.reduce((m, r) => Math.max(m, r.mismatchPercent ?? 0), 0);
    // Thumbnail: the worst entry's main diff; bootstrap runs have no diff → target.
    const worstRun = runs.slice().sort((a, b) => (b.mismatchPercent ?? -1) - (a.mismatchPercent ?? -1))[0];
    const issues = runs.reduce((n, r) => n + countIssues(r), 0);
    return {
      dirName: d.dirName,
      mtimeMs: d.mtimeMs,
      sizeBytes: d.sizeBytes,
      keep: d.keep,
      unreadable: d.summary === null,
      lockedBy: refs.get(d.relPath) ?? [],
      entries: runs.map((r) => ({ name: r.name, mismatchPercent: r.mismatchPercent, bootstrap: r.bootstrap })),
      worstMismatch: worst,
      issues,
      thumbnail: worstRun ? worstRun.diff ?? worstRun.target : undefined,
      git: sanitizeGitInfo(d.summary?.git),
    };
  });
  return index.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export interface BaselineIndexEntry {
  name: string;
  approvedAt: string;
  approvedFrom: string;
  viewport: { width: number; height: number };
  sourceUrl: string;
  fullPage: boolean; // absent on the manifest entry = viewport capture
  stepCount: number;
  missing: string[]; // artifact paths (repo-root-relative) not found on disk
  versions: { index: number; approvedAt: string; approvedFrom: string; sourceUrl: string; fullPage: boolean; missing: string[] }[]; // previous versions, newest first
}

// One row per approved baseline. `exists` is injected (repo-root-relative path
// -> bool) so the "broken baseline" check stays pure; a baseline whose artifacts
// were deleted fails at run time otherwise.
export function buildBaselineIndex(manifest: Manifest | null, exists: (relPath: string) => boolean): BaselineIndexEntry[] {
  if (!manifest) return [];
  return Object.entries(manifest.baselines)
    .map(([name, e]): BaselineIndexEntry => {
      const artifacts = [e.artifacts.main, ...Object.values(e.artifacts.steps)];
      return {
        name,
        approvedAt: e.approvedAt,
        approvedFrom: e.approvedFrom,
        viewport: e.viewport,
        sourceUrl: e.sourceUrl,
        fullPage: e.fullPage === true,
        stepCount: Object.keys(e.artifacts.steps).length,
        missing: [...new Set(artifacts)].filter((p) => !exists(p)),
        versions: (e.history ?? []).map((v, index) => ({
          index,
          approvedAt: v.approvedAt,
          approvedFrom: v.approvedFrom,
          sourceUrl: v.sourceUrl,
          fullPage: v.fullPage === true,
          missing: versionArtifacts(v).filter((p) => !exists(p)),
        })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const TREND_MAX_POINTS = 50;

export interface TrendPoint {
  dirName: string;
  mtimeMs: number;
  mismatchPercent: number;
  heightDelta?: number; // px of page height not compared, when non-zero
  baselineType: string;
}

// Mismatch % (and height difference) over time, per comparison name, from the
// summary.json files already on disk. Bootstrap runs and runs with no mismatch
// value (nothing was diffed) are not data points; unreadable dirs are skipped.
// Oldest first, capped to the most recent TREND_MAX_POINTS per name.
export function buildTrends(dirs: RunDirInfo[]): Record<string, TrendPoint[]> {
  const byName: Record<string, TrendPoint[]> = {};
  for (const d of [...dirs].sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    for (const r of d.summary?.runs ?? []) {
      if (r.bootstrap || r.mismatchPercent === undefined) continue;
      (byName[r.name] ??= []).push({
        dirName: d.dirName,
        mtimeMs: d.mtimeMs,
        mismatchPercent: r.mismatchPercent,
        ...(r.heightDelta ? { heightDelta: r.heightDelta } : {}),
        baselineType: r.baselineType,
      });
    }
  }
  for (const name of Object.keys(byName)) byName[name] = byName[name].slice(-TREND_MAX_POINTS);
  return byName;
}

export interface RunFilter {
  text?: string; // lowercased; matches the run dir name or any entry name
  issues?: true; // only runs with issues
  locked?: true; // only baseline-referenced runs
  min?: number; // only runs whose worst mismatch is at least this percent
}

// Query string -> filter. Junk is ignored (an unknown value never hides runs).
export function parseRunFilter(params: URLSearchParams): RunFilter {
  const f: RunFilter = {};
  const q = (params.get("q") ?? "").trim().toLowerCase();
  if (q) f.text = q;
  if (params.get("issues") === "1") f.issues = true;
  if (params.get("locked") === "1") f.locked = true;
  const min = params.get("min");
  if (min !== null && min.trim() !== "" && Number.isFinite(Number(min)) && Number(min) >= 0) f.min = Number(min);
  return f;
}

// All conditions must hold (AND); order is preserved.
export function filterRuns(index: RunIndexEntry[], f: RunFilter): RunIndexEntry[] {
  return index.filter(
    (e) =>
      (f.text === undefined || e.dirName.toLowerCase().includes(f.text) || e.entries.some((x) => x.name.toLowerCase().includes(f.text!))) &&
      (!f.issues || e.issues > 0) &&
      (!f.locked || e.lockedBy.length > 0) &&
      (f.min === undefined || e.worstMismatch >= f.min),
  );
}

// Bulk cleanup: everything that is neither kept nor referenced by a baseline.
// (Per-run DELETE is allowed on keep dirs — only the manifest lock is absolute.)
export function cleanupSelection(index: RunIndexEntry[]): RunIndexEntry[] {
  return index.filter((e) => !e.keep && e.lockedBy.length === 0);
}

export interface WriteRequest {
  origin: string | null; // Origin header
  host: string | null; // Host header
  tailscaleLogin: string | null; // Tailscale-User-Login, set by `tailscale serve`
  writers: string[]; // allowlisted Tailscale logins (VIGRESS_DASHBOARD_WRITERS)
}

// Gate for every state-changing route (keep, delete, cleanup, approve).
// The server only listens on 127.0.0.1, so a request is either direct and local
// (no Tailscale header) or proxied by `tailscale serve`, which adds the caller's
// login. A browser Origin must match the Host so another page can't drive it.
export function isWriteAllowed(r: WriteRequest): { ok: true } | { ok: false; reason: string } {
  if (r.origin !== null) {
    let originHost: string | null = null;
    try {
      originHost = new URL(r.origin).host;
    } catch {
      /* unparseable Origin is rejected below */
    }
    if (originHost === null || originHost !== r.host) return { ok: false, reason: "cross-origin request refused" };
  }
  if (r.tailscaleLogin !== null) {
    const login = r.tailscaleLogin.toLowerCase();
    if (!r.writers.some((w) => w.toLowerCase() === login)) {
      return { ok: false, reason: `${r.tailscaleLogin} is not allowed to make changes (set VIGRESS_DASHBOARD_WRITERS)` };
    }
  }
  return { ok: true };
}

// decodeURIComponent throws on malformed %-sequences; callers map null to 403.
export function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

// Lexical traversal guard for /files/ requests. The caller decodes the URL
// path BEFORE calling this; the server additionally realpath-checks on disk
// (symlink escapes). null = reject with 403.
export function safeChildPath(rootAbs: string, requestPath: string): string | null {
  if (!requestPath || isAbsolute(requestPath)) return null;
  const segments = requestPath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || s.startsWith("."))) return null;
  const resolved = normalize(join(rootAbs, requestPath));
  if (resolved !== rootAbs && !resolved.startsWith(rootAbs + "/")) return null;
  return resolved;
}
