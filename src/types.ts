import type { BaselineType, Viewport, ChecklistItem, StepAction } from "./config";
import type { StyleDiffEntry } from "./style";

// v7: baseline: refs (self-regression) — stepDiffs[], targetUrl, bootstrap runs
// with baseline/diff/mismatch omitted.
export const SCHEMA_VERSION = 7;

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

export interface RunResult {
  name: string;
  baselineType: BaselineType;
  viewport: Viewport;
  // Absent on bootstrap runs (nothing to diff against yet):
  mismatchPixels?: number;
  mismatchPercent?: number;
  target: string; // path relative to outDir
  targetUrl: string; // the URL that was captured (approve records it as sourceUrl)
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
}

export interface Summary {
  schemaVersion: number;
  outDir: string;
  reportHtml: string;
  summaryJson: string;
  runs: RunResult[];
}
