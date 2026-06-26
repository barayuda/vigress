import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeReport } from "./report";
import { SCHEMA_VERSION, type Summary } from "./types";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vrep-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const makeSummary = (outDir: string): Summary => ({
  schemaVersion: SCHEMA_VERSION,
  outDir,
  reportHtml: "report.html",
  summaryJson: "summary.json",
  runs: [
    {
      name: "homepage",
      baselineType: "url",
      viewport: { width: 1440, height: 900 },
      mismatchPixels: 50,
      mismatchPercent: 0.5,
      target: "homepage.target.png",
      baseline: "homepage.baseline.png",
      diff: "homepage.diff.png",
      regions: [],
      checklist: [
        {
          aspect: "header layout",
          region: "header",
          verdict: "pass",
          workaround: "ignore top padding",
        },
        {
          aspect: "footer alignment",
          verdict: "fail",
        },
      ],
      mode: "static", shots: [],
    },
  ],
});

describe("writeReport / checklistMd", () => {
  it("writes checklist.md to outDir", () => {
    const summary = makeSummary(dir);
    writeReport(summary);
    expect(existsSync(join(dir, "checklist.md"))).toBe(true);
  });

  it("checklist.md contains the run heading", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain("## homepage");
  });

  it("checklist.md marks a passing item with [x]", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain("[x]");
    expect(content).toContain("header layout");
  });

  it("checklist.md marks a failing item with [ ]", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain("[ ]");
    expect(content).toContain("footer alignment");
  });

  it("checklist.md includes the (region: <name>) annotation for the pass item", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain("(region: header)");
  });

  it("checklist.md includes the workaround in italics", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain("_ignore top padding_");
  });

  it("checklist.md pass line has full expected format", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain(
      "- [x] **pass** header layout (region: header) — _ignore top padding_"
    );
  });

  it("checklist.md fail line has full expected format", () => {
    const content = readFileSync(join(dir, "checklist.md"), "utf8");
    expect(content).toContain("- [ ] **fail** footer alignment");
  });

  it("also writes summary.json to outDir", () => {
    expect(existsSync(join(dir, "summary.json"))).toBe(true);
  });

  it("also writes report.html to outDir", () => {
    expect(existsSync(join(dir, "report.html"))).toBe(true);
  });
});
