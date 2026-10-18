import { parseArgs } from "node:util";

// Every CLI option, in one place. Kept out of cli.ts so the parsing (and its error
// messages) can be tested without running the CLI.
const OPTIONS = {
  target: { type: "string" },
  against: { type: "string" },
  "against-type": { type: "string" },
  name: { type: "string" },
  out: { type: "string" },
  "no-timestamp": { type: "boolean" },
  viewport: { type: "string" },
  state: { type: "string" },
  video: { type: "boolean" },
  "no-video": { type: "boolean" },
  clip: { type: "string" },
  "full-page": { type: "boolean" },
  threshold: { type: "string" },
  json: { type: "boolean" },
  quiet: { type: "boolean" },
  "max-mismatch": { type: "string" },
  "max-height-delta": { type: "string" },
  config: { type: "string" },
  url: { type: "string" },
  region: { type: "string", multiple: true },
  mask: { type: "string", multiple: true },
  "no-steps": { type: "boolean" },
  step: { type: "string", multiple: true },
  "require-steps": { type: "boolean" },
  "require-style": { type: "boolean" },
  "max-steps": { type: "string" },
  check: { type: "boolean" },
  "update-baseline": { type: "boolean" },
  run: { type: "string" },
  all: { type: "boolean" },
  port: { type: "string" },
  diff: { type: "string" },
  to: { type: "string" },
  keep: { type: "string" },
} as const;

// A bad command line (unknown option, a missing value, a value that starts with a dash)
// becomes a message for the caller to print with exit 2, instead of a thrown stack trace.
export function parseCli(argv: string[]) {
  try {
    const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
    return { ok: true as const, values, positionals };
  } catch (e) {
    return { ok: false as const, message: `vigress: ${e instanceof Error ? e.message.replace(/\s*\n\s*/g, " ") : String(e)}` };
  }
}

export interface ArgvToken {
  kind: "option" | "positional";
  name?: string; // option name, without the dashes
  index: number; // position in argv
  span: number; // how many argv entries it uses: 2 for `--x value`, 1 otherwise
}

// Where each option and positional sits in argv, so a caller can drop or rewrite a
// single one without guessing from the text (a value can look like a flag or a command).
// null when argv doesn't parse. An option terminator (`--`) is not reported.
export function argvTokens(argv: string[]): ArgvToken[] | null {
  try {
    const { tokens } = parseArgs({ args: argv, allowPositionals: true, options: OPTIONS, tokens: true });
    const out: ArgvToken[] = [];
    for (const t of tokens) {
      if (t.kind === "positional") out.push({ kind: "positional", index: t.index, span: 1 });
      else if (t.kind === "option") {
        const separateValue = t.value !== undefined && !t.inlineValue;
        out.push({ kind: "option", name: t.name, index: t.index, span: separateValue ? 2 : 1 });
      }
    }
    return out;
  } catch {
    return null;
  }
}
