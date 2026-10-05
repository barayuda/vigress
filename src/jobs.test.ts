import { describe, expect, it } from "bun:test";
import { isRunnableConfigName, listRunnableConfigs, canStart, appendTail, parseOutDir, startJob, finishJob, configRunArgs, baselineRunArgs, JOB_TAIL_LINES } from "./jobs";
import type { ManifestEntry } from "./baselines";

describe("isRunnableConfigName", () => {
  it("accepts a plain *.fullcheck.json file name", () => {
    expect(isRunnableConfigName("contact.fullcheck.json")).toBe(true);
    expect(isRunnableConfigName("my-page_v2.fullcheck.json")).toBe(true);
  });
  it("rejects paths, traversal, other extensions and empty names", () => {
    for (const bad of ["", "../x.fullcheck.json", "a/b.fullcheck.json", "/etc/passwd", "x.json", "x.fullcheck.json.bak", ".fullcheck.json", "a b.fullcheck.json", "x.fullcheck.json\n"]) {
      expect(isRunnableConfigName(bad)).toBe(false);
    }
  });
});

describe("listRunnableConfigs", () => {
  it("keeps only runnable names, sorted", () => {
    expect(listRunnableConfigs(["b.fullcheck.json", "README.md", "a.fullcheck.json", "comparisons.example.json", "../c.fullcheck.json"]))
      .toEqual(["a.fullcheck.json", "b.fullcheck.json"]);
  });
});

describe("canStart", () => {
  const job = (state: "running" | "done" | "failed") => ({ ...startJob("j1", "a.fullcheck.json", "t0"), state });
  it("allows the first job and one after a finished job", () => {
    expect(canStart(null).ok).toBe(true);
    expect(canStart(job("done")).ok).toBe(true);
    expect(canStart(job("failed")).ok).toBe(true);
  });
  it("refuses while a job is running (one at a time)", () => {
    const r = canStart(job("running"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/already running/);
  });
});

describe("appendTail", () => {
  it("splits chunks into lines and keeps only the last N", () => {
    let t: string[] = [];
    t = appendTail(t, "a\nb\n");
    t = appendTail(t, "c");
    expect(t).toEqual(["a", "b", "c"]);
    const many = appendTail([], Array.from({ length: JOB_TAIL_LINES + 5 }, (_, i) => `l${i}`).join("\n"));
    expect(many).toHaveLength(JOB_TAIL_LINES);
    expect(many[many.length - 1]).toBe(`l${JOB_TAIL_LINES + 4}`);
  });
  it("strips terminal colour codes", () => {
    expect(appendTail([], "\u001b[2m - navigating\u001b[22m\n\u001b[31mred\u001b[0m")).toEqual([" - navigating", "red"]);
  });
  it("drops blank lines", () => {
    expect(appendTail([], "a\n\n\nb")).toEqual(["a", "b"]);
  });
});

describe("parseOutDir", () => {
  it("reads outDir from the --json payload, ignoring surrounding noise", () => {
    expect(parseOutDir('warn: x\n{"schemaVersion":9,"outDir":"/abs/out/2026-10-04_10-00-00","runs":[]}\n')).toBe("/abs/out/2026-10-04_10-00-00");
  });
  it("is undefined when there is no payload", () => {
    expect(parseOutDir("")).toBeUndefined();
    expect(parseOutDir("not json")).toBeUndefined();
  });
});

describe("startJob / finishJob", () => {
  it("starts running with no result", () => {
    const j = startJob("j1", "a.fullcheck.json", "2026-10-04T10:00:00Z");
    expect(j).toMatchObject({ id: "j1", config: "a.fullcheck.json", state: "running", startedAt: "2026-10-04T10:00:00Z", tail: [] });
    expect(j.finishedAt).toBeUndefined();
  });
  it("exit 0 is done; any other exit is failed with the code; neither mutates the input", () => {
    const j = startJob("j1", "a.fullcheck.json", "t0");
    const ok = finishJob(j, { exitCode: 0, now: "t1", stdout: '{"outDir":"/o/x"}' });
    expect(ok).toMatchObject({ state: "done", exitCode: 0, finishedAt: "t1", outDir: "/o/x" });
    const bad = finishJob(j, { exitCode: 1, now: "t1", stdout: "" });
    expect(bad).toMatchObject({ state: "failed", exitCode: 1 });
    expect(j.state).toBe("running");
  });
  it("records an error (e.g. a timeout) as failed", () => {
    const r = finishJob(startJob("j1", "a.fullcheck.json", "t0"), { exitCode: null, now: "t1", stdout: "", error: "timed out" });
    expect(r).toMatchObject({ state: "failed", error: "timed out" });
  });
});

describe("configRunArgs", () => {
  it("runs the config exactly as the CLI would, as separate arguments", () => {
    expect(configRunArgs("/repo/a.fullcheck.json", "/repo/out")).toEqual(["--config", "/repo/a.fullcheck.json", "--json", "--out", "/repo/out"]);
  });
});

describe("baselineRunArgs", () => {
  const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
    storage: "local", approvedAt: "t", approvedFrom: "out/x", viewport: { width: 1280, height: 800 },
    sourceUrl: "https://app.test/contact", artifacts: { main: "out/x/c.png", steps: {} }, ...over,
  });

  it("re-captures the approved source URL against the baseline, at the approved viewport", () => {
    const r = baselineRunArgs("contact", entry(), "/repo/out");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args).toEqual([
        "--target=https://app.test/contact", "--against=baseline:contact", "--name=contact",
        "--viewport=1280x800", "--json", "--out", "/repo/out",
      ]);
    }
  });
  it("adds --full-page when the baseline was approved from a full-page run", () => {
    const r = baselineRunArgs("contact", entry({ fullPage: true }), "/repo/out");
    expect(r.ok && r.args).toContain("--full-page");
  });
  it("uses --name=value forms, so a name starting with '-' cannot become a flag", () => {
    const r = baselineRunArgs("-x", entry(), "/repo/out");
    expect(r.ok && r.args.filter((a) => a.startsWith("--name") || a.startsWith("--against"))).toEqual(["--against=baseline:-x", "--name=-x"]);
  });
  it("refuses a source URL that is not http(s)", () => {
    for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "figma:K/1:2", "", "not a url"]) {
      const r = baselineRunArgs("contact", entry({ sourceUrl: bad }), "/repo/out");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/http/);
    }
  });
  it("refuses a nonsensical viewport", () => {
    expect(baselineRunArgs("c", entry({ viewport: { width: 0, height: 800 } }), "/o").ok).toBe(false);
    expect(baselineRunArgs("c", entry({ viewport: { width: 1.5, height: 800 } }), "/o").ok).toBe(false);
  });
});
