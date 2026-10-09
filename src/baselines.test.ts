import { describe, expect, it } from "bun:test";
import {
  MANIFEST_VERSION, emptyManifest, parseManifest, parseBaselineRef,
  buildManifestEntry, upsertBaseline, resolveBaselineArtifacts,
  pickNewestRun, stepDiffVerdict, approveRuns, rollbackBaseline, pruneHistory, MAX_HISTORY, type RunDirCandidate,
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

describe("fullPage parity", () => {
  const vp = { width: 1440, height: 900 };
  const at = (r: Partial<RunResult>) => upsertBaseline(emptyManifest(), "page", buildManifestEntry(run(r), "out/a", "t"));

  it("records fullPage on the entry only when the run was full-page", () => {
    expect(buildManifestEntry(run({ fullPage: true }), "out/a", "t").fullPage).toBe(true);
    expect("fullPage" in buildManifestEntry(run(), "out/a", "t")).toBe(false);
  });
  it("accepts a matching full-page setting", () => {
    expect(resolveBaselineArtifacts(at({ fullPage: true }), "page", vp, true).ok).toBe(true);
    expect(resolveBaselineArtifacts(at({}), "page", vp, false).ok).toBe(true);
  });
  it("treats a legacy entry without the field as not full-page", () => {
    expect(resolveBaselineArtifacts(at({}), "page", vp).ok).toBe(true);
    expect(resolveBaselineArtifacts(at({}), "page", vp, true).ok).toBe(false);
  });
  it("rejects a mismatch in either direction: code 2, not missingEntry, names both settings", () => {
    for (const [approved, now] of [[true, false], [false, true]] as const) {
      const r = resolveBaselineArtifacts(at({ fullPage: approved || undefined }), "page", vp, now);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe(2);
        expect(r.missingEntry).toBeUndefined();
        expect(r.message).toMatch(/full-page/);
        expect(r.message).toMatch(approved ? /approved baseline \(on\)/ : /approved baseline \(off\)/);
      }
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

describe("approveRuns", () => {
  const sum = (runs: RunResult[], schemaVersion = 8): Summary => ({ ...summary(runs), schemaVersion });
  const has = () => true;
  const at = "2026-10-04T00:00:00Z";

  it("approves one named run into a new manifest without mutating the input", () => {
    const m0 = emptyManifest();
    const r = approveRuns(m0, sum([run({ name: "a" }), run({ name: "b" })]), "out/x", "a", has, at);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.approved.map((x) => x.name)).toEqual(["a"]);
      expect(Object.keys(r.manifest.baselines)).toEqual(["a"]);
      expect(r.manifest.baselines.a.approvedFrom).toBe("out/x");
      expect(r.manifest.baselines.a.approvedAt).toBe(at);
    }
    expect(m0.baselines).toEqual({});
  });
  it("treats a run literally named 'all' as a name, not as every run", () => {
    const r = approveRuns(emptyManifest(), sum([run({ name: "all" }), run({ name: "b" })]), "out/x", "all", has, at);
    expect(r.ok && r.approved.map((x) => x.name)).toEqual(["all"]);
  });
  it("approves every entry when which is null", () => {
    const r = approveRuns(emptyManifest(), sum([run({ name: "a" }), run({ name: "b" })]), "out/x", null, has, at);
    expect(r.ok && r.approved.map((x) => x.name)).toEqual(["a", "b"]);
  });
  it("refuses summaries older than schema 8 (capture mode unknown)", () => {
    const r = approveRuns(emptyManifest(), sum([run()], 7), "out/x", "page", has, at);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/older vigress.*schema 7/);
  });
  it("names the available runs when the name is unknown", () => {
    const r = approveRuns(emptyManifest(), sum([run({ name: "a" })]), "out/x", "nope", has, at);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/'nope'.*has: a/);
  });
  it("fails when a target capture is missing on disk", () => {
    const r = approveRuns(emptyManifest(), sum([run()]), "out/x", "page", () => false, at);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/target capture missing for 'page'/);
  });
  it("fails on a summary with no runs for every run", () => {
    expect(approveRuns(emptyManifest(), sum([]), "out/x", null, has, at).ok).toBe(false);
  });
});

describe("baseline history", () => {
  const ver = (dir: string, at: string) => buildManifestEntry(run({ shots: [{ name: "s", path: "page.s.png" }] }), `out/${dir}`, at);
  const approve = (m: ReturnType<typeof emptyManifest>, dir: string, at: string) => upsertBaseline(m, "page", ver(dir, at));
  const allThere = () => true;

  it("re-approving keeps the previous version in history, newest first", () => {
    let m = approve(emptyManifest(), "a", "t1");
    expect(m.baselines.page.history).toBeUndefined();
    m = approve(m, "b", "t2");
    m = approve(m, "c", "t3");
    expect(m.baselines.page.approvedFrom).toBe("out/c");
    expect(m.baselines.page.history!.map((h) => h.approvedFrom)).toEqual(["out/b", "out/a"]);
    expect("history" in m.baselines.page.history![0]).toBe(false); // versions do not nest
  });
  it("re-approving the very same run does not add a duplicate version", () => {
    let m = approve(emptyManifest(), "a", "t1");
    m = approve(m, "a", "t2");
    expect(m.baselines.page.history).toBeUndefined();
    expect(m.baselines.page.approvedAt).toBe("t2");
  });
  it("never lists the current version in its own history (re-approving an older run after a rollback)", () => {
    let m = approve(approve(emptyManifest(), "a", "t1"), "b", "t2");           // current b, history [a]
    const rolled = rollbackBaseline(m, "page", 0, allThere);                   // current a, history [b]
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    m = upsertBaseline(rolled.manifest, "page", ver("b", "t3"));               // approve b's run again
    expect(m.baselines.page.approvedFrom).toBe("out/b");
    expect(m.baselines.page.history!.map((h) => h.approvedFrom)).toEqual(["out/a"]); // not [a, b]
  });
  it("keeps at most MAX_HISTORY versions, dropping the oldest", () => {
    let m = emptyManifest();
    for (let i = 0; i < MAX_HISTORY + 4; i++) m = approve(m, "r" + i, "t" + i);
    expect(m.baselines.page.history).toHaveLength(MAX_HISTORY);
    expect(m.baselines.page.history![0].approvedFrom).toBe("out/r" + (MAX_HISTORY + 2));
  });
  it("does not mutate the input manifest", () => {
    const m1 = approve(emptyManifest(), "a", "t1");
    approve(m1, "b", "t2");
    expect(m1.baselines.page.history).toBeUndefined();
  });

  describe("rollbackBaseline", () => {
    const three = () => approve(approve(approve(emptyManifest(), "a", "t1"), "b", "t2"), "c", "t3");
    it("promotes the previous version and pushes the current one into history (so it is undoable)", () => {
      const r = rollbackBaseline(three(), "page", 0, allThere);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.manifest.baselines.page.approvedFrom).toBe("out/b");
      expect(r.manifest.baselines.page.history!.map((h) => h.approvedFrom)).toEqual(["out/c", "out/a"]);
      expect(r.restored.approvedFrom).toBe("out/b");
      const back = rollbackBaseline(r.manifest, "page", 0, allThere);
      expect(back.ok && back.manifest.baselines.page.approvedFrom).toBe("out/c");
    });
    it("can restore an older version by index", () => {
      const r = rollbackBaseline(three(), "page", 1, allThere);
      expect(r.ok && r.manifest.baselines.page.approvedFrom).toBe("out/a");
      expect(r.ok && r.manifest.baselines.page.history!.map((h) => h.approvedFrom)).toEqual(["out/c", "out/b"]);
    });
    it("refuses an unknown name, no history, or an index out of range", () => {
      expect(rollbackBaseline(three(), "nope", 0, allThere).ok).toBe(false);
      const none = rollbackBaseline(approve(emptyManifest(), "a", "t1"), "page", 0, allThere);
      expect(none.ok).toBe(false);
      if (!none.ok) expect(none.message).toMatch(/no previous version/);
      const oob = rollbackBaseline(three(), "page", 5, allThere);
      expect(oob.ok).toBe(false);
      if (!oob.ok) expect(oob.message).toMatch(/version 5.*has 2/);
      expect(rollbackBaseline(three(), "page", -1, allThere).ok).toBe(false);
      expect(rollbackBaseline(three(), "page", 0.5, allThere).ok).toBe(false);
    });
    it("refuses when the target version's files are gone from disk, naming them", () => {
      const r = rollbackBaseline(three(), "page", 0, (p) => !p.startsWith("out/b/"));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/out\/b\/page\.target\.png/);
    });
    it("treats __proto__ as an unknown name", () => {
      expect(rollbackBaseline(three(), "__proto__", 0, allThere).ok).toBe(false);
    });
  });
});

describe("pruneHistory", () => {
  const ver = (dir: string, at: string) => buildManifestEntry(run(), `out/${dir}`, at);
  const five = () => ["a", "b", "c", "d", "e"].reduce((m, d, i) => upsertBaseline(m, "page", ver(d, "t" + i)), emptyManifest()); // current e, history [d c b a]

  it("keeps the newest N previous versions and reports the dropped ones (oldest last)", () => {
    const r = pruneHistory(five(), "page", 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.baselines.page.history!.map((h) => h.approvedFrom)).toEqual(["out/d", "out/c"]);
    expect(r.dropped.map((h) => h.approvedFrom)).toEqual(["out/b", "out/a"]);
    expect(r.manifest.baselines.page.approvedFrom).toBe("out/e"); // the current version is never touched
  });
  it("keep 0 removes the whole history field", () => {
    const r = pruneHistory(five(), "page", 0);
    expect(r.ok && "history" in r.manifest.baselines.page).toBe(false);
    expect(r.ok && r.dropped).toHaveLength(4);
  });
  it("does nothing (and says so) when there is nothing to drop; does not mutate the input", () => {
    const m = five();
    const r = pruneHistory(m, "page", 10);
    expect(r.ok && r.dropped).toEqual([]);
    expect(m.baselines.page.history).toHaveLength(4);
  });
  it("refuses an unknown name and a bad count", () => {
    expect(pruneHistory(five(), "nope", 1).ok).toBe(false);
    expect(pruneHistory(five(), "__proto__", 1).ok).toBe(false);
    for (const bad of [-1, 1.5, NaN]) expect(pruneHistory(five(), "page", bad).ok).toBe(false);
  });
});
