import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { planCompare, commonRunNames } from "./compare";
import { compareRuns } from "./compareRuns";
import type { RunResult, Summary } from "./types";

const run = (over: Partial<RunResult> = {}): RunResult => ({
  name: "page", baselineType: "url", viewport: { width: 1440, height: 900 }, mismatchPixels: 0, mismatchPercent: 0,
  target: "page.target.png", targetUrl: "https://app.test/page", regions: [], checklist: [], mode: "steps",
  shots: [], steps: [], stepDiffs: [], ...over,
});
const sum = (runs: RunResult[]): Summary => ({ schemaVersion: 10, outDir: "/x", reportHtml: "report.html", summaryJson: "summary.json", runs });

describe("commonRunNames", () => {
  it("lists names present in both summaries, sorted", () => {
    expect(commonRunNames(sum([run({ name: "b" }), run({ name: "a" }), run({ name: "only-a" })]), sum([run({ name: "a" }), run({ name: "b" })]))).toEqual(["a", "b"]);
    expect(commonRunNames(sum([run({ name: "a" })]), sum([run({ name: "z" })]))).toEqual([]);
  });
});

describe("planCompare", () => {
  it("returns each side's target and shots (paths relative to its run dir)", () => {
    const a = sum([run({ shots: [{ name: "01-open", path: "page.01-open.png" }] })]);
    const b = sum([run({ target: "page.target2.png" })]);
    const p = planCompare(a, b, "page");
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.a).toEqual({ target: "page.target.png", shots: { "01-open": "page.01-open.png" } });
      expect(p.b).toEqual({ target: "page.target2.png", shots: {} });
    }
  });
  it("explains which side lacks the name and what it has", () => {
    const p = planCompare(sum([run({ name: "x" })]), sum([run({ name: "page" })]), "page");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.message).toMatch(/'page' not in the before run — has: x/);
    const q = planCompare(sum([run({ name: "page" })]), sum([run({ name: "y" })]), "page");
    if (!q.ok) expect(q.message).toMatch(/not in the after run — has: y/);
  });
});

describe("compareRuns", () => {
  let root: string;
  const solid = (w: number, h: number, c: [number, number, number]) => {
    const p = new PNG({ width: w, height: h });
    for (let i = 0; i < w * h; i++) { p.data[i * 4] = c[0]; p.data[i * 4 + 1] = c[1]; p.data[i * 4 + 2] = c[2]; p.data[i * 4 + 3] = 255; }
    return PNG.sync.write(p);
  };
  const mkdir = (name: string, files: Record<string, Buffer>) => {
    const d = join(root, name); mkdirSync(d, { recursive: true });
    for (const [f, data] of Object.entries(files)) { mkdirSync(join(d, f, ".."), { recursive: true }); writeFileSync(join(d, f), data); }
    return d;
  };
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), "vcmp-")); });
  afterAll(() => { rmSync(root, { recursive: true, force: true }); });

  it("diffs the two targets, reports the height difference (after minus before) and step verdicts", () => {
    const aDir = mkdir("a", { "page.target.png": solid(20, 20, [255, 255, 255]), "page.s1.png": solid(10, 10, [0, 0, 0]), "page.gone.png": solid(10, 10, [0, 0, 0]) });
    const bDir = mkdir("b", { "page.target.png": solid(20, 30, [255, 255, 255]), "page.s1.png": solid(10, 10, [255, 255, 255]), "page.new.png": solid(10, 10, [0, 0, 0]) });
    const r = compareRuns({
      a: { dir: aDir, summary: sum([run({ shots: [{ name: "s1", path: "page.s1.png" }, { name: "gone", path: "page.gone.png" }] })]) },
      b: { dir: bDir, summary: sum([run({ shots: [{ name: "s1", path: "page.s1.png" }, { name: "new", path: "page.new.png" }] })]) },
      name: "page",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.heightDelta).toBe(10);
    expect(r.result.widthDelta).toBe(0);
    expect(r.result.mismatchPercent).toBe(0); // common 20x20 area is identical
    const byName = new Map(r.result.stepDiffs.map((s) => [s.name, s]));
    expect(byName.get("s1")!.mismatchPercent).toBe(100);
    expect(byName.get("new")!.verdict).toBe("new");
    expect(byName.get("gone")!.verdict).toBe("missing");
    expect(r.result.diffPng.subarray(1, 4).toString()).toBe("PNG");
  });
  it("reports a changed target", () => {
    const aDir = mkdir("a2", { "page.target.png": solid(10, 10, [255, 255, 255]) });
    const bDir = mkdir("b2", { "page.target.png": solid(10, 10, [0, 0, 0]) });
    const r = compareRuns({ a: { dir: aDir, summary: sum([run()]) }, b: { dir: bDir, summary: sum([run()]) }, name: "page" });
    expect(r.ok && r.result.mismatchPercent).toBe(100);
    expect(r.ok && r.result.heightDelta).toBe(0);
  });
  it("refuses a target path that escapes the run dir (summary.json is a file on disk)", () => {
    const aDir = mkdir("a3", { "page.target.png": solid(10, 10, [0, 0, 0]) });
    const bDir = mkdir("b3", { "page.target.png": solid(10, 10, [0, 0, 0]) });
    const r = compareRuns({ a: { dir: aDir, summary: sum([run({ target: "../a3/page.target.png" })]) }, b: { dir: bDir, summary: sum([run()]) }, name: "page" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/unsafe path/);
  });
  it("fails clearly when a capture is missing on disk", () => {
    const aDir = mkdir("a4", {});
    const bDir = mkdir("b4", { "page.target.png": solid(10, 10, [0, 0, 0]) });
    const r = compareRuns({ a: { dir: aDir, summary: sum([run()]) }, b: { dir: bDir, summary: sum([run()]) }, name: "page" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/capture missing/);
  });
  it("passes through a name that is not in a run", () => {
    const aDir = mkdir("a5", {}); const bDir = mkdir("b5", {});
    const r = compareRuns({ a: { dir: aDir, summary: sum([run({ name: "x" })]) }, b: { dir: bDir, summary: sum([run()]) }, name: "page" });
    expect(r.ok).toBe(false);
  });
});
