// The dashboard page: a static document (HTML + CSS) whose behaviour is the plain
// JavaScript file dashboardClient.js, served at /app.js. Keeping the script in a real file
// (not inside a template literal) means no string escaping can corrupt it. All data
// arrives client-side from the /api routes; every run-provided string is rendered via
// textContent (never string-built HTML) so artifact/run names can't inject.
export function buildDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vigress dashboard</title>
<style>
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f1f5f9;color:#232933}
  header{padding:16px 24px;background:#fff;border-bottom:1px solid #dcdfe4;position:sticky;top:0;display:flex;gap:16px;align-items:baseline}
  header h1{margin:0;font-size:18px}
  header .sum{color:#656f80}
  header button{margin-left:auto}
  .row{background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:12px 24px;padding:12px;display:flex;gap:16px;align-items:center}
  .row.locked{opacity:.65}
  .thumb{width:140px;height:88px;object-fit:cover;object-position:top left;border:1px solid #ebf0f1;background:#fff;flex-shrink:0}
  .thumb.none{display:flex;align-items:center;justify-content:center;color:#656f80;font-size:12px}
  .info{flex:1;min-width:0}
  .name{font-weight:600}
  .meta{color:#656f80;font-size:12px}
  .badges span{display:inline-block;font-size:11px;border-radius:10px;padding:1px 8px;margin-right:6px}
  .b-locked{background:#f3f4f6;color:#374151}
  .b-keep{background:#e8f0fe;color:#1a56db}
  .b-unreadable{background:#fef3c7;color:#a16207}
  .b-issues{background:#fee2e2;color:#b42318}
  h2{margin:24px 24px 0;font-size:15px}
  table.tr{border-collapse:collapse;background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:8px 24px 0;width:calc(100% - 48px);font-size:13px}
  table.tr th,table.tr td{text-align:left;padding:6px 10px;border-bottom:1px solid #ebf0f1;vertical-align:middle}
  table.tr svg{display:block}
  table.tr .up{color:#b42318}
  table.tr .down{color:#067647}
  table.bl{border-collapse:collapse;background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:8px 24px 24px;width:calc(100% - 48px);font-size:13px}
  table.bl th,table.bl td{text-align:left;padding:6px 10px;border-bottom:1px solid #ebf0f1}
  table.bl .bad{color:#b42318}
  #baselines>.meta{margin:8px 24px}
  .detail{background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:-4px 24px 12px;padding:10px 16px;font-size:13px}
  .detail h3{margin:8px 0 2px;font-size:13px}
  .detail .bad{color:#b42318}
  .detail .ok{color:#067647}
  .detail ul{margin:2px 0 4px;padding-left:18px}
  .viewer{margin:6px 0 10px}
  .viewer .modes{display:flex;gap:6px;margin-bottom:6px}
  .viewer .modes button.on{background:#e8f0fe;border-color:#1a56db;color:#1a56db}
  .viewer .trio{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .viewer .trio figure{margin:0}
  .viewer figcaption{color:#656f80;font-size:11px}
  .viewer img{width:100%;border:1px solid #ebf0f1;background:#fff;display:block}
  .viewer .slider{position:relative}
  .viewer .slider .top{position:absolute;top:0;left:0}
  .viewer input[type=range]{width:100%;margin:6px 0 0}
  .runbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 24px 0;font-size:13px}
  .runbar select{font:inherit;padding:5px 8px;border:1px solid #dcdfe4;border-radius:5px;max-width:320px}
  .runbar .bad{color:#b42318}
  .runbar .ok{color:#067647}
  pre.tail{margin:6px 24px 0;padding:8px 12px;background:#fff;border:1px solid #dcdfe4;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word}
  .filters{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:10px 24px;font-size:13px}
  .filters input[type=search]{font:inherit;padding:5px 10px;border:1px solid #dcdfe4;border-radius:5px;min-width:220px}
  .filters input[type=number]{font:inherit;padding:5px 6px;border:1px solid #dcdfe4;border-radius:5px;width:64px}
  .filters label{display:flex;gap:5px;align-items:center;color:#656f80}
  .actions{display:flex;gap:8px;flex-shrink:0}
  button{font:inherit;padding:5px 12px;border:1px solid #dcdfe4;border-radius:5px;background:#fff;cursor:pointer}
  button:hover{background:#f1f5f9}
  button.danger{color:#b42318;border-color:#f3c4c0}
  button:disabled{opacity:.5;cursor:not-allowed}
  a.report{color:#1a56db;text-decoration:none;font-size:13px}
</style>
</head>
<body>
<header>
  <h1>vigress dashboard</h1>
  <div class="sum" id="summary">loading…</div>
  <button class="danger" id="cleanup">Cleanup</button>
</header>
<div class="runbar">
  <label>Run <select id="cfg"></select></label>
  <button id="run">Run</button>
  <span id="jobstatus"></span>
</div>
<pre class="tail" id="jobtail" hidden></pre>
<div class="runbar">
  <label>Compare <select id="cmp-a"></select></label>
  <label>→ <select id="cmp-b"></select></label>
  <label>name <select id="cmp-name"></select></label>
  <button id="cmp-go">Compare</button>
  <span id="cmp-status"></span>
</div>
<div id="cmpout" class="detail" hidden></div>
<div class="filters">
  <input type="search" id="q" placeholder="Filter by run or name…">
  <label><input type="checkbox" id="f-issues"> has issues</label>
  <label><input type="checkbox" id="f-locked"> baseline-locked</label>
  <label>worst mismatch ≥ <input type="number" id="f-min" min="0" step="0.5" placeholder="%"> %</label>
  <label style="margin-left:auto"><input type="checkbox" id="auto"> Auto-refresh</label>
</div>
<div id="runs"></div>
<h2>Trends</h2>
<div id="trends"></div>
<h2>Baselines</h2>
<div id="baselines"></div>
<script src="/app.js"></script>
</body>
</html>`;
}
