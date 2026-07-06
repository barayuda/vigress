import { join } from "node:path";
import type { Summary } from "./types";

// Machine-readable payload: same data as summary, artifact paths resolved to absolute.
export function buildJsonPayload(summary: Summary): object {
  const abs = (p: string): string => join(summary.outDir, p);
  return {
    schemaVersion: summary.schemaVersion,
    outDir: summary.outDir,
    reportHtml: abs(summary.reportHtml),
    summaryJson: abs(summary.summaryJson),
    runs: summary.runs.map((r) => ({
      name: r.name,
      baselineType: r.baselineType,
      viewport: r.viewport,
      mismatchPixels: r.mismatchPixels,
      mismatchPercent: r.mismatchPercent,
      target: abs(r.target),
      targetUrl: r.targetUrl,
      baseline: r.baseline ? abs(r.baseline) : undefined,
      diff: r.diff ? abs(r.diff) : undefined,
      video: r.video ? abs(r.video) : undefined,
      bootstrap: r.bootstrap,
      regions: r.regions.map((rg) => ({
        name: rg.name,
        mismatchPixels: rg.mismatchPixels,
        mismatchPercent: rg.mismatchPercent,
        verdict: rg.verdict,
        reason: rg.reason,
        targetBox: rg.targetBox,
        baselineBox: rg.baselineBox,
        diff: rg.diff ? abs(rg.diff) : undefined,
        styleDiff: rg.styleDiff,
      })),
      checklist: r.checklist,
      mode: r.mode,
      shots: r.shots.map((s) => ({ name: s.name, path: abs(s.path) })),
      steps: r.steps,
      stepDiffs: r.stepDiffs.map((d) => ({ ...d, diff: d.diff ? abs(d.diff) : undefined })),
    })),
  };
}
