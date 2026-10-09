# vigress reference — baselines, history, before/after and compare

Read this when you approve or re-check a baseline, roll back or prune its versions, do a before/after check, or diff two existing runs. Part of the `vigress` skill; the core rules live in `../SKILL.md`.

## Before / after (two commands)

```bash
bun run src/cli.ts before <name> --target <url>   # capture the starting point and bless it as baseline <name>
# ... the change is made ...
bun run src/cli.ts after <name> --json            # re-check against it; target/viewport/--full-page default from the baseline
```

`before` is a normal run with `--against baseline:<name> --update-baseline` (re-blessing keeps the replaced version in history); `after` is `--against baseline:<name>` and **never blesses**. Both accept the usual run flags and gates (`--max-mismatch`, `--state`, ...) but set `--against`/`--name` themselves. Ask before running `before` on an existing name: it changes what future checks compare against (undo with `rollback`). For runs that already exist and no baseline, use `compare` below.

## Compare two runs (before / after, no baseline)

If you captured a page before a change and again after it but never approved a baseline, diff the two existing runs:

```bash
bun run src/cli.ts compare <before-run> <after-run> --name <run> --json
```

A run is a folder path or a folder name under `--out` (take them from the earlier `--json` payloads' `outDir`). `--name` is needed when the runs share more than one comparison. It diffs the **target** capture of the before run against the after run plus the step screenshots they share, and reports `mismatchPercent`, `heightDelta` / `widthDelta` (**after minus before**), and `stepDiffs[]` (`ok`/`mismatch`/`new`/`missing`). It writes nothing unless `--diff <png>` is given, and the result is not a run (not in the list, trends or `approve`). Gates: `--max-mismatch` and `--max-height-delta` (exit 1). Use the same viewport and `--full-page` on both runs — otherwise only the common top area is compared, which `heightDelta` makes visible. For a lasting before/after, prefer a baseline (below): it survives and gates CI.

## Baseline snapshots (self-regression)

Beyond parity checks (target vs staging/Figma), `vigress` supports **self-regression**:
bless a known-good run as the approved baseline, then diff future runs against that snapshot.

### Approve a baseline

```bash
# After a satisfactory run
bun run src/cli.ts approve <name>              # auto-finds newest run containing <name>
bun run src/cli.ts approve <name> --run <dir>  # from a specific run dir
bun run src/cli.ts approve --all               # bless every entry in the newest run
```

`approve` writes `baselines/manifest.json` (git-tracked; commit it). Artifacts stay in place
under `out/` — no copying. The approved run dir becomes precious: deleting it breaks the
baseline until re-approved.

### Use a baseline ref

In a config entry: `"against": "baseline:<name>"` (or `--against baseline:<name>` on the CLI).
Guards: no manifest entry → exit 2 ("bootstrap with --update-baseline"); artifact files missing →
exit 1 ("re-approve or run with --update-baseline"); viewport or `--full-page` mismatch vs manifest → exit 2 (run with the same `--full-page` setting the baseline was approved with).

### Bootstrap / `--update-baseline`

```bash
bun run src/cli.ts --config <page>.fullcheck.json --update-baseline
```

Runs normally, then approves all results. If a `baseline:<name>` ref has no manifest entry yet,
that run is a **bootstrap**: diff phase skipped, captured and approved, `bootstrap: true` in the
result. Second run onward diffs normally. Works in both single-run and batch mode.

> **CI footgun:** `--update-baseline` blesses captures even when a gate trips — the run still exits 1, but the manifest now points at the failing state. Never leave it permanently enabled in CI; use it only for bootstrapping or intentional re-blessing.

### Step-diff verdicts

When a `baseline:` run has approved step shots, each named screenshot step is diffed against
its counterpart → `stepDiffs[]`:

| Verdict | Condition | Gate impact |
|---------|-----------|-------------|
| `ok` | Step in run and manifest, within threshold | none |
| `mismatch` | Step in run and manifest, over `--max-mismatch` | trips `--max-mismatch` |
| `new` | Step in run, not in manifest (newly added) | **never gates** |
| `missing` | Step in manifest, not in run (removed/failed) | trips `--require-steps` |

`mismatch` % counts toward `--max-mismatch`'s worst-of. Adding a step never breaks CI
until re-approval.

### History and rollback

Approving a name again keeps the version it replaces (newest first, max 10), so "before" is no longer lost.

```bash
bun run src/cli.ts history <name>             # current + previous versions, with indexes
bun run src/cli.ts rollback <name> [--to N]   # restore one (default 0 = the previous); the replaced version is kept
```

`prune <name> [--keep N]` (default 3) forgets older versions without deleting files, which unlocks their run dirs for cleanup. Rollback refuses when the target's files are gone from `out/`. Each kept version's run dir stays manifest-locked; do not delete them by hand. Ask before rolling back: it changes what every future `baseline:` run compares against. To see what changed between versions, use `compare <old-run> <current-run>`.

### Parity → bless → regression

1. Run against staging/Figma to verify parity.
2. Bless that run: `approve <name>` (or re-run with `--update-baseline`).
3. Change `against` to `baseline:<name>`. Future runs diff against the approved state.
