# vigress reference — interaction steps and functionality checks

Read this when you need to drive the page (click/fill/assert/screenshot), verify that controls really work, or control the interaction recording. Part of the `vigress` skill; the core rules live in `../SKILL.md`.

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
