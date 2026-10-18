import { argvTokens } from "./args";
import type { Invocation } from "./types";

// The exact command an agent can run to re-create a run's "after" capture. It is built
// from the recorded invocation, minus anything that would bless or overwrite a baseline.

const SAFE = /^[A-Za-z0-9_\/.:=,@%+-]+$/;

// Safe for a POSIX shell: plain words pass through, anything else is single-quoted.
export function shellQuote(arg: string): string {
  return SAFE.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

// Flags that must never appear in a re-run: one blesses the result as the new baseline,
// the other overwrites the run directory in place. `--json` is dropped and re-added last.
const DROPPED = new Set(["update-baseline", "no-timestamp", "json"]);

// null when there is no invocation, or argv can't be reproduced safely (it doesn't
// parse, or it has a `--` terminator, after which an appended --json would be a positional).
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

  return ["cd", shellQuote(inv.cwd), "&&", "bun", "run", shellQuote(cliPath), ...args.map(shellQuote), "--json"].join(" ");
}

// Compares the "before" run directory with the re-run's output. The last placeholder is
// text for the agent to replace with the re-run's `outDir`, so it is deliberately not quoted.
export function buildCompareCheckCommand(cwd: string, cliPath: string, beforeDirAbs: string, name: string): string {
  return [
    "cd", shellQuote(cwd), "&&", "bun", "run", shellQuote(cliPath), "compare",
    shellQuote(beforeDirAbs), "<outDir from the re-run JSON>", "--name", shellQuote(name), "--json",
  ].join(" ");
}
