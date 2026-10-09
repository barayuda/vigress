import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunDirCandidate } from "./baselines";
import type { Summary } from "./types";

// I/O side of run-dir discovery: every out/<dir>/summary.json becomes a
// candidate; unreadable summaries are skipped (crashed/legacy runs).
export function loadRunDir(dir: string): RunDirCandidate | null {
  const sPath = join(dir, "summary.json");
  if (!existsSync(sPath)) return null;
  try {
    const summary = JSON.parse(readFileSync(sPath, "utf8")) as Summary;
    return { dir, mtimeMs: statSync(dir).mtimeMs, summary };
  } catch {
    return null;
  }
}

export function loadRunDirs(baseOut: string): RunDirCandidate[] {
  if (!existsSync(baseOut)) return [];
  return readdirSync(baseOut, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadRunDir(join(baseOut, d.name)))
    .filter((c): c is RunDirCandidate => c !== null);
}
