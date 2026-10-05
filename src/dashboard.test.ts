import { describe, expect, it } from "bun:test";
import { referencedRunDirs, buildRunIndex, buildRunDetail, buildTrends, TREND_MAX_POINTS, fileUrl, parseRunFilter, filterRuns, buildBaselineIndex, isWriteAllowed, cleanupSelection, safeChildPath, safeDecode, type RunDirInfo } from "./dashboard";
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

describe("safeDecode", () => {
  it("decodes percent-encoded segments", () => {
    expect(safeDecode("a%20b")).toBe("a b");
  });
  it("returns null on a malformed sequence instead of throwing", () => {
    expect(safeDecode("%E0%A4%A")).toBeNull();
    expect(safeDecode("%")).toBeNull();
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

describe("isWriteAllowed", () => {
  const base = { origin: null, host: "127.0.0.1:4600", tailscaleLogin: null, writers: [] as string[] };

  it("allows a direct local request with no Origin (curl, CLI)", () => {
    expect(isWriteAllowed(base).ok).toBe(true);
  });
  it("allows a same-origin browser request", () => {
    expect(isWriteAllowed({ ...base, origin: "http://127.0.0.1:4600" }).ok).toBe(true);
  });
  it("rejects a cross-origin request (CSRF from another page)", () => {
    const r = isWriteAllowed({ ...base, origin: "https://evil.example" });
    expect(r.ok).toBe(false);
  });
  it("rejects an unparseable Origin", () => {
    expect(isWriteAllowed({ ...base, origin: "not a url" }).ok).toBe(false);
  });
  it("through the tailnet proxy, only allowlisted logins may write (case-insensitive)", () => {
    const via = { ...base, host: "box.tail1234.ts.net", origin: "https://box.tail1234.ts.net" };
    expect(isWriteAllowed({ ...via, tailscaleLogin: "bara@x.com", writers: ["Bara@X.com"] }).ok).toBe(true);
    expect(isWriteAllowed({ ...via, tailscaleLogin: "other@x.com", writers: ["bara@x.com"] }).ok).toBe(false);
  });
  it("through the tailnet proxy with no allowlist configured, nobody may write", () => {
    expect(isWriteAllowed({ ...base, tailscaleLogin: "bara@x.com", writers: [] }).ok).toBe(false);
  });
});

describe("buildBaselineIndex", () => {
  const manifestOf = (fullPage?: true) => {
    let m = upsertBaseline(emptyManifest(), "page", buildManifestEntry(run({ fullPage, shots: [{ name: "01-open", path: "page.01-open.png" }] }), "out/a", "2026-07-06T00:00:00Z"));
    m = upsertBaseline(m, "alpha", buildManifestEntry(run({ name: "alpha", shots: [] }), "out/b", "2026-07-07T00:00:00Z"));
    return m;
  };
  const allThere = () => true;

  it("lists entries sorted by name with the fields the page shows", () => {
    const idx = buildBaselineIndex(manifestOf(true), allThere);
    expect(idx.map((b) => b.name)).toEqual(["alpha", "page"]);
    expect(idx[1]).toMatchObject({
      name: "page", approvedAt: "2026-07-06T00:00:00Z", approvedFrom: "out/a",
      viewport: { width: 1440, height: 900 }, sourceUrl: "https://app.test/page",
      fullPage: true, stepCount: 1, missing: [],
    });
  });
  it("fullPage is false for viewport baselines and legacy entries", () => {
    expect(buildBaselineIndex(manifestOf(), allThere).every((b) => b.fullPage === false)).toBe(true);
  });
  it("reports artifacts the injected existence check cannot find", () => {
    const idx = buildBaselineIndex(manifestOf(), (p) => p !== "out/a/page.target.png");
    const page = idx.find((b) => b.name === "page")!;
    expect(page.missing).toEqual(["out/a/page.target.png"]);
    expect(idx.find((b) => b.name === "alpha")!.missing).toEqual([]);
  });
  it("is empty for a null manifest", () => {
    expect(buildBaselineIndex(null, allThere)).toEqual([]);
  });
});

describe("buildRunDetail", () => {
  const noisy = run({
    name: "page", mismatchPercent: 3.2, heightDelta: -40,
    steps: [
      { index: 1, action: "click", selector: "#a", check: true, status: "ok" },
      { index: 2, action: "click", selector: "#b", check: true, status: "failed", error: "not found" },
      { index: 3, action: "screenshot", check: false, status: "failed", error: "ignored: not a check" },
    ],
    stepDiffs: [
      { name: "01-open", mismatchPercent: 0.4, verdict: "ok" },
      { name: "02-gone", mismatchPercent: 0, verdict: "missing" },
    ],
    regions: [
      { name: "bar", mismatchPixels: 9, mismatchPercent: 7, verdict: "fail", reason: "content" },
      { name: "hdr", mismatchPixels: 0, mismatchPercent: 0, verdict: "pass", reason: "content",
        styleDiff: [
          { property: "color", target: "red", baseline: "blue", match: false },
          { property: "padding", target: "1px", baseline: "1px", match: true },
        ] },
    ],
  });

  it("keeps only what needs attention: failed check steps, style mismatches, step diffs with their verdict", () => {
    const [d] = buildRunDetail(summary([noisy]), "run-x");
    expect(d.name).toBe("page");
    expect(d.mismatchPercent).toBe(3.2);
    expect(d.heightDelta).toBe(-40);
    expect(d.failedSteps).toEqual([{ index: 2, action: "click", selector: "#b", error: "not found" }]);
    expect(d.regions.map((r) => [r.name, r.verdict, r.styleMismatches.length])).toEqual([["bar", "fail", 0], ["hdr", "pass", 1]]);
    expect(d.regions[1].styleMismatches).toEqual([{ property: "color", target: "red", baseline: "blue" }]);
    expect(d.stepDiffs.map((s) => s.verdict)).toEqual(["ok", "missing"]);
  });
  it("counts issues the same way the run list does", () => {
    const sum = summary([noisy]);
    const [d] = buildRunDetail(sum, "run-x");
    const [row] = buildRunIndex([dir({ summary: sum })], new Map());
    expect(d.issues).toBe(row.issues);
    expect(d.issues).toBe(3); // 1 failed check + 1 missing step diff + 1 style mismatch
  });
  it("marks a bootstrap entry and tolerates absent mismatch fields", () => {
    const [d] = buildRunDetail(summary([run({ bootstrap: true, mismatchPercent: undefined, heightDelta: undefined, baseline: undefined, diff: undefined })]), "run-x");
    expect(d.bootstrap).toBe(true);
    expect(d.mismatchPercent).toBeUndefined();
    expect(d.heightDelta).toBeUndefined();
    expect(d.issues).toBe(0);
  });
});

describe("fileUrl", () => {
  it("encodes each path segment and keeps the slashes", () => {
    expect(fileUrl("2026-10-04_10-00-00", "video/a b.webm")).toBe("/files/2026-10-04_10-00-00/video/a%20b.webm");
    expect(fileUrl("run x", "p.target.png")).toBe("/files/run%20x/p.target.png");
  });
});

describe("buildRunDetail images", () => {
  it("gives ready /files/ URLs for target, baseline, diff and video", () => {
    const [d] = buildRunDetail(summary([run({ video: "video/page.webm" })]), "run-x");
    expect(d.images).toEqual({
      target: "/files/run-x/page.target.png",
      baseline: "/files/run-x/page.baseline.png",
      diff: "/files/run-x/page.diff.png",
      video: "/files/run-x/video/page.webm",
    });
  });
  it("omits baseline, diff and video when the run has none (bootstrap)", () => {
    const [d] = buildRunDetail(summary([run({ bootstrap: true, baseline: undefined, diff: undefined })]), "run-x");
    expect(d.images).toEqual({ target: "/files/run-x/page.target.png" });
  });
});

describe("parseRunFilter", () => {
  const p = (q: string) => parseRunFilter(new URLSearchParams(q));
  it("reads text, issues, locked and a numeric minimum", () => {
    expect(p("q=%20Contact%20&issues=1&locked=1&min=2.5")).toEqual({ text: "contact", issues: true, locked: true, min: 2.5 });
  });
  it("is empty when nothing is given, and ignores junk", () => {
    expect(p("")).toEqual({});
    expect(p("issues=0&locked=yes&min=abc&q=%20%20")).toEqual({});
    expect(p("min=-3")).toEqual({});
  });
});

describe("filterRuns", () => {
  const idx = buildRunIndex(
    [
      dir({ dirName: "2026-10-01_a", relPath: "out/2026-10-01_a", mtimeMs: 5, summary: summary([run({ name: "contact", mismatchPercent: 0.5 })]) }),
      dir({ dirName: "2026-10-02_b", relPath: "out/2026-10-02_b", mtimeMs: 4, summary: summary([run({ name: "billing", mismatchPercent: 9,
        steps: [{ index: 1, action: "click", selector: "#x", check: true, status: "failed", error: "e" }] })]) }),
      dir({ dirName: "2026-10-03_c", relPath: "out/2026-10-03_c", mtimeMs: 3, summary: null }),
      dir({ dirName: "2026-10-04_d", relPath: "out/2026-10-04_d", mtimeMs: 2, summary: summary([run({ name: "contact", mismatchPercent: 3 })]) }),
    ],
    new Map([["out/2026-10-04_d", ["contact"]]]),
  );
  const names = (f: Parameters<typeof filterRuns>[1]) => filterRuns(idx, f).map((e) => e.dirName);

  it("returns everything, in order, for an empty filter", () => {
    expect(names({})).toEqual(["2026-10-01_a", "2026-10-02_b", "2026-10-03_c", "2026-10-04_d"]);
  });
  it("matches text against the run dir name or any entry name, case-insensitively", () => {
    expect(names({ text: "contact" })).toEqual(["2026-10-01_a", "2026-10-04_d"]);
    expect(names({ text: "10-02" })).toEqual(["2026-10-02_b"]);
    expect(names({ text: "nope" })).toEqual([]);
  });
  it("issues keeps only runs with issues; locked only baseline-referenced runs", () => {
    expect(names({ issues: true })).toEqual(["2026-10-02_b"]);
    expect(names({ locked: true })).toEqual(["2026-10-04_d"]);
  });
  it("min keeps runs whose worst mismatch is at least that percent", () => {
    expect(names({ min: 3 })).toEqual(["2026-10-02_b", "2026-10-04_d"]);
  });
  it("combines every condition (AND)", () => {
    expect(names({ text: "contact", min: 3 })).toEqual(["2026-10-04_d"]);
    expect(names({ text: "contact", issues: true })).toEqual([]);
  });
});

describe("buildTrends", () => {
  const d = (dirName: string, mtimeMs: number, runs: RunResult[]) => dir({ dirName, relPath: "out/" + dirName, mtimeMs, summary: summary(runs) });

  it("groups points by run name, oldest first", () => {
    const t = buildTrends([
      d("c", 30, [run({ name: "contact", mismatchPercent: 3 })]),
      d("a", 10, [run({ name: "contact", mismatchPercent: 1 }), run({ name: "billing", mismatchPercent: 8 })]),
      d("b", 20, [run({ name: "contact", mismatchPercent: 2, heightDelta: -40 })]),
    ]);
    expect(Object.keys(t).sort()).toEqual(["billing", "contact"]);
    expect(t.contact.map((p) => [p.dirName, p.mismatchPercent])).toEqual([["a", 1], ["b", 2], ["c", 3]]);
    expect(t.contact[1].heightDelta).toBe(-40);
    expect(t.billing).toHaveLength(1);
  });
  it("skips bootstrap runs and runs without a mismatch value", () => {
    const t = buildTrends([
      d("a", 1, [run({ name: "x", bootstrap: true, mismatchPercent: undefined })]),
      d("b", 2, [run({ name: "x", mismatchPercent: undefined })]),
      d("c", 3, [run({ name: "x", mismatchPercent: 0 })]),
    ]);
    expect(t.x.map((p) => p.dirName)).toEqual(["c"]);
  });
  it("skips unreadable run dirs and drops names left with no points", () => {
    const t = buildTrends([dir({ dirName: "bad", summary: null }), d("a", 1, [run({ name: "only-bootstrap", bootstrap: true, mismatchPercent: undefined })])]);
    expect(t).toEqual({});
  });
  it("keeps only the most recent points per name", () => {
    const many = Array.from({ length: TREND_MAX_POINTS + 7 }, (_, i) => d("r" + i, i, [run({ name: "n", mismatchPercent: i })]));
    const t = buildTrends(many);
    expect(t.n).toHaveLength(TREND_MAX_POINTS);
    expect(t.n[0].mismatchPercent).toBe(7);
    expect(t.n[t.n.length - 1].mismatchPercent).toBe(TREND_MAX_POINTS + 6);
  });
  it("records the baseline type so a parity run and a regression run can be told apart", () => {
    const t = buildTrends([d("a", 1, [run({ name: "n", baselineType: "baseline" })])]);
    expect(t.n[0].baselineType).toBe("baseline");
  });
});
