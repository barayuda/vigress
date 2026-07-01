import type { BrowserContext } from "playwright";
import { capturePage } from "../capture";
import type { Box, RunSpec } from "../config";
import { resolveBoxes, type BoxItem } from "../regions";
import { resolveStyles, type StyleItem, type StyleValues } from "../style";

export async function urlSource(
  ctx: BrowserContext,
  url: string,
  outPath: string,
  clip?: RunSpec["clip"],
  items: BoxItem[] = [],
  styleItems: StyleItem[] = [],
): Promise<{ path: string; boxes: Record<string, Box | null>; styles: Record<string, StyleValues> }> {
  const page = await ctx.newPage();
  try {
    await capturePage(page, url, outPath, clip);
    const boxes = await resolveBoxes(page, items);
    const styles = await resolveStyles(page, styleItems);
    return { path: outPath, boxes, styles };
  } finally {
    await page.close();
  }
}
