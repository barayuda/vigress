import { argvTokens } from "./args";
import type { Invocation } from "./types";

// The exact command an agent can run to re-create a run's "after" capture. It is built
// from the recorded invocation, minus anything that would bless or overwrite a baseline.

const SAFE = /^[A-Za-z0-9_\/.:=,@%+-]+$/;

/**
 * Safe for a POSIX shell and zsh: plain words pass through, anything else is single-quoted.
 * A leading "=" is quoted too, because zsh expands "=cmd" to the command's path.
 */
export function shellQuote(arg: string): string {
  return SAFE.test(arg) && !arg.startsWith("=") ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The environment variables that change how a run captures or where it writes. A re-run needs
 * them (the dashboard's jobs inherit them from the dashboard's shell). Secrets such as
 * FIGMA_TOKEN are deliberately not on this list: they must never reach summary.json.
 */
export const INVOCATION_ENV = ["VIGRESS_STATE", "VIGRESS_VIEWPORT", "VIGRESS_SETTLE", "VIGRESS_DWELL", "VIGRESS_BROWSER", "VIGRESS_OUT"] as const;

/** The INVOCATION_ENV variables that are set, or undefined when none are. */
export function pickInvocationEnv(env: Record<string, string | undefined>): Record<string, string> | undefined {
  const picked: Record<string, string> = {};
  for (const k of INVOCATION_ENV) {
    const v = env[k];
    if (v !== undefined) picked[k] = v;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

/**
 * Flags that must never appear in a re-run: one blesses the result as the new baseline,
 * the other overwrites the run directory in place. `--json` is dropped and re-added last.
 */
const DROPPED = new Set(["update-baseline", "no-timestamp", "json"]);

/**
 * null when there is no invocation, or argv can't be reproduced safely (it doesn't
 * parse, or it has a `--` terminator, after which an appended --json would be a positional).
 */
export function buildRerunCommand(inv: Invocation | undefined, cliPath: string): string | null {
  if (!inv) return null;
  const tokens = argvTokens(inv.argv);
  if (!tokens || inv.argv.includes("--")) return null;

  const skip = new Set<number>();
  for (const t of tokens) {
    if (t.kind === "option" && t.name && DROPPED.has(t.name)) for (let i = 0; i < t.span; i++) skip.add(t.index + i);
  }
  // `before` blesses a baseline; the re-run checks against it instead. Only the first
  // positional is the subcommand: `--name before` is just a value.
  const first = tokens.find((t) => t.kind === "positional");
  const rewriteAt = first && inv.argv[first.index] === "before" ? first.index : -1;
  const args = inv.argv.map((a, i) => (i === rewriteAt ? "after" : a)).filter((_, i) => !skip.has(i));

  // Only known names go in front: a hand-edited summary.json must not inject anything.
  const known = new Set<string>(INVOCATION_ENV);
  const env = Object.entries(inv.env ?? {}).filter(([k]) => known.has(k)).map(([k, v]) => `${k}=${shellQuote(v)}`);
  return ["cd", shellQuote(inv.cwd), "&&", ...env, "bun", "run", shellQuote(cliPath), ...args.map(shellQuote), "--json"].join(" ");
}

/**
 * Compares the "before" run directory with the re-run's output. The last placeholder is
 * text for the agent to replace with the re-run's `outDir`, so it is deliberately not quoted.
 */
export function buildCompareCheckCommand(cwd: string, cliPath: string, beforeDirAbs: string, name: string): string {
  return [
    "cd", shellQuote(cwd), "&&", "bun", "run", shellQuote(cliPath), "compare",
    shellQuote(beforeDirAbs), "<outDir from the re-run JSON>", "--name", shellQuote(name), "--json",
  ].join(" ");
}
