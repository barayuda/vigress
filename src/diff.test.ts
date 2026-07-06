import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PNG } from "pngjs";
import { diffPngs, diffShots, diffWithRegions } from "./diff";

let dir: string;

function solid(w: number, h: number, r: number, g: number, b: number): PNG {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return png;
}
function writePng(name: string, png: PNG): string {
  const p = join(dir, name);
  writeFileSync(p, PNG.sync.write(png));
  return p;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "vdiff-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("diffPngs", () => {
  it("reports 0% for identical images", () => {
    const a = writePng("a.png", solid(10, 10, 255, 255, 255));
    const b = writePng("b.png", solid(10, 10, 255, 255, 255));
    const res = diffPngs(a, b, join(dir, "d1.png"));
    expect(res.mismatchPixels).toBe(0);
    expect(res.mismatchPercent).toBe(0);
    expect(res.totalPixels).toBe(100);
  });
  it("reports >0% for different images", () => {
    const a = writePng("c.png", solid(10, 10, 255, 255, 255));
    const b = writePng("e.png", solid(10, 10, 0, 0, 0));
    const res = diffPngs(a, b, join(dir, "d2.png"));
    expect(res.mismatchPixels).toBe(100);
    expect(res.mismatchPercent).toBe(100);
  });
  it("crops to the common min dimensions when sizes differ", () => {
    const a = writePng("f.png", solid(10, 20, 255, 255, 255));
    const b = writePng("g.png", solid(8, 10, 255, 255, 255));
    const res = diffPngs(a, b, join(dir, "d3.png"));
    expect(res.width).toBe(8);
    expect(res.height).toBe(10);
    expect(res.totalPixels).toBe(80);
  });
});

describe("diffWithRegions", () => {
  it("masks both sides so a differing masked area does not count in the full diff", () => {
    // target all-white, baseline white except a black 4x4 patch at (0,0); mask covers the patch.
    const t = writePng("mt.png", solid(10, 10, 255, 255, 255));
    const bPng = solid(10, 10, 255, 255, 255);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = (10 * y + x) << 2; bPng.data[i] = 0; bPng.data[i + 1] = 0; bPng.data[i + 2] = 0;
    }
    const b = writePng("mb.png", bPng);
    const box = { x: 0, y: 0, width: 4, height: 4 };
    const res = diffWithRegions({
      targetPath: t, baselinePath: b, diffPath: join(dir, "mfull.png"),
      outDir: dir, name: "m", targetMaskBoxes: [box], baselineMaskBoxes: [box], regions: [],
    });
    expect(res.full.mismatchPixels).toBe(0); // patch was masked on both sides
  });

  it("scores a per-region content diff and writes its diff file", () => {
    const t = writePng("rt.png", solid(20, 10, 255, 255, 255));
    const b = writePng("rb.png", solid(20, 10, 0, 0, 0)); // fully different
    const region = { name: "left", targetBox: { x: 0, y: 0, width: 10, height: 10 }, baselineBox: { x: 0, y: 0, width: 10, height: 10 }, maxMismatch: 5 };
    const res = diffWithRegions({
      targetPath: t, baselinePath: b, diffPath: join(dir, "rfull.png"),
      outDir: dir, name: "r", targetMaskBoxes: [], baselineMaskBoxes: [], regions: [region],
    });
    expect(res.regions[0].name).toBe("left");
    expect(res.regions[0].mismatchPercent).toBe(100);
    expect(res.regions[0].verdict).toBe("fail");
    expect(res.regions[0].reason).toBe("content");
    expect(res.regions[0].diff).toBe("r.left.diff.png");
  });

  it("marks a region unresolved when a side box is null", () => {
    const t = writePng("ut.png", solid(10, 10, 255, 255, 255));
    const b = writePng("ub.png", solid(10, 10, 255, 255, 255));
    const res = diffWithRegions({
      targetPath: t, baselinePath: b, diffPath: join(dir, "ufull.png"),
      outDir: dir, name: "u", targetMaskBoxes: [], baselineMaskBoxes: [],
      regions: [{ name: "missing", targetBox: { x: 0, y: 0, width: 4, height: 4 }, baselineBox: null }],
    });
    expect(res.regions[0].verdict).toBe("unresolved");
    expect(res.regions[0].diff).toBeUndefined();
  });

  it("fails a region on geometry when box sizes differ beyond 2px", () => {
    const t = writePng("gt.png", solid(20, 20, 255, 255, 255));
    const b = writePng("gb.png", solid(20, 20, 255, 255, 255));
    const res = diffWithRegions({
      targetPath: t, baselinePath: b, diffPath: join(dir, "gfull.png"),
      outDir: dir, name: "g", targetMaskBoxes: [], baselineMaskBoxes: [],
      regions: [{ name: "geo", targetBox: { x: 0, y: 0, width: 16, height: 10 }, baselineBox: { x: 0, y: 0, width: 10, height: 10 } }],
    });
    expect(res.regions[0].verdict).toBe("fail");
    expect(res.regions[0].reason).toBe("geometry");
  });
});

describe("diffShots", () => {
  it("diffs matched shots, flags new and missing ones", () => {
    const approvedPath = writePng("approved-01.png", solid(50, 50, 255, 0, 0));
    const samePath = writePng("run-01.png", solid(50, 50, 255, 0, 0));
    const outDir = dirname(samePath);

    const diffs = diffShots({
      shots: [
        { name: "01-open", path: basename(samePath) },
        { name: "02-added", path: basename(samePath) },
      ],
      approvedSteps: { "01-open": approvedPath, "03-gone": approvedPath },
      outDir,
      name: "page",
    });

    const byName = new Map(diffs.map((d) => [d.name, d]));
    expect(byName.get("01-open")!.verdict).toBe("ok");
    expect(byName.get("01-open")!.mismatchPercent).toBe(0);
    expect(byName.get("01-open")!.diff).toBe("page.01-open.stepdiff.png");
    expect(existsSync(join(outDir, "page.01-open.stepdiff.png"))).toBe(true);
    expect(byName.get("02-added")!.verdict).toBe("new");
    expect(byName.get("02-added")!.diff).toBeUndefined();
    expect(byName.get("03-gone")!.verdict).toBe("missing");
  });

  it("applies maxMismatch to matched shots", () => {
    const approvedPath = writePng("approved-red.png", solid(50, 50, 255, 0, 0));
    const bluePath = writePng("run-blue.png", solid(50, 50, 0, 0, 255));
    const diffs = diffShots({
      shots: [{ name: "01-open", path: basename(bluePath) }],
      approvedSteps: { "01-open": approvedPath },
      outDir: dirname(bluePath),
      name: "page",
      maxMismatch: 5,
    });
    expect(diffs[0].verdict).toBe("mismatch");
    expect(diffs[0].mismatchPercent).toBeGreaterThan(5);
  });
});
