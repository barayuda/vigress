import { dirname, normalize, join, isAbsolute } from "node:path";
import type { Manifest } from "./baselines";
import type { RunResult, Summary, StepDiffVerdict, RegionVerdict, GitInfo } from "./types";
import { sanitizeGitInfo } from "./gitinfo";

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
    add(entry.approvedFrom, name);
    add(dirname(entry.artifacts.main), name);
    for (const p of Object.values(entry.artifacts.steps)) add(dirname(p), name);
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
  stepDiffs: { name: string; verdict: StepDiffVerdict; mismatchPercent: number }[];
}

// What the dashboard shows when a run is expanded: the parts of summary.json a
// reviewer acts on, without the artifact paths (those are served via /files/).
export function buildRunDetail(summary: Summary, dirName: string): RunDetailEntry[] {
  return summary.runs.map((r) => ({
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
    stepDiffs: r.stepDiffs.map((d) => ({ name: d.name, verdict: d.verdict, mismatchPercent: d.mismatchPercent })),
  }));
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
