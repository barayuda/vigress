import { describe, it, expect } from "bun:test";
import { PNG } from "pngjs";
import { paintMask, cropToBox, scoreRegion, boxInCapture, MASK_COLOR } from "./regions";

function solid(w: number, h: number, v: number): PNG {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = v; png.data[i * 4 + 1] = v; png.data[i * 4 + 2] = v; png.data[i * 4 + 3] = 255;
  }
  return png;
}
function px(png: PNG, x: number, y: number): [number, number, number] {
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

describe("paintMask", () => {
  it("paints only the box pixels to the mask color, leaving the rest", () => {
    const png = solid(10, 10, 0);
    paintMask(png, [{ x: 2, y: 2, width: 3, height: 3 }]);
    expect(px(png, 3, 3)).toEqual([MASK_COLOR.r, MASK_COLOR.g, MASK_COLOR.b]);
    expect(px(png, 0, 0)).toEqual([0, 0, 0]);
    expect(px(png, 5, 5)).toEqual([0, 0, 0]); // box is x[2..4],y[2..4]
  });
  it("clamps boxes that exceed image bounds without throwing", () => {
    const png = solid(4, 4, 0);
    expect(() => paintMask(png, [{ x: 2, y: 2, width: 10, height: 10 }])).not.toThrow();
    expect(px(png, 3, 3)).toEqual([MASK_COLOR.r, MASK_COLOR.g, MASK_COLOR.b]);
  });
});

describe("cropToBox", () => {
  it("returns a sub-image of the box size", () => {
    const png = solid(10, 10, 7);
    const c = cropToBox(png, { x: 1, y: 1, width: 4, height: 3 });
    expect(c.width).toBe(4);
    expect(c.height).toBe(3);
    expect(px(c, 0, 0)).toEqual([7, 7, 7]);
  });
});

describe("boxInCapture", () => {
  const clip = { x: 264, y: 56, width: 1176, height: 2000 };
  it("offsets a page-coordinate box into capture coordinates when --clip is set", () => {
    expect(boxInCapture({ x: 300, y: 100, width: 200, height: 50 }, clip)).toEqual({
      x: 36, y: 44, width: 200, height: 50,
    });
  });
  it("returns the box unchanged for a capture at the origin (no clip)", () => {
    const viewportRect = { x: 0, y: 0, width: 1440, height: 900 };
    expect(boxInCapture({ x: 10, y: 20, width: 100, height: 40 }, viewportRect)).toEqual({
      x: 10, y: 20, width: 100, height: 40,
    });
  });
  it("returns null when the box lies fully outside the capture (e.g. below the fold)", () => {
    const viewportRect = { x: 0, y: 0, width: 1440, height: 900 };
    expect(boxInCapture({ x: 10, y: 1200, width: 100, height: 40 }, viewportRect)).toBeNull();
    expect(boxInCapture({ x: 10, y: 10, width: 100, height: 40 }, clip)).toBeNull(); // above the clip
  });
  it("clamps a partially visible box to the overlap", () => {
    const viewportRect = { x: 0, y: 0, width: 1440, height: 900 };
    expect(boxInCapture({ x: 1400, y: 880, width: 100, height: 40 }, viewportRect)).toEqual({
      x: 1400, y: 880, width: 40, height: 20,
    });
  });
});

describe("scoreRegion", () => {
  const base = { resolvedTarget: true, resolvedBaseline: true, mismatchPercent: 1, targetBox: { width: 100, height: 40 }, baselineBox: { width: 100, height: 40 } };
  it("passes when content is under threshold and geometry matches", () => {
    expect(scoreRegion({ ...base })).toEqual({ verdict: "pass", reason: "content" });
  });
  it("fails on content over the region threshold", () => {
    expect(scoreRegion({ ...base, mismatchPercent: 9, maxMismatch: 5 })).toEqual({ verdict: "fail", reason: "content" });
  });
  it("fails on geometry first when box dimensions differ beyond 2px", () => {
    expect(scoreRegion({ ...base, mismatchPercent: 0, baselineBox: { width: 80, height: 40 } })).toEqual({ verdict: "fail", reason: "geometry" });
  });
  it("is unresolved when a side did not resolve", () => {
    expect(scoreRegion({ ...base, resolvedBaseline: false })).toEqual({ verdict: "unresolved", reason: "unresolved" });
  });
  it("uses the default threshold of 5 when none given", () => {
    expect(scoreRegion({ ...base, mismatchPercent: 6 })).toEqual({ verdict: "fail", reason: "content" });
    expect(scoreRegion({ ...base, mismatchPercent: 4 })).toEqual({ verdict: "pass", reason: "content" });
  });
});
