import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext } from "playwright";
import { buildRunConfig, type RunSpec } from "./config";
import { launchBrowser } from "./browser";
import { capturePage } from "./capture";
import { resolveBaseline } from "./sources";
import { diffPngs } from "./diff";
import { storageStateOption, runLogin } from "./auth";
import { writeReport } from "./report";
import { buildJsonPayload } from "./json";
import { SCHEMA_VERSION, type RunResult, type Summary } from "./types";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    target: { type: "string" },
    against: { type: "string" },
    "against-type": { type: "string" },
    name: { type: "string" },
    out: { type: "string" },
    viewport: { type: "string" },
    state: { type: "string" },
    video: { type: "boolean" },
    clip: { type: "string" },
    threshold: { type: "string" },
    json: { type: "boolean" },
    quiet: { type: "boolean" },
    "max-mismatch": { type: "string" },
    config: { type: "string" },
    url: { type: "string" },
  },
});

function log(quiet: boolean, msg: string): void {
  if (!quiet) process.stdout.write(msg + "\n");
}

async function main(): Promise<number> {
  // login subcommand
  if (positionals[0] === "login") {
    const url = typeof values.url === "string" ? values.url : undefined;
    const state = typeof values.state === "string" ? values.state : undefined;
    if (!url || !state) {
      process.stderr.write("Usage: vigress login --url <url> --state <path>\n");
      return 2;
    }
    await runLogin(url, state);
    return 0;
  }

  const { runs, opts } = buildRunConfig(values as Record<string, unknown>, process.env);
  if (runs.length === 0) {
    process.stderr.write(
      "Usage: vigress --target <url> --against <url|image.png|figma:KEY/NODE> [--state f] [--config f]\n",
    );
    return 2;
  }

  const outDir = resolve(opts.outDir);
  const videoDir = join(outDir, "video");
  mkdirSync(outDir, { recursive: true });
  mkdirSync(videoDir, { recursive: true });

  const browser = await launchBrowser();
  const results: RunResult[] = [];
  try {
    for (const spec of runs) {
      const ctxOpts = { viewport: spec.viewport, ...storageStateOption(opts.statePath) };
      const ctx: BrowserContext = spec.video
        ? await browser.newContext({ ...ctxOpts, recordVideo: { dir: videoDir, size: spec.viewport } })
        : await browser.newContext(ctxOpts);

      const targetRel = `${spec.name}.target.png`;
      const baselineRel = `${spec.name}.baseline.png`;
      const diffRel = `${spec.name}.diff.png`;

      const page = await ctx.newPage();
      await capturePage(page, spec.target, join(outDir, targetRel), spec.clip);
      await resolveBaseline(spec, ctx, join(outDir, baselineRel), process.env);
      const d = diffPngs(join(outDir, targetRel), join(outDir, baselineRel), join(outDir, diffRel), opts.threshold);

      const videoHandle = spec.video ? page.video() : undefined;
      await page.close();
      await ctx.close(); // flush video
      const videoPath = videoHandle ? await videoHandle.path() : undefined;

      const videoRel = videoPath ? join("video", videoPath.split("/").pop()!) : undefined;
      results.push({
        name: spec.name,
        baselineType: spec.baselineType,
        viewport: spec.viewport,
        mismatchPixels: d.mismatchPixels,
        mismatchPercent: d.mismatchPercent,
        target: targetRel,
        baseline: baselineRel,
        diff: diffRel,
        video: videoRel,
      });
      log(opts.quiet || opts.json, `[${spec.name}] ${spec.baselineType} mismatch ${d.mismatchPercent}% -> ${diffRel}`);
    }
  } finally {
    await browser.close();
  }

  const summary: Summary = {
    schemaVersion: SCHEMA_VERSION,
    outDir,
    reportHtml: "report.html",
    summaryJson: "summary.json",
    runs: results,
  };
  writeReport(summary);

  if (opts.json) {
    process.stdout.write(JSON.stringify(buildJsonPayload(summary)) + "\n");
  } else {
    log(opts.quiet, `report: ${join(outDir, "report.html")}`);
  }

  if (opts.maxMismatch !== undefined) {
    const worst = results.reduce((m, r) => Math.max(m, r.mismatchPercent), 0);
    if (worst > opts.maxMismatch) return 1;
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`vigress error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
