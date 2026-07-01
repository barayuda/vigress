---
name: vigress
description: Capture a target URL and compare it (pixel diff + video) against a baseline — another URL, a saved image (e.g. a Figma export), or a Figma frame via API — using the vigress CLI. Use when verifying a migration or redesign against staging or a design, recording a UI walkthrough, or when the user mentions visual regression, pixel diff, screenshot parity, or Figma comparison.
argument-hint: "<action, e.g. 'compare localhost:3000/x to staging' | 'diff against figma:KEY/NODE' | 'login to staging' | 'run config batch.json'>"
---

# vigress — visual regression (URL / image / Figma)

A Bun CLI at `<workspace>/vigress/`. Captures a **target URL** and diffs it against
a **baseline**, emitting pixel-diff images, a video, an HTML report, and (for
agents) a JSON payload. No deps in any app repo; uses system Chrome.

## Quick start

```bash
cd <workspace>/vigress
bun install                              # first time
bun run src/cli.ts login --url <app-url> --state auth.state.json   # if login needed
bun run src/cli.ts --target <url> --against <url|img.png|figma:KEY/NODE> \
  --state auth.state.json --out out --json
```

Each run writes to a timestamped subfolder `out/<YYYY-MM-DD_HH-MM-SS>/`, so
previous runs are never overwritten (the `--json` payload + log line print the
exact path). Inside: `<name>.{target,baseline,diff}.png`, `video/*.webm`,
`summary.json`, `report.html` (open it to review). Pass `--no-timestamp` to
write straight into `out/` (fixed path, overwrites).

**All artifacts (including video) record by default** — single-run and batch.
Pass `--no-video` to skip the `.webm`, or set `"video": false` on a batch entry.

## Baselines (auto-detected from `--against`)
- `https://…` → capture that URL  ·  `./file.png` → use that image  ·
  `figma:FILEKEY/NODEID` → Figma REST export (needs `FIGMA_TOKEN`).

## Batch
`bun run src/cli.ts --config comparisons.json` where the file is
`[{ "name","target","against","clip?","viewport?" }, …]`.

## For AI agents
- Pass `--json`: stdout is a single object `{ schemaVersion: 5, outDir, reportHtml,
  runs:[{ name, mismatchPercent, target, baseline, diff, video, mode, shots:[],
  steps:[{index,action,selector?,check,status,error?}],
  regions:[{name,mismatchPercent,verdict,reason,diff,styleDiff?:[{property,target,baseline,match}]}],
  checklist:[{aspect,region,verdict,workaround}] }] }` with absolute
  paths — Read the `diff` PNG; open `reportHtml` for the human view.
- `--quiet` to suppress chatter; `--max-mismatch <pct>` to make it exit non-zero
  (gate). The mismatch % is noisy (token/shell/render differences) — treat the
  diff image + video as the real signal, not a hard pass/fail, unless gating.
- `--require-steps` exits non-zero if any functionality check step failed (any
  `steps[]` entry with `check: true` has `status: "failed"`). Combines with
  `--max-mismatch`.
- `--require-style` exits non-zero if any region's `styleDiff` has a `match: false`
  entry. See "Style diffing" below — pixel mismatch alone can pass while a real
  color/spacing regression hides under the threshold.

## Best practices
- Match the viewport on both sides (`--viewport WxH`, default 1440×900).
- Use `--clip x,y,w,h` to crop to a content region and cut shell noise.
- Reuse one `--state` across runs; re-run `vigress login` when it expires.

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

### Per-step pass/fail results

Each step reports a result. `summary.json` and `--json` are **schemaVersion 5**
and include `mode`, `shots[]`, and `steps[]` on each run entry. The `steps[]`
shape is `{index, action, selector?, check, status:"ok"|"failed", error?}`:

- `check: true` for selector-dependent actions (`click`, `fill`, `select`,
  `hover`; `press`/`scroll`/`waitFor` when a `selector` is given) — these count
  as **functionality checks**.
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
