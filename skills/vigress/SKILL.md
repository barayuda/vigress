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
| Check several pages, or parity + functionality in one report | `--config <file>.json` (see "Full check") |
| Get a starter config | `init-config <page>` (placeholders) or `discover <page>` (from the live DOM) |
| Is the saved session still valid? | `login --url <u> --state <f> --check --json` |
| Bless a good run as the baseline | `approve <name>` / `approve --all` |
| Guard against regressions after that | `--against baseline:<name>` |
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
  (see "Baseline snapshots").

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
| `--require-style` | any region's `styleDiff` has a `match: false` (see "Style diffing") |

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
| `VIGRESS_BROWSER` | `chrome` (default), `msedge`, `chrome-beta`, `msedge-beta` |
| `VIGRESS_SETTLE` | ms to wait for the network to go idle (default 8000); SPAs with persistent sockets never reach it, so it is only a cap |
| `VIGRESS_DWELL` | ms to hold after each step so the video shows it (default 1000) |

## Best practices
- Match the viewport on both sides (`--viewport WxH`, default 1440×900).
- Use `--clip x,y,w,h` to crop to a content region and cut shell noise.
- `--threshold <0-1>` is pixelmatch's per-pixel colour tolerance (default 0.1) —
  prefer per-region `maxMismatch` over loosening it.
- Reuse one `--state` across runs; ask the human to re-run `login` when it expires.

## Regions, masks & checklists

A config entry (or a single run) can include fine-grained sub-regions, noise masks, and a structured checklist.

**Config shape (`regions[]`):**
```json
{
  "name": "dashboard",
  "target": "http://localhost:3000/dashboard",
  "against": "https://staging.example.com/dashboard",
  "regions": [
    {
      "name": "filter-bar",
      "target": "[data-testid=report-filter]",
      "baseline": ".report__filter",
      "maxMismatch": 2
    },
    {
      "name": "summary-cards",
      "selector": "[data-testid=summary-card]"
    }
  ],
  "mask": [
    { "selector": "[data-testid=date-filter]" }
  ],
  "checklist": [
    { "aspect": "filter-bar width/stretch", "region": "filter-bar", "verdict": "unresolved" },
    { "aspect": "summary-card radius/border/proportions", "region": "summary-cards", "verdict": "unresolved" }
  ]
}
```

**`regions[]` field reference:**

| field | meaning |
|---|---|
| `name` | identifier used in artifact names (`<name>.<region>.diff.png`) |
| `target` | CSS selector on the **target** side (e.g. new app with `data-testid`) |
| `baseline` | CSS selector on the **baseline** side (e.g. legacy staging class) |
| `selector` | CSS selector applied to **both** sides |
| `clip` | raw `{x,y,width,height}` fallback when selectors are absent |
| `maxMismatch` | per-region mismatch threshold % (default 5) |

Precedence per side: `target`/`baseline` → `selector` → `clip`.

**`mask[]` field reference:** same `target`, `baseline`, `selector`, `clip` shape. Matched regions are painted opaque magenta on both sides before diffing — the saved screenshots show the magenta boxes so the report reflects exactly what was compared.

**Region verdicts:** `pass` / `fail` / `unresolved`. Fail reason is `geometry` (width or height differs by >2px) or `content` (`mismatchPercent > maxMismatch`). `unresolved` means the selector matched on neither side.

**CLI flags (single-run, repeatable):**
```
--region "name=filter-bar;target=[data-testid=report-filter];baseline=.report__filter;max=2"
--mask   "selector=[data-testid=date-filter]"
```
Fields are delimited by `;`. For `clip`, keep commas in the value: `clip=277,175,280,205`.

## Style diffing (color, size, spacing)

Pixel diff answers "how many pixels differ" — it does not say **why**. A region
can score `pass` (low mismatch %) while a real color or spacing regression is
still there (e.g. red text vs green text on a tiny element barely moves the
pixel count). Add `style` to a region to get an exact property-by-property
answer instead of eyeballing the diff image.

**Config shape:**
```json
{
  "name": "header",
  "selector": "[data-testid=page-title]",
  "maxMismatch": 4,
  "style": true
}
```
- `"style": true` probes a sensible default set: `color`, `backgroundColor`,
  `fontSize`, `fontWeight`, `fontFamily`, `padding`, `margin`, `border`,
  `borderRadius`, `boxShadow`.
- `"style": ["color", "backgroundColor"]` probes exactly those CSS properties
  (camelCase, as read from `getComputedStyle`).
- Omitted or `false` disables it (default) — no extra browser work for regions
  that don't need it.

**CLI flag:** append `;style=color,backgroundColor` (or `;style=true`) to a
`--region` flag.

**Result (`regions[].styleDiff`):** an array of
`{ property, target, baseline, match }` — `target`/`baseline` are the raw
computed-style strings from each side, `match` is `false` when they genuinely
differ (values are whitespace-normalized first, so `rgb(0,0,0)` and
`rgb(0, 0, 0)` count as equal). `report.html` renders a small monospace table
under the region row: `<region> style: N/M mismatch(es)`, with mismatched rows
in red.

**Scope:** style is probed only on regions with a resolvable selector — never
on masks, and never against an `image`/`figma` baseline (there's no live DOM to
read `getComputedStyle` from; those baselines report no `styleDiff` for the
region). Use it against a **live staging URL** baseline.

**Gating:** `--require-style` exits non-zero if any probed property mismatches.
Combine with `--max-mismatch`/`--require-steps` to gate visual drift,
interaction health, and style parity in one run.

## Interaction steps

By default every run **auto-explores safe controls** (comboboxes, popovers, filter
inputs, aria-expanded buttons) — opening and closing up to 6, recorded in the
video. This exercises the interactive state of the page without any configuration.

Pass `steps` (in the config) or `--step` (CLI, repeatable) to drive a **precise
flow** instead. Use a `screenshot` action to capture the interacted state mid-flow:
the image is saved as `<name>.<shot>.png`, shown in the "flow shots" strip in the
report, and surfaced in `shots[]` in the JSON payload (not diffed).

Pass `--no-steps` to disable interaction entirely and take a **static** capture.

Interaction runs on the **target only**, after the clean diff screenshot — parity
is unaffected. The run `mode` (`static` / `explore` / `steps`) appears in both
the JSON output and the HTML report.

**Default precedence:** `--no-steps` → `static`; `steps`/`--step` present →
`steps`; otherwise → `explore` (auto-explore, the default).

### Asserting outcomes (not just clickability)

A `click` step passing only proves the selector resolved and the click ran —
not that anything happened. Follow interactions with an `assert` step to verify
the **outcome**; a control that "clicks fine" but does nothing then fails the
check (and `--require-steps` gates on it):

```json
"steps": [
  { "action": "click",  "selector": "[data-testid=export-btn]" },
  { "action": "assert", "selector": "[role=dialog]", "state": "visible" },
  { "action": "assert", "selector": ".toast", "text": "Export started" },
  { "action": "assert", "urlContains": "/reports" }
]
```

`assert` needs `selector` and/or `urlContains`; optional `state`
(`visible` default, or `hidden`) and `text` (element text must contain it).
CLI form: `--step "action=assert;selector=[role=dialog];state=visible"`.

### Per-step pass/fail results

Each step reports a result. `summary.json` and `--json` are **schemaVersion 10**
and include `mode`, `shots[]`, `steps[]`, and `stepDiffs[]` on each run entry.
The `steps[]` shape is `{index, action, selector?, check, status:"ok"|"failed", error?}`:

- `check: true` for selector-dependent actions (`click`, `fill`, `select`,
  `hover`; `press`/`scroll`/`waitFor` when a `selector` is given) and always
  for `assert` — these count as **functionality checks**.
- `check: false` for `screenshot` and selector-less `press`/`scroll`/`waitFor`.
- `status: "ok"` means the selector resolved and the action ran; `"failed"` means
  the element was not found or the action threw (the error is in `error`).

`report.html` shows a **Functionality table** per run (`# · action · selector ·
result ✓/✗`, failed rows red) and a header line
`functionality: X/Y checks passed`.

### Gating on failed checks

Pass `--require-steps` to exit non-zero if any check step failed. This combines
with `--max-mismatch` so you can gate on both visual drift and interaction health.

### Controlling dwell time

Set `VIGRESS_DWELL=<ms>` (default `1000`) to control how long vigress holds after
each step before proceeding. A higher value gives the video more time to show
each interaction clearly.

## Full check (UI parity + functionality + UX in one run)

The **full check** is the recommended run for verifying a migrated or
redesigned page against staging: one config that emits all three signals in a
single report — **UI parity** (regions scorecard + masks vs the baseline),
**functionality** (per-step pass/fail for every filter AND download via
`data-testid`), and a dwell-paced **UX walkthrough** video. Use it instead of a
plain visual diff whenever the page has interactive controls worth proving.

**Scaffold a starter config** with `init-config` instead of hand-writing the JSON:
```bash
bun run src/cli.ts init-config <page> --target <url> --against <url|img.png|figma:KEY/NODE> [--viewport WxH]
```
It writes `<page>.fullcheck.json` pre-filled with the URLs, viewport (default
1440×1000), and placeholder `regions`/`mask`/`checklist`/`steps` whose names are
prefixed `REPLACE-`. It never inspects the page or guesses selectors — you edit
the `REPLACE-*` entries with real clip coords + `data-testid`s. It refuses to
overwrite an existing file. Skip it and copy an existing config if that is faster.

Pass `--json` and it emits `{file, page, created, placeholders:[...], next}` (and
`{file, page, created:false, error:"exists"}` + exit 1 if the file exists) — so an
agent gets the path, the exact `REPLACE-*` tokens to resolve, and the run command
without parsing prose.

Name the config `<page>.fullcheck.json`. It combines:
- `regions` + `mask` → the visual parity scorecard (see "Regions, masks & checklists")
- `checklist` → ties each region to a named aspect
- `steps` → drives every interactive control (filters + downloads) so each
  reports an ok/failed functionality check (see "Interaction steps")

```bash
bun run src/cli.ts --config <page>.fullcheck.json --state auth.state.json --json
```

Interaction `steps` run on the **target only**, after the clean diff
screenshot — so functionality `data-testid`s only need to exist on the target
(the new app); the `against` baseline (e.g. staging) needs none, and parity is
unaffected. Open the resulting `report.html`: scorecard table + checklist +
`functionality: X/Y checks passed` + flow-shots + video. Add `--require-steps`
(optionally with `--max-mismatch`) to gate on both interaction health and drift.

A typical full check defines ~4–8 parity regions plus `steps` covering every
filter and download control, producing a scorecard + an `X/Y checks passed`
functionality table + a UX video in one report. Keep the config in the project
repo you are testing (e.g. `<page>.fullcheck.json`), not in this skill — the
skill is project-agnostic; the configs are project-specific.

## Discover (generate a fullcheck config from the live DOM)

`init-config` scaffolds a template with `REPLACE-*` placeholders — it never
inspects the page. `discover` does the opposite: it crawls the live
**`--target`** DOM and writes a run-ready `<page>.fullcheck.json` with real
selectors, regions, and steps, no placeholders.

```bash
bun run src/cli.ts discover <page> --target <url> --against <url> \
  [--viewport WxH] [--state auth.state.json] [--max-steps 20] [--json]
```

**How it works (read-only — never clicks or types during discovery):**
1. Navigates `--target` and waits for it to settle (no `--against` navigation —
   the baseline is written into the config as-is, for the human to review).
2. Runs one in-page DOM scan for functionally-relevant elements (buttons,
   links, inputs, selects, `[data-testid]`, `[role=button]`,
   `[role=combobox]`, `[aria-haspopup]`) — visible, enabled, capped at 200 raw
   matches.
3. Drops destructive-sounding controls (reuses the same `delete`/`log out`/
   `hapus` filter as auto-explore) and de-duplicates by resolved selector.
4. Picks the most stable selector per control: `data-testid` > `id` >
   `aria-label` > a nth-of-type DOM path fallback.
5. Clusters the surviving controls' bounding boxes into horizontal bands
   (`region-1`, `region-2`, …) as a starting parity scorecard.
6. Emits up to `--max-steps` (default 20) `click` + `screenshot` step pairs in
   layout order, closing dropdown-like controls (`role=combobox`, `<select>`,
   `aria-haspopup`) with `Escape` before the next step.

**Output:** the same `<page>.fullcheck.json` shape as `init-config`/`--config`
— open it, review the selectors/region boundaries/step order, adjust
`maxMismatch` per region, then run it like any other full check:
```bash
bun run src/cli.ts --config <page>.fullcheck.json --state auth.state.json --json
```
`--json` on `discover` itself emits `{file, page, created, discovered:
{candidates, safe, steps, regions}, next}` (and the same
`{created:false, error:"exists"}` + exit 1 if the file already exists).

**This is a heuristic starting point, not a verdict.** The region bands are
coarse (layout proximity only, no semantic grouping), step order follows DOM
order (not necessarily the order a human would test filters in), and the
nth-of-type fallback selector is brittle if the DOM shifts. Always review the
generated config before trusting a run's `--require-steps`/`--require-style`
gate on it.

## Baseline snapshots (self-regression)

Beyond parity checks (target vs staging/Figma), `vigress` supports **self-regression**:
bless a known-good run as the approved baseline, then diff future runs against that snapshot.

### Approve a baseline

```bash
# After a satisfactory run
bun run src/cli.ts approve <name>              # auto-finds newest run containing <name>
bun run src/cli.ts approve <name> --run <dir>  # from a specific run dir
bun run src/cli.ts approve --all               # bless every entry in the newest run
```

`approve` writes `baselines/manifest.json` (git-tracked; commit it). Artifacts stay in place
under `out/` — no copying. The approved run dir becomes precious: deleting it breaks the
baseline until re-approved.

### Use a baseline ref

In a config entry: `"against": "baseline:<name>"` (or `--against baseline:<name>` on the CLI).
Guards: no manifest entry → exit 2 ("bootstrap with --update-baseline"); artifact files missing →
exit 1 ("re-approve or run with --update-baseline"); viewport or `--full-page` mismatch vs manifest → exit 2 (run with the same `--full-page` setting the baseline was approved with).

### Bootstrap / `--update-baseline`

```bash
bun run src/cli.ts --config <page>.fullcheck.json --update-baseline
```

Runs normally, then approves all results. If a `baseline:<name>` ref has no manifest entry yet,
that run is a **bootstrap**: diff phase skipped, captured and approved, `bootstrap: true` in the
result. Second run onward diffs normally. Works in both single-run and batch mode.

> **CI footgun:** `--update-baseline` blesses captures even when a gate trips — the run still exits 1, but the manifest now points at the failing state. Never leave it permanently enabled in CI; use it only for bootstrapping or intentional re-blessing.

### Step-diff verdicts

When a `baseline:` run has approved step shots, each named screenshot step is diffed against
its counterpart → `stepDiffs[]`:

| Verdict | Condition | Gate impact |
|---------|-----------|-------------|
| `ok` | Step in run and manifest, within threshold | none |
| `mismatch` | Step in run and manifest, over `--max-mismatch` | trips `--max-mismatch` |
| `new` | Step in run, not in manifest (newly added) | **never gates** |
| `missing` | Step in manifest, not in run (removed/failed) | trips `--require-steps` |

`mismatch` % counts toward `--max-mismatch`'s worst-of. Adding a step never breaks CI
until re-approval.

### Parity → bless → regression

1. Run against staging/Figma to verify parity.
2. Bless that run: `approve <name>` (or re-run with `--update-baseline`).
3. Change `against` to `baseline:<name>`. Future runs diff against the approved state.

## Regression workflow

See PLAYBOOK.md for archetype checklists + the known-noise/workarounds catalog.

1. **Determine target + baseline URLs and the archetype.** Inspect the page or ask: is it a report/dashboard, table/list, form, or nav-sidebar?
2. **Read the matching PLAYBOOK.md archetype section.** Note the suggested region selectors and verify-methods for each aspect you need to check.
3. **Inspect the live DOM** to resolve per-side selectors (target app may use `data-testid`; baseline may use BEM classes). Identify dynamic elements (timestamps, live counts, date badges) to add to `mask`. Or run `vigress discover <page> --target <url> --against <url>` to generate a starting config from a live DOM crawl instead of inspecting by hand — review its output before relying on it (see "Discover").
4. **Write a vigress config** with `regions` (one per checklist aspect), `mask` (one per dynamic element), and a `checklist` array tying each aspect to its region name. To make it a **full check**, also add `steps` covering every filter and download (see "Full check") and name the file `<page>.fullcheck.json`. Add `"style": true` on any region where color/spacing is in question (e.g. after a design-system migration) — see "Style diffing".
5. **Run:**
   ```bash
   bun run src/cli.ts --config <file> --state auth.state.json --json
   ```
6. **Read the JSON output.** Map each `regions[]` entry's `verdict`/`reason` to the corresponding `checklist[]` item. A region can `pass` on pixels but still have `styleDiff` mismatches — check both. Report failing aspects with their recommended workaround from PLAYBOOK.md, fix the underlying issue, and re-run.
