import type { BaselineType, Viewport, ChecklistItem, StepAction } from "./config";
import type { StyleDiffEntry } from "./style";

// v7: baseline: refs (self-regression) — stepDiffs[], targetUrl, bootstrap runs
// with baseline/diff/mismatch omitted.
// v8: RunResult.fullPage — lets `approve` record the capture mode in the manifest.
// v9: RunResult.heightDelta — target height minus baseline height when they differ.
// v10: Summary.git — the commit/branch the run was started from.
// v11: Summary.invocation (cwd + argv) and RunResult.baselineRef (name + approvedAt) — how a run was made.
export const SCHEMA_VERSION = 11;

// Where a run was started from (the git repo in the working directory), so a run can be
// tied back to a commit and, through its GitHub page, to a pull request.
export interface GitInfo {
  commit: string; // full 40-hex sha
  branch?: string; // absent on a detached HEAD
  dirty: boolean; // uncommitted changes were present
  url?: string; // GitHub commit page, when origin is a GitHub remote
}

export interface BoxDims {
  width: number;
  height: number;
}

export type RegionVerdict = "pass" | "fail" | "unresolved";
export type RegionReason = "content" | "geometry" | "unresolved";

export interface RegionScore {
  name: string;
  mismatchPixels: number;
  mismatchPercent: number;
  verdict: RegionVerdict;
  reason: RegionReason;
  targetBox?: BoxDims;
  baselineBox?: BoxDims;
  diff?: string; // path relative to outDir; undefined when unresolved
  styleDiff?: StyleDiffEntry[]; // present only when the region's `style` opt-in was set
}

export type RunMode = "static" | "explore" | "steps";

export interface Shot {
  name: string;
  path: string; // relative to outDir
}

export interface StepResult {
  index: number; // 1-based step number
  action: StepAction;
  selector?: string;
  check: boolean; // true = a functionality check (acts on a selector)
  status: "ok" | "failed";
  error?: string; // present when status === "failed"
}

export type StepDiffVerdict = "ok" | "mismatch" | "new" | "missing";

// A named step screenshot diffed against its approved counterpart.
export interface StepDiff {
  name: string;
  mismatchPercent: number;
  diff?: string; // path relative to outDir; absent for "new"/"missing"
  verdict: StepDiffVerdict;
}

/**
 * How a run was started: the working directory and the raw CLI arguments after the script
 * path (so `vigress after home` records ["after", "home", …]). The state file appears only
 * as the path given to --state; its contents are never read into the summary.
 */
export interface Invocation {
  cwd: string; // absolute
  argv: string[];
  // The run settings that came from the environment (only those that were set): VIGRESS_STATE,
  // VIGRESS_VIEWPORT, VIGRESS_SETTLE, VIGRESS_DWELL, VIGRESS_BROWSER, VIGRESS_OUT. Never
  // FIGMA_TOKEN or any other variable. See pickInvocationEnv in rerun.ts.
  env?: Record<string, string>;
}

/** The approved baseline version a run diffed against. */
export interface BaselineRef {
  name: string; // the baseline: ref name
  approvedAt: string; // ISO timestamp of the approved entry
}

export interface RunResult {
  name: string;
  baselineType: BaselineType;
  viewport: Viewport;
  // Absent on bootstrap runs (nothing to diff against yet):
  mismatchPixels?: number;
  mismatchPercent?: number;
  // target PNG height minus baseline PNG height, in px. Present only when
  // non-zero; the diff covers just the common top area, so this is the part
  // of the page that was NOT compared.
  heightDelta?: number;
  target: string; // path relative to outDir
  targetUrl: string; // the URL that was captured (approve records it as sourceUrl)
  fullPage?: true; // captured as a full-page screenshot (absent = viewport capture)
  baseline?: string; // path relative to outDir; absent on bootstrap
  diff?: string; // path relative to outDir; absent on bootstrap
  video?: string; // path relative to outDir
  bootstrap?: true; // first baseline: run approved via --update-baseline
  regions: RegionScore[]; // [] when none
  checklist: ChecklistItem[]; // [] when none
  mode: RunMode; // "static" | "explore" | "steps"
  shots: Shot[]; // [] unless screenshot steps ran
  steps: StepResult[]; // [] for static/explore
  stepDiffs: StepDiff[]; // [] unless a baseline: run with approved step shots
  baselineRef?: BaselineRef; // absent on bootstrap runs and on non-baseline: runs
}

export interface Summary {
  schemaVersion: number;
  outDir: string;
  reportHtml: string;
  summaryJson: string;
  git?: GitInfo; // absent outside a git repo
  invocation?: Invocation; // absent only on pre-v11 summaries
  runs: RunResult[];
}
