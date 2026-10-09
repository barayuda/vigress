# Dashboard roadmap

Direction for growing `vigress dashboard` from a run-directory cleaner into the
place where results are reviewed, baselines are blessed and comparisons are
started. Agreed scope: review first, then run, then share; served over
Tailscale; zero-dependency page (no build step), as today.

## Principles

- **Tracer bullets.** Each stage starts with the thinnest end-to-end slice
  (manifest/file → pure function → API → page) and fills out from there.
- **Pure vs I/O.** Decisions live in `dashboard.ts` (pure, unit-tested);
  `server.ts` stays a thin shell; the page is `dashboardHtml.ts` (markup) + `dashboardClient.js` (behaviour)
  and renders data with `textContent` only. File-system checks are injected
  into pure functions so they test without a disk.
- **One source of truth.** The dashboard calls the same code the CLI uses
  (`upsertBaseline`, `buildManifestEntry`, the run pipeline). It never
  re-implements a CLI rule.
- **No output-schema changes.** Stages change the dashboard API, not
  `summary.json`.

## Security model (decide before Stage 2)

The server keeps binding `127.0.0.1`. Sharing is `tailscale serve --https`
proxying to it, tailnet only (never `funnel`).

- **Reads** are open to the tailnet.
- **Writes** (keep, delete, cleanup, approve, run) need an allowlisted
  Tailscale login (`Tailscale-User-Login` header set by `tailscale serve`)
  or a request from loopback, plus an `Origin` check against the page's own
  origin. No allowlist configured = writes from loopback only.
- **Runs** may only start from a saved `*.fullcheck.json` config or a
  `baseline:<name>` ref, never a free-text URL, so the page cannot be used to
  make the host browse arbitrary addresses.
- **Jobs** run one at a time, as a child process of the existing CLI, with a
  timeout.

The `CLAUDE.md` rule "binds 127.0.0.1 only — never expose it" stays true: the
proxy is the only path in. Update that bullet when Stage 3 ships.

## Stage 1 — Review

| # | Ticket | Notes |
|---|--------|-------|
| 1.1 | ✅ Baseline manager (read-only) | `GET /api/baselines`: name, approved date, viewport, `fullPage`, source URL, step count, missing artifacts. **Tracer slice.** |
| 1.2 | ✅ Approve from the page | `POST /api/runs/<dir>/approve/<name>`; same checks as `vigress approve` (schema >= 8, target capture present); guarded like delete. |
| 1.3 | ✅ Run detail view | Regions, failed steps, style diffs, `heightDelta`, step diffs per run, from `summary.json`. |
| 1.4 | ✅ Side-by-side viewer | Baseline / target / diff with a slider or toggle, via `/files/`. |
| 1.5 | ✅ Filter, search, auto-refresh | By name, issues, locked, mismatch over N%; poll `/api/runs`. |

## Stage 2 — Run

| # | Ticket | Notes |
|---|--------|-------|
| 2.1 | ✅ Job runner | One-at-a-time child process of the CLI; status endpoint. |
| 2.2 | ✅ Start from a saved config or baseline | Saved configs and `baseline:<name>` re-checks (manifest `sourceUrl`, approved viewport and capture mode). |
| 2.3 | ◐ Live status | Polling every 2 s with the last output lines on failure and the finished run in the list. Live streaming (server-sent events) was **not built**: it is polish, not a safety or correctness matter. |
| 2.4 | ✖ `init-config` / `discover` launcher | **Deliberately not built.** Both take free-text URLs (and `discover` crawls a live page), which breaks the "saved configs and approved baselines only" rule. Use the CLI; revisit only with an allowed-targets design. |

## Stage 3 — Share

| # | Ticket | Notes |
|---|--------|-------|
| 3.1 | ✅ Tailscale serving + write allowlist | The security model above; document `tailscale serve --bg --https=<port> localhost:4600`. |
| 3.2 | ✅ History and trends per run name | Mismatch % and `heightDelta` over time from existing `summary.json` files. |
| 3.3 | ✅ PR links | Each run records its commit/branch (schema 10); the dashboard links the GitHub commit page, which lists its PRs. No network call. |

Remote artifact storage is a separate effort (the manifest reserves
`storage: "remote"`); until then baselines stay per-machine.
