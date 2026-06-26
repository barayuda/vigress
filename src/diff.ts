import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { paintMask, cropToBox, scoreRegion } from "./regions";
import type { Box } from "./config";
import type { RegionScore, BoxDims } from "./types";

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

function diffBuffers(a: PNG, b: PNG, outPath: string, threshold: number): DiffResult {
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const ca = crop(a, width, height);
  const cb = crop(b, width, height);
  const diff = new PNG({ width, height });
  const mismatchPixels = pixelmatch(ca.data, cb.data, diff.data, width, height, { threshold });
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

export function diffPngs(
  baselinePath: string,
  candidatePath: string,
  outPath: string,
  threshold = 0.1,
): DiffResult {
  const base = PNG.sync.read(readFileSync(baselinePath));
  const cand = PNG.sync.read(readFileSync(candidatePath));
  return diffBuffers(base, cand, outPath, threshold);
}

export interface RegionInput {
  name: string;
  targetBox: Box | null;
  baselineBox: Box | null;
  maxMismatch?: number;
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

export function diffWithRegions(params: {
  targetPath: string;
  baselinePath: string;
  diffPath: string;
  outDir: string;
  name: string;
  targetMaskBoxes: Box[];
  baselineMaskBoxes: Box[];
  regions: RegionInput[];
  threshold?: number;
  defaultMaxMismatch?: number;
  geomTolerance?: number;
}): { full: DiffResult; regions: RegionScore[] } {
  const threshold = params.threshold ?? 0.1;
  const target = PNG.sync.read(readFileSync(params.targetPath));
  const baseline = PNG.sync.read(readFileSync(params.baselinePath));

  // Mask both sides, then persist the masked artifacts so the report shows them.
  paintMask(target, params.targetMaskBoxes);
  paintMask(baseline, params.baselineMaskBoxes);
  writeFileSync(params.targetPath, PNG.sync.write(target));
  writeFileSync(params.baselinePath, PNG.sync.write(baseline));

  const full = diffBuffers(target, baseline, params.diffPath, threshold);

  const regions: RegionScore[] = params.regions.map((r) => {
    const resolvedTarget = r.targetBox !== null;
    const resolvedBaseline = r.baselineBox !== null;
    const targetBox: BoxDims | undefined = r.targetBox
      ? { width: r.targetBox.width, height: r.targetBox.height }
      : undefined;
    const baselineBox: BoxDims | undefined = r.baselineBox
      ? { width: r.baselineBox.width, height: r.baselineBox.height }
      : undefined;

    if (!resolvedTarget || !resolvedBaseline) {
      const v = scoreRegion({
        resolvedTarget,
        resolvedBaseline,
        mismatchPercent: 0,
        maxMismatch: r.maxMismatch,
        targetBox,
        baselineBox,
        defaultMaxMismatch: params.defaultMaxMismatch,
        geomTolerance: params.geomTolerance,
      });
      return { name: r.name, mismatchPixels: 0, mismatchPercent: 0, verdict: v.verdict, reason: v.reason, targetBox, baselineBox };
    }

    const rel = `${slug(params.name)}.${slug(r.name)}.diff.png`;
    const ta = cropToBox(target, r.targetBox!);
    const ba = cropToBox(baseline, r.baselineBox!);
    const d = diffBuffers(ta, ba, join(params.outDir, rel), threshold);
    const v = scoreRegion({
      resolvedTarget,
      resolvedBaseline,
      mismatchPercent: d.mismatchPercent,
      maxMismatch: r.maxMismatch,
      targetBox,
      baselineBox,
      defaultMaxMismatch: params.defaultMaxMismatch,
      geomTolerance: params.geomTolerance,
    });
    return {
      name: r.name,
      mismatchPixels: d.mismatchPixels,
      mismatchPercent: d.mismatchPercent,
      verdict: v.verdict,
      reason: v.reason,
      targetBox,
      baselineBox,
      diff: rel,
    };
  });

  return { full, regions };
}
