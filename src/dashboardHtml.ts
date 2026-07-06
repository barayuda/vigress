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
  }
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
</script>
</body>
</html>`;
}
