import { chromium, type Browser } from "playwright";

const CHANNELS = ["chrome", "msedge", "chrome-beta", "msedge-beta"];

// Which installed browser to drive. Default is Google Chrome; set
// VIGRESS_BROWSER=msedge to use Microsoft Edge instead.
export function browserChannel(env: NodeJS.ProcessEnv = process.env): string {
  const c = env.VIGRESS_BROWSER || "chrome";
  if (!CHANNELS.includes(c)) {
    throw new Error(`vigress: VIGRESS_BROWSER must be one of ${CHANNELS.join(", ")} (got "${c}")`);
  }
  return c;
}

export interface WindowSize {
  width: number;
  height: number;
}

// Headless Chrome/Edge records the window, not the emulated viewport: a video is
// cropped (and padded grey) unless the window has the viewport's exact size.
export function launchArgs(windowSize?: WindowSize): string[] {
  return windowSize ? [`--window-size=${windowSize.width},${windowSize.height}`] : [];
}

export async function launchBrowser(headless = true, windowSize?: WindowSize): Promise<Browser> {
  // channel uses the installed browser — no Chromium download.
  return chromium.launch({ channel: browserChannel(), headless, args: launchArgs(windowSize) });
}
