import { existsSync, readdirSync, readFileSync, statSync, rmSync, unlinkSync, writeFileSync, realpathSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { buildRunIndex, buildRunDetail, parseRunFilter, filterRuns, buildBaselineIndex, referencedRunDirs, cleanupSelection, isWriteAllowed, safeChildPath, safeDecode, type RunDirInfo, type RunIndexEntry } from "./dashboard";
import { buildDashboardHtml } from "./dashboardHtml";
import { parseManifest, emptyManifest, writeManifest, approveRuns, type Manifest } from "./baselines";
import type { Summary } from "./types";
import { isRunnableConfigName, listRunnableConfigs, canStart, startJob, finishJob, appendTail, configRunArgs, baselineRunArgs, JOB_TIMEOUT_MS, type Job } from "./jobs";

// Thin I/O layer: scans out/, reads markers/manifest, serves artifacts, and
// executes guarded deletes. All decisions (locking, cleanup selection, path
// safety) live in dashboard.ts where they are unit-tested.

export interface DashboardOpts {
  outDirAbs: string; // absolute out/ dir
  port: number;
  rootDir: string; // repo root (cwd) — must match the cwd used when running approve, since manifest paths are relative to it
  manifestFile: string; // absolute path to baselines/manifest.json
  writers: string[]; // Tailscale logins allowed to change things via `tailscale serve` (VIGRESS_DASHBOARD_WRITERS)
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    try {
      if (e.isDirectory()) total += dirSizeBytes(p);
      else if (e.isFile()) total += statSync(p).size;
    } catch {
      // entry vanished mid-scan (concurrent delete) — count it as gone
    }
  }
  return total;
}

function readSummary(runDirAbs: string): Summary | null {
  try {
    const raw = JSON.parse(readFileSync(join(runDirAbs, "summary.json"), "utf8")) as Summary;
    // Treat old schema summaries whose run entries lack steps/stepDiffs/regions as unreadable
    // so buildRunIndex doesn't crash iterating them.
    const hasRequiredFields = Array.isArray(raw.runs) && raw.runs.every(
      (r) => Array.isArray(r.steps) && Array.isArray(r.stepDiffs) && Array.isArray(r.regions),
    );
    return hasRequiredFields ? raw : null;
  } catch {
    return null;
  }
}

function scanRunDirs(o: DashboardOpts): RunDirInfo[] {
  if (!existsSync(o.outDirAbs)) return [];
  return readdirSync(o.outDirAbs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d): RunDirInfo => {
      const abs = join(o.outDirAbs, d.name);
      const summary = readSummary(abs); // null = unreadable/legacy — still listed, still cleanable
      return {
        dirName: d.name,
        relPath: relative(o.rootDir, abs),
        mtimeMs: statSync(abs).mtimeMs,
        sizeBytes: dirSizeBytes(abs),
        keep: existsSync(join(abs, ".keep")),
        summary,
      };
    });
}

function loadManifest(o: DashboardOpts): Manifest | null {
  // Re-read per request: `vigress approve` may run while the dashboard is up.
  if (!existsSync(o.manifestFile)) return null;
  try {
    return parseManifest(readFileSync(o.manifestFile, "utf8"));
  } catch {
    return null; // corrupt manifest → treat as no locks, deletes stay guarded by 404s
  }
}

function currentIndex(o: DashboardOpts): RunIndexEntry[] {
  return buildRunIndex(scanRunDirs(o), referencedRunDirs(loadManifest(o)));
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// A run-dir URL segment must be a single, non-dotted path component.
function dirSegment(raw: string): string | null {
  const name = safeDecode(raw);
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) return null;
  return name;
}

const CLI_PATH = join(import.meta.dir, "cli.ts");

export function startDashboard(o: DashboardOpts): ReturnType<typeof Bun.serve> {
  // The latest run-a-config job (running or finished); at most one runs at a time.
  let job: Job | null = null;

  const configNames = (): string[] =>
    listRunnableConfigs(readdirSync(o.rootDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name));

  // Runs the CLI as a child process, exactly as `vigress --config <file> --json` would,
  // so the dashboard never re-implements a run. Output is captured, not shown live.
  function launch(label: string, args: string[]): Job {
    const started = startJob(crypto.randomUUID().slice(0, 8), label, new Date().toISOString());
    job = started;
    const proc = Bun.spawn([process.execPath, CLI_PATH, ...args], { cwd: o.rootDir, stdout: "pipe", stderr: "pipe", env: process.env });
    let stdout = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; proc.kill(); }, JOB_TIMEOUT_MS);
    const pump = async (stream: ReadableStream<Uint8Array>, isStdout: boolean): Promise<void> => {
      const dec = new TextDecoder();
      for await (const chunk of stream) {
        const text = dec.decode(chunk, { stream: true });
        if (isStdout) stdout += text;
        else if (job?.id === started.id) job = { ...job, tail: appendTail(job.tail, text) };
      }
    };
    void (async () => {
      await Promise.all([pump(proc.stdout, true), pump(proc.stderr, false)]);
      const code = await proc.exited;
      clearTimeout(timer);
      if (job?.id === started.id) {
        job = finishJob(job, { exitCode: code, now: new Date().toISOString(), stdout, error: timedOut ? "timed out" : undefined });
      }
    })();
    return started;
  }

  // Resolve once at startup — constant for the server's lifetime.
  const realOutDir = realpathSync(o.outDirAbs);

  return Bun.serve({
    hostname: "127.0.0.1", // it can delete files — never exposed beyond localhost
    port: o.port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);

      // Every state-changing route goes through one guard (Origin + Tailscale identity).
      if (req.method !== "GET" && req.method !== "HEAD") {
        const g = isWriteAllowed({
          origin: req.headers.get("origin"),
          host: req.headers.get("host"),
          tailscaleLogin: req.headers.get("tailscale-user-login"),
          writers: o.writers,
        });
        if (!g.ok) return json({ error: g.reason }, 403);
      }

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(buildDashboardHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (req.method === "GET" && url.pathname === "/api/runs") {
        return json(filterRuns(currentIndex(o), parseRunFilter(url.searchParams)));
      }

      // Saved configs the page may run: *.fullcheck.json files in the repo root, nothing else.
      if (req.method === "GET" && url.pathname === "/api/configs") {
        return json({ configs: configNames(), baselines: Object.keys(loadManifest(o)?.baselines ?? {}).sort() });
      }

      // Latest job, plus the run dir name (under out/) once it has produced one.
      if (req.method === "GET" && url.pathname === "/api/jobs") {
        const underOut = job?.outDir && job.outDir.startsWith(o.outDirAbs + "/") ? basename(job.outDir) : undefined;
        return json({ job, runDir: underOut });
      }

      // POST /api/jobs — body {config} (a saved config) or {baseline} (re-check an approved
      // baseline). 409 while one is running.
      if (req.method === "POST" && url.pathname === "/api/jobs") {
        let body: { config?: unknown; baseline?: unknown };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return json({ error: "expected a JSON body" }, 400);
        }
        const config = body.config;
        const baseline = body.baseline;
        if ((config === undefined) === (baseline === undefined)) {
          return json({ error: 'send exactly one of {"config": "<name>.fullcheck.json"} or {"baseline": "<name>"}' }, 400);
        }
        let label: string;
        let args: string[];
        if (config !== undefined) {
          if (typeof config !== "string" || !isRunnableConfigName(config)) {
            return json({ error: "config must be a *.fullcheck.json file name" }, 400);
          }
          if (!configNames().includes(config)) return json({ error: `no such config: ${config}` }, 404);
          label = config;
          args = configRunArgs(join(o.rootDir, config), o.outDirAbs);
        } else {
          if (typeof baseline !== "string" || baseline === "") return json({ error: "baseline must be a name" }, 400);
          const entries = loadManifest(o)?.baselines ?? {};
          if (!Object.hasOwn(entries, baseline)) return json({ error: `no approved baseline: ${baseline}` }, 404);
          const plan = baselineRunArgs(baseline, entries[baseline], o.outDirAbs);
          if (!plan.ok) return json({ error: plan.reason }, 400);
          label = `baseline:${baseline}`;
          args = plan.args;
        }
        const can = canStart(job);
        if (!can.ok) return json({ error: can.reason }, 409);
        return json({ job: launch(label, args) }, 202);
      }

      // GET /api/runs/<dirName>/detail — the reviewable parts of one run's summary.json.
      if (req.method === "GET" && parts[0] === "api" && parts[1] === "runs" && parts[3] === "detail" && parts.length === 4) {
        const dir = dirSegment(parts[2]);
        if (!dir) return new Response("forbidden", { status: 403 });
        const abs = join(o.outDirAbs, dir);
        if (!existsSync(abs)) return json({ error: "run dir not found" }, 404);
        const summary = readSummary(abs);
        if (!summary) return json({ error: "run has no readable summary.json" }, 404);
        return json(buildRunDetail(summary, dir));
      }

      // Approved baselines from the manifest (re-read per request), flagging missing artifacts.
      if (req.method === "GET" && url.pathname === "/api/baselines") {
        return json(buildBaselineIndex(loadManifest(o), (p) => existsSync(join(o.rootDir, p))));
      }

      // GET /files/<dirName>/<artifact path…> — path-traversal-guarded to out/.
      if (req.method === "GET" && parts[0] === "files" && parts.length >= 3) {
        const dir = dirSegment(parts[1]);
        if (!dir) return new Response("forbidden", { status: 403 });
        const decoded = parts.slice(2).map(safeDecode);
        if (decoded.some((s) => s === null)) return new Response("forbidden", { status: 403 });
        const rest = decoded.join("/");
        // Also refuse dot-prefixed path segments (e.g. .keep, .approved).
        if (parts.slice(2).some((seg) => seg.startsWith("."))) {
          return new Response("forbidden", { status: 403 });
        }
        const abs = safeChildPath(join(o.outDirAbs, dir), rest);
        if (!abs) return new Response("forbidden", { status: 403 });
        if (!existsSync(abs)) return new Response("not found", { status: 404 });
        // Lexical check passed; also refuse symlinks that escape out/.
        let realAbs: string;
        try {
          realAbs = realpathSync(abs);
        } catch {
          // File vanished between existsSync and realpathSync (concurrent delete).
          return new Response("not found", { status: 404 });
        }
        if (!realAbs.startsWith(realOutDir + "/")) {
          return new Response("forbidden", { status: 403 });
        }
        return new Response(Bun.file(abs));
      }

      // POST /api/runs/<dirName>/keep — toggle the marker.
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[3] === "keep" && parts.length === 4) {
        const dir = dirSegment(parts[2]);
        if (!dir) return new Response("forbidden", { status: 403 });
        const abs = join(o.outDirAbs, dir);
        if (!existsSync(abs)) return json({ error: "run dir not found" }, 404);
        const marker = join(abs, ".keep");
        if (existsSync(marker)) {
          unlinkSync(marker);
          return json({ keep: false });
        }
        writeFileSync(marker, "");
        return json({ keep: true });
      }

      // POST /api/runs/<dirName>/approve — body {name} or {all:true}. Same rules as
      // `vigress approve` (approveRuns); artifacts stay in place, only the manifest changes.
      if (req.method === "POST" && parts[0] === "api" && parts[1] === "runs" && parts[3] === "approve" && parts.length === 4) {
        const dir = dirSegment(parts[2]);
        if (!dir) return new Response("forbidden", { status: 403 });
        const abs = join(o.outDirAbs, dir);
        if (!existsSync(abs)) return json({ error: "run dir not found" }, 404);
        const summary = readSummary(abs);
        if (!summary) return json({ error: "run has no readable summary.json — re-run the comparison" }, 400);
        let body: { name?: unknown; all?: unknown };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return json({ error: "expected a JSON body" }, 400);
        }
        const which = body.all === true ? null : typeof body.name === "string" && body.name ? body.name : undefined;
        if (which === undefined) return json({ error: 'expected {"name": "<run>"} or {"all": true}' }, 400);
        let manifest: Manifest;
        try {
          // A corrupt manifest must not be silently replaced by an empty one.
          manifest = existsSync(o.manifestFile) ? parseManifest(readFileSync(o.manifestFile, "utf8")) : emptyManifest();
        } catch (e) {
          return json({ error: `manifest unreadable: ${e instanceof Error ? e.message : String(e)}` }, 500);
        }
        const runDirRel = relative(o.rootDir, abs);
        const res = approveRuns(manifest, summary, runDirRel, which, (t) => existsSync(join(abs, t)), new Date().toISOString());
        if (!res.ok) return json({ error: res.message }, 400);
        writeManifest(o.manifestFile, res.manifest);
        writeFileSync(join(abs, ".approved"), res.approved.map((r) => r.name).join("\n") + "\n");
        return json({ approved: res.approved.map((r) => r.name), from: runDirRel });
      }

      // DELETE /api/runs/<dirName> — server-side lock re-check, UI is advisory.
      if (req.method === "DELETE" && parts[0] === "api" && parts[1] === "runs" && parts.length === 3) {
        const dir = dirSegment(parts[2]);
        if (!dir) return new Response("forbidden", { status: 403 });
        const abs = join(o.outDirAbs, dir);
        if (!existsSync(abs)) return json({ error: "run dir not found" }, 404);
        const lockedBy = referencedRunDirs(loadManifest(o)).get(relative(o.rootDir, abs)) ?? [];
        if (lockedBy.length) return json({ error: "referenced by baseline", lockedBy }, 403);
        rmSync(abs, { recursive: true, force: true });
        return json({ deleted: dir });
      }

      // POST /api/cleanup — bulk delete everything neither kept nor locked.
      if (req.method === "POST" && url.pathname === "/api/cleanup") {
        const victims = cleanupSelection(currentIndex(o));
        const deleted: string[] = [];
        let freedBytes = 0;
        for (const v of victims) {
          const abs = join(o.outDirAbs, v.dirName);
          if (!existsSync(abs)) continue; // vanished between index and delete
          rmSync(abs, { recursive: true, force: true });
          deleted.push(v.dirName);
          freedBytes += v.sizeBytes;
        }
        return json({ deleted, freedBytes });
      }

      return new Response("not found", { status: 404 });
    },
  });
}
