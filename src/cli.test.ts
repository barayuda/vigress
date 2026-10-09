import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The CLI as a user runs it, for everything that needs no browser: every subcommand is
// reachable through the dispatch table in cli.ts and fails with the right usage and exit
// code. (Behaviour behind the usage lines is covered by the pure modules' tests.)
const CLI = join(import.meta.dir, "cli.ts");

function vigress(args: string[], cwd: string): { code: number; out: string } {
  const r = Bun.spawnSync([process.execPath, CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

describe("cli dispatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "vcli-"));
  const cases: Array<[string, string[], number, RegExp]> = [
    ["no arguments is the run usage", [], 2, /^Usage: vigress --target/],
    ["login", ["login"], 2, /Usage: vigress login/],
    ["init-config", ["init-config"], 2, /Usage: vigress init-config/],
    ["discover", ["discover"], 2, /Usage: vigress discover/],
    ["approve", ["approve"], 2, /Usage: vigress approve/],
    ["history", ["history"], 2, /Usage: vigress history/],
    ["rollback", ["rollback"], 2, /Usage: vigress rollback/],
    ["prune", ["prune"], 2, /Usage: vigress prune/],
    ["compare", ["compare"], 2, /Usage: vigress compare/],
    ["dashboard with a bad port", ["dashboard", "--port", "99999"], 2, /Usage: vigress dashboard/],
    ["before without a name", ["before"], 2, /Usage: vigress before/],
    ["before without --target", ["before", "x"], 2, /needs --target/],
    ["after without a baseline", ["after", "x"], 1, /no approved baseline 'x'/],
    ["history without a manifest", ["history", "x"], 1, /no baselines manifest/],
    ["rollback without a manifest", ["rollback", "x"], 1, /no baselines manifest/],
    ["prune without a manifest", ["prune", "x"], 1, /no baselines manifest/],
    ["an unknown option is a message, not a stack trace", ["--nope"], 2, /^vigress: Unknown option '--nope'/],
    ["an option value starting with a dash", ["prune", "x", "--keep", "-1"], 2, /--keep=-XYZ/],
    ["a subcommand name that is a JS builtin is just a run", ["__proto__"], 2, /^Usage: vigress --target/],
  ];
  for (const [name, args, code, re] of cases) {
    it(name, () => {
      const r = vigress(args, dir);
      expect(r.code).toBe(code);
      expect(r.out).toMatch(re);
      expect(r.out).not.toContain("    at "); // never a stack trace
    });
  }
  it("cleans up", () => rmSync(dir, { recursive: true, force: true }));
});
