import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { MANIFEST_PATH, parseManifest, emptyManifest, writeManifest, approveRuns, pickNewestRun, type RunDirCandidate } from "../baselines";
import { loadRunDir, loadRunDirs } from "../runs";
import { withManifestLock } from "../manifestLock";
import type { Ctx } from "./context";

// approve subcommand: bless a run's captures as the approved baseline.
// Manifest-only — artifacts stay in place under out/ (no copying).
export async function approveCommand({ values, positionals }: Ctx): Promise<number> {
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
  const manifestFile = resolve(MANIFEST_PATH);
  const runDirRel = relative(process.cwd(), candidate.dir);
  // Read, change and write under one lock so a concurrent writer's update is not lost.
  const res = withManifestLock(manifestFile, () => {
    const manifest = existsSync(manifestFile) ? parseManifest(readFileSync(manifestFile, "utf8")) : emptyManifest();
    const r = approveRuns(
      manifest, candidate.summary, runDirRel, all ? null : name!,
      (targetRel) => existsSync(join(candidate.dir, targetRel)), new Date().toISOString(),
    );
    if (r.ok) writeManifest(manifestFile, r.manifest);
    return r;
  });
  if (!res.ok) {
    process.stderr.write(`vigress approve: ${res.message}\n`);
    return 1;
  }
  const toApprove = res.approved;
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
