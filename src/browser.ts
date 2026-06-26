import { chromium, type Browser } from "playwright";

export async function launchBrowser(): Promise<Browser> {
  // channel: "chrome" uses the installed Google Chrome — no Chromium download.
  return chromium.launch({ channel: "chrome", headless: true });
}
