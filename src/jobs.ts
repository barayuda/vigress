// Pure core of the dashboard's "run a saved config" feature. server.ts owns the
// I/O (spawning the CLI, streams, timer); every decision lives here so it is
// unit-testable without a browser or a child process.

export type JobState = "running" | "done" | "failed";

export interface Job {
  id: string;
  config: string; // a *.fullcheck.json file name in the repo root, never a path
  state: JobState;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  outDir?: string; // absolute run dir, from the CLI's --json payload
  error?: string; // e.g. "timed out"
  tail: string[]; // last lines of the child's output
}

export const JOB_TAIL_LINES = 40;
export const JOB_TIMEOUT_MS = 15 * 60 * 1000;

// Only plain *.fullcheck.json names are runnable: no separators, no traversal,
// no free-text URLs. The page can only pick from files that already exist in the
// project, so it cannot be used to make the host open arbitrary addresses.
const CONFIG_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.fullcheck\.json$/;

export function isRunnableConfigName(name: string): boolean {
  return CONFIG_NAME.test(name);
}

export function listRunnableConfigs(fileNames: string[]): string[] {
  return fileNames.filter(isRunnableConfigName).sort();
}

// One job at a time: browsers are heavy and two runs would fight over --out.
export function canStart(current: Job | null): { ok: true } | { ok: false; reason: string } {
  if (current?.state === "running") {
    return { ok: false, reason: `a run is already running (${current.config}) — wait for it to finish` };
  }
  return { ok: true };
}

export function startJob(id: string, config: string, now: string): Job {
  return { id, config, state: "running", startedAt: now, tail: [] };
}

export function appendTail(tail: string[], chunk: string, max = JOB_TAIL_LINES): string[] {
  const lines = chunk.replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
  return [...tail, ...lines].slice(-max);
}

// `--json` prints one payload object on stdout; take outDir from it.
export function parseOutDir(stdout: string): string | undefined {
  for (const line of stdout.split("\n").reverse()) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t) as { outDir?: unknown };
      if (typeof v.outDir === "string") return v.outDir;
    } catch {
      /* not the payload line */
    }
  }
  return undefined;
}

export function finishJob(
  job: Job,
  r: { exitCode: number | null; now: string; stdout: string; error?: string },
): Job {
  const ok = r.exitCode === 0 && !r.error;
  return {
    ...job,
    state: ok ? "done" : "failed",
    finishedAt: r.now,
    exitCode: r.exitCode,
    outDir: parseOutDir(r.stdout),
    ...(r.error ? { error: r.error } : {}),
  };
}
