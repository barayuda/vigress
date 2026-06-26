import type { BaselineType, Viewport, ChecklistItem } from "./config";

export const SCHEMA_VERSION = 3;

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
}

export type RunMode = "static" | "explore" | "steps";

export interface Shot {
  name: string;
  path: string; // relative to outDir
}

export interface RunResult {
  name: string;
  baselineType: BaselineType;
  viewport: Viewport;
  mismatchPixels: number;
  mismatchPercent: number;
  target: string; // path relative to outDir
  baseline: string; // path relative to outDir
  diff: string; // path relative to outDir
  video?: string; // path relative to outDir
  regions: RegionScore[]; // [] when none
  checklist: ChecklistItem[]; // [] when none
  mode: RunMode; // "static" | "explore" | "steps"
  shots: Shot[]; // [] unless screenshot steps ran
}

export interface Summary {
  schemaVersion: number;
  outDir: string;
  reportHtml: string;
  summaryJson: string;
  runs: RunResult[];
}
