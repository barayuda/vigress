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
    target: "contact.target.png", baseline: "contact.baseline.png", diff: "contact.diff.png", video: "video/contact.webm",
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
