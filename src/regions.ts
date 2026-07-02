import { PNG } from "pngjs";
import type { Page } from "playwright";
import type { Box } from "./config";
import type { BoxDims, RegionVerdict, RegionReason } from "./types";

export interface BoxItem {
  key: string;
  selector?: string;
  clip?: Box;
}

// Translates a page-coordinate box into the screenshot's coordinate space.
// The screenshot only covers `capture` (the --clip rect, or the viewport at the
// origin), so the box is intersected with it and offset to the capture's origin.
// Returns null when the box lies entirely outside the captured area (e.g. below
// the fold) — the region then scores `unresolved` instead of diffing a clamped
// sliver at the wrong position.
export function boxInCapture(box: Box, capture: Box): Box | null {
  const x0 = Math.max(box.x, capture.x);
  const y0 = Math.max(box.y, capture.y);
  const x1 = Math.min(box.x + box.width, capture.x + capture.width);
  const y1 = Math.min(box.y + box.height, capture.y + capture.height);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0 - capture.x, y: y0 - capture.y, width: x1 - x0, height: y1 - y0 };
}

export async function resolveBoxes(
  page: Page,
  items: BoxItem[],
  capture?: Box,
): Promise<Record<string, Box | null>> {
  const out: Record<string, Box | null> = {};
  for (const it of items) {
    if (it.selector) {
      try {
        const bb = await page.locator(it.selector).first().boundingBox();
        // DOM boxes are in page coordinates; clip fallbacks below are authored
        // against the screenshot and pass through untranslated.
        out[it.key] = bb && capture ? boxInCapture(bb, capture) : bb;
      } catch {
        out[it.key] = null;
      }
    } else {
      out[it.key] = it.clip ?? null;
    }
  }
  return out;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const MASK_COLOR: RGB = { r: 255, g: 0, b: 255 }; // opaque magenta, unlikely in UI

function clampBox(png: PNG, b: Box): { x0: number; y0: number; x1: number; y1: number } {
  const x0 = Math.max(0, Math.floor(b.x));
  const y0 = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(png.width, Math.floor(b.x + b.width));
  const y1 = Math.min(png.height, Math.floor(b.y + b.height));
  return { x0, y0, x1, y1 };
}

export function paintMask(png: PNG, boxes: Box[], color: RGB = MASK_COLOR): void {
  for (const b of boxes) {
    const { x0, y0, x1, y1 } = clampBox(png, b);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (png.width * y + x) << 2;
        png.data[i] = color.r;
        png.data[i + 1] = color.g;
        png.data[i + 2] = color.b;
        png.data[i + 3] = 255;
      }
    }
  }
}

export function cropToBox(png: PNG, box: Box): PNG {
  const { x0, y0, x1, y1 } = clampBox(png, box);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (png.width * (y0 + y) + (x0 + x)) << 2;
      const di = (w * y + x) << 2;
      dst.data[di] = png.data[si];
      dst.data[di + 1] = png.data[si + 1];
      dst.data[di + 2] = png.data[si + 2];
      dst.data[di + 3] = png.data[si + 3];
    }
  }
  return dst;
}

export function scoreRegion(args: {
  resolvedTarget: boolean;
  resolvedBaseline: boolean;
  mismatchPercent: number;
  maxMismatch?: number;
  targetBox?: BoxDims;
  baselineBox?: BoxDims;
  defaultMaxMismatch?: number;
  geomTolerance?: number;
}): { verdict: RegionVerdict; reason: RegionReason } {
  if (!args.resolvedTarget || !args.resolvedBaseline) {
    return { verdict: "unresolved", reason: "unresolved" };
  }
  const tol = args.geomTolerance ?? 2;
  if (
    args.targetBox &&
    args.baselineBox &&
    (Math.abs(args.targetBox.width - args.baselineBox.width) > tol ||
      Math.abs(args.targetBox.height - args.baselineBox.height) > tol)
  ) {
    return { verdict: "fail", reason: "geometry" };
  }
  const limit = args.maxMismatch ?? args.defaultMaxMismatch ?? 5;
  if (args.mismatchPercent > limit) return { verdict: "fail", reason: "content" };
  return { verdict: "pass", reason: "content" };
}
