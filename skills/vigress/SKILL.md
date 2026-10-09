---
name: vigress
description: Capture a target URL and compare it (pixel diff + video) against a baseline — another URL, a saved image (e.g. a Figma export), a Figma frame via API, or a previously approved capture — using the vigress CLI. Use when verifying a migration or redesign against staging or a design, checking a full page (--full-page), guarding a page against regressions after blessing a baseline (approve), recording a UI walkthrough, or when the user mentions visual regression, pixel diff, screenshot parity, fullcheck, or Figma comparison. Not for unit tests or DOM-only assertions.
argument-hint: "<action, e.g. 'compare localhost:3000/x to staging' | 'diff against figma:KEY/NODE' | 'login to staging' | 'run config batch.json'>"
---

# vigress — visual regression (URL / image / Figma)

A Bun CLI (this repo; or `vigress` if linked with `bun link`). Captures a
**target URL** and diffs it against a **baseline**, emitting pixel-diff images,
a video, an HTML report, and (for agents) a JSON payload. No deps in any app
repo; uses system Chrome.

## Rules for agents (read first)

0. **Check Bun first.** Run `command -v bun`. If it is missing, **stop and ask
   the user before installing anything** — say what you will install and how.
   Install only after an explicit yes, then verify with `bun --version`:
   - macOS with Homebrew: `brew install oven-sh/bun/bun`
   - macOS/Linux otherwise: `curl -fsSL https://bun.sh/install | bash`, which
     writes to `~/.bun` and edits the shell profile (tell the user this; they
     may need to open a new shell or `export PATH="$HOME/.bun/bin:$PATH"`)
   - Windows: ask the user to follow https://bun.sh/docs/installation
   If the user declines, do not work around it with npm/node; the CLI needs Bun.
   Then run `bun install` once in the CLI folder (also ask first; it writes
   `node_modules`).
1. **Never run `login` or `dashboard` yourself.** `login` blocks on a human
   signing in and pressing Enter; `dashboard` serves until Ctrl-C. Both hang an
   agent session — ask the human to run them. `login --check` is the safe,
   non-interactive session test.
2. **`*.state.json` holds live credentials.** Never `cat`, print or commit it.
3. **Always pass `--json`** and take every artifact path from the payload — each
   run writes to a timestamped folder, so never assume `out/`. Read the `diff`
   PNG; point the human at `reportHtml`.
4. **The mismatch % is a noisy signal, not a verdict** (fonts, shell, render
   differences). Judge by the diff image and video; only gate when asked or in CI.
5. **`--update-baseline` blesses even a failing run.** Never leave it on in CI,
   and ask before re-blessing an existing baseline.
6. **Project configs live in the project repo**, not in this skill — the skill is
   project-agnostic.

## Which command?

| Goal | Command |
|---|---|
| Compare one page to staging / an image / a Figma frame | `--target <url> --against <url\|img.png\|figma:KEY/NODE>` |
| Check several pages, or parity + functionality in one report | `--config <file>.json` (see `references/fullcheck-and-discover.md`) |
| Get a starter config | `init-config <page>` (placeholders) or `discover <page>` (from the live DOM) |
| Is the saved session still valid? | `login --url <u> --state <f> --check --json` |
| Bless a good run as the baseline | `approve <name>` / `approve --all` |
| Guard against regressions after that | `--against baseline:<name>` |
| See, restore or forget earlier approved versions | `history <name>` / `rollback <name> [--to N]` / `prune <name> [--keep N]` |
| Before/after a change you are about to make | `before <name> --target <url>`, change, then `after <name>` (see `references/baselines.md`) |
| Before/after of runs you already have, no baseline | `compare <before-run> <after-run> [--name <run>] [--diff out.png] [--json]` (see `references/baselines.md`) |
| Browse, keep, delete old runs | `dashboard` (human only — blocks) |

## Quick start

```bash
bun install                              # first time
# Uses system Chrome; for Microsoft Edge export VIGRESS_BROWSER=msedge
bun run src/cli.ts login --url <app-url> --state auth.state.json   # human, if login needed
bun run src/cli.ts --target <url> --against <url|img.png|figma:KEY/NODE|baseline:<name>> \
  --state auth.state.json --out out --json
```

Pre-flight the session before a long run:

```bash
bun run src/cli.ts login --url <app-url> --state auth.state.json --check --json
# → {"url":…,"state":…,"finalUrl":…,"loggedIn":true|false} · exit 0 = ok, 1 = expired
```

If a capture with `--state` lands on a login page mid-run, vigress aborts with a
"session has likely expired" error rather than diffing login screens.

Each run writes to `out/<YYYY-MM-DD_HH-MM-SS>/`, so previous runs are never
overwritten. Inside: `<name>.{target,baseline,diff}.png`, `video/*.webm`,
`summary.json`, `checklist.md`, `report.html`. `--no-timestamp` writes straight
into `out/` (fixed path, overwrites). **Video records by default** (single and
batch); `--no-video` or `"video": false` on a batch entry skips it.

## Baselines (auto-detected from `--against`)
- `https://…` → capture that URL  ·  `./file.png` → use that image  ·
  `figma:FILEKEY/NODEID` → Figma REST export at 1× (needs `FIGMA_TOKEN`)  ·
  `baseline:<name>` → approved capture from `baselines/manifest.json`
  (see `references/baselines.md`).

## Batch

`bun run src/cli.ts --config comparisons.json` — a JSON array of entries. Only
`target` and `against` are required:

```json
[{ "name": "contact", "target": "<url>", "against": "<url|img|figma:…|baseline:…>",
   "viewport": { "width": 1440, "height": 900 }, "clip": { "x": 0, "y": 0, "width": 800, "height": 600 },
   "fullPage": false, "video": true,
   "regions": [], "mask": [], "checklist": [], "steps": [] }]
```

`--region`, `--mask` and `--step` flags apply to single runs only; with
`--config`, put them in the file (vigress warns on stderr if you mix them).

## Full-page capture

`--full-page` (or `"fullPage": true` on an entry) screenshots the whole
scrollable page instead of the viewport. vigress first steps down the page one
viewport at a time (capped at 60 steps) so lazy images and scroll-triggered
content load, and pins `[data-aos]` elements to their final state (AOS re-hides
sections that leave the viewport). Other scroll-reveal libraries are not handled.

- `--clip` is ignored in this mode.
- Both the target and a URL baseline are captured full-page; region/mask boxes
  are measured against each side's own page height, so regions below the fold work.
- The diff compares only the common top area. If the two pages differ in height,
  `heightDelta` (target minus baseline, px) reports how much went uncompared —
  check it, or gate with `--max-height-delta <px>`.
- A `baseline:` run must use the same setting the baseline was approved with
  (exit 2 otherwise).

## For AI agents

`--json` prints one object `{ schemaVersion: 10, outDir, reportHtml, git?:{commit,branch?,dirty,url?},
runs:[{ name, baselineType, viewport, mismatchPixels?, mismatchPercent?, heightDelta?,
target, targetUrl, fullPage?, baseline?, diff?, video?, bootstrap?,
mode, shots:[], steps:[{index,action,selector?,check,status,error?}],
stepDiffs:[{name,mismatchPercent,diff?,verdict:"ok"|"mismatch"|"new"|"missing"}],
regions:[{name,mismatchPercent,verdict,reason,diff,styleDiff?:[{property,target,baseline,match}]}],
checklist:[{aspect,region,verdict,workaround}] }] }` with absolute paths.

- On **bootstrap** runs (`bootstrap: true`) `baseline`, `diff`, `mismatchPixels`
  and `mismatchPercent` are absent — the run captured and approved but had
  nothing to diff against.
- `stepDiffs[]` is populated only for `baseline:` runs with approved step shots.
- `--quiet` suppresses the log lines.

### Gates and exit codes

Nothing fails on the mismatch % unless you ask. Exit `0` ok · `1` a gate tripped
or an unexpected error · `2` usage error (also: missing or mismatched baseline).

| Flag | Trips (exit 1) when |
|---|---|
| `--max-mismatch <pct>` | the worst of any run's or step diff's mismatch % exceeds it |
| `--max-height-delta <px>` | a run's target and baseline heights differ by more than this |
| `--require-steps` | any check step failed (`check: true`, `status: "failed"`) or an approved step is `missing` |
| `--require-style` | any region's `styleDiff` has a `match: false` (see `references/regions-and-style.md`) |

`new` step-diff verdicts (steps added since approval) never trip a gate.

### Reading a result

| You see | Do this |
|---|---|
| Region `fail` / `geometry` | box width or height differs by >2px — a layout change; read that region's diff PNG |
| Region `fail` / `content` | pixels over `maxMismatch`; check the diff PNG, then `styleDiff` for the cause |
| Region `unresolved` | the selector matched nothing on one side (or is below the fold on a viewport capture) — fix the selector or use `--full-page` |
| Region `pass` but `styleDiff` mismatches | a real colour/spacing regression hiding under the pixel threshold |
| `heightDelta` ≠ 0 | part of the page was not compared; fix the height difference or accept it knowingly |
| `steps[]` has a failed check | the control wasn't found or didn't do the asserted thing |
| Exit `2` on a `baseline:` run | no baseline yet (bootstrap with `--update-baseline`), or viewport / `--full-page` differs from the approved one |

## Environment

Flags always win over env vars (Bun loads `.env` from the working directory).

| Variable | Meaning |
|---|---|
| `FIGMA_TOKEN` | needed for `figma:` baselines |
| `VIGRESS_OUT` / `VIGRESS_STATE` / `VIGRESS_VIEWPORT` | defaults for `--out` / `--state` / `--viewport` |
| `VIGRESS_DASHBOARD_WRITERS` | comma-separated Tailscale logins allowed to change things through `tailscale serve` (dashboard, human only; unset = tailnet read-only) |
| `VIGRESS_BROWSER` | `chrome` (default), `msedge`, `chrome-beta`, `msedge-beta` |
| `VIGRESS_SETTLE` | ms to wait for the network to go idle (default 8000); SPAs with persistent sockets never reach it, so it is only a cap |
| `VIGRESS_DWELL` | ms to hold after each step so the video shows it (default 1000) |

## Best practices
- Match the viewport on both sides (`--viewport WxH`, default 1440×900).
- Use `--clip x,y,w,h` to crop to a content region and cut shell noise.
- `--threshold <0-1>` is pixelmatch's per-pixel colour tolerance (default 0.1) —
  prefer per-region `maxMismatch` over loosening it.
- Reuse one `--state` across runs; ask the human to re-run `login` when it expires.

## Reference (read only when you need it)

These live next to this file in `references/`; each starts with when to read it.

| Need | Read |
|---|---|
| Per-region scoring, noise masks, checklists, exact style (colour/size/spacing) diffs | `references/regions-and-style.md` |
| Click/fill/assert/screenshot steps, functionality checks, dwell time | `references/steps.md` |
| A one-page full check config; `init-config` and `discover` | `references/fullcheck-and-discover.md` |
| `approve`, `baseline:` refs, `--update-baseline`, step-diff verdicts, history/`rollback`/`prune`, `before`/`after`, `compare` | `references/baselines.md` |
| Page-type checklists (report, table, form, nav) and the known-noise catalog | `PLAYBOOK.md` |

## Regression workflow

See PLAYBOOK.md for archetype checklists + the known-noise/workarounds catalog.

1. **Determine target + baseline URLs and the archetype.** Inspect the page or ask: is it a report/dashboard, table/list, form, or nav-sidebar?
2. **Read the matching PLAYBOOK.md archetype section.** Note the suggested region selectors and verify-methods for each aspect you need to check.
3. **Inspect the live DOM** to resolve per-side selectors (target app may use `data-testid`; baseline may use BEM classes). Identify dynamic elements (timestamps, live counts, date badges) to add to `mask`. Or run `vigress discover <page> --target <url> --against <url>` to generate a starting config from a live DOM crawl instead of inspecting by hand — review its output before relying on it (see `references/fullcheck-and-discover.md`).
4. **Write a vigress config** with `regions` (one per checklist aspect), `mask` (one per dynamic element), and a `checklist` array tying each aspect to its region name. To make it a **full check**, also add `steps` covering every filter and download (see `references/fullcheck-and-discover.md`) and name the file `<page>.fullcheck.json`. Add `"style": true` on any region where color/spacing is in question (e.g. after a design-system migration) — see `references/regions-and-style.md`.
5. **Run:**
   ```bash
   bun run src/cli.ts --config <file> --state auth.state.json --json
   ```
6. **Read the JSON output.** Map each `regions[]` entry's `verdict`/`reason` to the corresponding `checklist[]` item. A region can `pass` on pixels but still have `styleDiff` mismatches — check both. Report failing aspects with their recommended workaround from PLAYBOOK.md, fix the underlying issue, and re-run.
