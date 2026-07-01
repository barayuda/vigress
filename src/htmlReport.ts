import type { RunResult, RegionScore, Shot, StepResult, Summary } from "./types";
import type { ChecklistItem } from "./config";
import { stepSummary } from "./steps";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function styleDiffTable(r: RegionScore): string {
  if (!r.styleDiff?.length) return "";
  const mismatches = r.styleDiff.filter((s) => !s.match).length;
  const rows = r.styleDiff.map((s) => `
      <tr class="v-${s.match ? "pass" : "fail"}">
        <td>${esc(s.property)}</td>
        <td>${esc(s.target ?? "—")}</td>
        <td>${esc(s.baseline ?? "—")}</td>
        <td>${s.match ? "✓" : "✗"}</td>
      </tr>`).join("");
  return `
    <div class="style-label">${esc(r.name)} style: ${mismatches}/${r.styleDiff.length} mismatch(es)</div>
    <table class="regions style">
      <thead><tr><th>property</th><th>target</th><th>baseline</th><th>match</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function regionRows(regions: RegionScore[]): string {
  if (!regions.length) return "";
  const rows = regions.map((r) => `
      <tr class="v-${r.verdict}">
        <td>${esc(r.name)}</td>
        <td>${r.mismatchPercent}%</td>
        <td>${esc(r.verdict)}${r.reason !== r.verdict ? ` (${esc(r.reason)})` : ""}</td>
        <td>${r.diff ? `<img class="thumb" src="${esc(r.diff)}" alt="${esc(r.name)} diff">` : "—"}</td>
      </tr>`).join("");
  return `
    <table class="regions">
      <thead><tr><th>region</th><th>score</th><th>verdict</th><th>diff</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${regions.map(styleDiffTable).join("")}`;
}

function checklistList(items: ChecklistItem[]): string {
  if (!items.length) return "";
  const lis = items.map((c) => `<li class="v-${c.verdict}"><b>${esc(c.verdict)}</b> — ${esc(c.aspect)}${c.workaround ? ` <i>(${esc(c.workaround)})</i>` : ""}</li>`).join("");
  return `<ul class="checklist">${lis}</ul>`;
}

function shotStrip(shots: Shot[]): string {
  if (!shots.length) return "";
  const figs = shots.map((s) => `<figure><figcaption>${esc(s.name)}</figcaption><img src="${esc(s.path)}" alt="${esc(s.name)}"></figure>`).join("");
  return `<div class="shots"><div class="shots-label">flow shots</div><div class="imgs">${figs}</div></div>`;
}

function functionalitySteps(steps: StepResult[]): string {
  const checks = steps.filter((s) => s.check);
  if (!checks.length) return "";
  const { ok, total } = stepSummary(steps);
  const header = total ? `<div class="fn-label">functionality: ${ok}/${total} checks passed</div>` : "";
  const rows = checks.map((s) => `
      <tr class="v-${s.status === "ok" ? "pass" : "fail"}">
        <td>${s.index}</td>
        <td>${esc(s.action)}</td>
        <td>${s.selector ? esc(s.selector) : "—"}</td>
        <td>${s.status === "ok" ? "✓" : "✗"}${s.error ? ` <span class="fn-err">${esc(s.error)}</span>` : ""}</td>
      </tr>`).join("");
  return `${header}
    <table class="regions steps">
      <thead><tr><th>#</th><th>action</th><th>selector</th><th>result</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function card(r: RunResult): string {
  const video = r.video
    ? `<div class="vid"><video src="${esc(r.video)}" controls muted></video></div>`
    : "";
  return `
  <section class="card">
    <h2>${esc(r.name)} <span class="pct">${r.mismatchPercent}%</span>
      <span class="meta">${esc(r.baselineType)} · ${r.viewport.width}×${r.viewport.height} · ${r.mismatchPixels}px · ${esc(r.mode)}</span>
    </h2>
    <div class="imgs">
      <figure><figcaption>target</figcaption><img src="${esc(r.target)}" alt="target"></figure>
      <figure><figcaption>baseline</figcaption><img src="${esc(r.baseline)}" alt="baseline"></figure>
      <figure><figcaption>diff</figcaption><img src="${esc(r.diff)}" alt="diff"></figure>
    </div>
    ${regionRows(r.regions)}
    ${checklistList(r.checklist)}
    ${functionalitySteps(r.steps)}
    ${shotStrip(r.shots)}
    ${video}
  </section>`;
}

export function buildReportHtml(summary: Summary): string {
  const worst = summary.runs.reduce((m, r) => Math.max(m, r.mismatchPercent), 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vigress report</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f1f5f9;color:#232933}
  header{padding:16px 24px;background:#fff;border-bottom:1px solid #dcdfe4;position:sticky;top:0}
  header h1{margin:0 0 4px;font-size:18px}
  header .sum{color:#656f80}
  .card{background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:16px 24px;padding:16px}
  .card h2{margin:0 0 12px;font-size:16px;display:flex;gap:10px;align-items:baseline}
  .pct{color:#e2483d;font-weight:600}
  .meta{color:#656f80;font-weight:400;font-size:12px}
  .imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  figure{margin:0}
  figcaption{color:#656f80;font-size:12px;margin-bottom:4px}
  img{width:100%;border:1px solid #ebf0f1;background:#fff}
  .vid{margin-top:12px}
  video{max-width:100%;border:1px solid #ebf0f1}
  table.regions{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  table.regions th,table.regions td{text-align:left;padding:6px 8px;border-bottom:1px solid #ebf0f1;vertical-align:middle}
  .thumb{width:120px;border:1px solid #ebf0f1}
  tr.v-fail td,li.v-fail{color:#b42318}
  tr.v-pass td,li.v-pass{color:#067647}
  tr.v-unresolved td,li.v-unresolved{color:#a16207}
  ul.checklist{margin:12px 0 0;padding-left:18px}
  .shots{margin-top:12px}
  .shots-label{color:#656f80;font-size:12px;margin-bottom:4px}
  .fn-label{color:#656f80;font-size:12px;margin-top:12px}
  .fn-err{color:#b42318;font-size:12px}
  .style-label{color:#656f80;font-size:12px;margin-top:12px}
  table.regions.style td{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
</style>
</head>
<body>
<header>
  <h1>vigress visual report</h1>
  <div class="sum">${summary.runs.length} comparison(s) · worst mismatch ${worst}%</div>
</header>
${summary.runs.map(card).join("\n")}
</body>
</html>`;
}
