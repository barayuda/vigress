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

export async function launchBrowser(headless = true): Promise<Browser> {
  // channel uses the installed browser — no Chromium download.
  return chromium.launch({ channel: browserChannel(), headless });
}
