import type { BrowserContext } from "playwright";
import { capturePage } from "../capture";
import type { Box, RunSpec } from "../config";
import { resolveBoxes, type BoxItem } from "../regions";

export async function urlSource(
  ctx: BrowserContext,
  url: string,
  outPath: string,
  clip?: RunSpec["clip"],
  items: BoxItem[] = [],
): Promise<{ path: string; boxes: Record<string, Box | null> }> {
  const page = await ctx.newPage();
  try {
    await capturePage(page, url, outPath, clip);
    const boxes = await resolveBoxes(page, items);
    return { path: outPath, boxes };
  } finally {
    await page.close();
  }
}
