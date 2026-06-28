import { parseArgs } from "node:util";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BrowserContext } from "playwright";
import { buildRunConfig, selectorForSide, parseRegionFlag, parseMaskFlag, parseStepFlag, validateStep, runStamp, type RunSpec, type ChecklistItem } from "./config";
import { runSteps, autoExplore, stepSummary } from "./steps";
import { resolveBoxes, type BoxItem } from "./regions";
import { diffWithRegions, type RegionInput } from "./diff";
import { launchBrowser } from "./browser";
import { capturePage } from "./capture";
import { resolveBaseline } from "./sources";
import { storageStateOption, runLogin } from "./auth";
import { writeReport } from "./report";
import { buildJsonPayload } from "./json";
import { SCHEMA_VERSION, type RunResult, type RegionScore, type RunMode, type Shot, type StepResult, type Summary } from "./types";

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
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
    threshold: { type: "string" },
    json: { type: "boolean" },
    quiet: { type: "boolean" },
    "max-mismatch": { type: "string" },
    config: { type: "string" },
    url: { type: "string" },
    region: { type: "string", multiple: true },
    mask: { type: "string", multiple: true },
    "no-steps": { type: "boolean" },
    step: { type: "string", multiple: true },
    "require-steps": { type: "boolean" },
  },
});

function log(quiet: boolean, msg: string): void {
  if (!quiet) process.stdout.write(msg + "\n");
}

function mergeChecklist(items: ChecklistItem[], regions: RegionScore[]): ChecklistItem[] {
  const byName = new Map(regions.map((r) => [r.name, r] as const));
  return items.map((it) => {
    if (it.region && byName.has(it.region)) {
      return { ...it, verdict: byName.get(it.region)!.verdict };
    }
    return { ...it, verdict: it.verdict ?? "manual" };
  });
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

  const regionFlags = Array.isArray(values.region) ? (values.region as string[]) : [];
  const maskFlags = Array.isArray(values.mask) ? (values.mask as string[]) : [];
  if (values.config && (regionFlags.length || maskFlags.length)) {
    process.stderr.write("vigress: --region/--mask are ignored with --config; put regions/mask in the config file instead\n");
  }
  if (runs.length === 1 && !values.config) {
    if (regionFlags.length) runs[0].regions = regionFlags.map((s) => parseRegionFlag(s));
    if (maskFlags.length) runs[0].mask = maskFlags.map((s) => parseMaskFlag(s));
  }

  const stepFlags = Array.isArray(values.step) ? (values.step as string[]) : [];
  if (values.config && stepFlags.length) {
    process.stderr.write("vigress: --step is ignored with --config; put steps in the config file instead\n");
  }
  if (runs.length === 1 && !values.config && stepFlags.length) {
    runs[0].steps = stepFlags.map(parseStepFlag);
    runs[0].steps.forEach(validateStep);
  }

  // Each run lands in its own timestamped subdir so prior outputs persist;
  // --no-timestamp writes straight into --out (fixed path, overwrites).
  const baseOut = resolve(opts.outDir);
  const outDir = values["no-timestamp"] === true ? baseOut : join(baseOut, runStamp());
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

      const specRegions = spec.regions ?? [];
      const specMasks = spec.mask ?? [];

      // Per-side box items (regions keyed r:<name>, masks keyed m:<index>).
      const targetItems: BoxItem[] = [
        ...specRegions.map((r) => ({ key: `r:${r.name}`, selector: selectorForSide(r, "target"), clip: r.clip })),
        ...specMasks.map((m, i) => ({ key: `m:${i}`, selector: selectorForSide(m, "target"), clip: m.clip })),
      ];
      const baselineItems: BoxItem[] = [
        ...specRegions.map((r) => ({ key: `r:${r.name}`, selector: selectorForSide(r, "baseline"), clip: r.clip })),
        ...specMasks.map((m, i) => ({ key: `m:${i}`, selector: selectorForSide(m, "baseline"), clip: m.clip })),
      ];

      const page = await ctx.newPage();
      await capturePage(page, spec.target, join(outDir, targetRel), spec.clip);
      const targetBoxes = await resolveBoxes(page, targetItems);
      const { boxes: baselineBoxes } = await resolveBaseline(spec, ctx, join(outDir, baselineRel), process.env, baselineItems);

      // image/figma baselines resolve no DOM boxes → fall back to the region's clip.
      const regionInputs: RegionInput[] = specRegions.map((r) => ({
        name: r.name,
        targetBox: targetBoxes[`r:${r.name}`] ?? r.clip ?? null,
        baselineBox: baselineBoxes[`r:${r.name}`] ?? r.clip ?? null,
        maxMismatch: r.maxMismatch,
      }));
      const targetMaskBoxes = specMasks
        .map((m, i) => targetBoxes[`m:${i}`] ?? m.clip ?? null)
        .filter((b): b is NonNullable<typeof b> => b !== null);
      const baselineMaskBoxes = specMasks
        .map((m, i) => baselineBoxes[`m:${i}`] ?? m.clip ?? null)
        .filter((b): b is NonNullable<typeof b> => b !== null);

      const { full, regions } = diffWithRegions({
        targetPath: join(outDir, targetRel),
        baselinePath: join(outDir, baselineRel),
        diffPath: join(outDir, diffRel),
        outDir,
        name: spec.name,
        targetMaskBoxes,
        baselineMaskBoxes,
        regions: regionInputs,
        threshold: opts.threshold,
      });

      // Interaction (target only), after the clean screenshot + diff so parity is unaffected.
      const mode: RunMode = values["no-steps"] === true ? "static" : (spec.steps?.length ? "steps" : "explore");
      let shots: Shot[] = [];
      let stepResults: StepResult[] = [];
      if (mode === "steps") {
        const r = await runSteps(page, spec.steps!, outDir, spec.name);
        shots = r.shots;
        stepResults = r.results;
      } else if (mode === "explore") {
        await autoExplore(page);
      }

      const videoHandle = spec.video ? page.video() : undefined;
      await page.close();
      await ctx.close();
      const videoPath = videoHandle ? await videoHandle.path() : undefined;
      const videoRel = videoPath ? join("video", videoPath.split("/").pop()!) : undefined;

      const checklist: ChecklistItem[] = mergeChecklist(spec.checklist ?? [], regions);

      results.push({
        name: spec.name,
        baselineType: spec.baselineType,
        viewport: spec.viewport,
        mismatchPixels: full.mismatchPixels,
        mismatchPercent: full.mismatchPercent,
        target: targetRel,
        baseline: baselineRel,
        diff: diffRel,
        video: videoRel,
        regions,
        checklist,
        mode,
        shots,
        steps: stepResults,
      });
      const ss = stepSummary(stepResults);
      const stepsNote = mode === "steps" ? ` · steps ${ss.ok}/${ss.total} ok` : "";
      log(opts.quiet || opts.json, `[${spec.name}] ${spec.baselineType} mismatch ${full.mismatchPercent}% · ${mode}${stepsNote} · ${regions.length} region(s) -> ${diffRel}`);
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
  if (values["require-steps"] && results.some((r) => r.steps.some((s) => s.check && s.status === "failed"))) {
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`vigress error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
