# vigress reference — regions, masks, checklists and style diffing

Read this when a comparison needs per-region scoring, noise masks, a checklist, or an exact computed-style (colour/size/spacing) answer. Part of the `vigress` skill; the core rules live in `../SKILL.md`.

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
