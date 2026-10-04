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
  table.bl{border-collapse:collapse;background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:8px 24px 24px;width:calc(100% - 48px);font-size:13px}
  table.bl th,table.bl td{text-align:left;padding:6px 10px;border-bottom:1px solid #ebf0f1}
  table.bl .bad{color:#b42318}
  .detail{background:#fff;border:1px solid #dcdfe4;border-radius:6px;margin:-4px 24px 12px;padding:10px 16px;font-size:13px}
  .detail h3{margin:8px 0 2px;font-size:13px}
  .detail .bad{color:#b42318}
  .detail .ok{color:#067647}
  .detail ul{margin:2px 0 4px;padding-left:18px}
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
<div id="runs"></div>
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

async function load() {
  index = await (await fetch("/api/runs")).json();
  render();
}

function renderDetail(panel, entries) {
  const list = (items) => { const ul = el("ul"); for (const t of items) ul.appendChild(el("li", null, t)); return ul; };
  for (const e of entries) {
    panel.appendChild(el("h3", null, e.name +
      (e.bootstrap ? " (bootstrap)" : e.mismatchPercent !== undefined ? " — " + e.mismatchPercent + "%" : "") +
      (e.heightDelta ? " · height " + (e.heightDelta > 0 ? "+" : "") + e.heightDelta + "px not compared" : "")));
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
    index.length + " run(s) · " + fmtBytes(total);
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
      detailBtn.onclick = async () => {
        if (!panel.hidden) { panel.hidden = true; return; }
        if (!panel.hasChildNodes()) {
          const res = await fetch("/api/runs/" + encodeURIComponent(r.dirName) + "/detail");
          if (!res.ok) { alert("No details: " + (await res.json()).error); return; }
          renderDetail(panel, await res.json());
        }
        panel.hidden = false;
      };
      actions.appendChild(detailBtn);
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
  const victims = index.filter((r) => !r.keep && !r.lockedBy.length);
  if (!victims.length) return alert("Nothing to clean up — every run is kept or baseline-referenced.");
  const total = victims.reduce((n, r) => n + r.sizeBytes, 0);
  const list = victims.map((r) => "  " + r.dirName).join("\\n");
  if (!confirm("Delete " + victims.length + " run(s), " + fmtBytes(total) + "?\\n\\n" + list)) return;
  const res = await fetch("/api/cleanup", { method: "POST" });
  const body = await res.json();
  alert("Deleted " + body.deleted.length + " run(s), freed " + fmtBytes(body.freedBytes));
  load();
};

load();
loadBaselines();
</script>
</body>
</html>`;
}
