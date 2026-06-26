import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Summary } from "./types";
import { buildReportHtml } from "./htmlReport";

// Writes summary.json + report.html into summary.outDir.
export function writeReport(summary: Summary): void {
  writeFileSync(join(summary.outDir, summary.summaryJson), JSON.stringify(summary, null, 2));
  writeFileSync(join(summary.outDir, summary.reportHtml), buildReportHtml(summary));
}
