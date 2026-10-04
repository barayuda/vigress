import type { Page } from "playwright";

export async function capturePage(
  page: Page,
  url: string,
  outPath: string,
  opts: {
    clip?: { x: number; y: number; width: number; height: number };
    // SPAs with persistent sockets (MQTT/long-poll) never reach networkidle, so the
    // wait is capped — otherwise it blocks the full 30s default and bloats the video.
    // Tune via VIGRESS_SETTLE (ms); lower = shorter clip, higher = safer for slow data.
    settle?: number;
    // Whole scrollable page instead of the viewport. Steps through it first so
    // lazy images and scroll-triggered content load, then returns to the top.
    fullPage?: boolean;
  } = {},
): Promise<{ path: string; height: number }> {
  const { clip, fullPage = false, settle = Number(process.env.VIGRESS_SETTLE) || 8000 } = opts;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: settle }).catch(() => {});
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(1500); // settle charts/async content
  if (fullPage) await scrollThrough(page);
  // animations: "disabled" freezes CSS animations/transitions to their end state —
  // without it a perpetual loader (e.g. spinner dots) never produces two identical
  // frames and page.screenshot() times out waiting for stability. caret: "hide"
  // keeps text-input captures deterministic.
  await page.screenshot({ path: outPath, clip: fullPage ? undefined : clip, fullPage, animations: "disabled", caret: "hide" });
  // Measured after prep (lazy content loaded) so callers can build the capture rect.
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  return { path: outPath, height };
}

// Step down one viewport at a time (capped) so IntersectionObserver-based lazy
// loading and scroll animations run, then wait for in-flight images and go back to the top.
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight || 800;
    for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 60; y += step, i++) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  // Scroll-reveal libraries (AOS) hide sections again once they leave the viewport,
  // so after scrolling back to the top most of the page would be blank. Pin the
  // final state instead.
  await page.addStyleTag({
    content: "[data-aos]{opacity:1!important;transform:none!important;transition:none!important}",
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
}
