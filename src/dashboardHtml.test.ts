import { describe, expect, it } from "bun:test";
import { buildDashboardHtml } from "./dashboardHtml";

describe("buildDashboardHtml", () => {
  const html = buildDashboardHtml();
  it("is a complete standalone document", () => {
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("<title>vigress dashboard</title>");
  });
  it("wires the client to the API", () => {
    expect(html).toContain('fetch("/api/runs")');
    expect(html).toContain("/api/cleanup");
    expect(html).toContain("/files/");
  });
  it("wires the run detail panel", () => {
    expect(html).toContain("Details");
    expect(html).toContain("/detail");
  });
  it("has a side-by-side and slider comparison viewer", () => {
    expect(html).toContain("Side by side");
    expect(html).toContain("Slider");
    expect(html).toContain('"range"');
  });
  it("has filter controls and auto-refresh wired to the runs API", () => {
    expect(html).toContain('id="q"');
    expect(html).toContain("Auto-refresh");
    expect(html).toContain('"/api/runs?"');
  });
  it("wires the approve action", () => {
    expect(html).toContain("/approve");
  });
  it("has a baselines section wired to its API", () => {
    expect(html).toContain('id="baselines"');
    expect(html).toContain('fetch("/api/baselines")');
  });
  it("has the run list container and cleanup button", () => {
    expect(html).toContain('id="runs"');
    expect(html).toContain('id="cleanup"');
  });
  it("renders untrusted strings via textContent, not innerHTML interpolation", () => {
    // The client script must never build HTML by string-concatenating run data.
    expect(html).not.toMatch(/(innerHTML|outerHTML|insertAdjacentHTML|document\.write)/);
  });
});
