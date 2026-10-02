INTERNAL

# VIGRESS.md (template — copy into your project root)

How agents run `vigress` visual comparisons in this project. Reference it from the project's `CLAUDE.md` (`@VIGRESS.md`).

## Setup (once per machine)

- `vigress` is installed globally (`bun link` in the vigress repo) and the `vigress` skill is in `~/.claude/skills`.
- Browser: `export VIGRESS_BROWSER=msedge` in `~/.zshrc` (default is Chrome).
- Reports go to `vigress-reports/` in this project (add it to `.gitignore`):
  `export VIGRESS_OUT=vigress-reports` or pass `--out vigress-reports`.

## Rules for agents

- Run `vigress` from the **project root**, never from the vigress repo. `baselines/manifest.json` and all artifact paths are relative to the current directory.
- Always pass `--json`; take artifact paths from the payload (`outDir`, `runs[].diff`), never assume a fixed folder. Each run lands in `vigress-reports/<YYYY-MM-DD_HH-MM-SS>/`.
- Read the `diff` PNGs and the per-region `verdict`/`reason` before reporting. The mismatch % is a noisy signal, not a verdict.
- Keep page configs in this repo as `<page>.fullcheck.json` (generate with `vigress discover <page> --target <url> --against <ref>`, then review the output).
- `vigress login` is interactive: ask the human to run `! vigress login --url <app> --state auth.state.json`. Agents may run `login --check` only. Public pages need no `--state`.
- Never read, print or commit `*.state.json` (live credentials).
- Never delete a `vigress-reports/<timestamp>/` dir that `baselines/manifest.json` references; it breaks the baseline until re-approved. Use `vigress dashboard --out vigress-reports` to clean up safely (it locks those dirs).
- Never leave `--update-baseline` on in CI: it approves a run even when a gate fails.

## Progress workflow (before vs after)

```bash
# 1. Bless the current state (bootstrap) — once per page
vigress --config <page>.fullcheck.json --update-baseline --json

# 2. After changes: diff against the blessed state, gated
vigress --config <page>.fullcheck.json --json --max-mismatch 2 --require-steps
```

For step 2, set `"against": "baseline:<name>"` in the config entry. The manifest key is the entry's own `name`.
Re-bless an accepted change with `vigress approve <name>` and commit `baselines/manifest.json`.

## Reporting prompt

> Run vigress on these pages against their `baseline:` snapshots, write reports to `vigress-reports/`, and summarize per page: mismatch %, failing regions, failed steps, style mismatches, and the `report.html` path.
