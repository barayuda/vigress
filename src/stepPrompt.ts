import type { StepDiffVerdict } from "./types";

// The prompt a user copies into Claude Code (running in the app repo) after marking changed
// step screenshots "keep before" (a regression: fix the app) or "keep after" (intended:
// don't undo it). Pure text building and validation; the caller supplies absolute paths.

export type KeepSide = "before" | "after";

/** Which sides can be kept: a missing step has no after image, a new step has no before image. */
export function sidesFor(step: { verdict: StepDiffVerdict }): KeepSide[] {
  if (step.verdict === "missing") return ["before"];
  if (step.verdict === "new") return ["after"];
  return ["before", "after"];
}

/**
 * Cards are chosen by the mismatch percentage, never by `verdict === "mismatch"`, which
 * only appears when a --max-mismatch gate was set. new/missing steps always get a card.
 */
export function isCardStep(step: { verdict: StepDiffVerdict; mismatchPercent: number }, hideBelow: number): boolean {
  if (step.verdict === "new" || step.verdict === "missing") return true;
  return step.mismatchPercent > hideBelow;
}

export interface PromptStep {
  name: string;
  side: KeepSide;
  verdict: StepDiffVerdict;
  mismatchPercent: number;
  // Absolute paths.
  before?: string;
  after?: string;
  diff?: string;
}

export interface StepPromptInput {
  mode: "baseline" | "compare";
  comparison: string;
  targetUrl: string;
  // Absolute before run dir, or "approved baseline <name> (approved <approvedAt>)".
  beforeLabel: string;
  afterDir: string;
  // Set when the baseline version the run used couldn't be matched.
  warning?: string;
  steps: PromptStep[];
  hideBelow: number;
  // From buildRerunCommand; null when the run can't be reproduced safely.
  rerun: string | null;
  // From buildCompareCheckCommand; printed in compare mode, and in baseline mode when
  // baselineDrift is "compare".
  compareCheck?: string;
  // Baseline mode only. Set when the plain re-run would diff against a different baseline
  // version than the before images (the baseline was re-approved or rolled back since the
  // run, or this run blessed itself), so its stepDiffs are not a valid check.
  // "compare": compareCheck diffs the before images' run with the re-run; it is the check.
  // "images": no command can check it; the agent compares the screenshots itself.
  baselineDrift?: "compare" | "images";
}

/**
 * Checks the user's picks against the steps that were offered. Server-side guard, so a
 * hand-made request can't ask for an image that doesn't exist.
 */
export function validatePicks(
  available: { name: string; verdict: StepDiffVerdict }[],
  picks: Record<string, KeepSide>,
): { ok: true } | { ok: false; message: string } {
  const entries = Object.entries(picks);
  if (entries.length === 0) return { ok: false, message: "nothing marked" };
  const byName = new Map(available.map((s) => [s.name, s]));
  for (const [name, side] of entries) {
    const step = byName.get(name);
    if (!step) return { ok: false, message: `unknown step: ${name}` };
    if (!sidesFor(step).includes(side)) {
      return { ok: false, message: `step "${name}" is ${step.verdict}; it cannot be kept as ${side}` };
    }
  }
  return { ok: true };
}

const ASK_ME = "Re-create the after run the way it was made; if you don't know how, ask me before guessing.";
const DRIFT_COMPARE =
  "The re-run's own stepDiffs are not the check here: it diffs against a different baseline version than these before images. Read the stepDiffs from the compare line instead.";
const DRIFT_IMAGES =
  "Warning: the re-run would compare against a different baseline version than these before images, so its stepDiffs are not the check.";
const DO_NOT_APPROVE =
  "Do not run `vigress approve`, `--update-baseline` or `vigress before`. Stop and tell me what you changed; I will approve it myself.";

/** Two decimals at most, no trailing zeros: 1.234 -> "1.23", 3 -> "3". */
function pct(n: number): string {
  return String(Number(n.toFixed(2)));
}

function stepBlock(n: number, s: PromptStep, mode: StepPromptInput["mode"]): string[] {
  const note =
    s.verdict === "missing"
      ? "missing from the after run"
      : s.verdict === "new"
        ? "new in the after run"
        : `${pct(s.mismatchPercent)}% differ`;
  const lines = [`${n}. ${s.name} (${note})`];
  if (s.side === "before") {
    if (s.before) lines.push(`   before: ${s.before}`);
    if (s.verdict !== "missing" && s.after) lines.push(`   after:  ${s.after}`);
    if (mode === "baseline" && s.diff) lines.push(`   diff:   ${s.diff}`);
  } else if (s.after) {
    lines.push(`   after:  ${s.after}`);
  }
  return lines;
}

export function buildStepPrompt(p: StepPromptInput): string {
  const fix = p.steps.filter((s) => s.side === "before");
  const keep = p.steps.filter((s) => s.side === "after");

  const out: string[] = [
    `vigress before/after review for "${p.comparison}" (${p.targetUrl})`,
    `Before: ${p.beforeLabel} · After: ${p.afterDir}`,
  ];
  if (p.warning) out.push(p.warning);

  // Numbering runs across both groups, FIX first.
  let n = 0;
  if (fix.length > 0) {
    out.push(
      "",
      "FIX these steps. The after screenshot is a regression; change the app code so it matches before again:",
    );
    for (const s of fix) out.push(...stepBlock(++n, s, p.mode));
  }
  if (keep.length > 0) {
    out.push(
      "",
      "KEEP these steps as they are now. The change is intended; do not undo it while fixing the above:",
    );
    for (const s of keep) out.push(...stepBlock(++n, s, p.mode));
  }

  // A "compare" drift without a compare command falls back to comparing by eye.
  const drift = p.mode !== "baseline" ? undefined : p.baselineDrift === "compare" && !p.compareCheck ? "images" : p.baselineDrift;
  out.push("", "How to check your work:", p.rerun ? `  ${p.rerun}` : `  ${ASK_ME}`);
  if ((p.mode === "compare" || drift === "compare") && p.compareCheck) out.push(`  ${p.compareCheck}`);
  if (drift === "compare") out.push(DRIFT_COMPARE);
  if (drift === "images") out.push(DRIFT_IMAGES);

  const done: string[] = [];
  if (fix.length > 0) {
    const back = fix.some((s) => s.verdict === "missing") ? " (a FIX step that was missing is present again)" : "";
    if (drift === "images") {
      done.push(`compare your new after screenshots with the before images listed above: every FIX step matches its before image again${back}`);
    } else {
      const where = drift === "compare" ? " in the compare output" : "";
      done.push(`every FIX step's mismatchPercent${where} is at or below ${p.hideBelow}%${back}`);
    }
  }
  if (keep.length > 0) done.push("every KEEP step still looks like its after screenshot");
  out.push(`Done means: ${done.join(", and ")}.`);
  out.push(DO_NOT_APPROVE);

  return out.join("\n");
}
