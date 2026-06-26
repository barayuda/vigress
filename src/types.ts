import type { BaselineType, Viewport } from "./config";

export const SCHEMA_VERSION = 1;

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
}

export interface Summary {
  schemaVersion: number;
  outDir: string;
  reportHtml: string; // relative to outDir, e.g. "report.html"
  summaryJson: string; // relative to outDir, e.g. "summary.json"
  runs: RunResult[];
}
