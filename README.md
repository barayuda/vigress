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
- [Batch mode (`--config`)](#batch-mode---config)
- [Regions & masks](#regions--masks)
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
- **Self-baseline regression** — save a known-good screenshot as a baseline image
  and re-diff future builds against it.

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

> `auth.state.json` contains live credentials — it's git-ignored by default
> (`*.state.json`). Keep it out of version control.

---

## CLI reference

```
bun run src/cli.ts [--target <url> --against <ref>] [options]
bun run src/cli.ts login --url <url> --state <path>
bun run src/cli.ts --config <file.json> [options]
```

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--target` | string | — | URL to capture and check (required unless `--config`). |
| `--against` | string | — | Baseline: a URL, an image path/URL, or `figma:KEY/NODE` (required unless `--config`). |
| `--against-type` | `url`\|`image`\|`figma` | auto | Force the baseline type, overriding auto-detection (single-run only). |
| `--name` | string | last path segment of target | Basename for this comparison's artifacts. |
| `--out` | string | `out` | Output directory (resolved to an absolute path). |
| `--viewport` | `WxH` | `1440x900` | Browser viewport for captures. |
| `--state` | path | — | Playwright storageState JSON (from `login`). |
| `--video` | boolean | `false` (single) | Record a `.webm` of the capture session. |
| `--clip` | `x,y,w,h` | — | Crop screenshots to this region (cuts shared chrome). |
| `--threshold` | number 0–1 | `0.1` | pixelmatch per-pixel color tolerance. |
| `--json` | boolean | `false` | Print a compact JSON payload to stdout (and nothing else). |
| `--quiet` | boolean | `false` | Suppress the per-comparison log lines. |
| `--max-mismatch` | number (pct) | — | Exit non-zero if any comparison exceeds this %. |
| `--config` | path | — | Run a batch of comparisons from a JSON file. |
| `--url` | string | — | (login only) the URL to open for sign-in. |

**Subcommand:** `login` — opens a headed browser to capture a `storageState`.

**Exit codes:** `0` success · `1` a comparison exceeded `--max-mismatch` (or an
unexpected error) · `2` usage error (missing required args).

---

## Baselines

The baseline is whatever you pass to `--against`. Its type is **auto-detected**:

| `--against` value | Detected type | Behavior |
|-------------------|---------------|----------|
| `http://…` / `https://…` | `url` | Captured live in the browser (uses `--state`, `--viewport`, `--clip`). |
| ends in a path / not a URL, e.g. `./design/x.png` | `image` | Local file copied as the baseline; an `http(s)` image URL is downloaded. |
| `figma:FILEKEY/NODEID` | `figma` | Exported as PNG via the Figma REST API (needs `FIGMA_TOKEN`). |

Override detection with `--against-type` if needed (single-run only). All
baselines are normalized to a PNG, then diffed against the target capture.
Different dimensions are handled by cropping both images to their common
top-left region before diffing.

**Getting a Figma ref:** in Figma, the URL of a selected frame looks like
`…/file/AbC123FileKey/…?node-id=12-345`. Use `figma:AbC123FileKey/12:345` (the
node id uses a colon).

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

> **Note:** in batch mode each entry's `video` defaults to **`true`** (omit it to
> record, set `"video": false` to skip). In single-run mode `--video` is
> opt-in (off by default). Global options (`--out`, `--state`, `--viewport`,
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

**`regions[]` fields:** `name` (artifact key), `target` (CSS selector on the new app), `baseline` (CSS selector on the reference), `selector` (applies to both sides), `clip` (`{x,y,width,height}` raw fallback), `maxMismatch` (% threshold, default 5). Precedence per side: `target`/`baseline` → `selector` → `clip`.

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

### New outputs (schemaVersion 2)

| File | What it is |
|------|------------|
| `out/<name>.<region>.diff.png` | per-region pixel-diff heatmap |
| `out/checklist.md` | markdown checklist of aspects with pass/fail/unresolved verdict |
| `out/report.html` | now includes a per-region table (region · score · verdict+reason · diff thumbnail) and a checklist section |

`summary.json` and the `--json` payload are now `schemaVersion: 2` and include `regions[]` (per-region `name`, `verdict`, `reason`, `mismatchPercent`) and `checklist[]` (per-aspect `aspect`, `region`, `verdict`, `workaround`).

**Masked artifacts:** the saved `<name>.target.png` and `<name>.baseline.png` show the magenta mask boxes — the report reflects exactly what was compared, making mask coverage auditable.

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
  "schemaVersion": 1,
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
      "baseline": "contact.baseline.png",
      "diff": "contact.diff.png",
      "video": "video/abc.webm"
    }
  ]
}
```

---

## Using it from an AI agent

Pass `--json` and the **only** thing on stdout is one compact JSON object — same
shape as `summary.json` but with **absolute** artifact paths, ready to read:

```bash
bun run src/cli.ts --target … --against … --state auth.state.json --json --quiet
```
```json
{ "schemaVersion": 1, "outDir": "/abs/out", "reportHtml": "/abs/out/report.html",
  "summaryJson": "/abs/out/summary.json",
  "runs": [ { "name": "contact", "baselineType": "url", "viewport": {"width":1440,"height":900},
              "mismatchPixels": 12345, "mismatchPercent": 4.2,
              "target": "/abs/out/contact.target.png", "baseline": "/abs/out/contact.baseline.png",
              "diff": "/abs/out/contact.diff.png", "video": "/abs/out/video/abc.webm" } ] }
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

# Self-baseline regression: save today's render, diff future builds against it
bun run src/cli.ts --target https://localhost:3000/home --against ./baselines/home.png --name home

# Batch, machine-readable, gated at 5%
bun run src/cli.ts --config comparisons.json --state auth.state.json --json --max-mismatch 5
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `browserType.launch: ... channel "chrome"` not found | Install Google Chrome, or `bunx playwright install chromium` and switch `src/browser.ts` to `chromium.launch({ headless: true })`. |
| `No session at "…"` / pages render logged-out | Run `vigress login --url <app> --state <path>` and pass the same `--state`. Re-run when it expires. |
| Figma: "no image for node" / 403 | Check `FIGMA_TOKEN`, the `figma:FILEKEY/NODEID` ref (node id uses `:`), and that the token can read that file. |
| Huge mismatch % but pages "look the same" | Expected noise (fonts/shell/offset). Use `--clip` and judge by the diff image, not the number. |
| No `.webm` produced | Pass `--video` (single-run mode is opt-in; batch records by default). |
| Target needs a VPN | Connect the VPN before running. |

---

## How it works

Per comparison, the CLI runs this pipeline:

```
parse args/env → launch Chrome → new context (viewport + storageState [+ recordVideo])
  → capture target URL → resolve baseline (capture URL | copy/download image | fetch Figma)
  → pixelmatch diff (crop to common size) → collect result → close context (flush video)
→ write summary.json + report.html → (with --json) print payload → exit code
```

Pure logic (diff, config parsing, baseline-type detection, Figma-ref parsing,
HTML/JSON building) is separated from the browser I/O so it's unit-testable
without a browser.

---

## Project layout

```
vigress/
├── src/
│   ├── cli.ts          # entrypoint: parse args, dispatch, orchestrate
│   ├── config.ts       # types, viewport/clip parse, baseline detect, run/batch builder
│   ├── auth.ts         # storageState load + `login` command
│   ├── browser.ts      # launch Chrome (channel:"chrome")
│   ├── capture.ts      # navigate + settle + screenshot
│   ├── diff.ts         # pixelmatch (crop-to-common) → DiffResult
│   ├── sources/        # baseline resolvers: url / image / figma
│   ├── htmlReport.ts   # buildReportHtml(summary) → report.html
│   ├── json.ts         # buildJsonPayload(summary) → absolute-path agent payload
│   ├── report.ts       # writes summary.json + report.html
│   └── types.ts        # RunResult / Summary / SCHEMA_VERSION
├── skills/vigress/SKILL.md   # AI skill (symlinked into ~/.claude/skills)
├── .env.example
└── out/                # artifacts (git-ignored)
```

---

## Testing

```bash
bun test
```

Unit tests cover the pure logic only (diff, config, sources parsing, HTML
report, JSON payload) — no browser, no network. The browser/capture/diff/video
pipeline is verified by running a real comparison.

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
