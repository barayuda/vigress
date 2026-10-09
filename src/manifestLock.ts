import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";

// baselines/manifest.json is read, changed and rewritten by several writers (approve,
// rollback, prune, --update-baseline from the CLI, and the dashboard). Without a lock two of
// them running at once could each read the same manifest and the second write would silently
// drop the first one's change. This is an advisory lock: a `<manifest>.lock` file created
// exclusively (it fails if it already exists) that holds the owner's pid and time.
//
// ponytail: advisory and local-disk only (not for a network share). Taking over a stale lock
// has a tiny check-then-delete window; it needs a crashed owner AND two new writers at the
// same instant. A proper OS file lock would need a native module.

export const LOCK_STALE_MS = 30_000; // no manifest update takes anywhere near this long
export const LOCK_TIMEOUT_MS = 10_000;
const HALF_WRITTEN_GRACE_MS = 2_000;

export interface LockInfo {
  pid: number;
  at: number;
}

// Pure: may a lock we could not acquire be taken over? `info` is the parsed lock file, or null
// if it was empty/unreadable; `ageMs` is the lock file's age.
export function lockIsStale(info: LockInfo | null, ageMs: number, pidAlive: (pid: number) => boolean, now: number): boolean {
  // An unreadable lock may be one whose owner is between creating and writing it: give it a moment.
  if (!info) return ageMs > HALF_WRITTEN_GRACE_MS;
  return now - info.at > LOCK_STALE_MS || !pidAlive(info.pid);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

function readLock(lock: string): { info: LockInfo | null; ageMs: number } {
  // The age must survive a parse failure: a lock that is still being written is empty for a
  // moment, and must look young, not old (or a live owner would have its lock taken over).
  let ageMs = Infinity; // Infinity = the file is gone
  try {
    ageMs = Date.now() - statSync(lock).mtimeMs;
  } catch {
    /* vanished */
  }
  let info: LockInfo | null = null;
  try {
    const v = JSON.parse(readFileSync(lock, "utf8")) as Partial<LockInfo>;
    if (typeof v.pid === "number" && typeof v.at === "number") info = { pid: v.pid, at: v.at };
  } catch {
    /* empty or half-written */
  }
  return { info, ageMs };
}

// Run `fn` while holding the manifest lock; the lock is released even if `fn` throws. Put the
// whole read -> change -> write sequence inside `fn`.
export function withManifestLock<T>(manifestFile: string, fn: () => T, opts: { timeoutMs?: number } = {}): T {
  const lock = manifestFile + ".lock";
  mkdirSync(dirname(manifestFile), { recursive: true });
  const deadline = Date.now() + (opts.timeoutMs ?? LOCK_TIMEOUT_MS);
  const mine: LockInfo = { pid: process.pid, at: Date.now() };
  for (;;) {
    try {
      const fd = openSync(lock, "wx"); // fails with EEXIST if someone holds it
      writeSync(fd, JSON.stringify(mine));
      closeSync(fd);
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const { info, ageMs } = readLock(lock);
      // The holder released it between our failed create and this read: nothing to judge,
      // just try to take it. (Treating "gone" as stale and deleting would remove the NEW
      // holder's lock if it appeared in between, giving two holders and lost updates.)
      if (ageMs === Infinity) continue;
      if (lockIsStale(info, ageMs, pidAlive, Date.now())) {
        // Delete only if it is still the very lock we judged stale: the same pid and time, or,
        // for an unreadable one, still unreadable and still old (a new lock would be young).
        const again = readLock(lock);
        const same = info
          ? again.info?.pid === info.pid && again.info?.at === info.at
          : again.info === null && again.ageMs > HALF_WRITTEN_GRACE_MS && again.ageMs !== Infinity;
        if (same) {
          try { unlinkSync(lock); } catch { /* someone else removed it first */ }
        }
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `the baselines manifest is locked by another vigress process (pid ${info?.pid ?? "unknown"}); ` +
          `try again in a moment, or delete ${lock} if that process is gone`,
        );
      }
      Bun.sleepSync(25);
    }
  }
  try {
    return fn();
  } finally {
    const cur = readLock(lock).info;
    if (cur?.pid === mine.pid && cur.at === mine.at) {
      try { unlinkSync(lock); } catch { /* already gone */ }
    }
  }
}
