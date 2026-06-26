import { describe, it, expect } from "bun:test";
import { parseViewport, detectBaselineType, parseClip, buildRunConfig } from "./config";
import { selectorForSide, parseRegionFlag, parseMaskFlag, runStamp } from "./config";
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
