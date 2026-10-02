import { dirname, normalize, join, isAbsolute } from "node:path";
import type { Manifest } from "./baselines";
import type { Summary } from "./types";

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

export function buildRunIndex(dirs: RunDirInfo[], refs: Map<string, string[]>): RunIndexEntry[] {
  const index = dirs.map((d): RunIndexEntry => {
    const runs = d.summary?.runs ?? [];
    const worst = runs.reduce((m, r) => Math.max(m, r.mismatchPercent ?? 0), 0);
    // Thumbnail: the worst entry's main diff; bootstrap runs have no diff → target.
    const worstRun = runs.slice().sort((a, b) => (b.mismatchPercent ?? -1) - (a.mismatchPercent ?? -1))[0];
    const issues = runs.reduce(
      (n, r) =>
        n +
        r.steps.filter((s) => s.check && s.status === "failed").length +
        r.stepDiffs.filter((sd) => sd.verdict === "missing").length +
        r.regions.reduce((k, rg) => k + (rg.styleDiff?.filter((s) => !s.match).length ?? 0), 0),
      0,
    );
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
    };
  });
  return index.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

// Bulk cleanup: everything that is neither kept nor referenced by a baseline.
// (Per-run DELETE is allowed on keep dirs — only the manifest lock is absolute.)
export function cleanupSelection(index: RunIndexEntry[]): RunIndexEntry[] {
  return index.filter((e) => !e.keep && e.lockedBy.length === 0);
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
