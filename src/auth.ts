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

// Exact path segments that identify a login/SSO page. Matching whole segments
// (not substrings) avoids false positives like /authors or /blog/sso-explained.
const LOGIN_SEGMENTS = new Set([
  "login", "log-in", "log_in",
  "signin", "sign-in", "sign_in",
  "sso", "auth", "oauth", "oauth2", "authorize", "authentication",
]);

function isLoginUrl(u: string): boolean {
  try {
    const url = new URL(u);
    // Include the hash so SPA hash routers (…/#/login) are detected too.
    const path = `${url.pathname}/${url.hash.replace(/^#/, "")}`;
    return path.toLowerCase().split("/").some((seg) => LOGIN_SEGMENTS.has(seg));
  } catch {
    return false;
  }
}

// True when a capture that asked for `requested` landed on a login page it did
// not ask for — the telltale sign of an expired/missing session. Deliberately
// false when the requested URL is itself a login page (then it's intentional).
export function looksLikeLoginRedirect(requested: string, final: string): boolean {
  return !isLoginUrl(requested) && isLoginUrl(final);
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

// Headless, non-interactive session validation (`login --check`): loads the
// saved state, opens the URL, and reports whether it stayed off the login page.
// Lets an agent pre-flight a session without hanging on the interactive flow.
export async function checkSession(
  url: string,
  statePath: string,
): Promise<{ loggedIn: boolean; finalUrl: string }> {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const ctx = await browser.newContext(storageStateOption(statePath));
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000); // let a client-side auth guard redirect
    const finalUrl = page.url();
    await ctx.close();
    return { loggedIn: !looksLikeLoginRedirect(url, finalUrl), finalUrl };
  } finally {
    await browser.close();
  }
}
