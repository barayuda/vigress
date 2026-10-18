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

// True while the user is typing in a run's step review (the prompt box or the hide-below
// input): re-rendering the run list then would take their focus and selection away.
function typingInStepReview() {
  const a = document.activeElement;
  return !!a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && !!a.closest("#runs .steprev");
}

// force=false (auto-refresh) skips the re-render when nothing changed, and while the user is
// typing in a step review (lastJson is left alone, so a later tick catches up).
async function load(force = true) {
  const text = await (await fetch("/api/runs?" + filterQuery())).text();
  if (force || (text !== lastJson && !typingInStepReview())) {
    lastJson = text;
    index = JSON.parse(text);
    render();
  }
  await loadBaselines();
  await loadTrends();
  await fillCompare();
  await loadConfigs(); // a run just approved becomes a baseline you can re-check
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

// --- step review: mark each changed step screenshot "keep before" (a regression: fix the app)
// or "keep after" (intended: don't undo it), then copy one prompt for the agent. ---
// State lives here, keyed by "run:<dir>:<name>" or "cmp:<a>:<b>:<name>", so the auto-refresh
// re-render and a repeated Compare keep it.
const DEFAULT_HIDE_BELOW = 0.1; // %, display-only
const stepPicks = new Map(); // key -> Map(step -> "before" | "after")
const stepHideBelow = new Map(); // key -> number
const stepPromptText = new Map(); // key -> the box's text, edits included; absent = box closed
const stepPromptError = new Map(); // key -> why the server refused the last prompt request
const stepPromptSeq = new Map(); // key -> latest prompt request, so a slow older answer is ignored
const stepReviewLive = new Map(); // key -> redraw of the newest render (an answer can land after a re-render)
const brokenImages = new Set(); // image URLs that failed to load: their side is never offered

// Mirrors isCardStep in src/stepPrompt.ts: by mismatch %, never by verdict; new/missing always.
const isCardStep = (d, hideBelow) => d.verdict === "new" || d.verdict === "missing" || d.mismatchPercent > hideBelow;
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

// ctx: { key, stepDiffs, promptAllowed, baselineWarning?, promptBody: (picks, hideBelow) => object }
function renderStepReview(container, ctx) {
  const key = ctx.key;
  if (!stepPicks.has(key)) stepPicks.set(key, new Map());
  const picks = stepPicks.get(key);
  const hideBelow = () => stepHideBelow.has(key) ? stepHideBelow.get(key) : DEFAULT_HIDE_BELOW;
  const usable = (d, side) => d.sides.includes(side) && !!d.images[side] && !brokenImages.has(d.images[side]);
  // A pick the data no longer allows (step gone, side not offered, image broken) is dropped.
  for (const [step, side] of [...picks]) {
    const d = ctx.stepDiffs.find((x) => x.name === step);
    if (!d || !usable(d, side) || !isCardStep(d, hideBelow())) picks.delete(step);
  }

  const root = el("div", "steprev");
  const bar = el("div", "steprev-bar");
  bar.appendChild(el("strong", null, "Step screenshots"));
  const label = el("label", null, "hide steps at or below ");
  const input = document.createElement("input");
  input.type = "number"; input.step = "0.01"; input.min = "0"; input.className = "hidebelow";
  input.value = String(hideBelow());
  label.appendChild(input);
  label.appendChild(document.createTextNode(" %"));
  bar.appendChild(label);
  root.appendChild(bar);
  if (ctx.baselineWarning) root.appendChild(el("div", "bad", ctx.baselineWarning));
  if (ctx.promptAllowed) root.appendChild(el("div", "meta", "Click the side to keep: before = the after screenshot is a regression (fix the app), after = the change is intended (keep it)."));
  const cards = el("div", "stepcards");
  const quiet = el("div", "meta quiet");
  root.appendChild(cards);
  root.appendChild(quiet);
  const foot = el("div", "steprev-foot");
  const copyBtn = el("button", "copyprompt");
  const err = el("div", "bad prompterr");
  if (ctx.promptAllowed) foot.appendChild(copyBtn);
  else foot.appendChild(el("div", "meta localonly", "Copy prompt is available only on the machine running the dashboard."));
  root.appendChild(foot);
  root.appendChild(err);
  const promptBox = el("div", "promptbox");
  root.appendChild(promptBox);
  container.appendChild(root);

  const pickButtons = []; // { d, side, btn, cap }
  const refreshMarks = () => {
    for (const p of pickButtons) {
      const on = picks.get(p.d.name) === p.side;
      p.btn.classList.toggle("on", on);
      p.btn.setAttribute("aria-pressed", String(on));
      p.cap.textContent = on ? (p.side === "before" ? "Keep before: fix" : "Keep after: intended") : (p.side === "before" ? "Before" : "After");
    }
    let fix = 0, keep = 0;
    for (const side of picks.values()) side === "before" ? fix++ : keep++;
    copyBtn.textContent = "Copy prompt (" + plural(fix + keep, "step", "steps") + ") · " + fix + " fix · " + keep + " keep";
    copyBtn.disabled = fix + keep === 0;
  };

  const showPrompt = () => {
    err.textContent = stepPromptError.has(key) ? "Copy prompt refused: " + stepPromptError.get(key) : "";
    err.hidden = !stepPromptError.has(key);
    promptBox.replaceChildren();
    if (!stepPromptText.has(key)) return;
    const ta = el("textarea", "prompt");
    ta.value = stepPromptText.get(key);
    ta.rows = 14;
    ta.spellcheck = false;
    ta.oninput = () => stepPromptText.set(key, ta.value);
    const row = el("div", "promptrow");
    const copy = el("button", null, "Copy");
    const status = el("span", "meta copystatus");
    copy.onclick = async () => {
      try {
        if (!navigator.clipboard) throw new Error("no clipboard");
        await navigator.clipboard.writeText(ta.value);
        status.textContent = "Copied.";
      } catch {
        ta.focus();
        ta.select();
        status.textContent = "Press Ctrl+C to copy";
      }
    };
    row.appendChild(copy);
    row.appendChild(status);
    promptBox.appendChild(ta);
    promptBox.appendChild(row);
    promptBox.appendChild(el("div", "meta", "Changing a pick or the hide-below value rebuilds this text and discards edits."));
  };

  // The server builds the text (it alone has the absolute paths); a refusal is shown, not swallowed.
  const fetchPrompt = async () => {
    if (!ctx.promptAllowed) return;
    const seq = (stepPromptSeq.get(key) || 0) + 1;
    stepPromptSeq.set(key, seq);
    let res, body;
    try {
      res = await fetch("/api/step-prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ctx.promptBody(Object.fromEntries(picks), hideBelow())),
      });
      const text = await res.text();
      try { body = JSON.parse(text); } catch { body = { error: text || "HTTP " + res.status }; }
    } catch (e) {
      res = null;
      body = { error: String(e) };
    }
    if (stepPromptSeq.get(key) !== seq) return; // a newer request has been sent
    if (res && res.ok && typeof body.text === "string") {
      stepPromptText.set(key, body.text);
      stepPromptError.delete(key);
    } else {
      stepPromptText.delete(key);
      stepPromptError.set(key, body.error || "HTTP " + (res ? res.status : "error"));
    }
    stepReviewLive.get(key)();
  };

  // A change to the picks or hide-below rebuilds an open box (or closes it when nothing is marked).
  const changed = () => {
    refreshMarks();
    if (stepPromptError.delete(key)) showPrompt(); // that refusal was about the old picks
    if (!stepPromptText.has(key)) return;
    if (picks.size) fetchPrompt();
    else { stepPromptText.delete(key); showPrompt(); }
  };

  const thumb = (d, side, src) => {
    const isDiff = side === "diff";
    const f = el(isDiff ? "figure" : "button", isDiff ? "thumb" : "pick");
    const cap = el(isDiff ? "figcaption" : "span", "cap", side === "before" ? "Before" : side === "after" ? "After" : "Diff");
    if (!isDiff) {
      f.type = "button";
      f.dataset.side = side;
      f.disabled = true; // until its image has loaded
    }
    if (!src) {
      f.appendChild(el("div", "noimg", side === "before" ? "not in before" : side === "after" ? "not in after" : "no diff"));
      f.appendChild(cap);
      return f;
    }
    const image = img(src, d.name + " " + side);
    image.loading = "eager";
    f.appendChild(image);
    f.appendChild(cap);
    // Clickable only once the image is shown: a side whose image is missing or broken is never offered.
    if (isDiff || !ctx.promptAllowed || !usable(d, side)) return f;
    f.title = side === "before" ? "Keep before: the after screenshot is a regression" : "Keep after: the change is intended";
    const enable = () => { f.disabled = false; };
    if (image.complete && image.naturalWidth > 0) enable();
    else image.onload = enable;
    image.onerror = () => {
      brokenImages.add(src);
      f.disabled = true;
      f.title = "the image did not load";
      if (picks.get(d.name) === side) { picks.delete(d.name); changed(); }
    };
    pickButtons.push({ d, side, btn: f, cap });
    f.onclick = () => {
      if (picks.get(d.name) === side) picks.delete(d.name);
      else picks.set(d.name, side);
      changed();
    };
    return f;
  };

  const drawCards = () => {
    cards.replaceChildren();
    pickButtons.length = 0;
    const hb = hideBelow();
    const hidden = [];
    for (const d of ctx.stepDiffs) {
      if (!isCardStep(d, hb)) { hidden.push(d.name); continue; }
      const card = el("div", "stepcard");
      card.dataset.step = d.name;
      card.appendChild(el("div", "name", d.name + " · " + (d.verdict === "missing" ? "missing from the after run" :
        d.verdict === "new" ? "new in the after run" : d.mismatchPercent + "% differ")));
      const row = el("div", "thumbs");
      row.appendChild(thumb(d, "before", d.images.before));
      row.appendChild(thumb(d, "after", d.images.after));
      row.appendChild(thumb(d, "diff", d.images.diff));
      card.appendChild(row);
      cards.appendChild(card);
    }
    if (!cards.hasChildNodes()) cards.appendChild(el("div", "meta", "No step changed by more than " + hb + "%."));
    quiet.textContent = hidden.length ? plural(hidden.length, "step", "steps") + " at or below " + hb + "%, nothing to decide: " + hidden.join(", ") : "";
    quiet.hidden = !hidden.length;
  };

  input.oninput = () => {
    const v = input.value === "" ? NaN : Number(input.value);
    if (!Number.isFinite(v) || v < 0) return; // keep the last valid value while typing
    stepHideBelow.set(key, v);
    // Picks on cards that are now hidden are dropped; the others stay.
    for (const [step] of [...picks]) {
      const d = ctx.stepDiffs.find((x) => x.name === step);
      if (!d || !isCardStep(d, v)) picks.delete(step);
    }
    drawCards();
    changed();
  };
  copyBtn.onclick = fetchPrompt;
  stepReviewLive.set(key, showPrompt);

  drawCards();
  refreshMarks();
  showPrompt();
}

function renderDetail(panel, entries, dirName) {
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
      renderStepReview(panel, {
        key: "run:" + dirName + ":" + e.name,
        stepDiffs: e.stepDiffs,
        promptAllowed: e.promptAllowed,
        baselineWarning: e.baselineWarning,
        promptBody: (picks, hideBelow) => ({ mode: "baseline", dir: dirName, name: e.name, picks, hideBelow }),
      });
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
        if (!confirm("Approve " + names + " from " + r.dirName + "? The current baselines are kept in history, so you can roll back.")) return;
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
          renderDetail(panel, await res.json(), r.dirName);
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
  title.textContent = points.map((p) => new Date(p.mtimeMs).toLocaleString() + ": " + p.mismatchPercent + "%").join("\n");
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

// Older approved versions: compare with the current one, or roll back to the one just before.
// The server refuses a rollback onto files that no longer exist, and the replaced version is
// kept, so a rollback can be rolled back too.
function historyCell(b) {
  const td = el("td");
  if (!b.versions.length) { td.textContent = "—"; return td; }
  const v = b.versions[0];
  const dirOf = (rel) => rel.split("/").pop();
  td.title = b.versions.map((x) => "[" + x.index + "] " + new Date(x.approvedAt).toLocaleString() + " from " + x.approvedFrom).join(" | ");
  td.appendChild(el("span", null, b.versions.length + " previous "));
  const cmp = el("button", null, "Compare to previous");
  cmp.onclick = () => {
    const a = dirOf(v.approvedFrom), c = dirOf(b.approvedFrom);
    if (!cmpRuns.some((r) => r.dirName === a) || !cmpRuns.some((r) => r.dirName === c)) { alert("Those runs are no longer in the run list."); return; }
    cmpEl("cmp-a").value = a;
    cmpEl("cmp-b").value = c;
    fillCmpNames();
    cmpEl("cmp-name").value = b.name;
    cmpEl("cmp-go").click();
    cmpEl("cmp-a").scrollIntoView({ block: "center" });
  };
  td.appendChild(cmp);
  const rb = el("button", "danger", "Rollback");
  if (v.missing.length) { rb.disabled = true; rb.title = "its files are gone: " + v.missing.join(", "); }
  rb.onclick = async () => {
    if (!confirm("Roll back '" + b.name + "' to the version approved " + new Date(v.approvedAt).toLocaleString() + " from " + v.approvedFrom +
      "? The current baseline moves into history, so you can roll back again to undo.")) return;
    const res = await fetch("/api/baselines/" + encodeURIComponent(b.name) + "/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: v.index }),
    });
    const body = await res.json();
    if (!res.ok) { alert("Rollback refused: " + body.error); return; }
    load();
  };
  td.appendChild(rb);
  return td;
}

async function loadBaselines() {
  const list = await (await fetch("/api/baselines")).json();
  const root = document.getElementById("baselines");
  root.replaceChildren();
  if (!list.length) { root.appendChild(el("div", "meta", "No approved baselines yet — run vigress approve.")); return; }
  const table = el("table", "bl");
  const head = el("tr");
  for (const h of ["name", "approved", "viewport", "capture", "steps", "source", "status", "history"]) head.appendChild(el("th", null, h));
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
    tr.appendChild(historyCell(b));
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
  const list = victims.map((r) => "  " + r.dirName).join("\n");
  if (!confirm("Delete " + victims.length + " run(s), " + fmtBytes(total) + "?\n\n" + list)) return;
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
let lastCfgJson = "";
async function loadConfigs() {
  const text = await (await fetch("/api/configs")).text();
  if (text === lastCfgJson) return; // do not rebuild (and close) an open dropdown on every refresh
  lastCfgJson = text;
  const { configs, baselines } = JSON.parse(text);
  const sel = document.getElementById("cfg");
  const keep = sel.value;
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
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  if (!polling) document.getElementById("run").disabled = !canRun(); // a running job keeps it disabled
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
  if (j.state === "failed" && j.tail.length) { tailEl.textContent = j.tail.join("\n"); tailEl.hidden = false; }
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

// --- compare two existing runs (before -> after); computed on the fly, nothing is saved ---
let cmpRuns = [];
const cmpEl = (id) => document.getElementById(id);

function cmpNames() {
  const a = cmpRuns.find((r) => r.dirName === cmpEl("cmp-a").value);
  const b = cmpRuns.find((r) => r.dirName === cmpEl("cmp-b").value);
  const inB = new Set(b ? b.entries.map((e) => e.name) : []);
  return a ? [...new Set(a.entries.map((e) => e.name))].filter((n) => inB.has(n)).sort() : [];
}

function fillCmpNames() {
  const sel = cmpEl("cmp-name");
  const keep = sel.value;
  const names = cmpNames();
  sel.replaceChildren();
  for (const n of names) { const o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); }
  if (names.includes(keep)) sel.value = keep;
  cmpEl("cmp-go").disabled = names.length === 0;
  cmpEl("cmp-status").textContent = names.length ? "" : "pick two runs that share a comparison name";
}

let lastCmpJson = "";
async function fillCompare() {
  const text = await (await fetch("/api/runs")).text();
  if (text === lastCmpJson) return; // an auto-refresh must not rebuild (and close) an open dropdown
  lastCmpJson = text;
  cmpRuns = JSON.parse(text).filter((r) => !r.unreadable && r.entries.length);
  const keepA = cmpEl("cmp-a").value, keepB = cmpEl("cmp-b").value;
  for (const id of ["cmp-a", "cmp-b"]) {
    const sel = cmpEl(id);
    sel.replaceChildren();
    for (const r of cmpRuns) {
      const o = document.createElement("option");
      o.value = r.dirName;
      o.textContent = r.dirName + " (" + r.entries.map((e) => e.name).join(", ") + ")";
      sel.appendChild(o);
    }
  }
  // newest-first list: default is "the run before the newest" -> "the newest"
  const has = (v) => cmpRuns.some((r) => r.dirName === v);
  cmpEl("cmp-a").value = has(keepA) ? keepA : (cmpRuns[1] || cmpRuns[0] || { dirName: "" }).dirName;
  cmpEl("cmp-b").value = has(keepB) ? keepB : (cmpRuns[0] || { dirName: "" }).dirName;
  fillCmpNames();
}

cmpEl("cmp-a").onchange = fillCmpNames;
cmpEl("cmp-b").onchange = fillCmpNames;
cmpEl("cmp-go").onclick = async () => {
  const out = cmpEl("cmpout");
  const q = new URLSearchParams({ a: cmpEl("cmp-a").value, b: cmpEl("cmp-b").value, name: cmpEl("cmp-name").value });
  cmpEl("cmp-status").textContent = "comparing…";
  const res = await fetch("/api/compare?" + q.toString());
  const body = await res.json();
  cmpEl("cmp-status").textContent = "";
  out.replaceChildren();
  out.hidden = false;
  if (!res.ok) { out.appendChild(el("div", "bad", "Compare failed: " + body.error)); return; }
  const sign = (n) => (n > 0 ? "+" : "") + n;
  out.appendChild(el("h3", null, body.name + ": " + body.before + " → " + body.after + " — " + body.mismatchPercent + "% differ"));
  if (body.heightDelta) out.appendChild(el("div", "bad", "height " + sign(body.heightDelta) + "px (after minus before) — that part was not compared"));
  if (body.widthDelta) out.appendChild(el("div", "bad", "width " + sign(body.widthDelta) + "px (after minus before)"));
  out.appendChild(renderViewer(body.images));
  if (body.stepDiffs.length) {
    const a = body.before, b = body.after, name = body.name;
    renderStepReview(out, {
      key: "cmp:" + a + ":" + b + ":" + name,
      stepDiffs: body.stepDiffs,
      promptAllowed: body.promptAllowed,
      promptBody: (picks, hideBelow) => ({ mode: "compare", a, b, name, picks, hideBelow }),
    });
  }
};

let typing = null;
document.getElementById("q").oninput = () => { clearTimeout(typing); typing = setTimeout(() => load(), 250); };
for (const id of ["f-issues", "f-locked", "f-min"]) document.getElementById(id).onchange = () => load();
setInterval(() => {
  if (document.getElementById("auto").checked && !document.hidden) load(false);
}, 5000);

load();
pollJob().then((running) => { if (running) startPolling(); });
