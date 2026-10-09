import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareRuns } from "../compareRuns";
import { commonRunNames } from "../compare";
import { loadRunDir } from "../runs";
import type { Ctx } from "./context";

// compare subcommand: diff the same-named capture of two EXISTING runs (before -> after),
// no baseline needed. Read-only; writes a diff image only when --diff <png> is given.
export async function compareCommand({ values, positionals }: Ctx): Promise<number> {
  const [, aArg, bArg] = positionals;
  if (!aArg || !bArg) {
    process.stderr.write("Usage: vigress compare <before-run-dir> <after-run-dir> [--name <run>] [--diff <out.png>] [--max-mismatch N] [--max-height-delta PX] [--json]\n");
    return 2;
  }
  const baseOut = resolve(typeof values.out === "string" ? values.out : process.env.VIGRESS_OUT ?? "out");
  // A run dir is a path, or a folder name under --out.
  const findDir = (arg: string): string => (existsSync(resolve(arg)) ? resolve(arg) : join(baseOut, arg));
  const A = loadRunDir(findDir(aArg));
  const B = loadRunDir(findDir(bArg));
  if (!A || !B) {
    process.stderr.write(`vigress compare: no readable summary.json in ${!A ? aArg : bArg}\n`);
    return 1;
  }
  const common = commonRunNames(A.summary, B.summary);
  const name = typeof values.name === "string" ? values.name : common.length === 1 ? common[0] : undefined;
  if (!name) {
    process.stderr.write(
      common.length
        ? `vigress compare: both runs have several comparisons — pass --name <${common.join("|")}>\n`
        : "vigress compare: the two runs have no comparison name in common\n",
    );
    return 2;
  }
  const threshold = typeof values.threshold === "string" ? Number(values.threshold) : 0.1;
  const maxMismatch = typeof values["max-mismatch"] === "string" ? Number(values["max-mismatch"]) : undefined;
  const res = compareRuns({ a: { dir: A.dir, summary: A.summary }, b: { dir: B.dir, summary: B.summary }, name, threshold, maxMismatch });
  if (!res.ok) {
    process.stderr.write(`vigress compare: ${res.message}\n`);
    return 1;
  }
  const r = res.result;
  let diffFile: string | undefined;
  if (typeof values.diff === "string") {
    diffFile = resolve(values.diff);
    writeFileSync(diffFile, r.diffPng);
  }
  if (values.json === true) {
    const { diffPng: _omit, ...rest } = r;
    process.stdout.write(JSON.stringify({ ...rest, before: A.dir, after: B.dir, diff: diffFile }) + "\n");
  } else {
    const sign = (n: number): string => (n > 0 ? "+" : "") + n;
    const counts = r.stepDiffs.reduce<Record<string, number>>((m, s) => ({ ...m, [s.verdict]: (m[s.verdict] ?? 0) + 1 }), {});
    process.stdout.write(
      `compare '${r.name}': ${aArg} -> ${bArg}\n` +
      `  mismatch ${r.mismatchPercent}% (${r.mismatchPixels}px over the common ${r.width}x${r.height} area)\n` +
      (r.heightDelta ? `  height ${sign(r.heightDelta)}px (after minus before) — that part was not compared\n` : "") +
      (r.widthDelta ? `  width ${sign(r.widthDelta)}px (after minus before)\n` : "") +
      (r.stepDiffs.length ? `  steps: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}\n` : "") +
      (diffFile ? `  diff written to ${diffFile}\n` : ""),
    );
  }
  // Same opt-in gates as a normal run; the % alone never fails.
  const maxHeightDelta = typeof values["max-height-delta"] === "string" ? Number(values["max-height-delta"]) : undefined;
  if (maxMismatch !== undefined && Math.max(r.mismatchPercent, ...r.stepDiffs.map((s) => s.mismatchPercent)) > maxMismatch) return 1;
  if (maxHeightDelta !== undefined && Math.abs(r.heightDelta) > maxHeightDelta) return 1;
  return 0;
}
