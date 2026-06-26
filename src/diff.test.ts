import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { diffPngs } from "./diff";

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
