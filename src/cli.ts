import { parseArgs } from "node:util";
import { mkdirSync, existsSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { MANIFEST_PATH, parseManifest, emptyManifest, writeManifest, buildManifestEntry, upsertBaseline, pickNewestRun, parseBaselineRef, resolveBaselineArtifacts, type RunDirCandidate, type ManifestEntry } from "./baselines";
import type { BrowserContext } from "playwright";
import { buildRunConfig, buildScaffoldConfig, scaffoldPlaceholders, parseViewport, selectorForSide, parseRegionFlag, parseMaskFlag, parseStepFlag, validateStep, runStamp, type RunSpec, type ChecklistItem, type Box } from "./config";
import { runSteps, autoExplore, stepSummary } from "./steps";
import { resolveBoxes, type BoxItem } from "./regions";
import { diffWithRegions, diffShots, type RegionInput } from "./diff";
import { launchBrowser } from "./browser";
import { capturePage } from "./capture";
import { resolveBaseline, imageSource } from "./sources";
import { storageStateOption, runLogin, checkSession, looksLikeLoginRedirect } from "./auth";
import { writeReport } from "./report";
import { buildJsonPayload } from "./json";
import { resolveStyles, styleProps, diffStyleValues, type StyleItem, type StyleValues } from "./style";
import { extractCandidates, gotoAndSettle, isSafeCandidate, dedupeCandidates, clusterBoxesIntoRegions, buildDiscoveredConfig } from "./discover";
import { SCHEMA_VERSION, type RunResult, type RegionScore, type RunMode, type Shot, type StepResult, type StepDiff, type Summary } from "./types";
import { startDashboard } from "./server";

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
    "require-style": { type: "boolean" },
    "max-steps": { type: "string" },
    check: { type: "boolean" },
    "update-baseline": { type: "boolean" },
    run: { type: "string" },
    all: { type: "boolean" },
    port: { type: "string" },
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

// I/O side of run-dir discovery: every out/<dir>/summary.json becomes a
// candidate; unreadable summaries are skipped (crashed/legacy runs).
function loadRunDir(dir: string): RunDirCandidate | null {
  const sPath = join(dir, "summary.json");
  if (!existsSync(sPath)) return null;
  try {
    const summary = JSON.parse(readFileSync(sPath, "utf8")) as Summary;
    return { dir, mtimeMs: statSync(dir).mtimeMs, summary };
  } catch {
    return null;
  }
}

function loadRunDirs(baseOut: string): RunDirCandidate[] {
  if (!existsSync(baseOut)) return [];
  return readdirSync(baseOut, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => loadRunDir(join(baseOut, d.name)))
    .filter((c): c is RunDirCandidate => c !== null);
}

async function main(): Promise<number> {
  // login subcommand
  if (positionals[0] === "login") {
    const url = typeof values.url === "string" ? values.url : undefined;
    const state = typeof values.state === "string" ? values.state : undefined;
    if (!url || !state) {
      process.stderr.write("Usage: vigress login --url <url> --state <path> [--check]\n");
      return 2;
    }
    // --check: headless, non-interactive session validation; exit 0 = logged in.
    if (values.check === true) {
      const r = await checkSession(url, state);
      if (values.json === true) {
        process.stdout.write(JSON.stringify({ url, state, finalUrl: r.finalUrl, loggedIn: r.loggedIn }) + "\n");
      } else if (r.loggedIn) {
        process.stdout.write(`session ok — ${url} stayed on ${r.finalUrl}\n`);
      } else {
        process.stdout.write(`session expired — ${url} redirected to ${r.finalUrl}\nRe-run: vigress login --url ${url} --state ${state}\n`);
      }
      return r.loggedIn ? 0 : 1;
    }
    await runLogin(url, state);
    return 0;
  }

  // init-config subcommand: scaffold a <page>.fullcheck.json starter (no browser).
  if (positionals[0] === "init-config") {
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

  // discover subcommand: crawl the live --target DOM and generate a run-ready
  // <page>.fullcheck.json (real regions/steps/checklist, not REPLACE-* placeholders).
  // Read-only — never clicks or types during discovery; the generated steps only
  // click when the resulting config is later run via --config.
  if (positionals[0] === "discover") {
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

  // approve subcommand: bless a run's captures as the approved baseline.
  // Manifest-only — artifacts stay in place under out/ (no copying).
  if (positionals[0] === "approve") {
    const name = positionals[1];
    const all = values.all === true;
    if (!name && !all) {
      process.stderr.write("Usage: vigress approve <name> [--run <dir>]  |  vigress approve --all [--run <dir>]\n");
      return 2;
    }
    const baseOut = resolve(typeof values.out === "string" ? values.out : process.env.VIGRESS_OUT ?? "out");
    let candidate: RunDirCandidate | null;
    if (typeof values.run === "string") {
      candidate = loadRunDir(resolve(values.run));
      if (!candidate) {
        process.stderr.write(`vigress approve: no readable summary.json in ${values.run}\n`);
        return 1;
      }
    } else {
      const dirs = loadRunDirs(baseOut);
      candidate = name
        ? pickNewestRun(dirs, name)
        : dirs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;
      if (!candidate) {
        const available = [...new Set(dirs.flatMap((c) => c.summary.runs.map((r) => r.name)))];
        process.stderr.write(
          `vigress approve: no run${name ? ` named '${name}'` : "s"} found under ${baseOut}` +
          (available.length ? ` — available: ${available.join(", ")}` : "") + "\n",
        );
        return 1;
      }
    }
    if (candidate.summary.schemaVersion < 7) {
      process.stderr.write(`vigress approve: ${candidate.dir} was written by an older vigress (schema ${candidate.summary.schemaVersion}) — re-run the comparison first\n`);
      return 1;
    }
    const toApprove = all ? candidate.summary.runs : candidate.summary.runs.filter((r) => r.name === name);
    if (!toApprove.length) {
      process.stderr.write(
        all
          ? `vigress approve: no runs found in ${candidate.dir}\n`
          : `vigress approve: run '${name}' not in ${candidate.dir} — has: ${candidate.summary.runs.map((r) => r.name).join(", ")}\n`,
      );
      return 1;
    }
    const manifestFile = resolve(MANIFEST_PATH);
    let manifest = existsSync(manifestFile) ? parseManifest(readFileSync(manifestFile, "utf8")) : emptyManifest();
    const runDirRel = relative(process.cwd(), candidate.dir);
    const approvedAt = new Date().toISOString();
    for (const run of toApprove) {
      if (!existsSync(join(candidate.dir, run.target))) {
        process.stderr.write(`vigress approve: target capture missing for '${run.name}' (${join(runDirRel, run.target)})\n`);
        return 1;
      }
      manifest = upsertBaseline(manifest, run.name, buildManifestEntry(run, runDirRel, approvedAt));
    }
    writeManifest(manifestFile, manifest);
    writeFileSync(join(candidate.dir, ".approved"), toApprove.map((r) => r.name).join("\n") + "\n");
    if (values.json === true) {
      process.stdout.write(JSON.stringify({
        manifest: manifestFile,
        approved: toApprove.map((r) => ({ name: r.name, main: join(runDirRel, r.target), steps: r.shots.length })),
        from: runDirRel,
      }) + "\n");
    } else {
      for (const run of toApprove) {
        process.stdout.write(`approved '${run.name}' — main + ${run.shots.length} step shot(s) from ${runDirRel}\n`);
      }
      process.stdout.write(`manifest: ${manifestFile}\n`);
    }
    return 0;
  }

  // dashboard subcommand: local web UI over out/ — browse runs, keep/delete.
  // Binds 127.0.0.1 only (it deletes files); serves until Ctrl-C.
  if (positionals[0] === "dashboard") {
    const port = typeof values.port === "string" ? Number(values.port) : 4600;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      process.stderr.write("Usage: vigress dashboard [--port 4600] [--out out]\n");
      return 2;
    }
    const baseOut = resolve(typeof values.out === "string" ? values.out : process.env.VIGRESS_OUT ?? "out");
    const server = startDashboard({
      outDirAbs: baseOut,
      port,
      rootDir: process.cwd(),
      manifestFile: resolve(MANIFEST_PATH),
    });
    process.stdout.write(`vigress dashboard: http://127.0.0.1:${server.port}/ (out: ${baseOut}) — Ctrl-C to stop\n`);
    await new Promise(() => {}); // serve until killed
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
    const res = resolveBaselineArtifacts(manifest, refName, spec.viewport);
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

      // DOM-resolved boxes are translated into this rect's coordinate space —
      // the screenshot covers the --clip region when set, else the viewport.
      const captureRect = spec.clip ?? { x: 0, y: 0, width: spec.viewport.width, height: spec.viewport.height };

      const page = await ctx.newPage();
      await capturePage(page, spec.target, join(outDir, targetRel), spec.clip);
      // With a session attached, landing on a login page means it expired —
      // fail fast instead of silently diffing two login screens.
      if (opts.statePath && looksLikeLoginRedirect(spec.target, page.url())) {
        throw new Error(
          `target redirected to a login page (${page.url()}) — the session in "${opts.statePath}" has likely expired. Re-run: vigress login --url ${spec.target} --state ${opts.statePath}`,
        );
      }
      const targetBoxes = await resolveBoxes(page, targetItems, captureRect);
      const targetStyles = await resolveStyles(page, targetStyleItems);

      const isBootstrap = bootstrapRuns.has(spec.name);
      const approved = approvedByRun.get(spec.name);

      let full: { mismatchPixels: number; mismatchPercent: number } | undefined;
      let regions: RegionScore[] = [];
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
        target: targetRel,
        targetUrl: spec.target,
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
      const pctNote = isBootstrap ? "bootstrap (new baseline)" : `mismatch ${full?.mismatchPercent ?? 0}%`;
      const stepDiffNote = stepDiffs.length ? ` · ${stepDiffs.filter((d) => d.verdict === "ok").length}/${stepDiffs.length} step diff(s) ok` : "";
      log(opts.quiet || opts.json, `[${spec.name}] ${spec.baselineType} ${pctNote} · ${mode}${stepsNote}${styleNote}${stepDiffNote} · ${regions.length} region(s) -> ${isBootstrap ? targetRel : diffRel}`);
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

  if (opts.updateBaseline) {
    let m = existsSync(manifestFile) ? parseManifest(readFileSync(manifestFile, "utf8")) : emptyManifest();
    const runDirRel = relative(process.cwd(), outDir);
    const approvedAt = new Date().toISOString();
    for (const r of results) m = upsertBaseline(m, r.name, buildManifestEntry(r, runDirRel, approvedAt));
    writeManifest(manifestFile, m);
    writeFileSync(join(outDir, ".approved"), results.map((r) => r.name).join("\n") + "\n");
    log(opts.quiet || opts.json, `baseline updated: ${results.map((r) => r.name).join(", ")}`);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(buildJsonPayload(summary)) + "\n");
  } else {
    log(opts.quiet, `report: ${join(outDir, "report.html")}`);
  }

  if (opts.maxMismatch !== undefined) {
    const worst = results.reduce(
      (m, r) => Math.max(m, r.mismatchPercent ?? 0, ...r.stepDiffs.map((d) => d.mismatchPercent)),
      0,
    );
    if (worst > opts.maxMismatch) return 1;
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

main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`vigress error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
