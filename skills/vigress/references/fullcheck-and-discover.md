# vigress reference — full check, init-config and discover

Read this when you are building a one-page parity + functionality config (`<page>.fullcheck.json`), either from a template (`init-config`) or from the live DOM (`discover`). Part of the `vigress` skill; the core rules live in `../SKILL.md`.

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
- `regions` + `mask` → the visual parity scorecard (see `regions-and-style.md`)
- `checklist` → ties each region to a named aspect
- `steps` → drives every interactive control (filters + downloads) so each
  reports an ok/failed functionality check (see `steps.md`)

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
