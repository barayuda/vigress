import { existsSync } from "node:fs";
import { chromium } from "playwright";

// Returns a Playwright context option object that includes storageState when a
// valid file is given. Throws a clear hint when a path is given but missing.
export function storageStateOption(statePath?: string): { storageState?: string } {
  if (!statePath) return {};
  if (!existsSync(statePath)) {
    throw new Error(
      `No session at "${statePath}" — run: vigress login --url <url> --state ${statePath}`,
    );
  }
  return { storageState: statePath };
}

// Opens a headed browser at loginUrl; the user signs in (any SSO/OAuth/MFA),
// presses Enter in the terminal, and the storageState is saved to statePath.
//
// If statePath already holds a session (e.g. from an earlier `login` against a
// different host), that session is loaded into the new context first, so this
// login's cookies are added alongside it rather than replacing it. A full
// check that spans two origins (e.g. a local app + a staging baseline it
// doesn't share cookies with) needs both sessions in the same state file —
// without this, logging into the second host would silently drop the first.
export async function runLogin(loginUrl: string, statePath: string): Promise<void> {
  const browser = await chromium.launch({ channel: "chrome", headless: false });
  const ctx = existsSync(statePath)
    ? await browser.newContext({ storageState: statePath })
    : await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
  process.stdout.write(
    `\nA browser opened at ${loginUrl}.\nSign in there, then press Enter here to save the session...`,
  );
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
    process.stdin.resume();
  });
  await ctx.storageState({ path: statePath });
  await browser.close();
  process.stdout.write(`\nSaved session to ${statePath}\n`);
}
