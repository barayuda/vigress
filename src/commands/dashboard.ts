import { resolve } from "node:path";
import { MANIFEST_PATH } from "../baselines";
import { startDashboard } from "../server";
import type { Ctx } from "./context";

// dashboard subcommand: local web UI over out/ — browse runs, keep/delete.
// Binds 127.0.0.1 only (it deletes files); serves until Ctrl-C.
export async function dashboardCommand({ values, positionals }: Ctx): Promise<number> {
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
    writers: (process.env.VIGRESS_DASHBOARD_WRITERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  });
  process.stdout.write(`vigress dashboard: http://127.0.0.1:${server.port}/ (out: ${baseOut}) — Ctrl-C to stop\n`);
  await new Promise(() => {}); // serve until killed
return 0; // unreachable: the server keeps the process alive until it is killed
}
