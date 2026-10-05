// The dashboard page: one static, self-contained document. All data arrives
// client-side from /api/runs; every run-provided string is rendered via
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
<script>
const fmtBytes = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
const fmtDate = (ms) => new Date(ms).toLocaleString();
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let index = [];
let lastJson = "";
const openDetails = new Set(); // run dirs whose Details panel is open; survives re-renders

function filterQuery() {
  const p = new URLSearchParams();
  const q = document.getElementById("q").value.trim();
  if (q) p.set("q", q);
  if (document.getElementById("f-issues").checked) p.set("issues", "1");
  if (document.getElementById("f-locked").checked) p.set("locked", "1");
  const min = document.getElementById("f-min").value;
  if (min !== "") p.set("min", min);
  return p.toString();
}

// force=false (auto-refresh) skips the re-render when nothing changed.
async function load(force = true) {
  const text = await (await fetch("/api/runs?" + filterQuery())).text();
  if (force || text !== lastJson) {
    lastJson = text;
    index = JSON.parse(text);
    render();
  }
  await loadBaselines();
  await loadTrends();
}

function img(src, alt) { const i = document.createElement("img"); i.src = src; i.alt = alt; i.loading = "lazy"; return i; }

// Baseline / target / diff, either side by side or as a drag-to-reveal overlay
// (target on top, clipped from the left by the range input).
function renderViewer(images) {
  const box = el("div", "viewer");
  const modes = el("div", "modes");
  const body = el("div");
  const trio = () => {
    const t = el("div", "trio");
    for (const [label, src] of [["Baseline · old", images.baseline], ["Target · new", images.target], ["Diff", images.diff]]) {
      if (!src) continue;
      const f = el("figure");
      f.appendChild(img(src, label));
      f.appendChild(el("figcaption", null, label));
      t.appendChild(f);
    }
    return t;
  };
  const slider = () => {
    const wrap = el("div");
    const stack = el("div", "slider");
    stack.appendChild(img(images.baseline, "baseline"));
    const top = img(images.target, "target");
    top.className = "top";
    stack.appendChild(top);
    const range = document.createElement("input");
    range.type = "range"; range.min = "0"; range.max = "100"; range.value = "50";
    const apply = () => { top.style.clipPath = "inset(0 0 0 " + range.value + "%)"; };
    range.oninput = apply; apply();
    wrap.appendChild(stack);
    wrap.appendChild(range);
    wrap.appendChild(el("div", "meta", "left of the handle: baseline · right: target"));
    return wrap;
  };
  const show = (mode, btn) => {
    for (const b of modes.children) b.classList.remove("on");
    btn.classList.add("on");
    body.replaceChildren(mode === "slider" ? slider() : trio());
  };
  const sideBtn = el("button", "on", "Side by side");
  sideBtn.onclick = () => show("side", sideBtn);
  modes.appendChild(sideBtn);
  if (images.baseline) {
    const sliderBtn = el("button", null, "Slider");
    sliderBtn.onclick = () => show("slider", sliderBtn);
    modes.appendChild(sliderBtn);
  }
  box.appendChild(modes);
  body.appendChild(trio());
  box.appendChild(body);
  return box;
}

function renderDetail(panel, entries) {
  const list = (items) => { const ul = el("ul"); for (const t of items) ul.appendChild(el("li", null, t)); return ul; };
  for (const e of entries) {
    panel.appendChild(el("h3", null, e.name +
      (e.bootstrap ? " (bootstrap)" : e.mismatchPercent !== undefined ? " — " + e.mismatchPercent + "%" : "") +
      (e.heightDelta ? " · height " + (e.heightDelta > 0 ? "+" : "") + e.heightDelta + "px not compared" : "")));
    panel.appendChild(renderViewer(e.images));
    if (!e.issues && !e.regions.length && !e.stepDiffs.length) { panel.appendChild(el("div", "ok", "nothing to review")); continue; }
    if (e.failedSteps.length) {
      panel.appendChild(el("div", "bad", "failed steps"));
      panel.appendChild(list(e.failedSteps.map((s) => "#" + s.index + " " + s.action + (s.selector ? " " + s.selector : "") + (s.error ? " — " + s.error : ""))));
    }
    if (e.regions.length) {
      panel.appendChild(el("div", null, "regions"));
      panel.appendChild(list(e.regions.map((g) => g.name + ": " + g.verdict + " (" + g.reason + ", " + g.mismatchPercent + "%)" +
        g.styleMismatches.map((s) => " · " + s.property + " " + s.target + " ≠ " + s.baseline).join(""))));
    }
    if (e.stepDiffs.length) {
      panel.appendChild(el("div", null, "step diffs"));
      panel.appendChild(list(e.stepDiffs.map((d) => d.name + ": " + d.verdict + " (" + d.mismatchPercent + "%)")));
    }
  }
}

function render() {
  const total = index.reduce((n, r) => n + r.sizeBytes, 0);
  document.getElementById("summary").textContent =
    index.length + " run(s) shown · " + fmtBytes(total);
  const root = document.getElementById("runs");
  root.replaceChildren();
  for (const r of index) {
    const row = el("div", "row" + (r.lockedBy.length ? " locked" : ""));
    if (r.thumbnail) {
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = "/files/" + encodeURIComponent(r.dirName) + "/" + r.thumbnail.split("/").map(encodeURIComponent).join("/");
      img.alt = "diff thumbnail";
      row.appendChild(img);
    } else {
      row.appendChild(el("div", "thumb none", "no image"));
    }
    const info = el("div", "info");
    info.appendChild(el("div", "name", r.dirName));
    info.appendChild(el("div", "meta",
      fmtDate(r.mtimeMs) + " · " + fmtBytes(r.sizeBytes) +
      (r.entries.length ? " · " + r.entries.map((e) => e.name + (e.bootstrap ? " (bootstrap)" : " " + (e.mismatchPercent ?? 0) + "%")).join(", ") : "") +
      (r.worstMismatch ? " · worst " + r.worstMismatch + "%" : "")));
    if (r.git) {
      const g = el("div", "meta");
      const label = (r.git.branch ? r.git.branch + "@" : "") + r.git.commit.slice(0, 7) + (r.git.dirty ? " (uncommitted changes)" : "");
      if (r.git.url) {
        // The server only passes on an exact github.com commit URL.
        const a = el("a", "report", label);
        a.href = r.git.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        g.appendChild(a);
      } else {
        g.textContent = label;
      }
      info.appendChild(g);
    }
    const badges = el("div", "badges");
    if (r.lockedBy.length) badges.appendChild(el("span", "b-locked", "🔒 baseline: " + r.lockedBy.join(", ")));
    if (r.keep) badges.appendChild(el("span", "b-keep", "keep"));
    if (r.unreadable) badges.appendChild(el("span", "b-unreadable", "unreadable"));
    if (r.issues) badges.appendChild(el("span", "b-issues", r.issues + " issue(s)"));
    info.appendChild(badges);
    row.appendChild(info);

    const actions = el("div", "actions");
    if (!r.unreadable) {
      const a = el("a", "report", "Open report");
      a.href = "/files/" + encodeURIComponent(r.dirName) + "/report.html";
      a.target = "_blank";
      actions.appendChild(a);
    }
    if (!r.unreadable && r.entries.length) {
      const approveBtn = el("button", null, "Approve");
      approveBtn.title = "Make this run's captures the approved baseline";
      approveBtn.onclick = async () => {
        const names = r.entries.map((e) => e.name).join(", ");
        if (!confirm("Approve " + names + " from " + r.dirName + "? This replaces their current baselines.")) return;
        const res = await fetch("/api/runs/" + encodeURIComponent(r.dirName) + "/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ all: true }),
        });
        const body = await res.json();
        if (!res.ok) { alert("Approve refused: " + body.error); return; }
        load();
      };
      actions.appendChild(approveBtn);
    }
    let panel = null;
    if (!r.unreadable) {
      panel = el("div", "detail");
      panel.hidden = true;
      const detailBtn = el("button", null, "Details");
      // Returns an error message, or null once the panel is showing.
      const showPanel = async () => {
        if (!panel.hasChildNodes()) {
          const res = await fetch("/api/runs/" + encodeURIComponent(r.dirName) + "/detail");
          if (!res.ok) return (await res.json()).error;
          renderDetail(panel, await res.json());
        }
        panel.hidden = false;
        return null;
      };
      detailBtn.onclick = async () => {
        if (!panel.hidden) { openDetails.delete(r.dirName); panel.hidden = true; return; }
        // Mark it open before the fetch: a re-render that lands meanwhile (auto-refresh,
        // a filter change) rebuilds the panel open instead of replacing it with a closed one.
        openDetails.add(r.dirName);
        const err = await showPanel();
        if (err) { openDetails.delete(r.dirName); alert("No details: " + err); }
      };
      actions.appendChild(detailBtn);
      if (openDetails.has(r.dirName)) showPanel();
    }
    const keepBtn = el("button", null, r.keep ? "Unkeep" : "Keep");
    keepBtn.onclick = async () => {
      await fetch("/api/runs/" + encodeURIComponent(r.dirName) + "/keep", { method: "POST" });
      load();
    };
    actions.appendChild(keepBtn);
    const delBtn = el("button", "danger", "Delete");
    delBtn.disabled = r.lockedBy.length > 0;
    delBtn.title = r.lockedBy.length ? "referenced by baseline: " + r.lockedBy.join(", ") : "";
    delBtn.onclick = async () => {
      if (!confirm("Delete " + r.dirName + " (" + fmtBytes(r.sizeBytes) + ")?")) return;
      const res = await fetch("/api/runs/" + encodeURIComponent(r.dirName), { method: "DELETE" });
      if (!res.ok) { alert("Delete refused: " + (await res.text())); return; }
      load();
    };
    actions.appendChild(delBtn);
    row.appendChild(actions);
    root.appendChild(row);
    if (panel) root.appendChild(panel);
  }
}

// Mismatch % over time as a tiny line; the y scale is per name (0 .. its own max, at least 1%).
function spark(points) {
  const NS = "http://www.w3.org/2000/svg", W = 160, H = 30;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 " + W + " " + H);
  svg.setAttribute("width", String(W));
  svg.setAttribute("height", String(H));
  const max = Math.max(1, ...points.map((p) => p.mismatchPercent));
  const x = (i) => points.length > 1 ? 3 + (i * (W - 6)) / (points.length - 1) : W / 2; // 3px margin so the last dot is not clipped
  const y = (p) => H - 2 - (p.mismatchPercent / max) * (H - 4);
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", points.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p).toFixed(1)).join(" "));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#1a56db");
  path.setAttribute("stroke-width", "1.5");
  svg.appendChild(path);
  const last = points[points.length - 1];
  const dot = document.createElementNS(NS, "circle");
  dot.setAttribute("cx", x(points.length - 1).toFixed(1));
  dot.setAttribute("cy", y(last).toFixed(1));
  dot.setAttribute("r", "2.5");
  dot.setAttribute("fill", "#1a56db");
  svg.appendChild(dot);
  const title = document.createElementNS(NS, "title");
  title.textContent = points.map((p) => new Date(p.mtimeMs).toLocaleString() + ": " + p.mismatchPercent + "%").join("\\n");
  svg.appendChild(title);
  return svg;
}

async function loadTrends() {
  const trends = await (await fetch("/api/trends")).json();
  const root = document.getElementById("trends");
  root.replaceChildren();
  const names = Object.keys(trends).sort();
  if (!names.length) { root.appendChild(el("div", "meta", "No comparisons yet.")); return; }
  const table = el("table", "tr");
  const head = el("tr");
  for (const h of ["name", "runs", "latest", "change", "trend"]) head.appendChild(el("th", null, h));
  table.appendChild(head);
  for (const n of names) {
    const pts = trends[n];
    const last = pts[pts.length - 1];
    const tr = el("tr");
    tr.appendChild(el("td", "name", n));
    tr.appendChild(el("td", null, String(pts.length)));
    tr.appendChild(el("td", null, last.mismatchPercent + "%" + (last.heightDelta ? " · height " + (last.heightDelta > 0 ? "+" : "") + last.heightDelta + "px" : "")));
    if (pts.length > 1) {
      const delta = Math.round((last.mismatchPercent - pts[pts.length - 2].mismatchPercent) * 100) / 100;
      tr.appendChild(el("td", delta > 0 ? "up" : delta < 0 ? "down" : null, delta > 0 ? "▲ +" + delta + "%" : delta < 0 ? "▼ " + delta + "%" : "no change"));
    } else {
      tr.appendChild(el("td", null, "—"));
    }
    const cell = el("td");
    cell.appendChild(spark(pts));
    tr.appendChild(cell);
    table.appendChild(tr);
  }
  root.appendChild(table);
}

async function loadBaselines() {
  const list = await (await fetch("/api/baselines")).json();
  const root = document.getElementById("baselines");
  root.replaceChildren();
  if (!list.length) { root.appendChild(el("div", "meta", "No approved baselines yet — run vigress approve.")); return; }
  const table = el("table", "bl");
  const head = el("tr");
  for (const h of ["name", "approved", "viewport", "capture", "steps", "source", "status"]) head.appendChild(el("th", null, h));
  table.appendChild(head);
  for (const b of list) {
    const tr = el("tr");
    tr.appendChild(el("td", "name", b.name));
    tr.appendChild(el("td", null, fmtDate(Date.parse(b.approvedAt))));
    tr.appendChild(el("td", null, b.viewport.width + "x" + b.viewport.height));
    tr.appendChild(el("td", null, b.fullPage ? "full page" : "viewport"));
    tr.appendChild(el("td", null, String(b.stepCount)));
    tr.appendChild(el("td", null, b.sourceUrl));
    tr.appendChild(b.missing.length
      ? el("td", "bad", b.missing.length + " artifact(s) missing")
      : el("td", null, "ok"));
    table.appendChild(tr);
  }
  root.appendChild(table);
}

document.getElementById("cleanup").onclick = async () => {
  // The server deletes every run that is neither kept nor locked, whatever the
  // list is filtered to — so the confirmation must list the unfiltered set.
  const all = await (await fetch("/api/runs")).json();
  const victims = all.filter((r) => !r.keep && !r.lockedBy.length);
  if (!victims.length) return alert("Nothing to clean up — every run is kept or baseline-referenced.");
  const total = victims.reduce((n, r) => n + r.sizeBytes, 0);
  const list = victims.map((r) => "  " + r.dirName).join("\\n");
  if (!confirm("Delete " + victims.length + " run(s), " + fmtBytes(total) + "?\\n\\n" + list)) return;
  const res = await fetch("/api/cleanup", { method: "POST" });
  const body = await res.json();
  alert("Deleted " + body.deleted.length + " run(s), freed " + fmtBytes(body.freedBytes));
  load();
};

// --- run a saved config (one job at a time; the server enforces it) ---
let polling = null;
const statusEl = document.getElementById("jobstatus");
const tailEl = document.getElementById("jobtail");

// Option values are "config:<file>" or "baseline:<name>"; the server re-validates both.
async function loadConfigs() {
  const { configs, baselines } = await (await fetch("/api/configs")).json();
  const sel = document.getElementById("cfg");
  sel.replaceChildren();
  const group = (label, kind, names) => {
    if (!names.length) return;
    const g = document.createElement("optgroup");
    g.label = label;
    for (const n of names) { const o = document.createElement("option"); o.value = kind + ":" + n; o.textContent = n; g.appendChild(o); }
    sel.appendChild(g);
  };
  group("Saved configs", "config", configs);
  group("Re-check an approved baseline", "baseline", baselines);
  if (!sel.options.length) { const o = document.createElement("option"); o.textContent = "nothing to run: no *.fullcheck.json in the repo root, no approved baselines"; sel.appendChild(o); }
  document.getElementById("run").disabled = !canRun();
}

const canRun = () => /^(config|baseline):./.test(document.getElementById("cfg").value);

function showJob(data) {
  const j = data.job;
  const runBtn = document.getElementById("run");
  statusEl.replaceChildren();
  tailEl.hidden = true;
  if (!j) { runBtn.disabled = !canRun(); return false; }
  const running = j.state === "running";
  runBtn.disabled = running || !canRun();
  if (running) {
    statusEl.appendChild(el("span", null, "running " + j.config + " since " + new Date(j.startedAt).toLocaleTimeString() + "…"));
    return true;
  }
  statusEl.appendChild(el("span", j.state === "done" ? "ok" : "bad",
    (j.state === "done" ? "finished " : "failed: ") + j.config +
    (j.state === "failed" ? " (" + (j.error || "exit " + j.exitCode) + ")" : "")));
  if (data.runDir) {
    const a = el("a", "report", " open report");
    a.href = "/files/" + encodeURIComponent(data.runDir) + "/report.html";
    a.target = "_blank";
    statusEl.appendChild(a);
  }
  if (j.state === "failed" && j.tail.length) { tailEl.textContent = j.tail.join("\\n"); tailEl.hidden = false; }
  return false;
}

async function pollJob() {
  const data = await (await fetch("/api/jobs")).json();
  const running = showJob(data);
  if (!running && polling) { clearInterval(polling); polling = null; load(); }
  return running;
}

function startPolling() {
  if (!polling) polling = setInterval(pollJob, 2000);
}

document.getElementById("run").onclick = async () => {
  const value = document.getElementById("cfg").value;
  const i = value.indexOf(":");
  const kind = value.slice(0, i), name = value.slice(i + 1);
  const what = kind === "baseline" ? "Re-check baseline " + name + "? This launches a browser, captures its source URL and diffs it against the approved capture."
                                   : "Run " + name + "? This launches a browser and visits the URLs in that file.";
  if (!confirm(what)) return;
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(kind === "baseline" ? { baseline: name } : { config: name }),
  });
  const body = await res.json();
  if (!res.ok) { alert("Run refused: " + body.error); return; }
  showJob(body);
  startPolling();
};

let typing = null;
document.getElementById("q").oninput = () => { clearTimeout(typing); typing = setTimeout(() => load(), 250); };
for (const id of ["f-issues", "f-locked", "f-min"]) document.getElementById(id).onchange = () => load();
setInterval(() => {
  if (document.getElementById("auto").checked && !document.hidden) load(false);
}, 5000);

load();
loadConfigs();
pollJob().then((running) => { if (running) startPolling(); });
</script>
</body>
</html>`;
}
