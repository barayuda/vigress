import type { Page } from "playwright";

export async function capturePage(
  page: Page,
  url: string,
  outPath: string,
  clip?: { x: number; y: number; width: number; height: number },
  // SPAs with persistent sockets (MQTT/long-poll) never reach networkidle, so the
  // wait is capped — otherwise it blocks the full 30s default and bloats the video.
  // Tune via VIGRESS_SETTLE (ms); lower = shorter clip, higher = safer for slow data.
  settle: number = Number(process.env.VIGRESS_SETTLE) || 8000,
): Promise<string> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: settle }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(1500); // settle charts/async content
  await page.screenshot({ path: outPath, clip });
  return outPath;
}
