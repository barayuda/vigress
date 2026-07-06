# vigress

A general-purpose **visual-regression CLI** built on **Bun + Playwright + pixelmatch**.

`vigress` opens a **target URL** in a real browser, captures a screenshot, and
compares it against a **baseline** — another live URL, a saved image (e.g. a
Figma export), or a Figma frame pulled via the Figma API. For each comparison it
writes the two screenshots, a **pixel-diff heatmap**, an optional **video** of
the capture session, a machine-readable **`summary.json`**, and a human-friendly
**`report.html`**. With `--json` it prints a structured payload to stdout so it's
equally usable by **AI agents**.

It is standalone tooling: it lives in its own folder and adds **no dependencies**
to any application repo.

---

## Table of contents

- [When to use it](#when-to-use-it)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start](#quick-start)
- [Authentication (logged-in pages)](#authentication-logged-in-pages)
- [CLI reference](#cli-reference)
- [Baselines](#baselines)
- [Baseline snapshots (self-regression)](#baseline-snapshots-self-regression)
- [Dashboard](#dashboard)
- [Batch mode (`--config`)](#batch-mode---config)
- [Regions & masks](#regions--masks)
- [Interaction steps & auto-explore](#interaction-steps--auto-explore)
- [Outputs](#outputs)
- [Using it from an AI agent](#using-it-from-an-ai-agent)
- [Interpreting the mismatch %](#interpreting-the-mismatch-)
- [Environment variables](#environment-variables)
- [Cookbook](#cookbook)
- [Troubleshooting](#troubleshooting)
- [How it works](#how-it-works)
- [Project layout](#project-layout)
- [Testing](#testing)
- [Limitations & caveats](#limitations--caveats)

---

## When to use it

- **Migration parity** — compare a migrated page (e.g. a new framework/`-v2`
  route) against the old app on staging.
- **Redesign / design QA** — compare an implemented page against a design export
  (a PNG from Figma, or a Figma frame fetched live).
- **Self-baseline regression** — bless an approved run's capture as the golden
  baseline (`vigress approve` / `--update-baseline`), then diff future builds
  against that snapshot using `baseline:<name>` refs.

Three things make `vigress` general: the target and baseline are **arguments**
(no hardcoded routes), it produces **both** a human report and an agent JSON
payload, and it authenticates to **any** site via a saved browser session.

---

## Requirements

- **Bun** ≥ 1.3 (`bun --version`).
- **Google Chrome** installed (the tool launches it via Playwright's
  `channel: "chrome"`, so no Chromium download is needed).
- A **`FIGMA_TOKEN`** only if you use `figma:` baselines.
- Network access to the target/baseline URLs (VPN if they're internal).

---

## Install

```bash
cd vigress
bun install
cp .env.example .env      # optional: set FIGMA_TOKEN, default viewport, etc.
```

Bun does **not** run Playwright's browser-download postinstall, which is fine —
`vigress` uses your system Chrome. If Chrome is missing, either install it, or
run `bunx playwright install chromium` and change the `channel: "chrome"` launch
in `src/browser.ts` to plain `chromium.launch({ headless: true })`.

> Optional: `bun link` in this folder exposes a global `vigress` command so you
> can type `vigress …` instead of `bun run src/cli.ts …`. All examples below use
> the explicit `bun run src/cli.ts` form.

---

## Quick start

**Compare local against staging (URL vs URL):**
```bash
bun run src/cli.ts \
  --target  https://localhost:3000/reports/contact-v2 \
  --against https://staging.example.com/reports/contact \
  --state   auth.state.json \
  --video --out out
open out/report.html      # review
```

**Compare a page against a Figma export saved on disk (URL vs image):**
```bash
bun run src/cli.ts --target https://localhost:3000/pricing --against ./design/pricing.png --out out
```

**Compare a page against a Figma frame fetched live (URL vs Figma):**
```bash
FIGMA_TOKEN=figd_xxx bun run src/cli.ts \
  --target https://localhost:3000/pricing \
  --against figma:AbC123FileKey/12:345 \
  --out out
```

If the page needs a login, run [`vigress login`](#authentication-logged-in-pages)
once first and pass `--state`.

---

## Authentication (logged-in pages)

`vigress` authenticates with a **Playwright `storageState`** — a JSON file of
cookies + localStorage captured from a real, manual sign-in. This works for any
auth scheme (SSO, OAuth, MFA, plain forms) because *you* log in; the tool just
reuses the session.

**1. Log in once (saves the session):**
```bash
bun run src/cli.ts login --url https://staging.example.com --state auth.state.json
```
A headed Chrome opens at the URL. Sign in there, then **press Enter in the
terminal** — the session is written to `auth.state.json`.

**2. Reuse it on every comparison:**
```bash
bun run src/cli.ts --target … --against … --state auth.state.json
```

The same `--state` is applied to **both** the target and any URL baseline
capture. If the file is missing, `vigress` fails fast with a hint to run `login`.
When the session expires, just re-run `login`.

**Expired sessions fail fast.** If a capture with `--state` lands on a login
page (the URL path gains a `login`/`sign-in`/`sso`/`auth` segment it didn't ask
for), the run aborts with a "session has likely expired" error instead of
silently diffing two login screens.

**Validate a session without signing in:**
```bash
bun run src/cli.ts login --url https://staging.example.com --state auth.state.json --check
```
Headless and non-interactive: exits `0` if the session still works, `1` if it
redirected to a login page (with `--json`: `{url, state, finalUrl, loggedIn}`).
Useful for scripts and AI agents to pre-flight the session before a run.

> `auth.state.json` contains live credentials — it's git-ignored by default
> (`*.state.json`). Keep it out of version control.

---

## CLI reference

```
bun run src/cli.ts [--target <url> --against <ref>] [options]
bun run src/cli.ts login --url <url> --state <path> [--check]
bun run src/cli.ts init-config <page> --target <url> --against <ref> [--viewport WxH]
bun run src/cli.ts discover <page> --target <url> --against <url> [--viewport WxH] [--state f] [--max-steps n]
bun run src/cli.ts approve <name> [--run <dir>]
bun run src/cli.ts approve --all [--run <dir>]
bun run src/cli.ts dashboard [--port 4600] [--out out]
bun run src/cli.ts --config <file.json> [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--target` | string | — | URL to capture and check (required unless `--config`). |
| `--against` | string | — | Baseline: a URL, an image path/URL, or `figma:KEY/NODE` (required unless `--config`). |
| `--against-type` | `url`\|`image`\|`figma` | auto | Force the baseline type, overriding auto-detection (single-run only). |
| `--name` | string | last path segment of target | Basename for this comparison's artifacts. |
| `--out` | string | `out` | Parent output directory. Each run writes to `<out>/<YYYY-MM-DD_HH-MM-SS>/`, so previous runs are never overwritten. |
| `--no-timestamp` | boolean | — | Write straight into `--out` (fixed path) instead of a timestamped subfolder — overwrites the previous run. |
| `--viewport` | `WxH` | `1440x900` | Browser viewport for captures. |
| `--state` | path | — | Playwright storageState JSON (from `login`). |
| `--video` | boolean | on | Record a `.webm` of the capture session. Video is **on by default** (all artifacts), so this flag is redundant; kept for explicitness. |
| `--no-video` | boolean | — | Skip video recording (the only opt-out; everything else is always written). |
| `--clip` | `x,y,w,h` | — | Crop screenshots to this region (cuts shared chrome). |
| `--threshold` | number 0–1 | `0.1` | pixelmatch per-pixel color tolerance. |
| `--json` | boolean | `false` | Print a compact JSON payload to stdout (and nothing else). |
| `--quiet` | boolean | `false` | Suppress the per-comparison log lines. |
| `--max-mismatch` | number (pct) | — | Exit non-zero if any comparison exceeds this %. |
| `--require-steps` | boolean | `false` | Exit non-zero if any functionality check step failed (i.e. any step with `check: true` has `status: "failed"`). Combines with `--max-mismatch`. |
| `--require-style` | boolean | `false` | Exit non-zero if any region's `styleDiff` contains a `match: false` entry. See [Regions & masks](#regions--masks). |
| `--config` | path | — | Run a batch of comparisons from a JSON file. |
| `--step` | string (repeatable) | — | Add one interaction step (single-run only). Format: `"action=click;selector=[data-testid=x]"`. See [Interaction steps & auto-explore](#interaction-steps--auto-explore). |
| `--no-steps` | boolean | — | Disable interaction entirely; capture is static (no auto-explore, no steps). |
| `--url` | string | — | (login only) the URL to open for sign-in. |
| `--check` | boolean | — | (login only) validate the saved session headlessly instead of signing in — exit `0` logged in, `1` expired. |
| `--max-steps` | number | `20` | (discover only) cap on generated click+screenshot step pairs. |
| `--update-baseline` | boolean | — | After the run completes, approve all results into `baselines/manifest.json`. If a `baseline:<name>` ref has no manifest entry yet, that run is a bootstrap: diff phase skipped, then approved. Works in both single-run and batch mode (all entries are approved in batch). |
| `--run` | path | — | (approve only) bless from a specific run directory instead of auto-finding the newest. |
| `--all` | boolean | — | (approve only) bless every entry in the run, not just the named one. |
| `--port` | number | `4600` | (dashboard only) port to bind the local server. Invalid value → usage error + exit 2. |

**Subcommands:**
- `login` — opens a headed browser to capture a `storageState`; with `--check`, validates an existing session headlessly.
- `init-config <page>` — scaffolds `<page>.fullcheck.json` with `REPLACE-*` placeholders (no browser).
- `discover <page>` — crawls the live `--target` DOM (read-only) and writes a run-ready `<page>.fullcheck.json`.
- `approve <name> [--run <dir>]` — blesses a run's target capture and named step shots into `baselines/manifest.json`. Auto-finds the newest run containing `<name>` unless `--run` is given.
- `approve --all [--run <dir>]` — blesses every entry in the run (for batch configs).
- `dashboard [--port 4600] [--out out]` — starts the local artifact-manager dashboard (see [Dashboard](#dashboard)).

**Exit codes:** `0` success · `1` a gate tripped (`--max-mismatch`,
`--require-steps`, `--require-style`) or an unexpected error · `2` usage error
(missing required args).

---

## Baselines

The baseline is whatever you pass to `--against`. Its type is **auto-detected**:

| `--against` value | Detected type | Behavior |
|-------------------|---------------|----------|
| `http://…` / `https://…` | `url` | Captured live in the browser (uses `--state`, `--viewport`, `--clip`). |
| ends in a path / not a URL, e.g. `./design/x.png` | `image` | Local file copied as the baseline; an `http(s)` image URL is downloaded. |
| `figma:FILEKEY/NODEID` | `figma` | Exported as PNG via the Figma REST API (needs `FIGMA_TOKEN`). |
| `baseline:<name>` | `baseline` | Diffs against the approved capture stored in `baselines/manifest.json`. See [Baseline snapshots](#baseline-snapshots-self-regression). |

Override detection with `--against-type` if needed (single-run only). All
baselines are normalized to a PNG, then diffed against the target capture.
Different dimensions are handled by cropping both images to their common
top-left region before diffing.

**Getting a Figma ref:** in Figma, the URL of a selected frame looks like
`…/file/AbC123FileKey/…?node-id=12-345`. Use `figma:AbC123FileKey/12:345` (the
node id uses a colon).

---

## Baseline snapshots (self-regression)

Beyond parity checks (target vs staging/Figma), `vigress` supports **self-regression**: bless a known-good run as the approved baseline, then diff every future run against that snapshot.

### Approving a baseline

After a satisfactory run, bless it:

```bash
# Bless by name (auto-finds the newest run containing it)
bun run src/cli.ts approve contact

# Bless a specific run directory
bun run src/cli.ts approve contact --run out/2026-07-06_15-11-50

# Bless every entry in the newest run (for batch configs)
bun run src/cli.ts approve --all
```

`approve` writes `baselines/manifest.json` (git-tracked) and drops a `.approved`
marker file in the run dir. Artifacts stay in place — **no copying**. The manifest
points at the approved `out/<timestamp>/` dir, which makes that directory precious:
deleting it breaks the baseline until re-approved.

### Using a baseline ref

```json
{ "name": "contact", "target": "https://localhost:3000/contact", "against": "baseline:contact" }
```

Or on the CLI: `--against baseline:contact`.

Guards: if no manifest entry exists → exit 2 ("bootstrap with --update-baseline");
if artifact files are missing → exit 1 ("re-approve or run with --update-baseline");
if the run viewport differs from the approved viewport → exit 2.

### Bootstrap / `--update-baseline`

Skip the `approve` step and let the run approve itself:

```bash
bun run src/cli.ts --config contact.fullcheck.json --update-baseline
```

- Runs normally, then approves all results.
- If a `baseline:<name>` ref has no manifest entry yet, that run is a **bootstrap**: the diff phase is skipped (nothing to diff against), everything is captured, and then approved. Subsequent runs diff normally.
- In batch mode, `--update-baseline` applies to every entry — including url/figma parity entries. This is the intended bridge: check the page against staging/Figma, bless that exact state, then guard it with a `baseline:` run going forward.
- Works in single-run mode too (approves the single result).

> **WARNING — CI footgun:** `--update-baseline` blesses the run's captures even when a gate trips (`--max-mismatch`, `--require-steps`). The run still exits 1, but the manifest now points at the **failing state** — a regression is blessed as the new baseline before the failure is reported. **Never leave `--update-baseline` permanently enabled in CI.** Use it deliberately: bootstrapping a new baseline or intentionally re-blessing an accepted change only.

> **Manifest key semantics:** The key written by `approve`/`--update-baseline` is always the run's `name` — **not** the name inside `baseline:<name>`. If a config entry has `"name": "contact-v2"` with `"against": "baseline:contact"`, `--update-baseline` creates/updates the `contact-v2` entry; it does **not** update `contact`.

> **`--no-steps` with an approved baseline:** running `--no-steps` against a `baseline:` ref whose manifest entry has approved step shots produces all-`missing` stepDiffs, which trips `--require-steps`. Use `--no-steps` there only if you intentionally omit `--require-steps`.

### The manifest

```
baselines/
  manifest.json    # git-tracked; commit this to share with teammates
```

```json
{
  "schemaVersion": 1,
  "baselines": {
    "contact": {
      "storage": "local",
      "approvedAt": "2026-07-06T15:11:50Z",
      "approvedFrom": "out/2026-07-06_15-11-50",
      "viewport": { "width": 1440, "height": 900 },
      "sourceUrl": "https://localhost:3000/contact",
      "artifacts": {
        "main": "out/2026-07-06_15-11-50/contact.target.png",
        "steps": {
          "date-open": "out/2026-07-06_15-11-50/contact.date-open.png"
        }
      }
    }
  }
}
```

Paths are relative to the repo root. The manifest is committed to git; `out/`
remains git-ignored. **Baselines are per-machine** until remote storage is
available — a fresh clone or CI runner must bootstrap with `--update-baseline`.

### Step diffing

When a `baseline:` run has approved step shots, `vigress` diffs each named
screenshot step against its approved counterpart and adds `stepDiffs[]` to the
run result:

| Verdict | Condition | Gate impact |
|---------|-----------|-------------|
| `ok` | Step in run and manifest, within threshold | none |
| `mismatch` | Step in run and manifest, over `--max-mismatch` | trips `--max-mismatch` |
| `new` | Step in run, not in manifest (newly added step) | **never gates** |
| `missing` | Step in manifest, not in run (step removed or failed) | trips `--require-steps` |

The `mismatch` verdict counts toward `--max-mismatch`'s worst-of. Adding a step
never trips a gate until re-approval; a promised state that disappeared is a real
failure.

### Parity → bless → regression workflow

1. **Parity check:** run against staging/Figma to verify the page matches the reference.
2. **Bless:** once satisfied, `approve` that run (or re-run with `--update-baseline`).
3. **Regression:** change the config's `against` to `baseline:<name>` (or use a separate baseline config). Future commits diff against the approved state.

---

## Dashboard

The dashboard is a local web UI for browsing, keeping, and cleaning up `out/` run directories.

```bash
bun run src/cli.ts dashboard [--port 4600] [--out out]
```

- Resolves `--out` / `VIGRESS_OUT` / `"out"` the same way every other subcommand does.
- Binds **`127.0.0.1` only** — the server can delete files and is never exposed beyond localhost.
- Serves until `Ctrl-C`. An invalid `--port` value prints the usage line and exits with code `2`.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Dashboard HTML page. |
| `GET` | `/api/runs` | JSON array of all run-dir entries (sorted newest-first). |
| `GET` | `/files/<run>/<path>` | Serves an artifact from `out/<run>/`. Path-traversal guarded (lexical + realpath symlink check); dot-prefixed path segments (e.g. `.keep`, `.approved`) are refused with `403`; returns `403` on any escape attempt. |
| `POST` | `/api/runs/<dir>/keep` | Toggles the `.keep` marker file in the run dir. Returns `{ keep: true|false }`. |
| `DELETE` | `/api/runs/<dir>` | Deletes the run dir. Returns `{ "deleted": "<dir>" }` on success; `403` + `{ lockedBy }` if the dir is referenced by `baselines/manifest.json`; `404` if the dir has already vanished. |
| `POST` | `/api/cleanup` | Bulk-deletes every run dir that is neither `.keep`-marked nor referenced by the manifest. Returns `{ deleted: string[], freedBytes: number }`. |

### Keep and lock semantics

- **`.keep` marker** — a zero-byte file written inside the run dir. Toggled via `POST /api/runs/<dir>/keep`. Keep-marked dirs are excluded from `POST /api/cleanup` but can still be manually deleted via `DELETE /api/runs/<dir>`. `.keep` is independent of `.approved`.
- **Manifest lock** — any run dir referenced by `baselines/manifest.json` (as `approvedFrom` or as the parent of any artifact path) is **locked**: `DELETE /api/runs/<dir>` returns `403` with a `lockedBy` field listing the baseline names that depend on it. This guard is re-checked server-side on every request; bypassing the UI does not bypass it. Cleanup (`POST /api/cleanup`) never touches locked dirs.
- **Manifest is re-read per request** — `vigress approve` can run while the dashboard is up and the locks will reflect the updated manifest immediately.

### Legacy / unreadable run dirs

Run dirs whose `summary.json` is unreadable or missing the `steps`, `stepDiffs`, or `regions` arrays (written by older vigress versions) are listed in `/api/runs` as `"unreadable": true`. They are not locked (unless the manifest references them) and are included in `POST /api/cleanup`.

---

## Batch mode (`--config`)

Run many comparisons in one invocation. The config file is a JSON array:

```json
[
  { "name": "contact", "target": "https://localhost:3000/reports/contact-v2", "against": "https://staging.example.com/reports/contact" },
  { "name": "pricing", "target": "https://localhost:3000/pricing", "against": "./design/pricing.png", "clip": { "x": 0, "y": 64, "width": 1440, "height": 900 } },
  { "name": "home", "target": "https://localhost:3000/", "against": "figma:AbC123/10:2", "viewport": { "width": 1280, "height": 800 } }
]
```

```bash
bun run src/cli.ts --config comparisons.json --state auth.state.json --out out --json
```

Per-entry fields: `target` and `against` are required; `name`, `clip`,
`viewport`, and `video` are optional.

> **Note:** **video records by default in both single-run and batch mode** — all
> artifacts are on unless you opt out. Pass `--no-video` to skip recording for the
> whole run, or set `"video": false` on an individual batch entry. Global options
> (`--out`, `--state`, `--viewport`,
> `--threshold`, `--json`, `--quiet`, `--max-mismatch`) come from the CLI flags
> and apply to the whole batch; `--viewport` is the per-entry default when an
> entry omits its own.

---

## Regions & masks

Per-region scoring lets you isolate specific UI areas, giving each a separate mismatch score and diff artifact. Masks suppress dynamic content (timestamps, live counts, date badges) before diffing so it doesn't inflate the overall mismatch.

### Extended config entry

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
      "selector": "[data-testid=summary-card]",
      "maxMismatch": 5
    },
    {
      "name": "chart-legend",
      "clip": { "x": 277, "y": 175, "width": 280, "height": 205 }
    }
  ],
  "mask": [
    { "selector": "[data-testid=date-filter]" },
    { "target": "[data-testid=live-count]", "baseline": ".count--live" }
  ],
  "checklist": [
    { "aspect": "filter-bar width/stretch", "region": "filter-bar", "verdict": "unresolved" },
    { "aspect": "summary-card radius/border/proportions", "region": "summary-cards", "verdict": "unresolved" },
    { "aspect": "chart legend/tick density", "region": "chart-legend", "verdict": "unresolved" }
  ]
}
```

**`regions[]` fields:** `name` (artifact key), `target` (CSS selector on the new app), `baseline` (CSS selector on the reference), `selector` (applies to both sides), `clip` (`{x,y,width,height}` raw fallback), `maxMismatch` (% threshold, default 5), `style` (opt-in computed-style diff, see below). Precedence per side: `target`/`baseline` → `selector` → `clip`.

**Coordinates:** selector-resolved region/mask boxes are automatically translated
into the screenshot's coordinate space when `--clip` is set, and a region that
lies entirely outside the captured area (e.g. below the fold) scores
`unresolved` rather than diffing the wrong pixels. `clip`-style regions/masks
are taken as-is — author them against the final screenshot.

**Style diffing (`style`):** pixel diff says *how many* pixels differ, not
*why*. Set `"style": true` on a region to also compare computed styles
property-by-property (`color`, `backgroundColor`, `fontSize`, `fontWeight`,
`fontFamily`, `padding`, `margin`, `border`, `borderRadius`, `boxShadow`), or
pass an explicit list like `"style": ["color", "backgroundColor"]`. Results
land in `regions[].styleDiff` as `{property, target, baseline, match}` and in a
per-region table in `report.html`. Only works against a **URL baseline** (an
image/Figma baseline has no DOM to read styles from). Gate on it with
`--require-style`. CLI flag form: append `;style=true` or
`;style=color,backgroundColor` to a `--region` flag.

**`mask[]` fields:** same `target`, `baseline`, `selector`, `clip` shape. Matched regions are painted opaque magenta on both sides before diffing.

**`checklist[]` fields:** `aspect` (free-form label), `region` (ties to a `regions[].name`), `verdict` (filled in by the tool from the region score), `workaround` (optional note).

### CLI flags for single runs (repeatable)

```bash
# Add a named region
--region "name=filter-bar;target=[data-testid=report-filter];baseline=.report__filter;max=2"

# Mask a dynamic element
--mask "selector=[data-testid=date-filter]"

# Clip value keeps its commas
--region "name=chart-legend;clip=277,175,280,205"
```

Fields are delimited by `;`, key=value.

> **Note:** `--region` and `--mask` apply to single runs only and are ignored in `--config` batch mode. Put `regions` and `mask` entries directly in the config file instead.

### New outputs

| File | What it is |
|------|------------|
| `out/<name>.<region>.diff.png` | per-region pixel-diff heatmap |
| `out/checklist.md` | markdown checklist of aspects with pass/fail/unresolved verdict |
| `out/report.html` | now includes a per-region table (region · score · verdict+reason · diff thumbnail) and a checklist section |

`summary.json` and the `--json` payload include `regions[]` (per-region `name`, `verdict`, `reason`, `mismatchPercent`), `checklist[]` (per-aspect `aspect`, `region`, `verdict`, `workaround`), `mode`, and `shots[]`.

**Masked artifacts:** the saved `<name>.target.png` and `<name>.baseline.png` show the magenta mask boxes — the report reflects exactly what was compared, making mask coverage auditable.

---

## Interaction steps & auto-explore

After the clean diff screenshot (so parity is unaffected), `vigress` can interact
with the target page — driving UI controls and capturing mid-flow screenshots that
appear in the report and the JSON payload. The interaction is **target-only** and
is recorded in the video.

### Default precedence

| Condition | Mode |
|-----------|------|
| `--no-steps` | `static` — no interaction, clean capture only |
| `steps` array in config or one or more `--step` flags | `steps` — runs the explicit flow |
| neither of the above (the default) | `explore` — auto-explores safe controls |

### Auto-explore (the default)

When no steps are configured and `--no-steps` is not set, `vigress` opens and
closes up to **6 safe controls** on the page, then continues. Safety caps:

- **Safelist:** `[role=combobox]`, `[aria-haspopup]`, `[data-testid$="-input"]`,
  `button[aria-expanded]` — only these selectors are touched.
- **~12 s total cap** — aborts if the deadline is reached.
- **Destructive-text skip** — any control whose text matches
  `delete`, `remove`, `logout`, `sign-out`, or `hapus` (case-insensitive) is
  skipped.
- **URL-change abort** — if a click navigates the page, `vigress` goes back and
  stops immediately.
- Never submits forms, never mutates data.

### Explicit steps

Add a `steps` array to a config entry, or pass `--step` on the CLI (repeatable).
Each step is a `key=value` string delimited by `;`:

```bash
# Click a combobox, then dismiss
--step "action=click;selector=[data-testid=period-input]" \
--step "action=screenshot;name=date-open" \
--step "action=press;key=Escape"
```

**Step action table:**

| `action` | Required fields | Optional fields | Behaviour |
|----------|-----------------|-----------------|-----------|
| `click` | `selector` | — | Clicks the first matching element. |
| `fill` | `selector`, `value` | — | Types `value` into the field. |
| `select` | `selector`, `value` | — | Selects `value` in a `<select>`. |
| `hover` | `selector` | — | Hovers over the element (triggers tooltips). |
| `press` | `key` | `selector` | Presses a keyboard key. If `selector` is given, focuses that element first; otherwise sends the key to the page globally. |
| `waitFor` | `selector` OR `ms` | — | Waits until the element is visible, or for `ms` milliseconds. |
| `scroll` | `selector` OR `by` | — | Scrolls the element into view, or scrolls the page by `by` pixels. |
| `screenshot` | `name` | — | Saves `<name>.<shot>.png` in the output directory. The file appears in the "flow shots" strip in `report.html` and in `shots[]` in the JSON payload, but is **not** diffed. |
| `assert` | `selector` OR `urlContains` | `state`, `text` | Verifies an **outcome**: the element reaches `state` (`visible` default, or `hidden`), its text contains `text`, and/or the page URL contains `urlContains`. Fails the step when the expectation isn't met — so a control that "clicks fine" but does nothing still fails the check. |

Each step is best-effort: a failure is logged to stderr and skipped; it never
aborts the rest of the flow.

**Config example with steps:**

```json
{
  "name": "contact",
  "target": "https://localhost:3000/reports/contact-v2",
  "against": "https://staging.example.com/reports/contact",
  "steps": [
    { "action": "click",      "selector": "[data-testid=period-input]" },
    { "action": "screenshot", "name": "date-open" },
    { "action": "press",      "key": "Escape" }
  ]
}
```

### Per-step results

Each step now reports a pass/fail result. `summary.json` and the `--json`
payload gain a `steps[]` array on each run entry:

| Field | Type | Description |
|-------|------|-------------|
| `index` | number | 1-based position of the step in the steps array. |
| `action` | string | The step action (`click`, `fill`, `press`, etc.). |
| `selector` | string? | The selector used (omitted for `screenshot`, `press`/`scroll`/`waitFor` without a selector). |
| `check` | boolean | Whether this step is a **functionality check**: `true` for `click`, `fill`, `select`, `hover`, `assert` (always); `press`, `scroll`, `waitFor` with a selector; `false` for `screenshot` and selector-less `press`/`scroll`/`waitFor`. |
| `status` | `"ok"` \| `"failed"` | `"ok"` means the selector resolved and the action ran; `"failed"` means the element was not found or the action threw. |
| `error` | string? | Error message when `status` is `"failed"`. |

`report.html` shows a **Functionality table** per run — one row per step where
`check` is `true`, with columns `# · action · selector · result (✓/✗)`. Failed
rows are highlighted in red and show the error message. The card header shows:

```
functionality: X/Y checks passed
```

where `X` is the count of `ok` check-steps and `Y` is the total check-steps.

### New outputs (schemaVersion 6 / 7)

`summary.json` and the `--json` payload are **`schemaVersion: 7`** (v5
added `regions[].styleDiff`; v6 added the `assert` step action; v7 added
`targetUrl`, `stepDiffs`, `bootstrap`, and made `baseline`/`diff`/mismatch
fields optional). Each run entry adds:

| Field | Type | Description |
|-------|------|-------------|
| `mode` | `"static"` \| `"explore"` \| `"steps"` | Which interaction mode ran. |
| `shots[]` | `{ name, path }[]` | Mid-flow screenshot files (empty unless `screenshot` steps ran). `path` is relative to `outDir` in `summary.json`, absolute in `--json`. |
| `steps[]` | `{ index, action, selector?, check, status, error? }[]` | Per-step result (empty in `static`/`explore` mode). |

`report.html` includes a **"flow shots" strip** below each comparison card when
`shots` are present.

---

## Outputs

Everything lands in `--out` (default `out/`, git-ignored). For a comparison
named `contact`:

| File | What it is |
|------|------------|
| `out/contact.target.png` | screenshot of the target URL |
| `out/contact.baseline.png` | the resolved baseline (captured / copied / downloaded) |
| `out/contact.diff.png` | pixelmatch heatmap (changed pixels highlighted) |
| `out/video/*.webm` | capture-session video (only when video is on) |
| `out/summary.json` | machine-readable run summary (see below) |
| `out/report.html` | a self-contained review page — **open this** |

**`report.html`** shows a header (comparison count + worst mismatch %) and one
card per comparison with the target / baseline / diff side-by-side plus the
video. It references the artifacts by relative path, so open it directly
(`open out/report.html`) — no server needed.

**`summary.json`** (artifact paths are **relative** to `outDir`):
```json
{
  "schemaVersion": 7,
  "outDir": "/abs/path/out",
  "reportHtml": "report.html",
  "summaryJson": "summary.json",
  "runs": [
    {
      "name": "contact",
      "baselineType": "url",
      "viewport": { "width": 1440, "height": 900 },
      "mismatchPixels": 12345,
      "mismatchPercent": 4.2,
      "target": "contact.target.png",
      "targetUrl": "https://localhost:3000/contact",
      "baseline": "contact.baseline.png",
      "diff": "contact.diff.png",
      "video": "video/abc.webm",
      "mode": "steps",
      "shots": [],
      "steps": [
        { "index": 1, "action": "click", "selector": "[data-testid=period-input]", "check": true, "status": "ok" },
        { "index": 2, "action": "screenshot", "check": false, "status": "ok" },
        { "index": 3, "action": "press", "check": false, "status": "ok" }
      ],
      "stepDiffs": [
        { "name": "date-open", "mismatchPercent": 0.1, "diff": "contact.date-open.stepdiff.png", "verdict": "ok" }
      ]
    }
  ]
}
```

**v7 schema changes** (from v6): each `RunResult` gains `targetUrl` (string — the captured URL, used by `approve` to record `sourceUrl` in the manifest) and `stepDiffs` (array of `{ name, mismatchPercent, diff?, verdict: "ok"|"mismatch"|"new"|"missing" }` — step screenshot regressions against an approved `baseline:` run). `bootstrap?: true` marks a first approval run (no prior baseline to diff against). On bootstrap runs, `baseline`, `diff`, `mismatchPixels`, and `mismatchPercent` are absent (they are optional from v7 onward).

---

## Using it from an AI agent

Pass `--json` and the **only** thing on stdout is one compact JSON object — same
shape as `summary.json` but with **absolute** artifact paths, ready to read:

```bash
bun run src/cli.ts --target … --against … --state auth.state.json --json --quiet
```
```json
{ "schemaVersion": 7, "outDir": "/abs/out", "reportHtml": "/abs/out/report.html",
  "summaryJson": "/abs/out/summary.json",
  "runs": [ { "name": "contact", "baselineType": "url", "viewport": {"width":1440,"height":900},
              "mismatchPixels": 12345, "mismatchPercent": 4.2,
              "target": "/abs/out/contact.target.png", "targetUrl": "https://localhost:3000/contact",
              "baseline": "/abs/out/contact.baseline.png",
              "diff": "/abs/out/contact.diff.png", "video": "/abs/out/video/abc.webm",
              "mode": "steps", "shots": [],
              "steps": [{"index":1,"action":"click","selector":"[data-testid=x]","check":true,"status":"ok"}],
              "stepDiffs": [{"name":"date-open","mismatchPercent":0.1,"diff":"/abs/out/contact.date-open.stepdiff.png","verdict":"ok"}] } ] }
```

An agent can parse this, **read** the `diff` PNG to inspect changes, open
`reportHtml` for the human, and use `--max-mismatch` to get a non-zero exit as a
gate. `schemaVersion` lets the consumer guard against format changes. There's
also an `~/.claude/skills/vigress` skill documenting this workflow.

---

## Interpreting the mismatch %

The mismatch percentage is a **signal, not a verdict**. Cross-environment and
design comparisons are inherently noisy:

- different apps/frameworks render fonts, anti-aliasing, and theme tokens
  slightly differently;
- app shells (headers/sidebars) can differ in height, shifting everything and
  inflating the %;
- a design export rarely matches a live render pixel-for-pixel.

So by default `vigress` **reports** the % and never fails on it — the **diff
image and video are the real deliverable**. Use them to spot genuine structural
differences. Two knobs help:

- **`--clip x,y,w,h`** to compare just the content region and exclude shared
  chrome;
- **`--max-mismatch <pct>`** only when you deliberately want a pass/fail gate
  (e.g. in a script or CI).

---

## Environment variables

CLI flags always win over env vars. Bun auto-loads `.env`.

| Variable | Used for | Flag equivalent |
|----------|----------|-----------------|
| `FIGMA_TOKEN` | Figma REST export (figma: baselines) | — |
| `VIGRESS_OUT` | default output dir | `--out` |
| `VIGRESS_STATE` | default storageState path | `--state` |
| `VIGRESS_VIEWPORT` | default viewport (`WxH`) | `--viewport` |
| `VIGRESS_SETTLE` | milliseconds to cap the `networkidle` wait per capture (default `8000`) — SPAs with persistent sockets (MQTT/long-poll) never reach networkidle, so the wait is bounded | — |
| `VIGRESS_DWELL` | milliseconds to hold after each interaction step (default `1000`), giving the video time to show each step clearly | — |

---

## Cookbook

```bash
# Migration: local v2 vs staging, cropped to content, recorded
bun run src/cli.ts --target https://localhost:3000/reports/contact-v2 \
  --against https://staging.example.com/reports/contact \
  --state auth.state.json --clip 264,56,1176,2000 --video --out out

# Design QA: page vs a Figma PNG you exported
bun run src/cli.ts --target https://localhost:3000/pricing --against ./design/pricing@2x.png

# Design QA: page vs a live Figma frame
FIGMA_TOKEN=figd_xxx bun run src/cli.ts --target https://localhost:3000/pricing --against figma:KEY/12:345

# Baseline snapshot: bootstrap (first approval)
bun run src/cli.ts --config contact.fullcheck.json --state auth.state.json --update-baseline

# Baseline snapshot: re-run against the approved state (regression check)
bun run src/cli.ts --config contact.fullcheck.json --state auth.state.json --json --max-mismatch 2

# Bless a specific named run after review
bun run src/cli.ts approve contact --run out/2026-07-06_15-11-50

# Batch, machine-readable, gated at 5%
bun run src/cli.ts --config comparisons.json --state auth.state.json --json --max-mismatch 5
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `browserType.launch: ... channel "chrome"` not found | Install Google Chrome, or `bunx playwright install chromium` and switch `src/browser.ts` to `chromium.launch({ headless: true })`. |
| `No session at "…"` / `session has likely expired` | Run `vigress login --url <app> --state <path>` and pass the same `--state`. Verify a saved session anytime with `vigress login --url <app> --state <path> --check`. |
| Figma: "no image for node" / 403 | Check `FIGMA_TOKEN`, the `figma:FILEKEY/NODEID` ref (node id uses `:`), and that the token can read that file. |
| Huge mismatch % but pages "look the same" | Expected noise (fonts/shell/offset). Use `--clip` and judge by the diff image, not the number. |
| No `.webm` produced | Video is on by default — check you didn't pass `--no-video` or set `"video": false` on the entry. |
| Target needs a VPN | Connect the VPN before running. |

---

## How it works

Per comparison, the CLI runs this pipeline:

```
parse args/env → resolve baseline: refs from the manifest (guards fail fast, no browser)
→ launch Chrome → new context (viewport + storageState [+ recordVideo])
  → capture target URL
  → resolve baseline (capture URL | copy/download image | fetch Figma | approved manifest image)
  → pixelmatch diff (crop to common size, paint masks, per-region sub-diffs)
  → interaction phase (explicit steps | auto-explore) — target-only, AFTER the clean diff
  → step diffs vs approved step shots (baseline: runs only)
  → close context (flush video)
→ write summary.json + report.html → (--update-baseline: approve results into the manifest)
→ (with --json) print payload → exit code (gates: --max-mismatch / --require-steps / --require-style)
```

Pure logic (diff, config parsing, baseline-type detection, Figma-ref parsing,
region/box math, the baselines manifest, the dashboard view-model, HTML/JSON
building) is separated from the browser and server I/O so it's unit-testable
without a browser.

---

## Project layout

```
vigress/
├── src/
│   ├── cli.ts            # entrypoint: parse args, dispatch subcommands, orchestrate
│   ├── config.ts         # types, viewport/clip parse, baseline detect, run/batch builder
│   ├── auth.ts           # storageState load, login / login --check, expired-session detection
│   ├── browser.ts        # launch Chrome (channel:"chrome")
│   ├── capture.ts        # navigate + settle + screenshot
│   ├── diff.ts           # pixelmatch (crop-to-common), per-region sub-diffs, step diffs
│   ├── regions.ts        # selector→box resolution, mask painting, region scoring
│   ├── style.ts          # computed-style probing + property-by-property diffs
│   ├── steps.ts          # interaction steps + auto-explore
│   ├── discover.ts       # read-only DOM crawl → generated fullcheck config
│   ├── baselines.ts      # baselines/manifest.json: parse/build/upsert/resolve, verdict matrix
│   ├── dashboard.ts      # dashboard view-model: run index, locks, cleanup selection, path guard
│   ├── dashboardHtml.ts  # the dashboard page (static, self-contained)
│   ├── server.ts         # Bun.serve wiring for `vigress dashboard` (127.0.0.1 only)
│   ├── sources/          # baseline resolvers: url / image / figma
│   ├── htmlReport.ts     # buildReportHtml(summary) → report.html
│   ├── json.ts           # buildJsonPayload(summary) → absolute-path agent payload
│   ├── report.ts         # writes summary.json + report.html
│   └── types.ts          # RunResult / Summary / SCHEMA_VERSION
├── skills/vigress/       # AI skill + playbook (symlinked into ~/.claude/skills)
├── baselines/            # manifest.json — approved baselines (git-tracked; created by `approve`)
├── .env.example
└── out/                  # artifacts (git-ignored)
```

---

## Testing

```bash
bun test
```

Unit tests cover the pure logic only (diff + step diffs, config, sources
parsing, baselines manifest, region/style math, dashboard view-model and page,
HTML report, JSON payload) — no browser, no network. The browser/capture/video
pipeline is verified by running a real comparison; the dashboard server is
verified live with curl (see the endpoint guards in [Dashboard](#dashboard)).

---

## Limitations & caveats

- **Not a single compiled binary.** Playwright can't be embedded in a
  `bun build --compile` executable (its dynamic `chromium-bidi` requires break
  bundling), so `vigress` ships as a Bun CLI that uses your installed Chrome.
- **Figma mode is the least battle-tested path** — verify it with a real
  `FIGMA_TOKEN` on a known frame before relying on it (the API's node-id
  handling can differ).
- **In URL-baseline mode with `--video`,** the recorded video covers both the
  target and the reference captures (they share one browser context).
- **The mismatch % is noisy** by design across environments — see
  [Interpreting the mismatch %](#interpreting-the-mismatch-).
