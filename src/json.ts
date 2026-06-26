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
      baseline: abs(r.baseline),
      diff: abs(r.diff),
      video: r.video ? abs(r.video) : undefined,
    })),
  };
}
