import type { Page } from "playwright";

export async function capturePage(
  page: Page,
  url: string,
  outPath: string,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(1500); // settle charts/async content
  await page.screenshot({ path: outPath, clip });
  return outPath;
}
