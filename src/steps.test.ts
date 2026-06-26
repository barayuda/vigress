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
