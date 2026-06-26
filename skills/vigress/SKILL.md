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
  --state auth.state.json --video --out out --json
```

Outputs in `out/`: `<name>.{target,baseline,diff}.png`, `video/*.webm`,
`summary.json`, `report.html` (open it to review).

## Baselines (auto-detected from `--against`)
- `https://…` → capture that URL  ·  `./file.png` → use that image  ·
  `figma:FILEKEY/NODEID` → Figma REST export (needs `FIGMA_TOKEN`).

## Batch
`bun run src/cli.ts --config comparisons.json` where the file is
`[{ "name","target","against","clip?","viewport?" }, …]`.

## For AI agents
- Pass `--json`: stdout is a single object `{ schemaVersion, outDir, reportHtml,
  runs:[{ name, mismatchPercent, target, baseline, diff, video }] }` with absolute
  paths — Read the `diff` PNG; open `reportHtml` for the human view.
- `--quiet` to suppress chatter; `--max-mismatch <pct>` to make it exit non-zero
  (gate). The mismatch % is noisy (token/shell/render differences) — treat the
  diff image + video as the real signal, not a hard pass/fail, unless gating.

## Best practices
- Match the viewport on both sides (`--viewport WxH`, default 1440×900).
- Use `--clip x,y,w,h` to crop to a content region and cut shell noise.
- Reuse one `--state` across runs; re-run `vigress login` when it expires.
