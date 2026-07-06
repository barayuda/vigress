import { describe, expect, it } from "bun:test";
import { referencedRunDirs, buildRunIndex, cleanupSelection, safeChildPath, type RunDirInfo } from "./dashboard";
import { emptyManifest, upsertBaseline, buildManifestEntry } from "./baselines";
import type { RunResult, Summary } from "./types";

const run = (over: Partial<RunResult> = {}): RunResult => ({
  name: "page", baselineType: "url", viewport: { width: 1440, height: 900 },
  mismatchPixels: 100, mismatchPercent: 1.5,
  target: "page.target.png", targetUrl: "https://app.test/page",
  baseline: "page.baseline.png", diff: "page.diff.png",
  regions: [], checklist: [], mode: "steps", shots: [], steps: [], stepDiffs: [],
  ...over,
});

const summary = (runs: RunResult[]): Summary => ({
  schemaVersion: 7, outDir: "/x", reportHtml: "report.html", summaryJson: "summary.json", runs,
});

const dir = (over: Partial<RunDirInfo> = {}): RunDirInfo => ({
  dirName: "2026-07-06_15-11-50", relPath: "out/2026-07-06_15-11-50",
  mtimeMs: 100, sizeBytes: 1000, keep: false, summary: summary([run()]),
  ...over,
});

describe("referencedRunDirs", () => {
  it("maps approvedFrom dirs to the baseline names referencing them", () => {
    const e = buildManifestEntry(run(), "out/2026-07-06_15-11-50", "t");
    let m = upsertBaseline(emptyManifest(), "page", e);
    m = upsertBaseline(m, "other", buildManifestEntry(run({ name: "other" }), "out/2026-07-06_15-11-50", "t"));
    const refs = referencedRunDirs(m);
    expect(refs.get("out/2026-07-06_15-11-50")).toEqual(["page", "other"]);
  });
  it("derives locks from artifact paths too, skipping bare filenames", () => {
    const m = {
      schemaVersion: 1,
      baselines: {
        edited: {
          storage: "local" as const,
          approvedAt: "t",
          approvedFrom: "out/dir-a",
          viewport: { width: 1, height: 1 },
          sourceUrl: "x",
          artifacts: { main: "out/dir-b/page.png", steps: { s1: "bare.png" } },
        },
      },
    };
    const refs = referencedRunDirs(m);
    expect(refs.get("out/dir-a")).toEqual(["edited"]);
    expect(refs.get("out/dir-b")).toEqual(["edited"]);
    expect(refs.has(".")).toBe(false);
  });
  it("empty for null manifest", () => {
    expect(referencedRunDirs(null).size).toBe(0);
  });
});

describe("buildRunIndex", () => {
  it("sorts newest first and computes worst mismatch across entries", () => {
    const idx = buildRunIndex(
      [
        dir({ dirName: "old", relPath: "out/old", mtimeMs: 1 }),
        dir({ dirName: "new", relPath: "out/new", mtimeMs: 2, summary: summary([run(), run({ name: "b", mismatchPercent: 9.9 })]) }),
      ],
      new Map(),
    );
    expect(idx.map((e) => e.dirName)).toEqual(["new", "old"]);
    expect(idx[0].worstMismatch).toBe(9.9);
    expect(idx[0].entries.map((e) => e.name)).toEqual(["page", "b"]);
  });
  it("marks locked dirs with the referencing baseline names", () => {
    const idx = buildRunIndex([dir()], new Map([["out/2026-07-06_15-11-50", ["page"]]]));
    expect(idx[0].lockedBy).toEqual(["page"]);
  });
  it("flags unreadable dirs (null summary) with no entries", () => {
    const idx = buildRunIndex([dir({ summary: null })], new Map());
    expect(idx[0].unreadable).toBe(true);
    expect(idx[0].entries).toEqual([]);
    expect(idx[0].worstMismatch).toBe(0);
  });
  it("thumbnail is the worst entry's diff, falling back to target on bootstrap", () => {
    const withDiff = buildRunIndex([dir()], new Map());
    expect(withDiff[0].thumbnail).toBe("page.diff.png");
    const boot = run({ bootstrap: true, baseline: undefined, diff: undefined, mismatchPercent: undefined, mismatchPixels: undefined });
    const bootIdx = buildRunIndex([dir({ summary: summary([boot]) })], new Map());
    expect(bootIdx[0].thumbnail).toBe("page.target.png");
  });
  it("counts issues: failed check steps + missing stepDiffs + style mismatches", () => {
    const r = run({
      steps: [{ index: 1, action: "click", selector: "#x", check: true, status: "failed", error: "boom" }],
      stepDiffs: [{ name: "01", mismatchPercent: 0, verdict: "missing" }],
      regions: [{ name: "r", mismatchPixels: 0, mismatchPercent: 0, verdict: "pass", reason: "content",
        styleDiff: [{ property: "color", target: "a", baseline: "b", match: false }] }],
    });
    const idx = buildRunIndex([dir({ summary: summary([r]) })], new Map());
    expect(idx[0].issues).toBe(3);
  });
});

describe("cleanupSelection", () => {
  it("selects only dirs that are neither keep nor locked", () => {
    const idx = buildRunIndex(
      [
        dir({ dirName: "junk", relPath: "out/junk", mtimeMs: 3 }),
        dir({ dirName: "kept", relPath: "out/kept", mtimeMs: 2, keep: true }),
        dir({ dirName: "blessed", relPath: "out/blessed", mtimeMs: 1 }),
      ],
      new Map([["out/blessed", ["page"]]]),
    );
    expect(cleanupSelection(idx).map((e) => e.dirName)).toEqual(["junk"]);
  });
});

describe("safeChildPath", () => {
  const root = "/repo/out";
  it("resolves plain child paths", () => {
    expect(safeChildPath(root, "2026/x.png")).toBe("/repo/out/2026/x.png");
  });
  it("rejects traversal and absolute paths", () => {
    expect(safeChildPath(root, "../etc/passwd")).toBeNull();
    expect(safeChildPath(root, "a/../../etc")).toBeNull();
    expect(safeChildPath(root, "/etc/passwd")).toBeNull();
  });
  it("rejects empty and dot-prefixed segments", () => {
    expect(safeChildPath(root, "")).toBeNull();
    expect(safeChildPath(root, ".approved")).toBeNull();
  });
});
