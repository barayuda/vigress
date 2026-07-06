import { describe, expect, it } from "bun:test";
import {
  MANIFEST_VERSION, emptyManifest, parseManifest, parseBaselineRef,
  buildManifestEntry, upsertBaseline, resolveBaselineArtifacts,
  pickNewestRun, stepDiffVerdict, type RunDirCandidate,
} from "./baselines";
import type { RunResult, Summary } from "./types";

const run = (over: Partial<RunResult> = {}): RunResult => ({
  name: "page", baselineType: "url", viewport: { width: 1440, height: 900 },
  mismatchPixels: 0, mismatchPercent: 0,
  target: "page.target.png", targetUrl: "https://app.test/page",
  baseline: "page.baseline.png", diff: "page.diff.png",
  regions: [], checklist: [], mode: "steps",
  shots: [{ name: "01-open", path: "page.01-open.png" }],
  steps: [], stepDiffs: [],
  ...over,
});

const summary = (runs: RunResult[]): Summary => ({
  schemaVersion: 7, outDir: "/x", reportHtml: "report.html", summaryJson: "summary.json", runs,
});

describe("parseBaselineRef", () => {
  it("extracts the name", () => expect(parseBaselineRef("baseline:csat-v2")).toBe("csat-v2"));
  it("null for non-refs and empty names", () => {
    expect(parseBaselineRef("https://x.test")).toBeNull();
    expect(parseBaselineRef("baseline:")).toBeNull();
    expect(parseBaselineRef("baseline:  ")).toBeNull();
  });
});

describe("parseManifest", () => {
  it("round-trips an empty manifest", () => {
    const m = parseManifest(JSON.stringify(emptyManifest()));
    expect(m.schemaVersion).toBe(MANIFEST_VERSION);
    expect(m.baselines).toEqual({});
  });
  it("rejects wrong schemaVersion", () => {
    expect(() => parseManifest(JSON.stringify({ schemaVersion: 99, baselines: {} }))).toThrow(/schemaVersion/);
  });
  it("rejects missing baselines object", () => {
    expect(() => parseManifest(JSON.stringify({ schemaVersion: MANIFEST_VERSION }))).toThrow(/baselines/);
  });
});

describe("buildManifestEntry / upsertBaseline", () => {
  it("maps main + shots into repo-root-relative artifact paths", () => {
    const e = buildManifestEntry(run(), "out/2026-07-06_15-11-50", "2026-07-06T00:00:00Z");
    expect(e.storage).toBe("local");
    expect(e.approvedFrom).toBe("out/2026-07-06_15-11-50");
    expect(e.sourceUrl).toBe("https://app.test/page");
    expect(e.artifacts.main).toBe("out/2026-07-06_15-11-50/page.target.png");
    expect(e.artifacts.steps["01-open"]).toBe("out/2026-07-06_15-11-50/page.01-open.png");
  });
  it("throws when the run has no target capture", () => {
    expect(() => buildManifestEntry(run({ target: "" }), "out/x", "t")).toThrow(/no target capture/);
  });
  it("upsert replaces wholesale and does not mutate", () => {
    const m0 = emptyManifest();
    const e1 = buildManifestEntry(run(), "out/a", "t1");
    const e2 = buildManifestEntry(run({ shots: [] }), "out/b", "t2");
    const m1 = upsertBaseline(m0, "page", e1);
    const m2 = upsertBaseline(m1, "page", e2);
    expect(m0.baselines).toEqual({});
    expect(m1.baselines.page.artifacts.steps["01-open"]).toBeDefined();
    expect(m2.baselines.page.artifacts.steps).toEqual({}); // stale steps dropped
  });
});

describe("resolveBaselineArtifacts", () => {
  const vp = { width: 1440, height: 900 };
  const entry = buildManifestEntry(run(), "out/a", "t");
  const manifest = upsertBaseline(emptyManifest(), "page", entry);

  it("resolves a matching entry", () => {
    const r = resolveBaselineArtifacts(manifest, "page", vp);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.entry.artifacts.main).toBe("out/a/page.target.png");
  });
  it("missing manifest → code 2, missingEntry, bootstrap hint", () => {
    const r = resolveBaselineArtifacts(null, "page", vp);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(2);
      expect(r.missingEntry).toBe(true);
      expect(r.message).toMatch(/--update-baseline/);
    }
  });
  it("unknown name → code 2, missingEntry", () => {
    const r = resolveBaselineArtifacts(manifest, "nope", vp);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missingEntry).toBe(true);
  });
  it("viewport mismatch → code 2, both viewports in message, NOT missingEntry", () => {
    const r = resolveBaselineArtifacts(manifest, "page", { width: 1280, height: 800 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe(2);
      expect(r.missingEntry).toBeUndefined();
      expect(r.message).toMatch(/1280x800/);
      expect(r.message).toMatch(/1440x900/);
    }
  });
});

describe("pickNewestRun", () => {
  const c = (dir: string, mtimeMs: number, names: string[]): RunDirCandidate => ({
    dir, mtimeMs, summary: summary(names.map((n) => run({ name: n }))),
  });
  it("picks the newest dir containing the name", () => {
    const got = pickNewestRun([c("out/old", 1, ["page"]), c("out/new", 2, ["page"]), c("out/other", 3, ["x"])], "page");
    expect(got?.dir).toBe("out/new");
  });
  it("null when nothing matches", () => {
    expect(pickNewestRun([c("out/a", 1, ["x"])], "page")).toBeNull();
  });
});

describe("stepDiffVerdict", () => {
  it("covers the verdict matrix", () => {
    expect(stepDiffVerdict(true, false, 0)).toBe("new");
    expect(stepDiffVerdict(false, true, 0)).toBe("missing");
    expect(stepDiffVerdict(true, true, 3.2, 2)).toBe("mismatch");
    expect(stepDiffVerdict(true, true, 1.9, 2)).toBe("ok");
    expect(stepDiffVerdict(true, true, 50)).toBe("ok"); // no gate set → noisy signal, not a verdict
  });
});
