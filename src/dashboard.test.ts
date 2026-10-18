import { describe, expect, it } from "bun:test";
import { baselineCheck, isFileAllowed, dirSegment, compareStepDiffsPayload, parseStepPromptBody, baselineCandidates, compareCandidates, planStepPrompt, referencedRunDirs, buildRunIndex, buildRunDetail, resolveRunBaseline, repoPathUrl, isPromptAllowed, buildTrends, TREND_MAX_POINTS, fileUrl, parseRunFilter, filterRuns, buildBaselineIndex, isWriteAllowed, cleanupSelection, safeChildPath, safeDecode, type RunDirInfo } from "./dashboard";
import { emptyManifest, upsertBaseline, buildManifestEntry, type Manifest, type ManifestEntry, type BaselineVersion } from "./baselines";
import type { RunResult, Summary } from "./types";
import { buildStepPrompt } from "./stepPrompt";

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

describe("buildRunIndex git", () => {
  it("carries the run's git info so the page can show branch@commit", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const g = { commit: sha, branch: "feat/x", dirty: true, url: `https://github.com/o/r/commit/${sha}` };
    const idx = buildRunIndex([dir({ summary: { ...summary([run()]), git: g } }), dir({ dirName: "none", relPath: "out/none" })], new Map());
    expect(idx.find((e) => e.dirName === "2026-07-06_15-11-50")!.git).toEqual(g);
    expect(idx.find((e) => e.dirName === "none")!.git).toBeUndefined();
  });
  it("drops a commit URL that is not exactly a GitHub commit page (summary.json is a file on disk)", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    for (const url of ["javascript:alert(1)", "https://evil.example/o/r/commit/" + sha, "https://github.com/o/r/commit/" + sha + "\"onmouseover=x", "http://github.com/o/r/commit/" + sha]) {
      const [e] = buildRunIndex([dir({ summary: { ...summary([run()]), git: { commit: sha, dirty: false, url } } })], new Map());
      expect(e.git).toEqual({ commit: sha, dirty: false });
    }
  });
  it("drops git info whose commit is not a 40-hex sha", () => {
    const [e] = buildRunIndex([dir({ summary: { ...summary([run()]), git: { commit: "<script>", dirty: false } } })], new Map());
    expect(e.git).toBeUndefined();
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

describe("baseline history in the dashboard", () => {
  const e = (dir: string, at: string) => buildManifestEntry(run({ shots: [{ name: "s", path: "page.s.png" }] }), `out/${dir}`, at);
  const m = upsertBaseline(upsertBaseline(emptyManifest(), "page", e("old", "2026-10-01T00:00:00Z")), "page", e("new", "2026-10-02T00:00:00Z"));

  it("locks the run dirs of previous versions too, so cleanup cannot delete a rollback target", () => {
    const refs = referencedRunDirs(m);
    expect(refs.get("out/new")).toEqual(["page"]);
    expect(refs.get("out/old")).toEqual(["page"]);
  });
  it("lists previous versions (newest first) with their own missing artifacts", () => {
    const [b] = buildBaselineIndex(m, (p) => !p.startsWith("out/old/page.s"));
    expect(b.missing).toEqual([]);
    expect(b.versions).toEqual([
      { index: 0, approvedAt: "2026-10-01T00:00:00Z", approvedFrom: "out/old", sourceUrl: "https://app.test/page", fullPage: false, missing: ["out/old/page.s.png"] },
    ]);
  });
  it("has no versions for a baseline approved once", () => {
    const [b] = buildBaselineIndex(upsertBaseline(emptyManifest(), "page", e("a", "t")), () => true);
    expect(b.versions).toEqual([]);
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

const ctx = { manifest: null, outDirRel: "out", promptAllowed: true };

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
    const [d] = buildRunDetail(summary([noisy]), "run-x", ctx);
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
    const [d] = buildRunDetail(sum, "run-x", ctx);
    const [row] = buildRunIndex([dir({ summary: sum })], new Map());
    expect(d.issues).toBe(row.issues);
    expect(d.issues).toBe(3); // 1 failed check + 1 missing step diff + 1 style mismatch
  });
  it("marks a bootstrap entry and tolerates absent mismatch fields", () => {
    const [d] = buildRunDetail(summary([run({ bootstrap: true, mismatchPercent: undefined, heightDelta: undefined, baseline: undefined, diff: undefined })]), "run-x", ctx);
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
    const [d] = buildRunDetail(summary([run({ video: "video/page.webm" })]), "run-x", ctx);
    expect(d.images).toEqual({
      target: "/files/run-x/page.target.png",
      baseline: "/files/run-x/page.baseline.png",
      diff: "/files/run-x/page.diff.png",
      video: "/files/run-x/video/page.webm",
    });
  });
  it("omits baseline, diff and video when the run has none (bootstrap)", () => {
    const [d] = buildRunDetail(summary([run({ bootstrap: true, baseline: undefined, diff: undefined })]), "run-x", ctx);
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

const version = (approvedAt: string, over: Partial<BaselineVersion> = {}): BaselineVersion => ({
  storage: "local", approvedAt, approvedFrom: "out/2026-a", viewport: { width: 1440, height: 900 }, sourceUrl: "https://app.test/page",
  artifacts: { main: "out/2026-a/page.target.png", steps: {} }, ...over,
});
const manifestOf = (name: string, entry: ManifestEntry): Manifest => ({ schemaVersion: 1, baselines: { [name]: entry } });

describe("resolveRunBaseline", () => {
  const cur = version("2026-10-03T00:00:00Z", { artifacts: { main: "out/c/m.png", steps: { s1: "out/c/s1.png" } } });
  const old = version("2026-10-01T00:00:00Z", { artifacts: { main: "out/o/m.png", steps: { s1: "out/o/s1.png" } } });
  const m = manifestOf("page", { ...cur, history: [old] });

  it("returns the current entry, no warning, when the ref matches it", () => {
    const r = resolveRunBaseline(m, { name: "page", approvedAt: cur.approvedAt }, "page");
    expect(r.version?.approvedAt).toBe(cur.approvedAt);
    expect(r.warning).toBeUndefined();
  });
  it("finds an older approvedAt in history", () => {
    const r = resolveRunBaseline(m, { name: "page", approvedAt: old.approvedAt }, "page");
    expect(r.version).toBe(m.baselines.page.history![0]);
    expect(r.warning).toBeUndefined();
  });
  it("falls back to the current entry with a warning when the version was pruned", () => {
    const r = resolveRunBaseline(m, { name: "page", approvedAt: "2020-01-01T00:00:00Z" }, "page");
    expect(r.version?.approvedAt).toBe(cur.approvedAt);
    expect(r.warning).toBe("the baseline changed after this run; before images may not be what this run was compared against");
  });
  it("falls back to the current entry with a warning when the run has no ref", () => {
    const r = resolveRunBaseline(m, undefined, "page");
    expect(r.version?.approvedAt).toBe(cur.approvedAt);
    expect(r.warning).toMatch(/baseline changed after this run/);
  });
  it("looks up ref.name over the run name", () => {
    const r = resolveRunBaseline(m, { name: "page", approvedAt: cur.approvedAt }, "other");
    expect(r.version?.approvedAt).toBe(cur.approvedAt);
  });
  it("returns no version when the baseline is gone (or there is no manifest)", () => {
    expect(resolveRunBaseline(m, undefined, "nope")).toEqual({ version: null, warning: "baseline 'nope' is no longer approved" });
    expect(resolveRunBaseline(null, { name: "page", approvedAt: cur.approvedAt }, "page")).toEqual({ version: null, warning: "baseline 'page' is no longer approved" });
  });
  it("does not resolve inherited object keys as baseline names", () => {
    expect(resolveRunBaseline(m, undefined, "constructor").version).toBeNull();
  });
});

describe("repoPathUrl", () => {
  it("maps a repo-relative artifact path under out/ to a /files/ URL", () => {
    expect(repoPathUrl("out/2026-a/home.step.png", "out")).toBe("/files/2026-a/home.step.png");
    expect(repoPathUrl("out/2026-a/sub dir/x.png", "out")).toBe("/files/2026-a/sub%20dir/x.png");
  });
  it("returns null for a path outside out/", () => {
    expect(repoPathUrl("elsewhere/x.png", "out")).toBeNull();
    expect(repoPathUrl("out/x.png", "out")).toBeNull(); // no run dir segment
    expect(repoPathUrl("outside/2026-a/x.png", "out")).toBeNull();
    expect(repoPathUrl("out/../secret/x.png", "out")).toBeNull();
  });
  it("uses no prefix when the out dir is the repo root (dashboard --out .)", () => {
    expect(repoPathUrl("2026-a/home.step.png", "")).toBe("/files/2026-a/home.step.png");
    expect(repoPathUrl("2026-a/sub/x.png", ".")).toBe("/files/2026-a/sub/x.png");
    expect(repoPathUrl("x.png", "")).toBeNull(); // no run dir segment
  });
  it("refuses absolute paths and . or .. segments in every case", () => {
    for (const out of ["", ".", "out"]) {
      const pre = out === "out" ? "out/" : "";
      expect(repoPathUrl("/etc/passwd", out)).toBeNull();
      expect(repoPathUrl(`/${pre}2026-a/x.png`, out)).toBeNull();
      expect(repoPathUrl(`${pre}../x/y.png`, out)).toBeNull();
      expect(repoPathUrl(`${pre}./2026-a/x.png`, out)).toBeNull();
      expect(repoPathUrl(`${pre}2026-a/../x.png`, out)).toBeNull();
      expect(repoPathUrl(`${pre}2026-a/./x.png`, out)).toBeNull();
      expect(repoPathUrl(`${pre}2026-a//x.png`, out)).toBeNull();
    }
  });
});

describe("isPromptAllowed", () => {
  it("allows only requests without a Tailscale login header", () => {
    expect(isPromptAllowed(null)).toBe(true);
    expect(isPromptAllowed("me@x")).toBe(false);
  });
});

describe("isFileAllowed", () => {
  it("refuses a run's summary.json to Tailscale viewers (it holds the invocation: cwd, argv, env)", () => {
    expect(isFileAllowed("summary.json", "me@x")).toBe(false);
    expect(isFileAllowed("sub/summary.json", "me@x")).toBe(false);
    expect(isFileAllowed("SUMMARY.JSON", "me@x")).toBe(false);
  });
  it("serves summary.json locally, and every other file to everyone", () => {
    expect(isFileAllowed("summary.json", null)).toBe(true);
    expect(isFileAllowed("report.html", "me@x")).toBe(true);
    expect(isFileAllowed("page.target.png", "me@x")).toBe(true);
    expect(isFileAllowed("summary.json.png", "me@x")).toBe(true);
  });
});

describe("buildRunDetail step images and sides", () => {
  const r = run({
    name: "page",
    baselineRef: { name: "page", approvedAt: "2026-10-03T00:00:00Z" },
    shots: [{ name: "s1", path: "page.s1.png" }],
    stepDiffs: [
      { name: "s1", mismatchPercent: 2, verdict: "mismatch", diff: "page.s1.diff.png" },
      { name: "s2", mismatchPercent: 0, verdict: "missing" },
    ],
  });
  const m = manifestOf("page", version("2026-10-03T00:00:00Z", { artifacts: { main: "out/2026-a/page.target.png", steps: { s1: "out/2026-a/page.s1.png", s2: "out/2026-a/page.s2.png" } } }));

  it("gives before/after/diff URLs and both sides for a changed step", () => {
    const [d] = buildRunDetail(summary([r]), "run-x", { manifest: m, outDirRel: "out", promptAllowed: true });
    const s1 = d.stepDiffs[0];
    expect(s1.images).toEqual({ before: "/files/2026-a/page.s1.png", after: "/files/run-x/page.s1.png", diff: "/files/run-x/page.s1.diff.png" });
    expect(s1.sides).toEqual(["before", "after"]);
    expect(d.baselineWarning).toBeUndefined();
  });
  it("has no after image for a missing step, and offers only the before side", () => {
    const [d] = buildRunDetail(summary([r]), "run-x", { manifest: m, outDirRel: "out", promptAllowed: true });
    const s2 = d.stepDiffs[1];
    expect(s2.images.after).toBeUndefined();
    expect(s2.images.before).toBe("/files/2026-a/page.s2.png");
    expect(s2.sides).toEqual(["before"]);
  });
  it("has no before image for a new step", () => {
    const rn = run({ shots: [{ name: "s3", path: "page.s3.png" }], stepDiffs: [{ name: "s3", mismatchPercent: 0, verdict: "new" }] });
    const [d] = buildRunDetail(summary([rn]), "run-x", { manifest: m, outDirRel: "out", promptAllowed: true });
    expect(d.stepDiffs[0].images).toEqual({ after: "/files/run-x/page.s3.png" });
    expect(d.stepDiffs[0].sides).toEqual(["after"]);
  });
  it("passes promptAllowed through and never exposes absolute paths", () => {
    const [d] = buildRunDetail(summary([r]), "run-x", { manifest: m, outDirRel: "out", promptAllowed: false });
    expect(d.promptAllowed).toBe(false);
    const slashed = JSON.stringify(d).match(/"\/[^"]*"/g) ?? [];
    expect(slashed.length).toBeGreaterThan(0);
    expect(slashed.every((v) => v.startsWith('"/files/'))).toBe(true);
  });
  it("warns, and uses the current entry, when the ref was pruned or absent", () => {
    const rp = { ...r, baselineRef: undefined };
    const [d] = buildRunDetail(summary([rp]), "run-x", { manifest: m, outDirRel: "out", promptAllowed: true });
    expect(d.baselineWarning).toMatch(/baseline changed after this run/);
    expect(d.stepDiffs[0].images.before).toBe("/files/2026-a/page.s1.png");
  });
  it("warns that the baseline is gone and shows no before images when there is no manifest entry", () => {
    const [d] = buildRunDetail(summary([r]), "run-x", { manifest: null, outDirRel: "out", promptAllowed: true });
    expect(d.baselineWarning).toBe("baseline 'page' is no longer approved");
    expect(d.stepDiffs[0].images.before).toBeUndefined();
  });
  it("omits a before image whose manifest path is outside out/", () => {
    const bad = manifestOf("page", version("2026-10-03T00:00:00Z", { artifacts: { main: "x.png", steps: { s1: "elsewhere/s1.png" } } }));
    const [d] = buildRunDetail(summary([r]), "run-x", { manifest: bad, outDirRel: "out", promptAllowed: true });
    expect(d.stepDiffs[0].images.before).toBeUndefined();
  });
  it("sets no baselineWarning for a run without step diffs", () => {
    const [d] = buildRunDetail(summary([run()]), "run-x", ctx);
    expect(d.baselineWarning).toBeUndefined();
    expect(d.stepDiffs).toEqual([]);
  });
});

describe("dirSegment", () => {
  it("accepts one plain component and refuses traversal, dots and bad escapes", () => {
    expect(dirSegment("2026-a")).toBe("2026-a");
    expect(dirSegment("a%2Fb")).toBeNull();
    expect(dirSegment("..")).toBeNull();
    expect(dirSegment(".hidden")).toBeNull();
    expect(dirSegment("%E0%A4%A")).toBeNull();
    expect(dirSegment("")).toBeNull();
  });
});

describe("compareStepDiffsPayload", () => {
  it("gives URLs, an inline diff and sides, and no buffers or absolute paths", () => {
    const out = compareStepDiffsPayload(
      [
        { name: "s1", mismatchPercent: 2, verdict: "ok", aRel: "page.s1.png", bRel: "page.s1.png", diffPng: Buffer.from("png") },
        { name: "s2", mismatchPercent: 0, verdict: "missing", aRel: "page.s2.png" },
        { name: "s3", mismatchPercent: 0, verdict: "new", bRel: "page.s3.png" },
      ],
      "run-a",
      "run-b",
    );
    expect(out[0].images).toEqual({ before: "/files/run-a/page.s1.png", after: "/files/run-b/page.s1.png", diff: "data:image/png;base64," + Buffer.from("png").toString("base64") });
    expect(out[0].sides).toEqual(["before", "after"]);
    expect(out[1].images).toEqual({ before: "/files/run-a/page.s2.png" });
    expect(out[1].sides).toEqual(["before"]);
    expect(out[2].images).toEqual({ after: "/files/run-b/page.s3.png" });
    expect(out[2].sides).toEqual(["after"]);
    const text = JSON.stringify(out);
    expect(text).not.toContain('"type":"Buffer"');
    // every string value is a /files/ URL or a data URI: no filesystem path
    const strings = [...text.matchAll(/"(?:before|after|diff)":"([^"]*)"/g)].map((x) => x[1]);
    expect(strings.length).toBe(5);
    expect(strings.every((v) => v.startsWith("/files/") || v.startsWith("data:image/png;base64,"))).toBe(true);
  });
});

describe("parseStepPromptBody", () => {
  const base = { mode: "baseline", dir: "run-x", name: "page", picks: { s1: "before" }, hideBelow: 0.1 };
  it("accepts a baseline body and a compare body", () => {
    expect(parseStepPromptBody(base)).toEqual({ ok: true, body: { mode: "baseline", dir: "run-x", name: "page", picks: { s1: "before" }, hideBelow: 0.1 } });
    const c = parseStepPromptBody({ mode: "compare", a: "run-a", b: "run-b", name: "page", picks: { s1: "after" }, hideBelow: 0 });
    expect(c).toEqual({ ok: true, body: { mode: "compare", a: "run-a", b: "run-b", name: "page", picks: { s1: "after" }, hideBelow: 0 } });
  });
  it.each([
    [null],
    [{ ...base, mode: "x" }],
    [{ ...base, dir: "../x" }],
    [{ ...base, dir: undefined }],
    [{ ...base, name: "" }],
    [{ ...base, hideBelow: -1 }],
    [{ ...base, hideBelow: "0.1" }],
    [{ ...base, hideBelow: Number.NaN }],
    [{ ...base, picks: [] }],
    [{ ...base, picks: { s1: "both" } }],
    [{ mode: "compare", a: "run-a", b: ".x", name: "page", picks: {}, hideBelow: 0 }],
  ])("rejects a bad body %#", (b) => {
    expect(parseStepPromptBody(b).ok).toBe(false);
  });
});

describe("step prompt planning", () => {
  const paths = { rootDir: "/repo", outDirAbs: "/repo/out", outDirRel: "out" };
  const r = run({
    name: "page",
    targetUrl: "https://app.test/page",
    baselineRef: { name: "page", approvedAt: "2026-10-03T00:00:00Z" },
    shots: [{ name: "s1", path: "page.s1.png" }, { name: "s3", path: "page.s3.png" }, { name: "tiny", path: "page.tiny.png" }],
    stepDiffs: [
      { name: "s1", mismatchPercent: 2, verdict: "ok", diff: "page.s1.diff.png" },
      { name: "s2", mismatchPercent: 0, verdict: "missing" },
      { name: "s3", mismatchPercent: 0, verdict: "new" },
      { name: "tiny", mismatchPercent: 0.05, verdict: "ok", diff: "page.tiny.diff.png" },
    ],
  });
  const m = manifestOf("page", version("2026-10-03T00:00:00Z", { artifacts: { main: "out/2026-a/page.target.png", steps: { s1: "out/2026-a/page.s1.png", s2: "out/2026-a/page.s2.png", tiny: "out/2026-a/page.tiny.png" } } }));
  const all = (): boolean => true;
  const sum: Summary = { ...summary([r]), invocation: { cwd: "/app", argv: ["after", "page", "--target", "https://app.test/page"] } };
  const plan = (picks: Record<string, "before" | "after">, over: { exists?: (a: string) => boolean; hideBelow?: number } = {}) => {
    const b = baselineCandidates(r, "/repo/out/run-x", m, paths, over.exists ?? all);
    return planStepPrompt({
      mode: "baseline", name: "page", picks, hideBelow: over.hideBelow ?? 0.1, candidates: b.candidates, afterRun: r, afterSummary: sum,
      afterDirAbs: "/repo/out/run-x", beforeLabel: b.beforeLabel, warning: b.warning, rootDir: "/repo", cliPath: "/cli/cli.ts",
    });
  };

  it("resolves absolute before/after/diff paths in baseline mode", () => {
    const p = plan({ s1: "before" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.input.steps).toEqual([
      { name: "s1", side: "before", verdict: "ok", mismatchPercent: 2, before: "/repo/out/2026-a/page.s1.png", after: "/repo/out/run-x/page.s1.png", diff: "/repo/out/run-x/page.s1.diff.png" },
    ]);
    expect(p.input.beforeLabel).toBe("approved baseline page (approved 2026-10-03T00:00:00Z)");
    expect(p.input.afterDir).toBe("/repo/out/run-x");
    expect(p.input.targetUrl).toBe("https://app.test/page");
    expect(p.input.rerun).toContain("cd /app && bun run /cli/cli.ts after page --target https://app.test/page --json");
    expect(p.input.compareCheck).toBeUndefined();
    expect(p.input.warning).toBeUndefined();
  });
  it("gives a missing step no after or diff path, and a new step no before path", () => {
    const p = plan({ s2: "before", s3: "after" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.input.steps).toEqual([
      { name: "s2", side: "before", verdict: "missing", mismatchPercent: 0, before: "/repo/out/2026-a/page.s2.png" },
      { name: "s3", side: "after", verdict: "new", mismatchPercent: 0, after: "/repo/out/run-x/page.s3.png" },
    ]);
  });
  it("only includes picked steps, in run order", () => {
    const p = plan({ s3: "after", s1: "after" });
    expect(p.ok && p.input.steps.map((s) => s.name)).toEqual(["s1", "s3"]);
  });
  it("refuses a pick on a step hidden by hideBelow", () => {
    const p = plan({ tiny: "before" });
    expect(p).toEqual({ ok: false, message: 'step "tiny" is hidden at 0.1%; it cannot be marked' });
    expect(plan({ tiny: "before" }, { hideBelow: 0.01 }).ok).toBe(true);
  });
  it("refuses unknown steps, impossible sides and empty picks", () => {
    expect(plan({ nope: "before" }).ok).toBe(false);
    expect(plan({ s2: "after" }).ok).toBe(false);
    expect(plan({}).ok).toBe(false);
  });
  it("refuses a side whose image is not on disk", () => {
    const p = plan({ s1: "before" }, { exists: (a) => !a.includes("2026-a") });
    expect(p).toEqual({ ok: false, message: 'step "s1" has no before image to keep' });
    expect(plan({ s1: "after" }, { exists: (a) => !a.includes("2026-a") }).ok).toBe(true);
    expect(plan({ s1: "after" }, { exists: (a) => !a.includes("run-x") }).ok).toBe(false);
  });
  it("refuses a before image whose manifest path is outside out/", () => {
    const bad = manifestOf("page", version("2026-10-03T00:00:00Z", { artifacts: { main: "x.png", steps: { s1: "/etc/passwd" } } }));
    const b = baselineCandidates(r, "/repo/out/run-x", bad, paths, all);
    expect(b.candidates[0].before).toBeUndefined();
  });
  it("carries the baseline warning and a no-longer-approved label", () => {
    const b = baselineCandidates(r, "/repo/out/run-x", null, paths, all);
    expect(b.warning).toBe("baseline 'page' is no longer approved");
    expect(b.beforeLabel).toBe("approved baseline page (no longer approved)");
    expect(b.candidates.every((c) => c.before === undefined)).toBe(true);
  });
  it("has no rerun when the summary has no invocation", () => {
    const b = baselineCandidates(r, "/repo/out/run-x", m, paths, all);
    const p = planStepPrompt({ mode: "baseline", name: "page", picks: { s1: "after" }, hideBelow: 0.1, candidates: b.candidates, afterRun: r, afterSummary: summary([r]), afterDirAbs: "/repo/out/run-x", beforeLabel: b.beforeLabel, rootDir: "/repo", cliPath: "/cli/cli.ts" });
    expect(p.ok && p.input.rerun).toBeNull();
  });

  it("compare mode: before is the a run's shot, no diff path, compareCheck from the after run's cwd", () => {
    const cands = compareCandidates(
      [{ name: "s1", mismatchPercent: 2, verdict: "ok", aRel: "page.s1.png", bRel: "page.s1.png" }, { name: "s2", mismatchPercent: 0, verdict: "missing", aRel: "page.s2.png" }],
      "/repo/out/run-a",
      "/repo/out/run-b",
      all,
    );
    const p = planStepPrompt({ mode: "compare", name: "page", picks: { s1: "before", s2: "before" }, hideBelow: 0.1, candidates: cands, afterRun: r, afterSummary: sum, afterDirAbs: "/repo/out/run-b", beforeLabel: "/repo/out/run-a", rootDir: "/repo", cliPath: "/cli/cli.ts", compareBeforeDirAbs: "/repo/out/run-a" });
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.input.steps[0]).toEqual({ name: "s1", side: "before", verdict: "ok", mismatchPercent: 2, before: "/repo/out/run-a/page.s1.png", after: "/repo/out/run-b/page.s1.png" });
    expect(p.input.beforeLabel).toBe("/repo/out/run-a");
    expect(p.input.compareCheck).toBe("cd /app && bun run /cli/cli.ts compare /repo/out/run-a <outDir from the re-run JSON> --name page --json");
  });
  it("compare mode: a new step has an after path and no before path", () => {
    const cands = compareCandidates([{ name: "s3", mismatchPercent: 0, verdict: "new", bRel: "page.s3.png" }], "/repo/out/run-a", "/repo/out/run-b", all);
    expect(cands[0].before).toBeUndefined();
    expect(cands[0].after).toBe("/repo/out/run-b/page.s3.png");
  });
  it("compare mode: drops an image that is not on disk (new step's after, missing step's before)", () => {
    const cands = compareCandidates(
      [{ name: "s3", mismatchPercent: 0, verdict: "new", bRel: "page.s3.png" }, { name: "s2", mismatchPercent: 0, verdict: "missing", aRel: "page.s2.png" }],
      "/repo/out/run-a",
      "/repo/out/run-b",
      () => false,
    );
    expect(cands.every((c) => c.before === undefined && c.after === undefined)).toBe(true);
    const p = planStepPrompt({ mode: "compare", name: "page", picks: { s3: "after" }, hideBelow: 0.1, candidates: cands, afterRun: r, afterSummary: sum, afterDirAbs: "/repo/out/run-b", beforeLabel: "/repo/out/run-a", rootDir: "/repo", cliPath: "/cli/cli.ts", compareBeforeDirAbs: "/repo/out/run-a" });
    expect(p).toEqual({ ok: false, message: 'step "s3" has no after image to keep' });
  });
  it("compare mode: drops traversal paths", () => {
    const cands = compareCandidates([{ name: "s1", mismatchPercent: 2, verdict: "ok", aRel: "../x.png", bRel: "../../etc/passwd" }], "/repo/out/run-a", "/repo/out/run-b", all);
    expect(cands[0].before).toBeUndefined();
    expect(cands[0].after).toBeUndefined();
  });
  it("baseline mode: drops traversal shot and diff paths", () => {
    const bad = run({
      name: "page", baselineRef: { name: "page", approvedAt: "2026-10-03T00:00:00Z" },
      shots: [{ name: "s1", path: "../../etc/passwd" }],
      stepDiffs: [{ name: "s1", mismatchPercent: 2, verdict: "ok", diff: "../x.diff.png" }],
    });
    const b = baselineCandidates(bad, "/repo/out/run-x", m, paths, all);
    expect(b.candidates[0].after).toBeUndefined();
    expect(b.candidates[0].diff).toBeUndefined();
    expect(b.candidates[0].before).toBe("/repo/out/2026-a/page.s1.png");
  });
});

describe("step prompt when the re-run would diff against a different baseline version", () => {
  const paths = { rootDir: "/repo", outDirAbs: "/repo/out", outDirRel: "out" };
  const all = (): boolean => true;
  const r = run({
    name: "page",
    baselineRef: { name: "page", approvedAt: "2026-10-03T00:00:00Z" },
    shots: [{ name: "s1", path: "page.s1.png" }],
    stepDiffs: [{ name: "s1", mismatchPercent: 2, verdict: "ok", diff: "page.s1.diff.png" }],
  });
  const sum: Summary = { ...summary([r]), invocation: { cwd: "/app", argv: ["after", "page"] } };
  const used = version("2026-10-03T00:00:00Z", { approvedFrom: "out/2026-a", artifacts: { main: "out/2026-a/page.target.png", steps: { s1: "out/2026-a/page.s1.png" } } });
  const later = (from: string) =>
    version("2026-10-05T00:00:00Z", { approvedFrom: from, artifacts: { main: `${from}/page.target.png`, steps: { s1: `${from}/page.s1.png` } } });
  const prompt = (m: Manifest | null, rr: RunResult = r, exists: (a: string) => boolean = all) => {
    const b = baselineCandidates(rr, "/repo/out/run-x", m, paths, exists);
    const p = planStepPrompt({
      mode: "baseline", name: rr.name, picks: { s1: "before" }, hideBelow: 0.1, candidates: b.candidates, afterRun: rr, afterSummary: { ...sum, runs: [rr] },
      afterDirAbs: "/repo/out/run-x", beforeLabel: b.beforeLabel, warning: b.warning, check: b.check, rootDir: "/repo", cliPath: "/cli/cli.ts",
    });
    if (!p.ok) throw new Error(p.message);
    return { b, input: p.input, text: buildStepPrompt(p.input) };
  };
  const COMPARE = "cd /app && bun run /cli/cli.ts compare /repo/out/2026-a <outDir from the re-run JSON> --name page --json";
  const PLAIN_DONE = "every FIX step's mismatchPercent is at or below";

  it("history hit: before comes from the history version, and the compare line is the check", () => {
    const { b, input, text } = prompt(manifestOf("page", { ...later("out/2026-b"), history: [used] }));
    expect(b.candidates[0].before).toBe("/repo/out/2026-a/page.s1.png");
    expect(b.check).toEqual({ kind: "compare", beforeDirAbs: "/repo/out/2026-a" });
    expect(input.baselineDrift).toBe("compare");
    expect(input.compareCheck).toBe(COMPARE);
    expect(text).toContain(`  ${COMPARE}`);
    expect(text).toContain("stepDiffs are not the check here");
    expect(text).not.toContain(PLAIN_DONE);
  });
  it("self-blessed run (the current entry was approved from this run): compare line, never the plain Done rule", () => {
    const { input, text } = prompt(manifestOf("page", { ...later("out/run-x"), history: [used] }));
    expect(input.compareCheck).toBe(COMPARE);
    expect(text).toContain(`  ${COMPARE}`);
    expect(text).not.toContain(PLAIN_DONE);
  });
  it("self-blessed run whose own version is the resolved one: the images warning, no compare line", () => {
    // The run's ref was pruned, so the before images fall back to the current entry: this run itself.
    const { b, text } = prompt(manifestOf("page", later("out/run-x")));
    expect(b.check).toEqual({ kind: "images" });
    expect(text).toContain("the re-run would compare against a different baseline version than these before images");
    expect(text).not.toContain("vigress compare");
    expect(text).not.toContain(" compare /repo");
    expect(text).not.toContain(PLAIN_DONE);
  });
  it("uses the images warning when the before run dir is gone", () => {
    const { b, text } = prompt(manifestOf("page", { ...later("out/2026-b"), history: [used] }), r, (a) => !a.startsWith("/repo/out/2026-a/summary.json"));
    expect(b.check).toEqual({ kind: "images" });
    expect(text).not.toContain(PLAIN_DONE);
  });
  it("uses the images warning when the run's name differs from the baseline name", () => {
    const named = { ...r, name: "page-check" };
    const { b, text } = prompt(manifestOf("page", { ...later("out/2026-b"), history: [used] }), named);
    expect(b.check).toEqual({ kind: "images" });
    expect(text).not.toContain(PLAIN_DONE);
  });
  it("resolved version is current and not self-blessed: unchanged (plain re-run is the check)", () => {
    const { b, input, text } = prompt(manifestOf("page", used));
    expect(b.check).toEqual({ kind: "rerun" });
    expect(input.baselineDrift).toBeUndefined();
    expect(input.compareCheck).toBeUndefined();
    expect(text).toContain(PLAIN_DONE);
    expect(text).not.toContain("compare");
  });
  it("baselineCheck refuses a before run dir outside the out dir", () => {
    const odd = { ...used, approvedFrom: "../elsewhere" };
    expect(baselineCheck(r, "/repo/out/run-x", manifestOf("page", { ...later("out/2026-b"), history: [odd] }), odd, paths, all)).toEqual({ kind: "images" });
  });
  it("buildRunDetail shows the history version's before image", () => {
    const [d] = buildRunDetail(summary([r]), "run-x", { manifest: manifestOf("page", { ...later("out/2026-b"), history: [used] }), outDirRel: "out", promptAllowed: true });
    expect(d.stepDiffs[0].images.before).toBe("/files/2026-a/page.s1.png");
    expect(d.baselineWarning).toBeUndefined();
  });
});
