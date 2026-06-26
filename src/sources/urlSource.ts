import type { BrowserContext } from "playwright";
import { capturePage } from "../capture";
import type { RunSpec } from "../config";

// Capture a reference URL in its own page. Returns outPath.
export async function urlSource(
  ctx: BrowserContext,
  url: string,
  outPath: string,
  clip?: RunSpec["clip"],
): Promise<string> {
  const page = await ctx.newPage();
  try {
    await capturePage(page, url, outPath, clip);
  } finally {
    await page.close();
  }
  return outPath;
}
