// Opt-in UI smoke test for the dashboard: `bun run test:ui`.
//
// Unit tests (`bun test`) cover the pure logic only. This drives the REAL dashboard with a
// REAL browser against a throwaway repo, so the page script and its races stay covered:
// filters, the Cleanup safety confirmation, Details surviving an auto-refresh, approve,
// rollback, compare, trends, git links, and running a saved config / re-checking a baseline.
// It needs an installed browser (VIGRESS_BROWSER, default chrome) and takes about a minute.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { launchBrowser } from "../src/browser";
import { buildManifestEntry, emptyManifest, upsertBaseline, writeManifest } from "../src/baselines";
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

function png(): Buffer {
  const p = new PNG({ width: 40, height: 30 });
  for (let i = 0; i < 40 * 30; i++) { p.data[i * 4] = 120; p.data[i * 4 + 1] = 120; p.data[i * 4 + 2] = 220; p.data[i * 4 + 3] = 255; }
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
const probe = Bun.serve({ port: 0, fetch: () => new Response("") });
const port = probe.port;
probe.stop(true);
const dash = Bun.spawn([process.execPath, join(ROOT, "src/cli.ts"), "dashboard", "--port", String(port), "--out", "out"], {
  cwd: repo, stdout: "ignore", stderr: "inherit", env: { ...process.env, VIGRESS_BROWSER: process.env.VIGRESS_BROWSER ?? "chrome" },
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
  page.on("pageerror", (e) => problems.push("pageerror: " + String(e)));
  // Refusals this test provokes on purpose (a locked delete: 403, a second run: 409) are not problems.
  page.on("response", (r) => {
    const deliberate = r.request().method() !== "GET" && (r.status() === 403 || r.status() === 409);
    if (r.status() >= 400 && !deliberate && !r.url().includes("favicon")) problems.push(`${r.status()} ${r.url().replace(base, "")}`);
  });
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
