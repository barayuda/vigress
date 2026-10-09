import type { parseCli } from "../args";

// What every subcommand receives: the parsed command line (see args.ts).
type Parsed = Extract<ReturnType<typeof parseCli>, { ok: true }>;
export type CliValues = Parsed["values"];
export interface Ctx {
  values: CliValues;
  positionals: string[];
}
