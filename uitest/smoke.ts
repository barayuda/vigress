// Opt-in UI smoke test for the dashboard: `bun run test:ui`.
//
// Unit tests (`bun test`) cover the pure logic only. This drives the REAL dashboard with a
// REAL browser against a throwaway repo, so the page script and its races stay covered:
// filters, the Cleanup safety confirmation, Details surviving an auto-refresh, approve,
// rollback, compare, trends, git links, running a saved config / re-checking a baseline, and
// the step review (keep before / keep after cards and the copy-prompt box).
// It needs an installed browser (VIGRESS_BROWSER, default chrome) and takes about a minute.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import type { Page } from "playwright";
import { launchBrowser } from "../src/browser";
import { buildManifestEntry, emptyManifest, parseManifest, upsertBaseline, writeManifest } from "../src/baselines";
import type { RunResult } from "../src/types";

const ROOT = join(import.meta.dir, "..");
const failures: string[] = [];
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

// ---- a throwaway repo ------------------------------------------------------------
const repo = mkdtempSync(join(tmpdir(), "vigress-ui-"));
const SHA = "0123456789abcdef0123456789abcdef01234567";
let seeded = 0;

function png(rgb: [number, number, number] = [120, 120, 220]): Buffer {
  const p = new PNG({ width: 40, height: 30 });
  for (let i = 0; i < 40 * 30; i++) { p.data[i * 4] = rgb[0]; p.data[i * 4 + 1] = rgb[1]; p.data[i * 4 + 2] = rgb[2]; p.data[i * 4 + 3] = 255; }
  return PNG.sync.write(p);
}

function seedRun(dir: string, name: string, pct: number, opts: { failedStep?: boolean; gitUrl?: string } = {}): void {
  const d = join(repo, "out", dir);
  mkdirSync(d, { recursive: true });
  for (const f of ["target", "baseline", "diff"]) writeFileSync(join(d, `${name}.${f}.png`), png());
  const run: RunResult = {
    name, baselineType: "url", viewport: { width: 1440, height: 900 }, mismatchPixels: 1, mismatchPercent: pct,
    target: `${name}.target.png`, baseline: `${name}.baseline.png`, diff: `${name}.diff.png`, targetUrl: `https://app.test/${name}`,
    regions: [], checklist: [], mode: "steps", shots: [], stepDiffs: [],
    steps: opts.failedStep ? [{ index: 1, action: "click", selector: "#x", check: true, status: "failed", error: "not found" }] : [],
  };
  const summary = {
    schemaVersion: 10, outDir: "/x", reportHtml: "report.html", summaryJson: "summary.json", runs: [run],
    ...(opts.gitUrl ? { git: { commit: SHA, branch: "feat/demo", dirty: false, url: opts.gitUrl } } : {}),
  };
  writeFileSync(join(d, "summary.json"), JSON.stringify(summary));
  const t = new Date(2026, 9, 1, 10 + seeded++);
  utimesSync(d, t, t);
}

seedRun("2026-10-01_a", "contact", 0.5, { gitUrl: `https://github.com/o/r/commit/${SHA}` });
seedRun("2026-10-02_b", "billing", 9, { failedStep: true });
seedRun("2026-10-03_c", "contact", 3);
seedRun("2026-10-04_d", "misc", 1);
seedRun("2026-10-05_e", "tamper", 2, { gitUrl: "javascript:alert(1)" });
// contact: current = run c, previous version = run a  (locks both)
const entry = (dir: string, name: string, at: string) => buildManifestEntry(
  { name, baselineType: "url", viewport: { width: 1440, height: 900 }, target: `${name}.target.png`, targetUrl: `https://app.test/${name}`, regions: [], checklist: [], mode: "steps", shots: [], steps: [], stepDiffs: [] },
  `out/${dir}`, at);
let manifest = upsertBaseline(emptyManifest(), "contact", entry("2026-10-01_a", "contact", "2026-10-01T00:00:00Z"));
manifest = upsertBaseline(manifest, "contact", entry("2026-10-03_c", "contact", "2026-10-03T00:00:00Z"));
writeManifest(join(repo, "baselines", "manifest.json"), manifest);

// ---- step review: an approved "flow" baseline with three step shots, and a run against it --
// s1 changed (3%, but verdict "ok": cards go by mismatchPercent, not verdict), s2 barely (0.05%,
// under the default hide-below of 0.1%), s3 is missing from the after run. Seeded late, so the
// earlier checks see the run list they expect.
const FLOW_BASE = "2026-10-07_flowbase";
const FLOW_AFTER = "2026-10-08_flowafter";
const FLOW_APPROVED_AT = "2026-10-07T12:00:00.000Z";
const DO_NOT_APPROVE = "Do not run `vigress approve`, `--update-baseline` or `vigress before`. Stop and tell me what you changed; I will approve it myself.";
const LOCAL_ONLY = "Copy prompt is available only on the machine running the dashboard.";
const REBUILD_HINT = "Changing a pick or the hide-below value rebuilds this text and discards edits.";

function seedFlow(): void {
  const write = (dir: string, files: Record<string, Buffer>, run: RunResult, when: Date): void => {
    const d = join(repo, "out", dir);
    mkdirSync(d, { recursive: true });
    for (const [f, buf] of Object.entries(files)) writeFileSync(join(d, f), buf);
    writeFileSync(join(d, "summary.json"), JSON.stringify({
      schemaVersion: 11, outDir: d, reportHtml: "report.html", summaryJson: "summary.json",
      invocation: { cwd: repo, argv: ["after", "flow"] }, runs: [run],
    }));
    utimesSync(d, when, when);
  };
  const shots = (names: string[]) => names.map((n) => ({ name: n, path: `flow.${n}.png` }));
  const common = { name: "flow", viewport: { width: 1440, height: 900 }, target: "flow.target.png", targetUrl: "https://app.test/flow", regions: [], checklist: [], mode: "steps" as const, steps: [] };
  const baseRun: RunResult = { ...common, baselineType: "url", shots: shots(["s1", "s2", "s3"]), stepDiffs: [] };
  write(FLOW_BASE, { "flow.target.png": png(), "flow.s1.png": png(), "flow.s2.png": png(), "flow.s3.png": png() }, baseRun, new Date(2026, 9, 7, 12));
  const afterRun: RunResult = {
    ...common, baselineType: "baseline", mismatchPixels: 0, mismatchPercent: 0, baseline: "flow.baseline.png", diff: "flow.diff.png",
    shots: shots(["s1", "s2"]),
    stepDiffs: [
      { name: "s1", mismatchPercent: 3, diff: "flow.s1.diff.png", verdict: "ok" },
      { name: "s2", mismatchPercent: 0.05, diff: "flow.s2.diff.png", verdict: "ok" },
      { name: "s3", mismatchPercent: 0, verdict: "missing" },
    ],
    baselineRef: { name: "flow", approvedAt: FLOW_APPROVED_AT },
  };
  write(FLOW_AFTER, {
    "flow.target.png": png(), "flow.baseline.png": png(), "flow.diff.png": png(),
    "flow.s1.png": png([220, 60, 60]), "flow.s2.png": png(), "flow.s1.diff.png": png([255, 0, 255]), "flow.s2.diff.png": png(),
  }, afterRun, new Date(2026, 9, 8, 12));
  // The dashboard has changed the manifest by now (rollbacks, approvals): add to what is there.
  const file = join(repo, "baselines", "manifest.json");
  writeManifest(file, upsertBaseline(parseManifest(readFileSync(file, "utf8")), "flow", buildManifestEntry(baseRun, `out/${FLOW_BASE}`, FLOW_APPROVED_AT)));
}

// ---- two tiny pages for the "run a saved config" part ---------------------------
const pages = Bun.serve({
  port: 0,
  fetch: (r) => new Response(
    new URL(r.url).pathname === "/c.html"
      ? '<body style="margin:0"><div style="height:800px;background:#ccd"><div style="height:100px;background:#c33"></div></div>'
      : '<body style="margin:0"><div style="height:800px;background:#ccd"></div>',
    { headers: { "content-type": "text/html" } },
  ),
});
const site = `http://127.0.0.1:${pages.port}`;
writeFileSync(join(repo, "t.fullcheck.json"), JSON.stringify([{ name: "t", target: `${site}/a.html`, against: `${site}/c.html`, video: false, steps: [] }]));

// ---- the real dashboard ------------------------------------------------------------
const WRITER = "writer@example.com";
const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = probe.port;
probe.stop(true);
const dash = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "dashboard", "--port", String(port), "--out", "out"], {
  cwd: repo, stdout: "ignore", stderr: "inherit",
  // WRITER passes the write guard over "tailscale serve", so the step-prompt route's own
  // local-only refusal is what answers it.
  env: { ...process.env, VIGRESS_BROWSER: process.env.VIGRESS_BROWSER ?? "chrome", VIGRESS_DASHBOARD_WRITERS: WRITER },
});
const base = `http://127.0.0.1:${port}`;

async function ready(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + "/api/runs")).ok) return; } catch { /* not up yet */ }
    await Bun.sleep(500);
  }
  throw new Error("dashboard did not start");
}

async function main(): Promise<void> {
  await ready();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const problems: string[] = [];
  // Failures provoked on purpose later on, as "<status> <path>".
  const expected = new Set<string>();
  const watch = (p: Page): void => {
    p.on("pageerror", (e) => problems.push("pageerror: " + String(e)));
    // Refusals this test provokes on purpose (a locked delete: 403, a second run: 409) are not problems.
    p.on("response", (r) => {
      const deliberate = r.request().method() !== "GET" && (r.status() === 403 || r.status() === 409);
      const what = `${r.status()} ${r.url().replace(base, "")}`;
      if (r.status() >= 400 && !deliberate && !expected.has(what) && !r.url().includes("favicon")) problems.push(what);
    });
  };
  watch(page);
  let nextDialog: "accept" | "dismiss" = "accept";
  let lastDialog = "";
  page.on("dialog", async (d) => { lastDialog = d.message(); await (nextDialog === "accept" ? d.accept() : d.dismiss()); });

  const rows = () => page.locator("#runs .row .name").allTextContents();
  const settle = () => page.waitForTimeout(700);
  const reload = async () => { await page.goto(base + "/"); await page.waitForSelector("#runs .row"); await page.waitForSelector("#baselines table.bl"); };

  // 1. page loads and lists every run
  await reload();
  check("lists all seeded runs, newest first", JSON.stringify(await rows()) === JSON.stringify(["2026-10-05_e", "2026-10-04_d", "2026-10-03_c", "2026-10-02_b", "2026-10-01_a"]), JSON.stringify(await rows()));

  // 2. filters
  await page.fill("#q", "billing"); await settle();
  check("text filter", JSON.stringify(await rows()) === '["2026-10-02_b"]');
  await page.fill("#q", ""); await settle();
  await page.check("#f-issues"); await settle();
  check("has-issues filter", JSON.stringify(await rows()) === '["2026-10-02_b"]');
  await page.uncheck("#f-issues"); await page.check("#f-locked"); await settle();
  check("baseline-locked filter includes the history version's run dir", JSON.stringify(await rows()) === '["2026-10-03_c","2026-10-01_a"]', JSON.stringify(await rows()));
  await page.uncheck("#f-locked"); await page.fill("#f-min", "5"); await page.dispatchEvent("#f-min", "change"); await settle();
  check("min-mismatch filter", JSON.stringify(await rows()) === '["2026-10-02_b"]');

  // 3. Cleanup must list the UNFILTERED deletable runs (the server deletes all of them)
  nextDialog = "dismiss";
  await page.click("#cleanup"); await settle();
  check("Cleanup dialog lists every deletable run while filtered", ["2026-10-02_b", "2026-10-04_d", "2026-10-05_e"].every((d) => lastDialog.includes(d)), lastDialog);
  check("Cleanup dialog never lists locked runs", !lastDialog.includes("2026-10-03_c") && !lastDialog.includes("2026-10-01_a"));
  nextDialog = "accept";
  await page.fill("#f-min", ""); await page.dispatchEvent("#f-min", "change"); await settle();

  // 4. git links: a real GitHub commit URL is linked, a tampered one is not
  const links = await page.locator("#runs .row").evaluateAll((rs) => rs.map((r) => ({ name: r.querySelector(".name")!.textContent, href: r.querySelector(".info .meta a")?.getAttribute("href") ?? null })));
  check("valid commit URL becomes a link", links.find((l) => l.name === "2026-10-01_a")?.href === `https://github.com/o/r/commit/${SHA}`);
  check("a javascript: URL in summary.json is never linked", links.find((l) => l.name === "2026-10-05_e")?.href === null);

  // 5. Details: content, viewer, slider
  const rowB = page.locator("#runs .row", { hasText: "2026-10-02_b" });
  await rowB.getByRole("button", { name: "Details" }).click();
  await page.waitForSelector(".detail:not([hidden]) .viewer img");
  await page.waitForFunction(() => [...document.querySelectorAll(".detail .viewer img")].every((i) => (i as HTMLImageElement).naturalWidth > 0));
  check("Details shows the failed step", (await page.locator(".detail:not([hidden])").first().textContent())!.includes("not found"));
  await page.getByRole("button", { name: "Slider" }).first().click();
  await page.locator(".detail:not([hidden]) input[type=range]").first().fill("30");
  check("slider clips the target image", (await page.locator(".detail:not([hidden]) .slider .top").first().evaluate((e) => (e as HTMLElement).style.clipPath)).includes("30%"));

  // 6. the Details panel must survive an auto-refresh re-render (regression: it came back closed)
  await page.check("#auto");
  seedRun("2026-10-06_f", "late", 1);
  await page.waitForFunction(() => document.querySelectorAll("#runs .row").length === 6, null, { timeout: 12000 });
  check("auto-refresh picks up a new run", true);
  check("an open Details panel stays open after the re-render", (await page.locator(".detail:not([hidden])").count()) >= 1);
  await page.uncheck("#auto");

  // 7. trends
  await reload();
  const trend = await page.locator("#trends table.tr tr").evaluateAll((trs) => trs.slice(1).map((tr) => [...tr.querySelectorAll("td")].slice(0, 4).map((td) => td.textContent)));
  const contact = trend.find((t) => t[0] === "contact");
  check("trends: contact has 2 runs, latest 3%, up 2.5%", !!contact && contact[1] === "2" && contact[2] === "3%" && contact[3]!.includes("+2.5"), JSON.stringify(contact));

  // 8. compare previous baseline version with the current one
  await page.getByRole("button", { name: "Compare to previous" }).click();
  await page.waitForSelector("#cmpout h3");
  await page.waitForFunction(() => [...document.querySelectorAll("#cmpout img")].every((i) => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
  check("compare shows before -> after with a diff", (await page.locator("#cmpout h3").textContent())!.includes("2026-10-01_a → 2026-10-03_c"));

  // 9. rollback, then undo it; the old run dir is locked in the meantime
  const approvedCell = () => page.locator("#baselines table.bl tr").nth(1).locator("td").nth(1).textContent();
  const t0 = await approvedCell();
  const del = await page.evaluate(async () => (await fetch("/api/runs/2026-10-01_a", { method: "DELETE" })).status);
  check("a kept history version's run dir cannot be deleted (403)", del === 403, String(del));
  await page.getByRole("button", { name: "Rollback" }).click();
  await page.waitForFunction((p) => document.querySelectorAll("#baselines table.bl tr")[1]?.querySelectorAll("td")[1]?.textContent !== p, t0, { timeout: 8000 });
  const t1 = await approvedCell();
  check("Rollback changes the current baseline", t1 !== t0);
  await page.getByRole("button", { name: "Rollback" }).click();
  await page.waitForFunction((p) => document.querySelectorAll("#baselines table.bl tr")[1]?.querySelectorAll("td")[1]?.textContent !== p, t1, { timeout: 8000 });
  check("rolling back again undoes it", (await approvedCell()) === t0);

  // 10. approve refreshes the baselines table
  await page.locator("#runs .row", { hasText: "2026-10-04_d" }).getByRole("button", { name: "Approve" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#baselines table.bl tr").length >= 3, null, { timeout: 8000 });
  check("Approve adds the baseline to the table", (await page.locator("#baselines table.bl td.name").allTextContents()).includes("misc"));

  // 11. run a saved config from the page; a second start is refused while it runs
  await reload();
  await page.selectOption("#cfg", "config:t.fullcheck.json");
  await page.click("#run");
  await page.waitForFunction(() => document.getElementById("jobstatus")!.textContent!.startsWith("running"), null, { timeout: 8000 });
  const second = await page.evaluate(async () => (await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config: "t.fullcheck.json" }) })).status);
  check("a second run is refused while one is running (409)", second === 409, String(second));
  await page.waitForFunction(() => /^finished|^failed/.test(document.getElementById("jobstatus")!.textContent!), null, { timeout: 90000 });
  check("the saved config run finishes with a report link", (await page.locator("#jobstatus").textContent())!.startsWith("finished") && (await page.locator("#jobstatus a").count()) === 1, await page.locator("#jobstatus").textContent() ?? "");

  // 12. approve that run, then re-check the baseline from the page (the "after")
  await page.waitForSelector("#runs .row");
  await page.locator("#runs .row", { hasText: "t " }).first().getByRole("button", { name: "Approve" }).click().catch(() => {});
  await page.waitForFunction(() => [...document.querySelectorAll("#baselines table.bl td.name")].some((t) => t.textContent === "t"), null, { timeout: 8000 });
  await page.selectOption("#cfg", "baseline:t");
  await page.click("#run");
  await page.waitForFunction(() => document.getElementById("jobstatus")!.textContent!.startsWith("running baseline:t"), null, { timeout: 8000 });
  await page.waitForFunction(() => /^finished|^failed/.test(document.getElementById("jobstatus")!.textContent!), null, { timeout: 90000 });
  check("re-checking an approved baseline finishes", (await page.locator("#jobstatus").textContent())!.startsWith("finished baseline:t"), await page.locator("#jobstatus").textContent() ?? "");

  // 13. step review: keep before / keep after cards and the agent prompt
  seedFlow();
  await reload();
  // Missing UI must FAIL the checks below, not hang the suite: every wait here is short and soft.
  const soft = (p: Promise<unknown>): Promise<unknown> => p.catch(() => {});
  await soft(page.locator("#runs .row", { hasText: FLOW_AFTER }).getByRole("button", { name: "Details" }).click());
  const rev = page.locator("#runs .detail:not([hidden]) .steprev");
  await soft(rev.locator(".stepcard").first().waitFor({ timeout: 5000 }));
  const cardNames = () => rev.locator(".stepcard").evaluateAll((cs) => cs.map((c) => (c as HTMLElement).dataset.step));
  const pick = (step: string, side: string) => rev.locator(`.stepcard[data-step="${step}"] button.pick[data-side="${side}"]`);
  const pressed = async (step: string, side: string) => (await pick(step, side).getAttribute("aria-pressed", { timeout: 2000 }).catch(() => null)) === "true";
  const copyBtn = rev.locator("button.copyprompt");
  const copyText = () => copyBtn.textContent({ timeout: 2000 }).catch(() => "(no button)");
  const quiet = (await rev.locator(".quiet").textContent({ timeout: 2000 }).catch(() => "")) ?? "";
  check("step review shows cards only above hide-below, plus missing",
    JSON.stringify(await cardNames()) === '["s1","s3"]' && quiet.includes("nothing to decide") && quiet.includes("s2"),
    JSON.stringify(await cardNames()) + " / " + quiet);

  await soft(pick("s1", "before").click({ timeout: 3000 }));
  check("clicking a side marks it and updates the count",
    (await pressed("s1", "before")) && (await copyText()) === "Copy prompt (1 step) · 1 fix · 0 keep", (await copyText()) ?? "");
  await soft(pick("s1", "before").click({ timeout: 3000 }));
  check("clicking the marked side again clears it",
    !(await pressed("s1", "before")) && (await copyText()) === "Copy prompt (0 steps) · 0 fix · 0 keep" && (await copyBtn.isDisabled().catch(() => false)), (await copyText()) ?? "");
  await soft(pick("s1", "before").click({ timeout: 3000 }));

  // A new run forces a real re-render of the list (and so of the open Details panel). The
  // hide-below value is set to a non-default first, so the re-render must keep it as well.
  const hideBelow = rev.locator("input.hidebelow");
  check("hide-below starts at 0.1", (await hideBelow.inputValue({ timeout: 2000 }).catch(() => "")) === "0.1");
  await soft(hideBelow.fill("0.5", { timeout: 2000 }));
  // Focus in the input holds the auto-refresh back (checked further down), so leave it first.
  await soft(hideBelow.evaluate((e) => (e as HTMLElement).blur(), null, { timeout: 2000 }));
  await page.check("#auto");
  const rowCount = await page.locator("#runs .row").count();
  seedRun("2026-10-09_g", "late2", 1);
  await soft(page.waitForFunction((n) => document.querySelectorAll("#runs .row").length === n + 1, rowCount, { timeout: 12000 }));
  await soft(page.waitForSelector('#runs .detail:not([hidden]) .stepcard[data-step="s1"] button.pick[data-side="before"][aria-pressed="true"]', { timeout: 5000 }));
  check("picks survive an auto-refresh", (await page.locator("#runs .row").count()) === rowCount + 1 && (await pressed("s1", "before")));
  check("hide-below survives an auto-refresh",
    (await hideBelow.inputValue({ timeout: 2000 }).catch(() => "")) === "0.5" && JSON.stringify(await cardNames()) === '["s1","s3"]',
    (await hideBelow.inputValue({ timeout: 2000 }).catch(() => "")) + " / " + JSON.stringify(await cardNames()));
  await page.uncheck("#auto");

  await soft(hideBelow.fill("5", { timeout: 2000 }));
  check("raising hide-below drops picks on hidden cards",
    JSON.stringify(await cardNames()) === '["s3"]' && (await copyText()) === "Copy prompt (0 steps) · 0 fix · 0 keep", JSON.stringify(await cardNames()) + " / " + (await copyText()));
  await soft(hideBelow.fill("0.1", { timeout: 2000 }));
  check("lowering it again brings the card back unmarked", JSON.stringify(await cardNames()) === '["s1","s3"]' && !(await pressed("s1", "before")));

  await soft(pick("s1", "before").click({ timeout: 3000 }));
  await soft(copyBtn.click({ timeout: 3000 }));
  const box = rev.locator("textarea.prompt");
  await soft(box.waitFor({ timeout: 5000 }));
  const promptText = await box.inputValue({ timeout: 2000 }).catch(() => "");
  check("copy prompt fills the editable box",
    promptText.includes("FIX these steps") && promptText.includes("s1 (3% differ)") && promptText.endsWith(DO_NOT_APPROVE), promptText.slice(0, 200));
  check("the box says edits are discarded on a change", ((await rev.textContent({ timeout: 2000 }).catch(() => "")) ?? "").includes(REBUILD_HINT));

  // Copy: the clipboard API, and its fallback when the browser refuses.
  const copy = rev.getByRole("button", { name: "Copy", exact: true });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (t: string) => { (window as unknown as { copied: string }).copied = t; return Promise.resolve(); } } });
  });
  await soft(copy.click({ timeout: 3000 }));
  check("Copy puts the box's text on the clipboard", (await page.evaluate(() => (window as unknown as { copied?: string }).copied)) === promptText && promptText !== "");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("denied")) } });
  });
  await soft(copy.click({ timeout: 3000 }));
  await soft(rev.locator(".copystatus", { hasText: "Press Ctrl+C to copy" }).waitFor({ timeout: 3000 }));
  const allSelected = await page.evaluate(() => {
    const t = document.querySelector("#runs .detail:not([hidden]) .steprev textarea.prompt") as HTMLTextAreaElement | null;
    return !!t && t.value.length > 0 && t.selectionStart === 0 && t.selectionEnd === t.value.length;
  });
  check("a refused clipboard selects the text and says Press Ctrl+C to copy",
    allSelected && ((await rev.locator(".copystatus").textContent({ timeout: 2000 }).catch(() => "")) ?? "").includes("Press Ctrl+C to copy"));

  await soft(box.fill(promptText + "\nEDITED", { timeout: 2000 }));
  await soft(pick("s3", "before").click({ timeout: 3000 }));
  await soft(page.waitForFunction(() => {
    const v = (document.querySelector("#runs .detail:not([hidden]) .steprev textarea.prompt") as HTMLTextAreaElement | null)?.value ?? "";
    return !v.includes("EDITED") && v.includes("s3 (missing from the after run)");
  }, null, { timeout: 5000 }));
  const rebuilt = await box.inputValue({ timeout: 2000 }).catch(() => "");
  check("changing a pick rebuilds the text and discards edits",
    !rebuilt.includes("EDITED") && rebuilt.includes("s3 (missing from the after run)") && (await copyText()) === "Copy prompt (2 steps) · 2 fix · 0 keep", (await copyText()) ?? "");

  // Typing in the prompt box holds the auto-refresh back, so focus and text are not lost; the
  // list catches up once focus leaves.
  await page.check("#auto");
  const rowsBefore = await page.locator("#runs .row").count();
  await soft(box.focus({ timeout: 2000 }));
  await soft(box.evaluate((e) => { const t = e as HTMLTextAreaElement; t.setSelectionRange(t.value.length, t.value.length); }, null, { timeout: 2000 }));
  await soft(box.pressSequentially(" TYPED", { timeout: 3000 }));
  seedRun("2026-10-09_h", "late3", 1);
  await page.waitForTimeout(6500); // more than one 5 s auto-refresh tick
  const focusKept = await page.evaluate(() => {
    const a = document.activeElement as HTMLTextAreaElement | null;
    return !!a && a.matches("#runs .detail:not([hidden]) .steprev textarea.prompt") && a.value.endsWith(" TYPED");
  });
  check("typing in the prompt box keeps focus and text through an auto-refresh tick",
    focusKept && (await page.locator("#runs .row").count()) === rowsBefore, `focus kept: ${focusKept}, rows ${rowsBefore} -> ${await page.locator("#runs .row").count()}`);
  await soft(box.evaluate((e) => (e as HTMLElement).blur(), null, { timeout: 2000 }));
  await soft(page.waitForFunction((n) => document.querySelectorAll("#runs .row").length === n + 1, rowsBefore, { timeout: 12000 }));
  const caughtUp = await page.locator("#runs .row").count();
  const kept = await box.inputValue({ timeout: 2000 }).catch(() => "");
  check("the list catches up once focus leaves, and keeps the edited text",
    caughtUp === rowsBefore + 1 && kept.endsWith(" TYPED"), `rows ${rowsBefore} -> ${caughtUp}, text ends ${JSON.stringify(kept.slice(-20))}`);
  await page.uncheck("#auto");

  // The Compare panel gets the same cards: before / after / diff from the two runs.
  await page.selectOption("#cmp-a", FLOW_BASE);
  await page.selectOption("#cmp-b", FLOW_AFTER);
  await page.selectOption("#cmp-name", "flow");
  await page.click("#cmp-go");
  const cmpCard = '#cmpout .steprev .stepcard[data-step="s1"]';
  await soft(page.waitForFunction((sel) => {
    const imgs = [...document.querySelectorAll(sel + " img")] as HTMLImageElement[];
    return imgs.length === 3 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, cmpCard, { timeout: 5000 }));
  check("compare panel shows step cards", (await page.locator(cmpCard + " img").count()) === 3 &&
    (await page.locator(cmpCard + " img").evaluateAll((is) => is.every((i) => (i as HTMLImageElement).naturalWidth > 0))));
  const cmpRev = page.locator("#cmpout .steprev");
  await soft(cmpRev.locator('.stepcard[data-step="s1"] button.pick[data-side="after"]').click({ timeout: 3000 }));
  await soft(cmpRev.locator("button.copyprompt").click({ timeout: 3000 }));
  await soft(cmpRev.locator("textarea.prompt").waitFor({ timeout: 5000 }));
  const cmpPrompt = await cmpRev.locator("textarea.prompt").inputValue({ timeout: 2000 }).catch(() => "");
  check("a compare-mode prompt keeps the step and has the compare check line",
    cmpPrompt.includes("KEEP these steps") && cmpPrompt.includes(" compare ") && cmpPrompt.includes(join(repo, "out", FLOW_BASE)), cmpPrompt.slice(0, 200));

  // Local only: never a prompt for a request that came through `tailscale serve`.
  const viaTailscale = (login: string) => page.evaluate(async ({ login, dir }) => {
    const r = await fetch("/api/step-prompt", {
      method: "POST",
      headers: { "content-type": "application/json", "tailscale-user-login": login },
      body: JSON.stringify({ mode: "baseline", dir, name: "flow", picks: { s1: "before" }, hideBelow: 0.1 }),
    });
    return { status: r.status, body: await r.text() };
  }, { login, dir: FLOW_AFTER });
  const ts = await viaTailscale(WRITER);
  check("step-prompt endpoint refuses tailscale viewers with the note", ts.status === 403 && ts.body.includes(LOCAL_ONLY), `${ts.status} ${ts.body}`);
  // A run's summary.json holds the invocation (cwd, argv, env): local only too.
  expected.add(`403 /files/${FLOW_AFTER}/summary.json`);
  const summaryStatus = (headers: Record<string, string>) => page.evaluate(async ({ dir, headers }) => (await fetch(`/files/${dir}/summary.json`, { headers })).status, { dir: FLOW_AFTER, headers });
  const tsSummary = await summaryStatus({ "tailscale-user-login": WRITER });
  const localSummary = await summaryStatus({});
  check("summary.json is refused to tailscale viewers and served locally", tsSummary === 403 && localSummary === 200, `${tsSummary} / ${localSummary}`);
  check("a tailscale viewer who may not write is refused too", (await viaTailscale("reader@example.com")).status === 403);
  const tsCtx = await browser.newContext({ viewport: { width: 1300, height: 900 }, extraHTTPHeaders: { "tailscale-user-login": WRITER } });
  const tsPage = await tsCtx.newPage();
  watch(tsPage);
  await tsPage.goto(base + "/");
  await tsPage.waitForSelector("#runs .row");
  await soft(tsPage.locator("#runs .row", { hasText: FLOW_AFTER }).getByRole("button", { name: "Details" }).click());
  const tsRev = tsPage.locator("#runs .detail:not([hidden]) .steprev");
  await soft(tsRev.locator(".stepcard").first().waitFor({ timeout: 5000 }));
  const tsNote = (await tsRev.locator(".localonly").textContent({ timeout: 2000 }).catch(() => "")) ?? "";
  check("over tailscale the page shows the cards and the note instead of Copy prompt",
    (await tsRev.locator(".stepcard").count()) === 2 && tsNote === LOCAL_ONLY && (await tsRev.locator("button.copyprompt").count()) === 0, tsNote);
  await tsCtx.close();

  // A pick the server can no longer honour (its image is gone) is refused, and the page says why.
  expected.add("400 /api/step-prompt");
  expected.add(`404 /files/${FLOW_BASE}/flow.s1.png`);
  rmSync(join(repo, "out", FLOW_BASE, "flow.s1.png"));
  await soft(copyBtn.click({ timeout: 3000 }));
  await soft(rev.locator(".prompterr").waitFor({ timeout: 5000 }));
  const refused = (await rev.locator(".prompterr").textContent({ timeout: 2000 }).catch(() => "")) ?? "";
  check("a refused prompt shows the server's reason on the page", refused.includes("no before image"), refused);
  // And a side whose image does not load is never offered.
  const ctx2 = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const page2 = await ctx2.newPage();
  watch(page2);
  await page2.goto(base + "/");
  await page2.waitForSelector("#runs .row");
  await soft(page2.locator("#runs .row", { hasText: FLOW_AFTER }).getByRole("button", { name: "Details" }).click());
  const rev2 = page2.locator("#runs .detail:not([hidden]) .steprev");
  await soft(rev2.locator('.stepcard[data-step="s1"] button.pick[data-side="after"]:not([disabled])').waitFor({ timeout: 5000 }));
  await soft(page2.waitForSelector('#runs .detail:not([hidden]) .stepcard[data-step="s1"] button.pick[data-side="before"][disabled]', { timeout: 5000 }));
  await soft(page2.waitForSelector('#runs .detail:not([hidden]) .stepcard[data-step="s1"] button.pick[data-side="before"][title="the image did not load"]', { timeout: 5000 }));
  const brokenSide = rev2.locator('.stepcard[data-step="s1"] button.pick[data-side="before"]');
  check("a side whose image fails to load cannot be picked",
    (await brokenSide.isDisabled({ timeout: 2000 }).catch(() => false)) && (await brokenSide.getAttribute("title", { timeout: 2000 }).catch(() => null)) === "the image did not load" &&
    !(await rev2.locator('.stepcard[data-step="s1"] button.pick[data-side="after"]').isDisabled({ timeout: 2000 }).catch(() => true)));
  await ctx2.close();

  check("no page errors and no failed requests during the whole run", problems.length === 0, problems.join("; "));
  // browser.close() can block after a long session; never let that hang the whole suite.
  await page.close().catch(() => {});
  await Promise.race([browser.close(), Bun.sleep(10000)]);
}

try {
  await main();
} catch (e) {
  failures.push("crashed: " + (e instanceof Error ? e.message : String(e)));
  console.log(` FAIL  crashed: ${e instanceof Error ? e.stack : String(e)}`);
} finally {
  dash.kill();
  pages.stop(true);
  rmSync(repo, { recursive: true, force: true });
}
console.log(failures.length ? `\n${failures.length} UI check(s) failed` : "\nall UI checks passed");
process.exit(failures.length ? 1 : 0);
