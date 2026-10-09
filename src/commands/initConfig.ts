import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildScaffoldConfig, scaffoldPlaceholders, parseViewport } from "../config";
import type { Ctx } from "./context";

// init-config subcommand: scaffold a <page>.fullcheck.json starter (no browser).
export async function initConfigCommand({ values, positionals }: Ctx): Promise<number> {
  const page = positionals[1];
  const target = typeof values.target === "string" ? values.target : undefined;
  const against = typeof values.against === "string" ? values.against : undefined;
  if (!page || !target || !against) {
    process.stderr.write("Usage: vigress init-config <page> --target <url> --against <url|image.png|figma:KEY/NODE> [--viewport WxH]\n");
    return 2;
  }
  const file = resolve(`${page}.fullcheck.json`);
  const next = `bun run src/cli.ts --config ${page}.fullcheck.json --state auth.state.json --json`;
  if (existsSync(file)) {
    if (values.json === true) process.stdout.write(JSON.stringify({ file, page, created: false, error: "exists" }) + "\n");
    else process.stderr.write(`vigress: ${file} already exists — refusing to overwrite\n`);
    return 1;
  }
  const viewport = typeof values.viewport === "string" ? parseViewport(values.viewport) : undefined;
  const scaffold = buildScaffoldConfig({ page, target, against, viewport });
  writeFileSync(file, JSON.stringify(scaffold, null, 2) + "\n");
  if (values.json === true) {
    process.stdout.write(JSON.stringify({ file, page, created: true, placeholders: scaffoldPlaceholders(scaffold), next }) + "\n");
  } else {
    process.stdout.write(`wrote ${file}\nEdit the REPLACE-* regions/mask/checklist/steps, then run:\n  ${next}\n`);
  }
  return 0;
}
