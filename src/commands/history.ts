import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MANIFEST_PATH, parseManifest, writeManifest, rollbackBaseline, versionArtifacts } from "../baselines";
import { withManifestLock } from "../manifestLock";
import type { Ctx } from "./context";

// history / rollback subcommands: earlier approved versions of a baseline. Approving a name
// again keeps the version it replaces; rollback restores one (the replaced version is kept too).
export async function historyCommand({ values, positionals }: Ctx): Promise<number> {
  const cmd = positionals[0];
  const name = positionals[1];
  if (!name) {
    process.stderr.write(cmd === "history" ? "Usage: vigress history <name>\n" : "Usage: vigress rollback <name> [--to <index>]   (see `vigress history <name>` for indexes; default 0 = the previous version)\n");
    return 2;
  }
  const manifestFile = resolve(MANIFEST_PATH);
  if (!existsSync(manifestFile)) {
    process.stderr.write(`vigress ${cmd}: no baselines manifest at ${MANIFEST_PATH}\n`);
    return 1;
  }
  const manifest = parseManifest(readFileSync(manifestFile, "utf8"));
  const exists = (p: string): boolean => existsSync(resolve(p));
  if (cmd === "history") {
    if (!Object.hasOwn(manifest.baselines, name)) {
      process.stderr.write(`vigress history: no approved baseline '${name}' — has: ${Object.keys(manifest.baselines).join(", ") || "none"}\n`);
      return 1;
    }
    const { history = [], ...current } = manifest.baselines[name];
    const gone = (v: Parameters<typeof versionArtifacts>[0]): string => (versionArtifacts(v).some((p) => !exists(p)) ? "  (files missing)" : "");
    process.stdout.write(`${name}: current — approved ${current.approvedAt} from ${current.approvedFrom}${gone(current)}\n`);
    history.forEach((v, i) => process.stdout.write(`  [${i}] ${v.approvedAt} from ${v.approvedFrom}${gone(v)}\n`));
    if (!history.length) process.stdout.write("  no previous versions\n");
    return 0;
  }
  const to = typeof values.to === "string" ? Number(values.to) : 0;
  // Re-read inside the lock: read, change and write must be one step.
  const res = withManifestLock(manifestFile, () => {
    const r = rollbackBaseline(parseManifest(readFileSync(manifestFile, "utf8")), name, to, exists);
    if (r.ok) writeManifest(manifestFile, r.manifest);
    return r;
  });
  if (!res.ok) {
    process.stderr.write(`vigress rollback: ${res.message}\n`);
    return 1;
  }
  process.stdout.write(`rolled '${name}' back to the version approved ${res.restored.approvedAt} from ${res.restored.approvedFrom}\nthe version it replaced is kept: run \`vigress history ${name}\`\n`);
  return 0;
}
