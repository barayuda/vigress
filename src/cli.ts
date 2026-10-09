#!/usr/bin/env bun
import { parseCli } from "./args";
import type { Ctx } from "./commands/context";
import { loginCommand } from "./commands/login";
import { initConfigCommand } from "./commands/initConfig";
import { discoverCommand } from "./commands/discover";
import { approveCommand } from "./commands/approve";
import { historyCommand } from "./commands/history";
import { pruneCommand } from "./commands/prune";
import { compareCommand } from "./commands/compare";
import { dashboardCommand } from "./commands/dashboard";
import { runCommand } from "./commands/run";

// One module per subcommand in src/commands/. Anything that is not a subcommand is a run
// (`vigress --target ...`, `--config ...`, and `before` / `after`).
const COMMANDS: Record<string, (ctx: Ctx) => Promise<number>> = {
  login: loginCommand,
  "init-config": initConfigCommand,
  discover: discoverCommand,
  approve: approveCommand,
  history: historyCommand,
  rollback: historyCommand,
  prune: pruneCommand,
  compare: compareCommand,
  dashboard: dashboardCommand,
};

const parsed = parseCli(Bun.argv.slice(2));
if (!parsed.ok) {
  process.stderr.write(parsed.message + "\n");
  process.exit(2);
}
const { values, positionals } = parsed;
const name = positionals[0];
const command = name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : runCommand;

command({ values, positionals }).then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`vigress error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
