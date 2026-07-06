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
  it("has the run list container and cleanup button", () => {
    expect(html).toContain('id="runs"');
    expect(html).toContain('id="cleanup"');
  });
  it("renders untrusted strings via textContent, not innerHTML interpolation", () => {
    // The client script must never build HTML by string-concatenating run data.
    expect(html).not.toMatch(/(innerHTML|outerHTML|insertAdjacentHTML|document\.write)/);
  });
});
