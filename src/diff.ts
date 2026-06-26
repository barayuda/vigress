import { readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export interface DiffResult {
  width: number;
  height: number;
  mismatchPixels: number;
  totalPixels: number;
  mismatchPercent: number;
  diffPath: string;
}

function crop(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (src.width * y + x) << 2;
      const di = (w * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

export function diffPngs(
  baselinePath: string,
  candidatePath: string,
  outPath: string,
  threshold = 0.1,
): DiffResult {
  const base = PNG.sync.read(readFileSync(baselinePath));
  const cand = PNG.sync.read(readFileSync(candidatePath));
  const width = Math.min(base.width, cand.width);
  const height = Math.min(base.height, cand.height);
  const a = crop(base, width, height);
  const b = crop(cand, width, height);
  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(a.data, b.data, diff.data, width, height, {
    threshold,
  });
  writeFileSync(outPath, PNG.sync.write(diff));
  const totalPixels = width * height;
  return {
    width,
    height,
    mismatchPixels,
    totalPixels,
    mismatchPercent: Number(((mismatchPixels / totalPixels) * 100).toFixed(2)),
    diffPath: outPath,
  };
}
