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
- Pass `--json`: stdout is a single object `{ schemaVersion: 2, outDir, reportHtml,
  runs:[{ name, mismatchPercent, target, baseline, diff, video,
  regions:[{name,mismatchPercent,verdict,reason,diff}],
  checklist:[{aspect,region,verdict,workaround}] }] }` with absolute
  paths — Read the `diff` PNG; open `reportHtml` for the human view.
- `--quiet` to suppress chatter; `--max-mismatch <pct>` to make it exit non-zero
  (gate). The mismatch % is noisy (token/shell/render differences) — treat the
  diff image + video as the real signal, not a hard pass/fail, unless gating.

## Best practices
- Match the viewport on both sides (`--viewport WxH`, default 1440×900).
- Use `--clip x,y,w,h` to crop to a content region and cut shell noise.
- Reuse one `--state` across runs; re-run `vigress login` when it expires.

## Regions, masks & checklists

A config entry (or a single run) can include fine-grained sub-regions, noise masks, and a structured checklist.

**Config shape (`regions[]`):**
```json
{
  "name": "contact",
  "target": "https://localhost:3000/reports/contact-v2",
  "against": "https://staging.example.com/reports/contact",
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

## Regression workflow

See PLAYBOOK.md for archetype checklists + the known-noise/workarounds catalog.

1. **Determine target + baseline URLs and the archetype.** Inspect the page or ask: is it a report/dashboard, table/list, form, or nav-sidebar?
2. **Read the matching PLAYBOOK.md archetype section.** Note the suggested region selectors and verify-methods for each aspect you need to check.
3. **Inspect the live DOM** to resolve per-side selectors (target app may use `data-testid`; baseline may use BEM classes). Identify dynamic elements (timestamps, live counts, date badges) to add to `mask`.
4. **Write a vigress config** with `regions` (one per checklist aspect), `mask` (one per dynamic element), and a `checklist` array tying each aspect to its region name.
5. **Run:**
   ```bash
   bun run src/cli.ts --config <file> --state auth.state.json --json
   ```
6. **Read the JSON output.** Map each `regions[]` entry's `verdict`/`reason` to the corresponding `checklist[]` item. Report failing aspects with their recommended workaround from PLAYBOOK.md, fix the underlying issue, and re-run.
