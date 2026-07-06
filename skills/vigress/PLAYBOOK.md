# vigress Regression Playbook

Archetype checklists for per-region scoring and the known-noise/workarounds catalog.

---

## Interaction recording

**Default (auto-explore):** every run automatically opens and closes up to 6 safe
controls (dropdowns, filter inputs, comboboxes, aria-expanded buttons). For
report/dashboard and form archetypes this is usually enough to exercise the
filters and inputs in the video — no configuration required.

**Steps (precise flow):** when you need to verify a specific functional state,
author a `steps` array in the config. A typical pattern: open the target control,
add a `screenshot` step to capture the interacted state, then dismiss. Example for
a date filter:

```json
"steps": [
  { "action": "click",      "selector": "[data-testid=period-input]" },
  { "action": "screenshot", "name": "date-open" },
  { "action": "press",      "key": "Escape" }
]
```

The `screenshot` step saves `<name>.date-open.png`, displays it in the "flow
shots" strip in `report.html`, and surfaces it in `shots[]` in the JSON payload.
It is not pixel-diffed — it is a visual record of the interacted state.

Add an `assert` step after an interaction to verify the outcome (element
`state`/`text`, or `urlContains`) — clicking alone only proves the selector
resolved, not that the control worked:

```json
"steps": [
  { "action": "click",  "selector": "[data-testid=period-input]" },
  { "action": "assert", "selector": "[role=listbox]", "state": "visible" },
  { "action": "press",  "key": "Escape" }
]
```

Use steps when auto-explore is insufficient: e.g. switch a channel selector, open
a multi-step filter, or verify a drawer/modal that only opens on a specific
interaction sequence.

**Static capture:** pass `--no-steps` to skip interaction entirely (useful when
the page has animation or the auto-explore triggers noise).

---

## report/dashboard

**Detection hints:** The page contains chart or graph elements (bar, line, pie), summary stat cards, a filter bar near the top, and a sticky page or section header. Routes often include `/reports/`, `/analytics/`, or `/dashboard/`.

| aspect | suggested region selector | verify-method | workaround |
|---|---|---|---|
| chart legend/tick density | `[data-testid="chart-legend"]`, `.chart__legend`, `.recharts-legend-wrapper` | visual-diff-read | Mask the chart area if tick labels include live values; use a region-score on the legend only |
| filter-bar width/stretch | `[data-testid="report-filter"]`, `.report__filter`, `[role="toolbar"]` | region-score | Mask any date-picker badge showing today's date |
| summary-card radius/border/proportions | `[data-testid="summary-card"]`, `.stat-card`, `.kpi-card` | region-score | If cards contain live counts, mask the value element |
| number/percent formatting (`-100%` vs `-100 %`) | `[data-testid="metric-value"]`, `.metric__value`, `.kpi__value` | visual-diff-read | Compare a page state with known static data; mask live count cells |
| sticky header background | `[data-testid="page-header"]`, `.page-header--sticky`, `header[data-sticky]` | computed-style | Use `getComputedStyle` to verify `background-color` resolves to the token hex, not `transparent` |
| section vertical rhythm | `[data-testid="report-body"]`, `.report__sections`, `main > section` | region-score | Clip to the section boundary; geometry-fail will catch height shifts |

---

## table/list

**Detection hints:** The page is dominated by a scrollable table or list with column headers, optional pagination, and an empty-state. Routes often include `/contacts`, `/users`, `/transactions`, or `/inventory`.

| aspect | suggested region selector | verify-method | workaround |
|---|---|---|---|
| sticky header background | `[data-testid="table-header"]`, `thead`, `.data-table__head` | computed-style | Verify `background-color` is opaque; `transparent` makes the sticky header show content behind it |
| column widths/alignment | `[data-testid="table-row"]:first-child`, `tbody tr:first-child`, `.data-table__row--first` | region-score | Clip to the first data row to isolate column geometry from pagination noise |
| row height/zebra striping | `[data-testid="table-body"]`, `tbody`, `.data-table__body` | region-score | Mask any cells with live counts or timestamps |
| pagination control | `[data-testid="pagination"]`, `.pagination`, `nav[aria-label*="pagination"]` | region-score | Mask the "N total" or "page X of Y" text if the count changes between runs |
| empty-state | `[data-testid="empty-state"]`, `.empty-state`, `[role="status"]` | visual-diff-read | Navigate to a filtered/empty view; compare icon + message only |

---

## form

**Detection hints:** The page contains labeled inputs, selects, or textareas with a submit/save button. May include validation messages. Routes often include `/settings`, `/profile`, `/new`, `/edit`, or `/create`.

| aspect | suggested region selector | verify-method | workaround |
|---|---|---|---|
| field spacing | `[data-testid="form-body"]`, `.form__fields`, `form > fieldset` | region-score | Clip to field group to exclude page header offset |
| label/control alignment | `[data-testid="form-field"]`, `.form-field`, `.field-group` | region-score | Use a region per field group to isolate alignment failures |
| validation/error color | `[data-testid="field-error"]`, `.field__error`, `[role="alert"]` | computed-style | Trigger validation before capture; verify `color` resolves to the error token hex |
| button variant + disabled state | `[data-testid="form-submit"]`, `button[type="submit"]`, `.btn--primary` | visual-diff-read | Read the diff PNG around the button area; check both enabled and disabled states |
| focus ring | `[data-testid="form-field"]:focus-within`, `.form-field--focused` | computed-style | Tab to the field before capture; verify `outline` or `box-shadow` is present and correct color |

---

## nav-sidebar

**Detection hints:** A persistent vertical navigation panel on the left (or collapsed drawer) with icon+label items, an active-item highlight, and possibly section headers. Routes share the sidebar across the app.

| aspect | suggested region selector | verify-method | workaround |
|---|---|---|---|
| active-item highlight (matchPaths) | `[data-testid="nav-item--active"]`, `.nav-item--active`, `[aria-current="page"]` | region-score | Navigate to the route that should activate the item before capture |
| label casing/wording | `[data-testid="nav-sidebar"]`, `.sidebar__nav`, `nav[aria-label*="main"]` | visual-diff-read | Read the diff PNG for text changes; computed-style won't catch wording |
| item set (flag newer-than-baseline items as *expected*, not regressions) | `[data-testid="nav-sidebar"]`, `.sidebar__nav` | visual-diff-read | Add new items to the checklist with `verdict: expected`; do not score them as failures |
| icon set | `[data-testid="nav-item"]`, `.nav-item`, `.sidebar__item` | visual-diff-read | Mask icon cells individually if icons differ by design intent |
| width | `[data-testid="nav-sidebar"]`, `.sidebar`, `aside[role="navigation"]` | region-score | Geometry-fail triggers if width shifts >2px; check CSS variable resolves correctly |

---

## Known-noise & workarounds catalog

| symptom | how to neutralize |
|---|---|
| Design-system tokens not injected on `localhost` — colors differ from staging | Detect via `getComputedStyle(documentElement).getPropertyValue('--<your-token-name>')` returning `""` or the raw variable string. Fix: use `var(--token, #hex)` inline fallbacks, or replace with literal hex for canvas comparisons. |
| Sticky header/footer shows content bleed-through — `transparent` background | Ensure the sticky element has an opaque `background-color` (the token must resolve). Use `computed-style` verify-method; mask if the background token is intentionally transparent and the bleed is expected. |
| Dynamic content (timestamps, live counts, "Today (date)") inflates mismatch | Add a `mask` entry targeting the dynamic element: `{ "selector": "[data-testid=date-filter]" }`. The mask paints both sides opaque magenta before diffing, so the element is excluded. |
| `networkidle` never settles — MQTT/long-poll connections keep the network busy | `vigress` proceeds after a timeout; this is expected behavior. The capture is taken after the page-load timeout, not strictly at networkidle. No action needed; note it in the run context. |
| Font anti-aliasing/sub-pixel rendering differs between environments | Set a per-region `maxMismatch` tolerance (e.g. `"maxMismatch": 1`) rather than 0. A threshold of 0 will fail on any sub-pixel AA difference. |
| Scrollbar width differs between OS/browser (adds ~15px to layout) | Use `clip` to stay inside the content area and exclude the scrollbar gutter, or add a mask targeting the scrollbar region. |

---

## Parity → bless → regression

After a successful parity check (target vs staging/Figma), switch to self-regression
to guard against future regressions without re-comparing to the original reference.

### 1 — Parity check

Run the full check against the reference (staging URL or Figma baseline) and confirm
all regions and steps pass to your satisfaction.

### 2 — Bless the run

```bash
# Approve by name (auto-finds the newest run)
bun run src/cli.ts approve <name>

# Or bootstrap via --update-baseline (no separate approve step needed)
bun run src/cli.ts --config <page>.fullcheck.json --state auth.state.json --update-baseline
```

`approve` writes `baselines/manifest.json` — commit it. The approved `out/<timestamp>/`
dir must not be deleted (it holds the artifacts the manifest points at).

### 3 — Regression config

Change `against` to `baseline:<name>` in the config (or use a separate regression config):

```json
{ "name": "contact", "target": "https://app.example.com/contact", "against": "baseline:contact" }
```

Run with gates: `--max-mismatch 2 --require-steps`. Step diffs against approved screenshots
populate `stepDiffs[]` — `new` verdicts never trip gates; `missing` trips `--require-steps`.

### Step-diff verdict matrix

| Verdict | Condition | Gate |
|---------|-----------|------|
| `ok` | Step in run and manifest, within `--max-mismatch` | none |
| `mismatch` | Step over `--max-mismatch` | trips `--max-mismatch` |
| `new` | Step added since approval | **never gates** |
| `missing` | Approved step absent from run | trips `--require-steps` |
