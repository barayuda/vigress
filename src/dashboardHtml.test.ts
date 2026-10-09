import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDashboardHtml } from "./dashboardHtml";

const client = readFileSync(join(import.meta.dir, "dashboardClient.js"), "utf8"); // the real script, served at /app.js

describe("buildDashboardHtml", () => {
  const html = buildDashboardHtml();
  const page = html + "\n" + client; // markup + behaviour: ids live in one, fetch URLs in the other
  it("is a complete standalone document", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("<title>vigress dashboard</title>");
  });
  it("wires the client to the API", () => {
    expect(page).toContain('fetch("/api/runs")');
    expect(page).toContain("/api/cleanup");
    expect(page).toContain("/files/");
  });
  it("wires the run detail panel", () => {
    expect(page).toContain("Details");
    expect(page).toContain("/detail");
  });
  it("has a side-by-side and slider comparison viewer", () => {
    expect(page).toContain("Side by side");
    expect(page).toContain("Slider");
    expect(page).toContain('"range"');
  });
  it("has filter controls and auto-refresh wired to the runs API", () => {
    expect(page).toContain('id="q"');
    expect(page).toContain("Auto-refresh");
    expect(page).toContain('"/api/runs?"');
  });
  it("has a run bar for saved configs wired to the jobs API", () => {
    expect(page).toContain('id="cfg"');
    expect(page).toContain('id="run"');
    expect(page).toContain('"/api/jobs"');
    expect(page).toContain('"/api/configs"');
  });
  it("wires baseline rollback and compare-with-previous", () => {
    expect(page).toContain("/rollback");
    expect(page).toContain("Rollback");
  });
  it("wires the approve action", () => {
    expect(page).toContain("/approve");
  });
  it("has a baselines section wired to its API", () => {
    expect(page).toContain('id="baselines"');
    expect(page).toContain('fetch("/api/baselines")');
  });
  it("has a trends section wired to its API", () => {
    expect(page).toContain('id="trends"');
    expect(page).toContain('"/api/trends"');
  });
  it("has a compare bar wired to the compare API", () => {
    expect(page).toContain('id="cmp-a"');
    expect(page).toContain('id="cmp-b"');
    expect(page).toContain("/api/compare?");
  });
  it("serves its script from /app.js, with no inline script left in the page", () => {
    expect(html).toContain('<script src="/app.js"></script>');
    expect(html).not.toMatch(/<script>/);
  });
  it("ships a client script that actually parses", () => {
    // Syntax check only (never runs it): a script that fails to parse blanks the whole page
    // and string checks cannot see that.
    expect(() => new Function(client)).not.toThrow();
  });
  it("has the run list container and cleanup button", () => {
    expect(page).toContain('id="runs"');
    expect(page).toContain('id="cleanup"');
  });
  it("renders untrusted strings via textContent, not innerHTML interpolation", () => {
    // The client script must never build HTML by string-concatenating run data.
    expect(page).not.toMatch(/(innerHTML|outerHTML|insertAdjacentHTML|document\.write)/);
  });
});
