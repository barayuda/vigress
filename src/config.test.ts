import { describe, it, expect } from "bun:test";
import { parseViewport, detectBaselineType, parseClip, buildRunConfig } from "./config";
import { selectorForSide, parseRegionFlag, parseMaskFlag, runStamp, buildScaffoldConfig, scaffoldPlaceholders, type Step } from "./config";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("parseViewport", () => {
  it("parses WxH", () => expect(parseViewport("1280x720")).toEqual({ width: 1280, height: 720 }));
  it("defaults to 1440x900", () => expect(parseViewport(undefined)).toEqual({ width: 1440, height: 900 }));
});

describe("detectBaselineType", () => {
  it("url for http(s)", () => {
    expect(detectBaselineType("https://x.test/a")).toBe("url");
    expect(detectBaselineType("http://x.test")).toBe("url");
  });
  it("figma for figma: prefix", () => expect(detectBaselineType("figma:ABC/12:34")).toBe("figma"));
  it("image otherwise", () => expect(detectBaselineType("./shot.png")).toBe("image"));
});

describe("parseClip", () => {
  it("parses x,y,w,h", () => expect(parseClip("1,2,30,40")).toEqual({ x: 1, y: 2, width: 30, height: 40 }));
  it("undefined when absent", () => expect(parseClip(undefined)).toBeUndefined());
});

describe("buildRunConfig", () => {
  it("builds a single run from args, args over env", () => {
    const { runs, opts } = buildRunConfig(
      { target: "http://localhost:3000/x", against: "https://staging.test/x", name: "x", viewport: "800x600", video: true, threshold: "0.2" },
      { VIGRESS_VIEWPORT: "1440x900", VIGRESS_OUT: "envout" },
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ name: "x", target: "http://localhost:3000/x", against: "https://staging.test/x", baselineType: "url", video: true });
    expect(runs[0].viewport).toEqual({ width: 800, height: 600 });
    expect(opts.threshold).toBe(0.2);
    expect(opts.outDir).toBe("envout"); // env used when no --out arg
  });

  it("derives a name when not given", () => {
    const { runs } = buildRunConfig({ target: "http://h/reports/contact-v2", against: "./b.png" }, {});
    expect(runs[0].baselineType).toBe("image");
    expect(runs[0].name.length).toBeGreaterThan(0);
  });

  it("max-mismatch parsed into opts", () => {
    const { opts } = buildRunConfig({ target: "http://h/x", against: "http://s/x", "max-mismatch": "5" }, {});
    expect(opts.maxMismatch).toBe(5);
  });
});

describe("selectorForSide", () => {
  it("prefers per-side selector, falls back to shared, else undefined", () => {
    expect(selectorForSide({ target: ".t", baseline: ".b", selector: ".s" }, "target")).toBe(".t");
    expect(selectorForSide({ selector: ".s" }, "baseline")).toBe(".s");
    expect(selectorForSide({ clip: { x: 0, y: 0, width: 1, height: 1 } }, "target")).toBeUndefined();
  });
});

describe("parseRegionFlag", () => {
  it("parses name, per-side selectors, max", () => {
    const r = parseRegionFlag("name=filter-bar;target=[data-testid=report-filter];baseline=.report__filter;max=2");
    expect(r.name).toBe("filter-bar");
    expect(r.target).toBe("[data-testid=report-filter]");
    expect(r.baseline).toBe(".report__filter");
    expect(r.maxMismatch).toBe(2);
  });
  it("parses a clip box", () => {
    const r = parseRegionFlag("name=card;clip=277,175,280,205");
    expect(r.clip).toEqual({ x: 277, y: 175, width: 280, height: 205 });
  });
});

describe("parseMaskFlag", () => {
  it("parses a shared selector and per-side selectors", () => {
    expect(parseMaskFlag("selector=[data-testid=date-filter]").selector).toBe("[data-testid=date-filter]");
    const m = parseMaskFlag("target=.timestamp;baseline=.created-at");
    expect(m.target).toBe(".timestamp");
    expect(m.baseline).toBe(".created-at");
  });
});

describe("buildRunConfig batch regions/mask/checklist", () => {
  it("passes regions, mask, and checklist through from the config file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vcfg-"));
    const cfg = join(dir, "c.json");
    writeFileSync(cfg, JSON.stringify([{
      name: "contact",
      target: "http://localhost:3000/reports/contact-v2",
      against: "https://staging.example.com/reports/contact",
      regions: [{ name: "filter-bar", target: "[data-testid=report-filter]", baseline: ".report__filter", maxMismatch: 2 }],
      mask: [{ selector: "[data-testid=date-filter]" }],
      checklist: [{ aspect: "filter bar width", region: "filter-bar", verdict: "manual" }],
    }]));
    const { runs } = buildRunConfig({ config: cfg }, {} as NodeJS.ProcessEnv);
    expect(runs[0].regions?.[0].name).toBe("filter-bar");
    expect(runs[0].mask?.[0].selector).toBe("[data-testid=date-filter]");
    expect(runs[0].checklist?.[0].aspect).toBe("filter bar width");
  });
  it("throws a clear error when a region has no name", () => {
    const dir = mkdtempSync(join(tmpdir(), "vcfg-"));
    const cfg = join(dir, "bad.json");
    writeFileSync(cfg, JSON.stringify([{
      target: "http://localhost:3000/x", against: "http://localhost:3000/y",
      regions: [{ selector: ".foo" }],
    }]));
    expect(() => buildRunConfig({ config: cfg }, {} as NodeJS.ProcessEnv)).toThrow(/region needs a non-empty 'name'/);
  });
});

describe("video defaults on (all artifacts)", () => {
  it("single run records video by default", () => {
    const { runs } = buildRunConfig({ target: "http://x/a", against: "http://x/b" }, {} as NodeJS.ProcessEnv);
    expect(runs[0].video).toBe(true);
  });
  it("single run --no-video disables video", () => {
    const { runs } = buildRunConfig({ target: "http://x/a", against: "http://x/b", "no-video": true }, {} as NodeJS.ProcessEnv);
    expect(runs[0].video).toBe(false);
  });
  it("batch defaults video on, honors explicit false, and --no-video flips the default off", () => {
    const dir = mkdtempSync(join(tmpdir(), "vvid-"));
    const cfg = join(dir, "v.json");
    writeFileSync(cfg, JSON.stringify([
      { name: "a", target: "http://x/a", against: "http://x/b" },
      { name: "c", target: "http://x/c", against: "http://x/d", video: false },
    ]));
    const on = buildRunConfig({ config: cfg }, {} as NodeJS.ProcessEnv).runs;
    expect(on[0].video).toBe(true); // default on
    expect(on[1].video).toBe(false); // explicit false honored
    const off = buildRunConfig({ config: cfg, "no-video": true }, {} as NodeJS.ProcessEnv).runs;
    expect(off[0].video).toBe(false); // --no-video flips default off
    expect(off[1].video).toBe(false); // explicit false still false
  });
});

describe("runStamp", () => {
  it("formats YYYY-MM-DD_HH-MM-SS in local time, zero-padded", () => {
    // local-time components in → same components out, TZ-independent
    expect(runStamp(new Date(2026, 5, 26, 9, 5, 3))).toBe("2026-06-26_09-05-03");
  });
  it("matches the run-folder shape for the current time", () => {
    expect(runStamp()).toMatch(/^\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d$/);
  });
});

import { parseStepFlag, validateStep } from "./config";

describe("parseStepFlag", () => {
  it("parses a click step", () => {
    expect(parseStepFlag("action=click;selector=[data-testid=period-input]")).toEqual({ action: "click", selector: "[data-testid=period-input]" });
  });
  it("parses a fill step with value and a waitFor with ms", () => {
    expect(parseStepFlag("action=fill;selector=#q;value=hello")).toEqual({ action: "fill", selector: "#q", value: "hello" });
    expect(parseStepFlag("action=waitFor;ms=500")).toEqual({ action: "waitFor", ms: 500 });
  });
  it("parses a screenshot step", () => {
    expect(parseStepFlag("action=screenshot;name=date-open")).toEqual({ action: "screenshot", name: "date-open" });
  });
  it("parses assert steps (state / text / urlContains)", () => {
    expect(parseStepFlag("action=assert;selector=[role=dialog];state=visible")).toEqual({ action: "assert", selector: "[role=dialog]", state: "visible" });
    expect(parseStepFlag("action=assert;selector=.toast;text=Saved")).toEqual({ action: "assert", selector: ".toast", text: "Saved" });
    expect(parseStepFlag("action=assert;urlContains=/reports")).toEqual({ action: "assert", urlContains: "/reports" });
  });
});

describe("validateStep", () => {
  it("accepts valid steps", () => {
    expect(() => validateStep({ action: "click", selector: "#x" })).not.toThrow();
    expect(() => validateStep({ action: "fill", selector: "#x", value: "y" })).not.toThrow();
    expect(() => validateStep({ action: "waitFor", ms: 300 })).not.toThrow();
    expect(() => validateStep({ action: "screenshot", name: "s" })).not.toThrow();
  });
  it("rejects unknown action", () => {
    expect(() => validateStep({ action: "boom" } as any)).toThrow(/unknown step action/);
  });
  it("rejects a step missing its required field", () => {
    expect(() => validateStep({ action: "click" })).toThrow(/click.*selector/);
    expect(() => validateStep({ action: "fill", selector: "#x" })).toThrow(/fill.*value/);
    expect(() => validateStep({ action: "screenshot" })).toThrow(/screenshot.*name/);
    expect(() => validateStep({ action: "waitFor" })).toThrow(/waitFor.*selector.*ms/);
  });
  it("accepts valid assert steps", () => {
    expect(() => validateStep({ action: "assert", selector: "#x" })).not.toThrow(); // defaults to visible
    expect(() => validateStep({ action: "assert", selector: "#x", state: "hidden" })).not.toThrow();
    expect(() => validateStep({ action: "assert", selector: ".toast", text: "Saved" })).not.toThrow();
    expect(() => validateStep({ action: "assert", urlContains: "/reports" })).not.toThrow();
  });
  it("rejects invalid assert steps", () => {
    expect(() => validateStep({ action: "assert" })).toThrow(/assert.*selector.*urlContains/);
    expect(() => validateStep({ action: "assert", selector: "#x", state: "shiny" as any })).toThrow(/assert.*state/);
    expect(() => validateStep({ action: "assert", text: "Saved" })).toThrow(/assert.*selector/);
  });
});

describe("buildRunConfig batch steps", () => {
  it("passes steps through and validates them", () => {
    const dir = mkdtempSync(join(tmpdir(), "vstep-"));
    const ok = join(dir, "ok.json");
    writeFileSync(ok, JSON.stringify([{ target: "http://x/a", against: "http://x/b", steps: [{ action: "click", selector: "#c" }] }]));
    expect(buildRunConfig({ config: ok }, {} as NodeJS.ProcessEnv).runs[0].steps?.[0].selector).toBe("#c");

    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([{ target: "http://x/a", against: "http://x/b", steps: [{ action: "click" }] }]));
    expect(() => buildRunConfig({ config: bad }, {} as NodeJS.ProcessEnv)).toThrow(/click.*selector/);
  });
});

describe("buildScaffoldConfig", () => {
  it("stamps page name, urls, and default viewport", () => {
    const [entry] = buildScaffoldConfig({ page: "agents", target: "http://x/a", against: "https://s/a" });
    expect(entry.name).toBe("agents-fullcheck");
    expect(entry.target).toBe("http://x/a");
    expect(entry.against).toBe("https://s/a");
    expect(entry.viewport).toEqual({ width: 1440, height: 1000 });
  });

  it("honors an explicit viewport", () => {
    const [entry] = buildScaffoldConfig({ page: "p", target: "http://x/a", against: "http://x/b", viewport: { width: 800, height: 600 } });
    expect(entry.viewport).toEqual({ width: 800, height: 600 });
  });

  it("produces a config that survives buildRunConfig + validateStep", () => {
    const dir = mkdtempSync(join(tmpdir(), "vscaf-"));
    const file = join(dir, "p.fullcheck.json");
    writeFileSync(file, JSON.stringify(buildScaffoldConfig({ page: "p", target: "http://x/a", against: "http://x/b" })));
    const { runs } = buildRunConfig({ config: file }, {} as NodeJS.ProcessEnv);
    expect(runs[0].regions?.every((r) => !!r.name)).toBe(true);
    expect(() => (runs[0].steps ?? []).forEach((s) => validateStep(s as Step))).not.toThrow();
  });
});

describe("scaffoldPlaceholders", () => {
  it("collects unique REPLACE-* tokens from a scaffold", () => {
    const tokens = scaffoldPlaceholders(buildScaffoldConfig({ page: "p", target: "http://x/a", against: "http://x/b" }));
    expect(tokens).toContain("REPLACE-top");
    expect(tokens).toContain("REPLACE-content");
    expect(tokens).toContain("REPLACE-download-btn");
    expect(new Set(tokens).size).toBe(tokens.length); // unique
  });

  it("returns empty when nothing matches", () => {
    expect(scaffoldPlaceholders([{ name: "done", steps: [{ action: "click", selector: "#x" }] }])).toEqual([]);
  });
});
