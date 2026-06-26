import type { RunResult, Summary } from "./types";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function card(r: RunResult): string {
  const video = r.video
    ? `<div class="vid"><video src="${esc(r.video)}" controls muted></video></div>`
    : "";
  return `
  <section class="card">
    <h2>${esc(r.name)} <span class="pct">${r.mismatchPercent}%</span>
      <span class="meta">${esc(r.baselineType)} · ${r.viewport.width}×${r.viewport.height} · ${r.mismatchPixels}px</span>
    </h2>
    <div class="imgs">
      <figure><figcaption>target</figcaption><img src="${esc(r.target)}" alt="target"></figure>
      <figure><figcaption>baseline</figcaption><img src="${esc(r.baseline)}" alt="baseline"></figure>
      <figure><figcaption>diff</figcaption><img src="${esc(r.diff)}" alt="diff"></figure>
    </div>
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
