import { describe, it, expect } from "bun:test";
import { parseViewport, detectBaselineType, parseClip, buildRunConfig } from "./config";

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
