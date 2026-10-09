import { runLogin, checkSession } from "../auth";
import type { Ctx } from "./context";

// login subcommand
export async function loginCommand({ values, positionals }: Ctx): Promise<number> {
  const url = typeof values.url === "string" ? values.url : undefined;
  const state = typeof values.state === "string" ? values.state : undefined;
  if (!url || !state) {
    process.stderr.write("Usage: vigress login --url <url> --state <path> [--check]\n");
    return 2;
  }
  // --check: headless, non-interactive session validation; exit 0 = logged in.
  if (values.check === true) {
    const r = await checkSession(url, state);
    if (values.json === true) {
      process.stdout.write(JSON.stringify({ url, state, finalUrl: r.finalUrl, loggedIn: r.loggedIn }) + "\n");
    } else if (r.loggedIn) {
      process.stdout.write(`session ok — ${url} stayed on ${r.finalUrl}\n`);
    } else {
      process.stdout.write(`session expired — ${url} redirected to ${r.finalUrl}\nRe-run: vigress login --url ${url} --state ${state}\n`);
    }
    return r.loggedIn ? 0 : 1;
  }
  await runLogin(url, state);
  return 0;
}
