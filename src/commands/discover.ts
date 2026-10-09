import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseViewport } from "../config";
import { launchBrowser } from "../browser";
import { storageStateOption } from "../auth";
import { extractCandidates, gotoAndSettle, isSafeCandidate, dedupeCandidates, clusterBoxesIntoRegions, buildDiscoveredConfig } from "../discover";
import type { Ctx } from "./context";

// discover subcommand: crawl the live --target DOM and generate a run-ready
// <page>.fullcheck.json (real regions/steps/checklist, not REPLACE-* placeholders).
// Read-only — never clicks or types during discovery; the generated steps only
// click when the resulting config is later run via --config.
export async function discoverCommand({ values, positionals }: Ctx): Promise<number> {
  const page = positionals[1];
  const target = typeof values.target === "string" ? values.target : undefined;
  const against = typeof values.against === "string" ? values.against : undefined;
  if (!page || !target || !against) {
    process.stderr.write("Usage: vigress discover <page> --target <url> --against <url> [--viewport WxH] [--state f] [--max-steps n]\n");
    return 2;
  }
  const file = resolve(`${page}.fullcheck.json`);
  const next = `bun run src/cli.ts --config ${page}.fullcheck.json --state auth.state.json --json`;
  if (existsSync(file)) {
    if (values.json === true) process.stdout.write(JSON.stringify({ file, page, created: false, error: "exists" }) + "\n");
    else process.stderr.write(`vigress: ${file} already exists — refusing to overwrite\n`);
    return 1;
  }
  const viewport = parseViewport(typeof values.viewport === "string" ? values.viewport : undefined);
  const maxSteps = typeof values["max-steps"] === "string" ? Number(values["max-steps"]) : 20;

  const browser = await launchBrowser();
  let raw: Awaited<ReturnType<typeof extractCandidates>>;
  try {
    const ctx = await browser.newContext({ viewport, ...storageStateOption(typeof values.state === "string" ? values.state : undefined) });
    const page2 = await ctx.newPage();
    await gotoAndSettle(page2, target);
    raw = await extractCandidates(page2);
    await ctx.close();
  } finally {
    await browser.close();
  }

  const safe = dedupeCandidates(raw.filter(isSafeCandidate));
  const stepCandidates = safe.slice(0, maxSteps);
  const regions = clusterBoxesIntoRegions(safe.map((c) => c.box));
  const scaffold = buildDiscoveredConfig({ page, target, against, viewport, regions, steps: stepCandidates });
  writeFileSync(file, JSON.stringify(scaffold, null, 2) + "\n");

  if (values.json === true) {
    process.stdout.write(JSON.stringify({
      file, page, created: true,
      discovered: { candidates: raw.length, safe: safe.length, steps: stepCandidates.length, regions: regions.length },
      next,
    }) + "\n");
  } else {
    process.stdout.write(
      `wrote ${file}\n` +
      `discovered ${raw.length} control(s) -> ${safe.length} safe -> ${stepCandidates.length} step(s), ${regions.length} region(s)\n` +
      `This is a heuristic starting point, not a verdict — review selectors, step order, and maxMismatch before relying on it. Then run:\n  ${next}\n`,
    );
  }
  return 0;
}
