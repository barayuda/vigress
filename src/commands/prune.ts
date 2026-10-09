import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_PATH, parseManifest, writeManifest, pruneHistory } from "../baselines";
import { referencedRunDirs } from "../dashboard";
import type { Ctx } from "./context";

// prune subcommand: forget old baseline versions beyond the newest N (default 3). Deletes no files.
export async function pruneCommand({ values, positionals }: Ctx): Promise<number> {
  const name = positionals[1];
  if (!name) {
    process.stderr.write("Usage: vigress prune <name> [--keep <N>]   (keeps the newest N previous versions, default 3; deletes no files)\n");
    return 2;
  }
  const manifestFile = resolve(MANIFEST_PATH);
  if (!existsSync(manifestFile)) {
    process.stderr.write(`vigress prune: no baselines manifest at ${MANIFEST_PATH}\n`);
    return 1;
  }
  const manifest = parseManifest(readFileSync(manifestFile, "utf8"));
  const res = pruneHistory(manifest, name, typeof values.keep === "string" ? Number(values.keep) : 3);
  if (!res.ok) {
    process.stderr.write(`vigress prune: ${res.message}\n`);
    return 1;
  }
  if (!res.dropped.length) {
    process.stdout.write(`nothing to prune for '${name}'\n`);
    return 0;
  }
  writeManifest(manifestFile, res.manifest);
  const stillLocked = referencedRunDirs(res.manifest);
  const freed = [...new Set(res.dropped.map((v) => v.approvedFrom))].filter((d) => !stillLocked.has(d));
  process.stdout.write(
    `dropped ${res.dropped.length} old version(s) of '${name}'\n` +
    (freed.length ? `no longer locked (delete them in the dashboard if you want the disk back):\n${freed.map((d) => "  " + d).join("\n")}\n` : "their run dirs are still used by another baseline\n"),
  );
  return 0;
}
