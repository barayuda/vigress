# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`vigress` is a standalone visual-regression CLI (Bun + Playwright + pixelmatch). It captures a target URL in real Chrome and diffs it against a baseline — another URL, a saved image, or a Figma frame (`figma:FILEKEY/NODEID` via the Figma REST API). It runs TypeScript directly via Bun; there is **no build step, no bundler, no linter config** — `bin` points straight at `src/cli.ts`.

## Commands

```bash
bun install                          # setup (uses system Chrome; no Playwright browser download)
bun test                             # all unit tests
bun test src/diff.test.ts            # single test file
bun test -t "pattern"                # filter by test name

# Run the CLI
bun run src/cli.ts --target <url> --against <url|img.png|figma:KEY/NODE> [--state auth.state.json] [--json]
bun run src/cli.ts login --url <url> --state auth.state.json          # capture a session (headed Chrome, manual sign-in)
bun run src/cli.ts login --url <url> --state auth.state.json --check  # validate a session non-interactively (exit 0/1)
bun run src/cli.ts --config <page>.fullcheck.json --state auth.state.json --json   # batch mode
bun run src/cli.ts init-config <page> --target <url> --against <ref>  # scaffold a fullcheck config (placeholders, no browser)
bun run src/cli.ts discover <page> --target <url> --against <ref>     # generate a fullcheck config from the live DOM (read-only crawl)
bun run src/cli.ts approve <name> [--run <dir>]                       # bless a run's captures as the approved baseline
bun run src/cli.ts approve --all [--run <dir>]                        # bless every entry in a run (batch configs)
bun run src/cli.ts --config <page>.fullcheck.json --update-baseline   # run normally then auto-approve all results
```

There is no browser-based integration test suite — the capture/diff/video pipeline is verified by running a real comparison and opening `out/<timestamp>/report.html`.

## Architecture

### The pipeline (orchestrated in `src/cli.ts`)

```
parse args/env (config.ts) → launch system Chrome (browser.ts, channel:"chrome")
  → capture target (capture.ts) → resolve baseline (sources/: url | image | figma, auto-detected)
  → pixelmatch diff (diff.ts: crop to common size, paint masks magenta, per-region sub-diffs)
  → interaction phase (steps.ts) — target-only, AFTER the clean diff so parity is unaffected
  → write summary.json + report.html (report.ts, htmlReport.ts) → --json payload (json.ts) → exit code
```

Interaction modes: `static` (`--no-steps`), `steps` (explicit steps configured), or `explore` (the default — auto-opens up to 6 "safe" controls with a safelist, destructive-text skip, URL-change abort, ~12s cap).

### Pure logic vs browser I/O — the key separation

Everything except `browser.ts`, `capture.ts`, `steps.ts`'s Playwright calls, `auth.ts`'s login flow, and `sources/urlSource.ts` is pure and unit-testable **without a browser or network**. Tests are colocated (`src/*.test.ts`) and cover only the pure side: diffing, config/flag parsing, baseline-type detection, region/box math, style diffing, HTML/JSON building. Keep new logic on the pure side when possible so it stays testable.

### The JSON contract (three places to keep in sync)

`SCHEMA_VERSION` lives in `src/types.ts` (currently **7**). `summary.json` uses paths relative to `outDir`; the `--json` stdout payload is the same shape with **absolute** paths (built in `json.ts`). When you change the output shape (including adding a step-action enum value):

1. Bump `SCHEMA_VERSION` in `src/types.ts`.
2. Update the README's schema docs (it has drifted before).
3. Update `skills/vigress/SKILL.md` (the agent-facing doc, symlinked into `~/.claude/skills`) and `skills/vigress/PLAYBOOK.md`. Keep these **project-agnostic** — no app-specific routes or hostnames.

### Config surface

- Batch configs are JSON arrays of run entries; `*.fullcheck.json` files at the repo root are working examples (one page's full parity check: `regions`, `mask`, `checklist`, `steps`).
- CLI repeatable flags (`--region`, `--mask`, `--step`) use `key=value` pairs delimited by `;`, parsed in `config.ts`. They apply to single runs only and are ignored (with a stderr warning) under `--config`.
- Region/mask selectors are per-side: `target` / `baseline` selectors → shared `selector` → raw `clip` fallback. Regions may opt into computed-style diffing via `style` (handled in `style.ts`); masks never do.
- Selector-resolved region/mask boxes are translated into the screenshot's coordinate space via `boxInCapture` in `regions.ts` (handles `--clip` offsets; fully-outside boxes → `unresolved`). Raw `clip` regions/masks pass through untranslated — they're authored against the final screenshot.
- Steps can `assert` outcomes (`state`/`text`/`urlContains`) — the difference between "the selector resolved" and "the control actually worked". `assert` is always a `check: true` step.
- `against: "baseline:<name>"` (config) or `--against baseline:<name>` (CLI) diffs against an approved capture stored in `baselines/manifest.json`. The manifest is git-tracked; paths in it are relative to the repo root and point into `out/` (no copying). Baselines are per-machine until remote storage exists.
- Env vars (Bun auto-loads `.env`; flags always win): `FIGMA_TOKEN`, `VIGRESS_OUT`, `VIGRESS_STATE`, `VIGRESS_VIEWPORT`, `VIGRESS_SETTLE` (networkidle cap, default 8000ms — SPAs with persistent sockets never reach networkidle), `VIGRESS_DWELL` (pause after each step for video legibility, default 1000ms).

### Behaviors that look wrong but are deliberate

- `--update-baseline` blesses even a gate-tripped run (exit 1 still reported) — this is by design (the flag means "bless regardless"). **Never leave it always-on in CI**: a regression would be blessed as the new baseline before the failure surfaced.
- `capture.ts` screenshots with `animations: "disabled"` — without it, perpetual loaders never yield two identical frames and `page.screenshot()` times out.
- Each run writes to a timestamped subdir under `--out` so prior runs persist; `--no-timestamp` overwrites in place.
- Video records **by default** in both single and batch mode; `--no-video` / `"video": false` is the only opt-out.
- The mismatch % is treated as a noisy signal, not a verdict — the tool never fails on it unless `--max-mismatch` is set. Gates: `--max-mismatch` (worst %), `--require-steps` (any failed check step), `--require-style` (any `styleDiff` mismatch). Exit codes: `0` ok, `1` gate tripped or error, `2` usage error.
- `login` preserves existing sessions when logging into a second host (state files are merged, not replaced). `login` is interactive by design (blocks on Enter) — never run it headlessly; `login --check` is the non-interactive session validator (exit 0/1).
- A capture with `--state` that lands on a login page fails fast ("session has likely expired") via `looksLikeLoginRedirect` in `auth.ts` — segment-based URL matching, deliberately not substring matching.
- `auth.state.json` holds live credentials; `*.state.json` is git-ignored — never commit or print its contents.
- Figma baselines export at `scale=1` (`figmaImageApiUrl`) — the target is captured at `deviceScaleFactor: 1`, and the diff crops to the common top-left, so a 2× export would silently compare a quarter of the design.
- `discover` is strictly read-only against the live DOM (never clicks/types); the config it emits is a heuristic starting point, and `init-config` refuses to overwrite an existing fullcheck file.
- `approve` is manifest-only — artifacts stay in place under `out/` (no copying). This makes the approved run dir precious: **deleting an `out/<timestamp>/` dir that was approved breaks the baseline** until re-approved. The `.approved` marker file in the run dir is informational; the manifest is the contract.
- `new` step-diff verdicts (a step added to the run since approval) **never trip any gate** by design — adding a step must not break CI until re-approval. Only `missing` (an approved step absent from the run) trips `--require-steps`.
