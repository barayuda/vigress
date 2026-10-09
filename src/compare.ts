import type { Summary } from "./types";

// Pure planning for "compare two existing runs": which captures to diff. Paths come
// from summary.json (a file on disk), so callers must still treat them as untrusted.

export interface CompareSide {
  target: string; // relative to the run dir
  shots: Record<string, string>; // step shot name -> path relative to the run dir
}

export function commonRunNames(a: Summary, b: Summary): string[] {
  const inB = new Set(b.runs.map((r) => r.name));
  return [...new Set(a.runs.map((r) => r.name))].filter((n) => inB.has(n)).sort();
}

function side(s: Summary, name: string): CompareSide | null {
  const r = s.runs.find((x) => x.name === name);
  if (!r) return null;
  return { target: r.target, shots: Object.fromEntries(r.shots.map((sh) => [sh.name, sh.path])) };
}

export function planCompare(
  before: Summary,
  after: Summary,
  name: string,
): { ok: true; a: CompareSide; b: CompareSide } | { ok: false; message: string } {
  const a = side(before, name);
  if (!a) return { ok: false, message: `run '${name}' not in the before run — has: ${before.runs.map((r) => r.name).join(", ")}` };
  const b = side(after, name);
  if (!b) return { ok: false, message: `run '${name}' not in the after run — has: ${after.runs.map((r) => r.name).join(", ")}` };
  return { ok: true, a, b };
}
