import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockIsStale, withManifestLock, LOCK_STALE_MS } from "./manifestLock";
import { emptyManifest, writeManifest, parseManifest } from "./baselines";

const alive = () => true;
const dead = () => false;

describe("lockIsStale", () => {
  const now = 1_000_000;
  it("a fresh lock held by a live process is not stale", () => {
    expect(lockIsStale({ pid: 1, at: now - 1000 }, 1000, alive, now)).toBe(false);
  });
  it("a lock whose process is gone is stale", () => {
    expect(lockIsStale({ pid: 1, at: now - 1000 }, 1000, dead, now)).toBe(true);
  });
  it("a lock older than the limit is stale even if the pid looks alive (pid reuse, a hung process)", () => {
    expect(lockIsStale({ pid: 1, at: now - LOCK_STALE_MS - 1 }, 5, alive, now)).toBe(true);
  });
  it("an unreadable lock file is given a moment (its writer may be mid-write), then treated as stale", () => {
    expect(lockIsStale(null, 100, alive, now)).toBe(false);
    expect(lockIsStale(null, 5000, alive, now)).toBe(true);
  });
});

describe("withManifestLock", () => {
  const mk = () => { const d = mkdtempSync(join(tmpdir(), "vlock-")); return { d, file: join(d, "baselines", "manifest.json") }; };

  it("runs the function, returns its value, and removes the lock afterwards", () => {
    const { d, file } = mk();
    expect(withManifestLock(file, () => 42)).toBe(42);
    expect(existsSync(file + ".lock")).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });
  it("releases the lock when the function throws", () => {
    const { d, file } = mk();
    expect(() => withManifestLock(file, () => { throw new Error("boom"); })).toThrow("boom");
    expect(existsSync(file + ".lock")).toBe(false);
    rmSync(d, { recursive: true, force: true });
  });
  it("a second holder waits, then fails with a clear message instead of corrupting anything", () => {
    const { d, file } = mk();
    withManifestLock(file, () => {
      expect(() => withManifestLock(file, () => 1, { timeoutMs: 150 })).toThrow(/locked by another vigress process/);
    });
    rmSync(d, { recursive: true, force: true });
  });
  it("takes over a stale lock (its process is gone)", () => {
    const { d, file } = mk();
    withManifestLock(file, () => 0); // creates the directory
    writeFileSync(file + ".lock", JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() })); // a pid that does not exist
    expect(withManifestLock(file, () => "ok", { timeoutMs: 2000 })).toBe("ok");
    rmSync(d, { recursive: true, force: true });
  });
  it("many processes doing read-modify-write on the manifest lose no update", () => {
    const { d, file } = mk();
    writeManifest(file, emptyManifest());
    const startAt = Date.now() + 700; // after every process has booted
    const child = `
      import { withManifestLock } from ${JSON.stringify(join(import.meta.dir, "manifestLock"))};
      import { parseManifest, writeManifest } from ${JSON.stringify(join(import.meta.dir, "baselines"))};
      import { readFileSync } from "node:fs";
      const file = ${JSON.stringify(file)};
      while (Date.now() < ${startAt}) {} // all processes start together, so they really contend
      for (let i = 0; i < 12; i++) {
        withManifestLock(file, () => {
          const m = parseManifest(readFileSync(file, "utf8"));
          const n = Object.keys(m.baselines).length;
          Bun.sleepSync(2); // widen the race window
          m.baselines["k" + process.pid + "_" + i] = { storage: "local", approvedAt: "t", approvedFrom: "out/x", viewport: { width: 1, height: 1 }, sourceUrl: "https://x", artifacts: { main: "out/x/a.png", steps: {} } };
          writeManifest(file, m);
        });
      }`;
    const procs = Array.from({ length: 6 }, () => Bun.spawn([process.execPath, "-e", child], { stdout: "ignore", stderr: "pipe" }));
    const codes = procs.map((p) => p.exitCode);
    return Promise.all(procs.map((p) => p.exited)).then((exit) => {
      expect(exit).toEqual([0, 0, 0, 0, 0, 0]);
      expect(Object.keys(parseManifest(readFileSync(file, "utf8")).baselines)).toHaveLength(72); // 6 processes x 12 updates
      expect(existsSync(file + ".lock")).toBe(false);
      void codes;
      rmSync(d, { recursive: true, force: true });
    });
  });
});

describe("writeManifest", () => {
  it("writes atomically: valid JSON afterwards and no temp file left behind", () => {
    const d = mkdtempSync(join(tmpdir(), "vwm-"));
    const file = join(d, "baselines", "manifest.json");
    writeManifest(file, emptyManifest());
    writeManifest(file, emptyManifest());
    expect(parseManifest(readFileSync(file, "utf8")).baselines).toEqual({});
    expect(readdirSync(join(d, "baselines"))).toEqual(["manifest.json"]);
    rmSync(d, { recursive: true, force: true });
  });
});
