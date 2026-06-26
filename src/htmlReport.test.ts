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
      }],
    };
    const html = buildReportHtml(s);
    expect(html).toContain("filter-bar");
    expect(html).toContain("fail");
    expect(html).toContain("filter bar width");
    expect(html).toContain('src="contact.filter-bar.diff.png"');
  });
});
