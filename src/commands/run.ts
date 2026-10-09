import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { MANIFEST_PATH, parseManifest, emptyManifest, writeManifest, buildManifestEntry, upsertBaseline, parseBaselineRef, resolveBaselineArtifacts, type ManifestEntry } from "../baselines";
import type { BrowserContext } from "playwright";
import { buildRunConfig, selectorForSide, parseRegionFlag, parseMaskFlag, parseStepFlag, validateStep, runStamp, type ChecklistItem, type Box } from "../config";
import { runSteps, autoExplore, stepSummary } from "../steps";
import { captureRect, resolveBoxes, type BoxItem } from "../regions";
import { diffWithRegions, diffShots, type RegionInput } from "../diff";
import { launchBrowser } from "../browser";
import { capturePage } from "../capture";
import { resolveBaseline, imageSource } from "../sources";
import { storageStateOption, looksLikeLoginRedirect } from "../auth";
import { writeReport } from "../report";
import { buildJsonPayload } from "../json";
import { resolveStyles, styleProps, diffStyleValues, type StyleItem, type StyleValues } from "../style";
import { buildGitInfo } from "../gitinfo";
import { SCHEMA_VERSION, type GitInfo, type RunResult, type RegionScore, type RunMode, type Shot, type StepResult, type StepDiff, type Summary } from "../types";
import { prepareBeforeAfter } from "../beforeAfter";
import { withManifestLock } from "../manifestLock";
import type { Ctx } from "./context";

function log(quiet: boolean, msg: string): void {
  if (!quiet) process.stdout.write(msg + "\n");
}

function gitOut(...args: string[]): string {
  const r = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "ignore" });
  return r.exitCode === 0 ? r.stdout.toString() : "";
}

// The git repo in the working directory, if any: lets a run be tied back to a commit.
function collectGitInfo(): GitInfo | undefined {
  return buildGitInfo({
    commit: gitOut("rev-parse", "HEAD"),
    branch: gitOut("rev-parse", "--abbrev-ref", "HEAD"),
    dirty: gitOut("status", "--porcelain").trim() !== "",
    remote: gitOut("remote", "get-url", "origin"),
  });
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

// The normal run: one comparison, or a batch from --config (also `before` / `after`).
export async function runCommand({ values, positionals }: Ctx): Promise<number> {
  // before / after: a normal single run with options filled in from the baseline (see beforeAfter.ts).
  const beforeAfter = positionals[0] === "before" || positionals[0] === "after" ? positionals[0] : undefined;
  if (beforeAfter) {
    const manifestPath = resolve(MANIFEST_PATH);
    const plan = prepareBeforeAfter(beforeAfter, positionals[1], values as Record<string, unknown>, existsSync(manifestPath) ? parseManifest(readFileSync(manifestPath, "utf8")) : null);
    if (!plan.ok) {
      process.stderr.write(plan.message + "\n");
      return plan.code;
    }
    Object.assign(values, plan.patch);
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

  // Resolve baseline: refs up front — pure guards, no browser needed, fail fast.
  const manifestFile = resolve(MANIFEST_PATH);
  const manifest = existsSync(manifestFile) ? parseManifest(readFileSync(manifestFile, "utf8")) : null;
  const approvedByRun = new Map<string, ManifestEntry>();
  const bootstrapRuns = new Set<string>();
  for (const spec of runs) {
    if (spec.baselineType !== "baseline") continue;
    const refName = parseBaselineRef(spec.against);
    if (!refName) {
      process.stderr.write(`vigress: invalid baseline ref '${spec.against}' — expected baseline:<name>\n`);
      return 2;
    }
    const res = resolveBaselineArtifacts(manifest, refName, spec.viewport, spec.fullPage === true);
    if (!res.ok) {
      if (res.missingEntry && opts.updateBaseline) {
        // First run for this name: capture + approve, skip diffing (bootstrap).
        bootstrapRuns.add(spec.name);
        continue;
      }
      process.stderr.write(`vigress: ${res.message}\n`);
      return res.code;
    }
    if (!existsSync(res.entry.artifacts.main)) {
      process.stderr.write(`vigress: approved baseline artifacts missing for '${refName}' (${res.entry.artifacts.main} deleted?) — re-approve or run with --update-baseline\n`);
      return 1;
    }
    approvedByRun.set(spec.name, res.entry);
  }

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

      // Style probing only applies to regions that opt in via `style` (masks never do).
      const styledRegions = specRegions
        .map((r) => ({ region: r, props: styleProps(r.style) }))
        .filter((x): x is { region: typeof x.region; props: string[] } => x.props !== undefined);
      const targetStyleItems: StyleItem[] = styledRegions.map(({ region, props }) => ({
        key: `r:${region.name}`,
        selector: selectorForSide(region, "target"),
        props,
      }));
      const baselineStyleItems: StyleItem[] = styledRegions.map(({ region, props }) => ({
        key: `r:${region.name}`,
        selector: selectorForSide(region, "baseline"),
        props,
      }));

      const page = await ctx.newPage();
      const { height: targetHeight } = await capturePage(page, spec.target, join(outDir, targetRel), {
        clip: spec.clip,
        fullPage: spec.fullPage,
      });
      // With a session attached, landing on a login page means it expired —
      // fail fast instead of silently diffing two login screens.
      if (opts.statePath && looksLikeLoginRedirect(spec.target, page.url())) {
        throw new Error(
          `target redirected to a login page (${page.url()}) — the session in "${opts.statePath}" has likely expired. Re-run: vigress login --url ${spec.target} --state ${opts.statePath}`,
        );
      }
      // DOM-resolved boxes are translated into the screenshot's coordinate space.
      const targetBoxes = await resolveBoxes(page, targetItems, captureRect(spec, targetHeight));
      const targetStyles = await resolveStyles(page, targetStyleItems);

      const isBootstrap = bootstrapRuns.has(spec.name);
      const approved = approvedByRun.get(spec.name);

      let full: { mismatchPixels: number; mismatchPercent: number } | undefined;
      let regions: RegionScore[] = [];
      let heightDelta = 0;
      if (!isBootstrap) {
        let baselineBoxes: Record<string, Box | null> = {};
        let baselineStyles: Record<string, StyleValues> = {};
        if (spec.baselineType === "baseline") {
          // Approved image baseline: no DOM to probe, like image/figma.
          await imageSource(approved!.artifacts.main, join(outDir, baselineRel));
        } else {
          const resolved = await resolveBaseline(
            spec, ctx, join(outDir, baselineRel), process.env, baselineItems, baselineStyleItems, opts.statePath,
          );
          baselineBoxes = resolved.boxes;
          baselineStyles = resolved.styles;
        }

        // image/figma/baseline baselines resolve no DOM boxes → fall back to the region's clip.
        const regionInputs: RegionInput[] = specRegions.map((r) => ({
          name: r.name,
          targetBox: targetBoxes[`r:${r.name}`] ?? r.clip ?? null,
          baselineBox: baselineBoxes[`r:${r.name}`] ?? r.clip ?? null,
          maxMismatch: r.maxMismatch,
        }));
        const styleDiffByRegion = new Map(
          styledRegions.map(({ region, props }) => [
            region.name,
            diffStyleValues(targetStyles[`r:${region.name}`] ?? null, baselineStyles[`r:${region.name}`] ?? null, props),
          ]),
        );
        const targetMaskBoxes = specMasks
          .map((m, i) => targetBoxes[`m:${i}`] ?? m.clip ?? null)
          .filter((b): b is NonNullable<typeof b> => b !== null);
        const baselineMaskBoxes = specMasks
          .map((m, i) => baselineBoxes[`m:${i}`] ?? m.clip ?? null)
          .filter((b): b is NonNullable<typeof b> => b !== null);

        const d = diffWithRegions({
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
        full = d.full;
        heightDelta = d.heightDelta;
        regions = d.regions.map((r) => {
          const styleDiff = styleDiffByRegion.get(r.name);
          return styleDiff ? { ...r, styleDiff } : r;
        });
      }

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

      // Step-state regression: only meaningful against an approved baseline.
      let stepDiffs: StepDiff[] = [];
      if (approved) {
        stepDiffs = diffShots({
          shots,
          approvedSteps: approved.artifacts.steps,
          outDir,
          name: spec.name,
          threshold: opts.threshold,
          maxMismatch: opts.maxMismatch,
        });
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
        mismatchPixels: full?.mismatchPixels,
        mismatchPercent: full?.mismatchPercent,
        heightDelta: heightDelta || undefined,
        target: targetRel,
        targetUrl: spec.target,
        fullPage: spec.fullPage ? true : undefined,
        baseline: isBootstrap ? undefined : baselineRel,
        diff: isBootstrap ? undefined : diffRel,
        video: videoRel,
        bootstrap: isBootstrap ? true : undefined,
        regions,
        checklist,
        mode,
        shots,
        steps: stepResults,
        stepDiffs,
      });
      const ss = stepSummary(stepResults);
      const stepsNote = mode === "steps" ? ` · steps ${ss.ok}/${ss.total} ok` : "";
      const styleMismatches = regions.reduce((n, r) => n + (r.styleDiff?.filter((s) => !s.match).length ?? 0), 0);
      const styleNote = regions.some((r) => r.styleDiff) ? ` · style ${styleMismatches} mismatch(es)` : "";
      const heightNote = heightDelta ? ` (height ${heightDelta > 0 ? "+" : ""}${heightDelta}px not compared)` : "";
      const pctNote = isBootstrap ? "bootstrap (new baseline)" : `mismatch ${full?.mismatchPercent ?? 0}%${heightNote}`;
      const stepDiffNote = stepDiffs.length ? ` · ${stepDiffs.filter((d) => d.verdict === "ok").length}/${stepDiffs.length} step diff(s) ok` : "";
      log(opts.quiet || opts.json, `[${spec.name}] ${spec.baselineType} ${pctNote} · ${mode}${stepsNote}${styleNote}${stepDiffNote} · ${regions.length} region(s) -> ${isBootstrap ? targetRel : diffRel}`);
    }
  } finally {
    await browser.close();
  }

  const gitInfo = collectGitInfo();
  const summary: Summary = {
    schemaVersion: SCHEMA_VERSION,
    outDir,
    reportHtml: "report.html",
    summaryJson: "summary.json",
    ...(gitInfo ? { git: gitInfo } : {}),
    runs: results,
  };
  writeReport(summary);

  if (opts.updateBaseline) {
    const runDirRel = relative(process.cwd(), outDir);
    const approvedAt = new Date().toISOString();
    // Read, change and write under one lock so a concurrent writer's update is not lost.
    withManifestLock(manifestFile, () => {
      let m = existsSync(manifestFile) ? parseManifest(readFileSync(manifestFile, "utf8")) : emptyManifest();
      for (const r of results) m = upsertBaseline(m, r.name, buildManifestEntry(r, runDirRel, approvedAt));
      writeManifest(manifestFile, m);
    });
    writeFileSync(join(outDir, ".approved"), results.map((r) => r.name).join("\n") + "\n");
    log(opts.quiet || opts.json, `baseline updated: ${results.map((r) => r.name).join(", ")}`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(buildJsonPayload(summary)) + "\n");
  } else {
    log(opts.quiet, `report: ${join(outDir, "report.html")}`);
    if (beforeAfter === "before") log(opts.quiet, `starting point saved as baseline '${positionals[1]}' — make your change, then run: vigress after ${positionals[1]}`);
  }

  if (opts.maxMismatch !== undefined) {
    const worst = results.reduce(
      (m, r) => Math.max(m, r.mismatchPercent ?? 0, ...r.stepDiffs.map((d) => d.mismatchPercent)),
      0,
    );
    if (worst > opts.maxMismatch) return 1;
  }
  if (opts.maxHeightDelta !== undefined && results.some((r) => Math.abs(r.heightDelta ?? 0) > opts.maxHeightDelta!)) {
    return 1;
  }
  if (
    values["require-steps"] &&
    results.some((r) => r.steps.some((s) => s.check && s.status === "failed") || r.stepDiffs.some((d) => d.verdict === "missing"))
  ) {
    return 1;
  }
  if (values["require-style"] && results.some((r) => r.regions.some((rg) => rg.styleDiff?.some((s) => !s.match)))) {
    return 1;
  }
  return 0;
}
