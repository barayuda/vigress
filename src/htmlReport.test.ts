import { describe, it, expect } from "bun:test";
import { buildReportHtml } from "./htmlReport";
import { SCHEMA_VERSION, type Summary } from "./types";

const summary: Summary = {
  schemaVersion: SCHEMA_VERSION,
  outDir: "/tmp/out",
  reportHtml: "report.html",
  summaryJson: "summary.json",
  runs: [
    {
      name: "contact",
      baselineType: "url",
      viewport: { width: 1440, height: 900 },
      mismatchPixels: 1234,
      mismatchPercent: 4.2,
      target: "contact.target.png",
      baseline: "contact.baseline.png",
      diff: "contact.diff.png",
      video: "video/contact.webm",
      regions: [], checklist: [],
      mode: "static", shots: [], steps: [],
    },
  ],
};

describe("buildReportHtml", () => {
  it("returns an HTML document referencing each artifact", () => {
    const html = buildReportHtml(summary);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("contact");
    expect(html).toContain("4.2%");
    expect(html).toContain('src="contact.target.png"');
    expect(html).toContain('src="contact.baseline.png"');
    expect(html).toContain('src="contact.diff.png"');
    expect(html).toContain('src="video/contact.webm"');
    expect(html).toContain("<video");
  });
  it("omits the video tag when no video", () => {
    const noVid: Summary = { ...summary, runs: [{ ...summary.runs[0], video: undefined }] };
    const html = buildReportHtml(noVid);
    expect(html).not.toContain("<video");
  });
});

describe("buildReportHtml regions + checklist", () => {
  it("renders a region row with its verdict and a checklist aspect", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "contact", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 10, mismatchPercent: 1.5,
        target: "contact.target.png", baseline: "contact.baseline.png", diff: "contact.diff.png",
        regions: [{ name: "filter-bar", mismatchPixels: 5, mismatchPercent: 3.2, verdict: "fail", reason: "content", diff: "contact.filter-bar.diff.png" }],
        checklist: [{ aspect: "filter bar width", region: "filter-bar", verdict: "fail" }],
        mode: "static", shots: [], steps: [],
      }],
    };
    const html = buildReportHtml(s);
    expect(html).toContain("filter-bar");
    expect(html).toContain("fail");
    expect(html).toContain("filter bar width");
    expect(html).toContain('src="contact.filter-bar.diff.png"');
    expect(html).toContain("fail (content)");
  });
  it("does not render redundant 'unresolved (unresolved)' when verdict equals reason", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "home", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 0, mismatchPercent: 0,
        target: "home.target.png", baseline: "home.baseline.png", diff: "home.diff.png",
        regions: [{ name: "header", mismatchPixels: 0, mismatchPercent: 0, verdict: "unresolved", reason: "unresolved" }],
        checklist: [],
        mode: "static", shots: [], steps: [],
      }],
    };
    const html = buildReportHtml(s);
    expect(html).toContain("unresolved");
    expect(html).not.toContain("unresolved (unresolved)");
  });
});

describe("buildReportHtml mode + shots", () => {
  it("shows the mode and renders a flow-shots strip", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "c", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 0, mismatchPercent: 0,
        target: "c.target.png", baseline: "c.baseline.png", diff: "c.diff.png",
        regions: [], checklist: [],
        mode: "steps", shots: [{ name: "date-open", path: "c.date-open.png" }], steps: [],
      }],
    };
    const html = buildReportHtml(s);
    expect(html).toContain("steps");
    expect(html).toContain("date-open");
    expect(html).toContain('src="c.date-open.png"');
  });
});

describe("buildReportHtml functionality steps", () => {
  it("renders a functionality table with pass/fail and a count", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "c", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 0, mismatchPercent: 0,
        target: "c.target.png", baseline: "c.baseline.png", diff: "c.diff.png",
        regions: [], checklist: [], mode: "steps", shots: [],
        steps: [
          { index: 1, action: "click", selector: "[data-testid=period-input]", check: true, status: "ok" },
          { index: 2, action: "click", selector: "[data-testid=nope]", check: true, status: "failed", error: "not found" },
        ],
      }],
    };
    const html = buildReportHtml(s);
    expect(html).toContain("functionality: 1/2 checks passed");
    expect(html).toContain("[data-testid=period-input]");
    expect(html).toContain("✓");
    expect(html).toContain("✗");
  });
});
