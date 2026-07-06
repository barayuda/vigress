import { describe, it, expect } from "bun:test";
import { buildJsonPayload } from "./json";
import { SCHEMA_VERSION, type Summary } from "./types";

const summary: Summary = {
  schemaVersion: SCHEMA_VERSION,
  outDir: "/tmp/out",
  reportHtml: "report.html",
  summaryJson: "summary.json",
  runs: [{
    name: "contact", baselineType: "url", viewport: { width: 1440, height: 900 },
    mismatchPixels: 10, mismatchPercent: 1.5,
    target: "contact.target.png", targetUrl: "https://app.test/page", baseline: "contact.baseline.png", diff: "contact.diff.png", video: "video/contact.webm",
    regions: [], checklist: [],
    mode: "static", shots: [], steps: [], stepDiffs: [],
  }],
};

describe("buildJsonPayload", () => {
  it("carries schemaVersion + outDir and resolves paths to absolute", () => {
    const p = buildJsonPayload(summary) as any;
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.outDir).toBe("/tmp/out");
    expect(p.reportHtml).toBe("/tmp/out/report.html");
    expect(p.runs[0].diff).toBe("/tmp/out/contact.diff.png");
    expect(p.runs[0].video).toBe("/tmp/out/video/contact.webm");
    expect(p.runs[0].mismatchPercent).toBe(1.5);
  });
});

describe("buildJsonPayload regions + checklist", () => {
  it("includes region scores (absolute diff paths) and the checklist", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "contact", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 10, mismatchPercent: 1.5,
        target: "contact.target.png", targetUrl: "https://app.test/page", baseline: "contact.baseline.png", diff: "contact.diff.png",
        regions: [{ name: "filter-bar", mismatchPixels: 5, mismatchPercent: 3.2, verdict: "fail", reason: "content", diff: "contact.filter-bar.diff.png" }],
        checklist: [{ aspect: "filter bar width", region: "filter-bar", verdict: "fail" }],
        mode: "static", shots: [], steps: [], stepDiffs: [],
      }],
    };
    const p = buildJsonPayload(s) as any;
    expect(p.schemaVersion).toBe(SCHEMA_VERSION);
    expect(p.runs[0].regions[0].diff).toBe("/tmp/out/contact.filter-bar.diff.png");
    expect(p.runs[0].regions[0].verdict).toBe("fail");
    expect(p.runs[0].checklist[0].aspect).toBe("filter bar width");
  });
});

describe("buildJsonPayload mode + shots", () => {
  it("carries mode and resolves shot paths to absolute", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "c", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 0, mismatchPercent: 0,
        target: "c.target.png", targetUrl: "https://app.test/page", baseline: "c.baseline.png", diff: "c.diff.png",
        regions: [], checklist: [],
        mode: "steps", shots: [{ name: "date-open", path: "c.date-open.png" }], steps: [], stepDiffs: [],
      }],
    };
    const p = buildJsonPayload(s) as any;
    expect(p.runs[0].mode).toBe("steps");
    expect(p.runs[0].shots[0].path).toBe("/tmp/out/c.date-open.png");
  });
});

describe("buildJsonPayload steps", () => {
  it("carries per-step results", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "c", baselineType: "url", viewport: { width: 1440, height: 900 },
        mismatchPixels: 0, mismatchPercent: 0,
        target: "c.target.png", baseline: "c.baseline.png", diff: "c.diff.png",
        targetUrl: "https://app.test/page", stepDiffs: [],
        regions: [], checklist: [], mode: "steps", shots: [],
        steps: [
          { index: 1, action: "click", selector: "[data-testid=period-input]", check: true, status: "ok" },
          { index: 2, action: "click", selector: "[data-testid=nope]", check: true, status: "failed", error: "not found" },
        ],
      }],
    };
    const p = buildJsonPayload(s) as any;
    expect(p.runs[0].steps[0].status).toBe("ok");
    expect(p.runs[0].steps[1].status).toBe("failed");
    expect(p.runs[0].steps[1].check).toBe(true);
  });
});

describe("buildJsonPayload stepDiffs + bootstrap", () => {
  it("maps stepDiffs (absolute diff path) and passes bootstrap through", () => {
    const s: Summary = {
      schemaVersion: SCHEMA_VERSION, outDir: "/tmp/out", reportHtml: "report.html", summaryJson: "summary.json",
      runs: [{
        name: "page", baselineType: "image", viewport: { width: 1440, height: 900 },
        target: "page.target.png", targetUrl: "https://app.test/page",
        bootstrap: true,
        regions: [], checklist: [], mode: "steps", shots: [], steps: [],
        stepDiffs: [
          { name: "01-open", mismatchPercent: 1.2, diff: "page.01-open.stepdiff.png", verdict: "ok" },
          { name: "02-new", mismatchPercent: 0, verdict: "new" },
        ],
      }],
    };
    const p = buildJsonPayload(s) as any;
    expect(p.runs[0].bootstrap).toBe(true);
    expect(p.runs[0].baseline).toBeUndefined();
    expect(p.runs[0].diff).toBeUndefined();
    expect(p.runs[0].stepDiffs[0].diff).toBe("/tmp/out/page.01-open.stepdiff.png");
    expect(p.runs[0].stepDiffs[1].diff).toBeUndefined();
    expect(p.runs[0].targetUrl).toBe("https://app.test/page");
  });
});
