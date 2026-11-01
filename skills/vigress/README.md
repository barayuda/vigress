# vigress

Visual regression for web pages. It opens a page (the **target**) in real Chrome or Edge and compares it with a
**baseline**: another URL, a saved image, a Figma frame, or a capture you approved earlier. You get a pixel-diff
image, a video of the session, an HTML report and a JSON result the agent reads.

This file is for people. The agent reads [`SKILL.md`](SKILL.md). The CLI it drives lives in
[README of this repo](../../README.md), which has the full command reference.

| | |
| --- | --- |
| Needs | [Bun](https://bun.sh) and Chrome or Edge. `FIGMA_TOKEN` only for Figma baselines |
| Does not need | Anything installed in the app you test. The CLI stays outside your project |
| Install note | The skill alone is not enough. `npx skills` copies `skills/vigress/` only, so set up the CLI once (below) |
| Never does | Run `login` or `dashboard` itself (both block, so it asks you), print `*.state.json`, or install Bun without your yes |

## Set up

1. Set up the CLI once, from a clone of this repo (the CLI is the repo root):

   ```bash
   git clone git@github.com:barayuda/vigress.git
   cd vigress
   bun install                 # uses your system Chrome, no browser download
   bun link                    # optional: gives you a global `vigress` command
   cp .env.example .env        # set FIGMA_TOKEN only if you compare against Figma
   ```

   No Bun? The agent checks first and asks before it installs anything.

2. Link the skill, so `git pull` updates it (run from the repo root):

   ```bash
   ln -s "$PWD/skills/vigress" ~/.claude/skills/vigress
   ```

3. Tell the agent where the CLI is. Without `bun link` it must run `bun run src/cli.ts` from the repo root. With
   `bun link`, it can use `vigress` from any folder. Say which one in your first request:

   > The CLI is linked as `vigress`.

   or

   > The CLI is in `~/path/to/vigress`. Run it from there.

## How to use

Describe the task, or call the skill: `/vigress <request>` (Claude Code, linked or `npx skills` install),
`/public-website-skills:vigress <request>` (plugin install), `$vigress <request>` (Codex). The request needs a
**target**, a **baseline**, and the **viewport** if it is not 1440x900. Replace the placeholders in `<...>`.

### 1. Compare a page with staging

Use it for a migration or a new route against the old one.

> /vigress Compare `http://localhost:3000/pricing` with `https://staging.example.com/pricing`. Full page,
> viewport 1440x900. Tell me which areas differ and show me the diff image.

### 2. Compare with a Figma frame

Needs `FIGMA_TOKEN` in `.env`. The frame id is in the Figma URL (`node-id=12-345` becomes `12:345`).

> /vigress Compare `http://localhost:3000/pricing` with the Figma frame `figma:<FILEKEY>/<NODE-ID>`. Crop to
> the content area and ignore the header. List the differences in colour, size and spacing.

### 3. Compare a page that needs login

Login needs a person, so you run it yourself. In Claude Code, type the line with a leading `!` so it runs in the
session:

```bash
! vigress login --url https://staging.example.com --state auth.state.json
```

Sign in in the window that opens, then press Enter in the terminal. Then:

> /vigress Check that the saved session `auth.state.json` is still valid. If it is, compare
> `https://staging.example.com/reports` with `http://localhost:3000/reports` using that session.

`auth.state.json` holds a live login. It is gitignored. Never commit it or paste it into a chat.

### 4. Approve a baseline, then catch regressions

Run once when the page is right, then after every change.

> /vigress Compare `http://localhost:3000/pricing` with `https://staging.example.com/pricing`. If I agree the
> result is good, approve it as the baseline named `pricing`.

Later:

> /vigress Run `pricing` against its approved baseline. Fail if the mismatch is above 2 percent. Do not
> re-approve anything.

The agent asks before it replaces an existing baseline, because approving blesses even a failing run.

### 5. Before and after a change

> /vigress Capture `http://localhost:3000/pricing` as `before` now. I will change the CSS, then ask you to
> capture `after` and tell me what moved.

When you are done:

> /vigress Capture `after` for `pricing` and show me what changed. Which changes look unintended?

If the dashboard gave you a "before/after review" prompt, paste it in whole. The agent fixes the listed FIX steps,
keeps the KEEP steps, and re-runs the exact command in it.

### 6. Check a whole page, including filters and downloads

> /vigress Build a full check for `https://staging.example.com/reports` against `http://localhost:3000/reports`.
> Discover the page structure first, show me the config before you run it, and cover every filter. Save it as
> `reports.fullcheck.json`.

`*.fullcheck.json` holds your app's URLs and selectors, so it stays in your project and is never committed here.

### Tips for good requests

- Give **both** URLs and the same viewport. Different widths give a diff that means nothing.
- Name what to ignore: "ignore the date badge and the live counts". It masks them so they do not show as changes.
- Name what matters: "the table and the filter bar". It scores those regions on their own.
- Ask for the **diff image and the video**, not only the percentage. A single number is noisy (fonts and
  rendering differ), so the agent judges by the image.
- Do not paste tokens into the request. Put them in `.env`.

## What you get

Each run writes to a new folder, so earlier runs are never overwritten. The agent reads the exact path from the
JSON result and tells you where it is.

```text
out/2026-11-01_10-30-00/
├── <name>.target.png  <name>.baseline.png  <name>.diff.png
├── video/*.webm
├── summary.json  checklist.md
└── report.html                    open this one
```

`vigress dashboard` serves these runs in a browser. It blocks until Ctrl-C, so run it yourself. See the
[README](../../README.md#dashboard).

## Common problems

| Problem | Fix |
| --- | --- |
| `bun: command not found` | Say yes when the agent offers to install Bun, or install it from [bun.sh](https://bun.sh) and open a new shell |
| `bun run src/cli.ts` cannot find the file | You are not in the repo root. Run `bun link` there, then tell the agent the CLI is linked as `vigress` |
| "session has likely expired" | The saved login ran out. Run the `login` command again yourself |
| `FIGMA_TOKEN is required for a figma: baseline` | Set `FIGMA_TOKEN` in the `.env` in the repo root |
| Exit code 2 on a `baseline:` run | No baseline yet, or the viewport or full-page setting differs from the approved one |
| Blank sections in a full-page capture | Lazy or scroll-reveal content did not load. Mask that block or compare a smaller region |
| Mismatch is high but the pages look the same | Fonts and rendering differ between machines. Read the diff image and use per-region checks |
