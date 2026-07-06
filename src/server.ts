import { existsSync, readdirSync, readFileSync, statSync, rmSync, unlinkSync, writeFileSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";
import { buildRunIndex, referencedRunDirs, cleanupSelection, safeChildPath, type RunDirInfo, type RunIndexEntry } from "./dashboard";
import { buildDashboardHtml } from "./dashboardHtml";
import { parseManifest, type Manifest } from "./baselines";
import type { Summary } from "./types";

// Thin I/O layer: scans out/, reads markers/manifest, serves artifacts, and
// executes guarded deletes. All decisions (locking, cleanup selection, path
// safety) live in dashboard.ts where they are unit-tested.

export interface DashboardOpts {
  outDirAbs: string; // absolute out/ dir
  port: number;
  rootDir: string; // repo root (cwd) — relPath base, matching manifest path style
  manifestFile: string; // absolute path to baselines/manifest.json
}

function dirSizeBytes(dir: string): number {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirSizeBytes(p);
    else if (e.isFile()) total += statSync(p).size;
  }
  return total;
}

function scanRunDirs(o: DashboardOpts): RunDirInfo[] {
  if (!existsSync(o.outDirAbs)) return [];
  return readdirSync(o.outDirAbs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d): RunDirInfo => {
      const abs = join(o.outDirAbs, d.name);
      let summary: Summary | null = null;
      try {
        const raw = JSON.parse(readFileSync(join(abs, "summary.json"), "utf8")) as Summary;
        // Treat old schema summaries whose run entries lack steps/stepDiffs as unreadable
        // so buildRunIndex doesn't crash iterating them.
        const hasRequiredFields = Array.isArray(raw.runs) && raw.runs.every(
          (r) => Array.isArray(r.steps) && Array.isArray(r.stepDiffs),
        );
        summary = hasRequiredFields ? raw : null;
      } catch {
        summary = null; // unreadable/legacy — still listed, still cleanable
      }
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
  const name = decodeURIComponent(raw);
  if (!name || name.includes("/") || name.includes("..") || name.startsWith(".")) return null;
  return name;
}

export function startDashboard(o: DashboardOpts): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1", // it can delete files — never exposed beyond localhost
    port: o.port,
    fetch(req: Request): Response {
      const url = new URL(req.url);
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && url.pathname === "/") {
        return new Response(buildDashboardHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
      }

      if (req.method === "GET" && url.pathname === "/api/runs") {
        return json(currentIndex(o));
      }

      // GET /files/<dirName>/<artifact path…> — path-traversal-guarded to out/.
      if (req.method === "GET" && parts[0] === "files" && parts.length >= 3) {
        const dir = dirSegment(parts[1]);
        if (!dir) return new Response("forbidden", { status: 403 });
        const rest = parts.slice(2).map(decodeURIComponent).join("/");
        const abs = safeChildPath(join(o.outDirAbs, dir), rest);
        if (!abs) return new Response("forbidden", { status: 403 });
        if (!existsSync(abs)) return new Response("not found", { status: 404 });
        // Lexical check passed; also refuse symlinks that escape out/.
        if (!realpathSync(abs).startsWith(realpathSync(o.outDirAbs) + "/")) {
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
