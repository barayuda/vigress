import { describe, it, expect } from "bun:test";
import { isDestructiveText, EXPLORE_SELECTORS, exploreSelector } from "./steps";

describe("isDestructiveText", () => {
  it("flags destructive labels (case-insensitive, word-boundary)", () => {
    for (const t of ["Delete", "delete row", "Remove", "Log out", "logout", "Sign out", "sign-out", "Hapus"]) {
      expect(isDestructiveText(t)).toBe(true);
    }
  });
  it("does not flag benign labels", () => {
    for (const t of ["Download", "Reload", "removed 3 items", "Export", "Today"]) {
      expect(isDestructiveText(t)).toBe(false);
    }
  });
});

describe("exploreSelector", () => {
  it("joins every safelist entry into one selector", () => {
    const sel = exploreSelector();
    for (const e of EXPLORE_SELECTORS) expect(sel).toContain(e);
    expect(EXPLORE_SELECTORS).toContain('[role=combobox]');
    expect(EXPLORE_SELECTORS).toContain('[data-testid$="-input"]');
  });
});

import { isCheckStep, stepSummary } from "./steps";
import type { StepResult } from "./types";

describe("isCheckStep", () => {
  it("click/fill/select/hover are always checks", () => {
    for (const action of ["click", "fill", "select", "hover"] as const) {
      expect(isCheckStep({ action, selector: "#x" })).toBe(true);
    }
  });
  it("press/scroll/waitFor are checks only with a selector", () => {
    expect(isCheckStep({ action: "press", key: "Escape" })).toBe(false);
    expect(isCheckStep({ action: "press", key: "Enter", selector: "#x" })).toBe(true);
    expect(isCheckStep({ action: "waitFor", ms: 100 })).toBe(false);
    expect(isCheckStep({ action: "waitFor", selector: "#x" })).toBe(true);
    expect(isCheckStep({ action: "scroll", by: 100 })).toBe(false);
    expect(isCheckStep({ action: "scroll", selector: "#x" })).toBe(true);
  });
  it("screenshot is never a check", () => {
    expect(isCheckStep({ action: "screenshot", name: "s" })).toBe(false);
  });
  it("assert is always a check, even without a selector (urlContains-only)", () => {
    expect(isCheckStep({ action: "assert", selector: "#x" })).toBe(true);
    expect(isCheckStep({ action: "assert", urlContains: "/reports" })).toBe(true);
  });
});

describe("stepSummary", () => {
  const mk = (check: boolean, status: "ok" | "failed"): StepResult => ({ index: 1, action: "click", check, status });
  it("counts only check steps", () => {
    expect(stepSummary([mk(true, "ok"), mk(true, "failed"), mk(false, "ok")])).toEqual({ ok: 1, total: 2 });
  });
  it("returns zero total when there are no check steps", () => {
    expect(stepSummary([mk(false, "ok")])).toEqual({ ok: 0, total: 0 });
  });
});
