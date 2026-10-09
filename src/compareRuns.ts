import { existsSync, readFileSync } from "node:fs";
import { diffPngData } from "./diff";
import { planCompare } from "./compare";
import { safeChildPath } from "./dashboard";
import { stepDiffVerdict } from "./baselines";
import type { Summary, StepDiffVerdict } from "./types";

// Shared by `vigress compare` and the dashboard: diff the same-named capture of two
// existing runs ("before" and "after"). Reads the PNGs, writes nothing.

export interface CompareInput {
  a: { dir: string; summary: Summary }; // before (absolute run dir)
  b: { dir: string; summary: Summary }; // after
  name: string;
  threshold?: number;
  maxMismatch?: number;
}

export interface CompareResult {
  name: string;
  mismatchPixels: number;
  mismatchPercent: number;
  width: number; // common area compared
  height: number;
  widthDelta: number; // after minus before
  heightDelta: number;
  stepDiffs: { name: string; mismatchPercent: number; verdict: StepDiffVerdict }[];
  diffPng: Buffer;
  aTarget: string; // paths relative to each run dir, for building file URLs
  bTarget: string;
}

export function compareRuns(i: CompareInput): { ok: true; result: CompareResult } | { ok: false; message: string } {
  const plan = planCompare(i.a.summary, i.b.summary, i.name);
  if (!plan.ok) return plan;

  // summary.json is a file on disk: a path in it must stay inside its own run dir.
  const read = (dir: string, rel: string, what: string): { ok: true; data: Buffer } | { ok: false; message: string } => {
    const abs = safeChildPath(dir, rel);
    if (!abs) return { ok: false, message: `unsafe path in summary.json for ${what}: ${rel}` };
    if (!existsSync(abs)) return { ok: false, message: `capture missing for ${what}: ${rel}` };
    return { ok: true, data: readFileSync(abs) };
  };

  const at = read(i.a.dir, plan.a.target, "the before target");
  if (!at.ok) return at;
  const bt = read(i.b.dir, plan.b.target, "the after target");
  if (!bt.ok) return bt;
  const main = diffPngData(at.data, bt.data, i.threshold);

  const stepDiffs: CompareResult["stepDiffs"] = [];
  for (const [shot, bRel] of Object.entries(plan.b.shots)) {
    const aRel = plan.a.shots[shot];
    if (aRel === undefined) { stepDiffs.push({ name: shot, mismatchPercent: 0, verdict: "new" }); continue; }
    const sa = read(i.a.dir, aRel, `before step '${shot}'`);
    if (!sa.ok) return sa;
    const sb = read(i.b.dir, bRel, `after step '${shot}'`);
    if (!sb.ok) return sb;
    const d = diffPngData(sa.data, sb.data, i.threshold);
    stepDiffs.push({ name: shot, mismatchPercent: d.mismatchPercent, verdict: stepDiffVerdict(true, true, d.mismatchPercent, i.maxMismatch) });
  }
  for (const shot of Object.keys(plan.a.shots)) {
    if (!(shot in plan.b.shots)) stepDiffs.push({ name: shot, mismatchPercent: 0, verdict: "missing" });
  }

  return {
    ok: true,
    result: {
      name: i.name,
      mismatchPixels: main.mismatchPixels,
      mismatchPercent: main.mismatchPercent,
      width: main.width,
      height: main.height,
      widthDelta: main.widthDelta,
      heightDelta: main.heightDelta,
      stepDiffs,
      diffPng: main.diffPng,
      aTarget: plan.a.target,
      bTarget: plan.b.target,
    },
  };
}
