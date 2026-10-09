import type { Manifest } from "./baselines";

// `vigress before <name>` / `vigress after <name>`: a before/after check as two short
// commands over what already exists. This only decides which options to add to a normal
// single run (the CLI then runs it as usual), so there is no second run pipeline.
//   before: capture --target and bless it as baseline <name> (bootstrap, or re-bless;
//           the replaced version is kept in history).
//   after:  re-check against baseline <name>; target, viewport and capture mode default
//           from the baseline. It never blesses anything.

export type BeforeAfterPlan =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; code: 1 | 2; message: string };

export function prepareBeforeAfter(
  cmd: "before" | "after",
  name: string | undefined,
  values: Record<string, unknown>,
  manifest: Manifest | null,
): BeforeAfterPlan {
  if (!name) return { ok: false, code: 2, message: `Usage: vigress ${cmd} <name> ${cmd === "before" ? "--target <url> " : ""}[--viewport WxH] [--full-page] [--state f] [--json]` };
  if (values.against !== undefined) {
    return { ok: false, code: 2, message: `'${cmd}' sets --against itself (baseline:${name}); drop --against` };
  }
  const entry = manifest && Object.hasOwn(manifest.baselines, name) ? manifest.baselines[name] : undefined;

  // The baseline's own viewport and capture mode are the defaults, so a plain run matches it.
  const patch: Record<string, unknown> = { against: `baseline:${name}`, name };
  if (entry) {
    if (values.viewport === undefined) patch.viewport = `${entry.viewport.width}x${entry.viewport.height}`;
    if (entry.fullPage && values["full-page"] !== true) patch["full-page"] = true;
  }

  if (cmd === "before") {
    if (typeof values.target !== "string" || !values.target) {
      return { ok: false, code: 2, message: "vigress before needs --target <url>: the page to capture as the starting point" };
    }
    patch["update-baseline"] = true;
    return { ok: true, patch };
  }

  if (values["update-baseline"] === true) {
    return { ok: false, code: 2, message: "'after' never blesses anything; use `vigress before` (or `approve`) to change the baseline" };
  }
  if (!entry) {
    return { ok: false, code: 1, message: `no approved baseline '${name}' — capture the starting point first: vigress before ${name} --target <url>` };
  }
  if (typeof values.target !== "string" || !values.target) {
    if (!/^https?:\/\/\S+$/.test(entry.sourceUrl)) {
      return { ok: false, code: 1, message: `baseline '${name}' has no http(s) source URL; pass --target <url>` };
    }
    patch.target = entry.sourceUrl;
  }
  return { ok: true, patch };
}
