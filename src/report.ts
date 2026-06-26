import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Summary } from "./types";
import { buildReportHtml } from "./htmlReport";

function checklistMd(summary: Summary): string {
  const lines: string[] = ["# vigress checklist", ""];
  for (const r of summary.runs) {
    lines.push(`## ${r.name} — ${r.mismatchPercent}% overall`);
    if (r.checklist.length) {
      for (const c of r.checklist) {
        lines.push(`- [${c.verdict === "pass" ? "x" : " "}] **${c.verdict}** ${c.aspect}${c.region ? ` (region: ${c.region})` : ""}${c.workaround ? ` — _${c.workaround}_` : ""}`);
      }
    } else {
      lines.push("- _(no checklist items)_");
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function writeReport(summary: Summary): void {
  writeFileSync(join(summary.outDir, summary.summaryJson), JSON.stringify(summary, null, 2));
  writeFileSync(join(summary.outDir, summary.reportHtml), buildReportHtml(summary));
  writeFileSync(join(summary.outDir, "checklist.md"), checklistMd(summary));
}
