import type { BrowserContext } from "playwright";
import { capturePage } from "../capture";
import { looksLikeLoginRedirect } from "../auth";
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
  capture?: Box,
  statePath?: string,
): Promise<{ path: string; boxes: Record<string, Box | null>; styles: Record<string, StyleValues> }> {
  const page = await ctx.newPage();
  try {
    await capturePage(page, url, outPath, clip);
    // Same fail-fast as the target capture: an attached session that lands on
    // a login page has expired — don't diff against a login screen.
    if (statePath && looksLikeLoginRedirect(url, page.url())) {
      throw new Error(
        `baseline redirected to a login page (${page.url()}) — the session in "${statePath}" has likely expired. Re-run: vigress login --url ${url} --state ${statePath}`,
      );
    }
    const boxes = await resolveBoxes(page, items, capture);
    const styles = await resolveStyles(page, styleItems);
    return { path: outPath, boxes, styles };
  } finally {
    await page.close();
  }
}
