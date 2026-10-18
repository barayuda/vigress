import { describe, expect, it } from "bun:test";
import { buildStepPrompt, isCardStep, sidesFor, validatePicks, type StepPromptInput } from "./stepPrompt";

const END =
  "Do not run `vigress approve`, `--update-baseline` or `vigress before`. Stop and tell me what you changed; I will approve it myself.";
const ASK = "Re-create the after run the way it was made; if you don't know how, ask me before guessing.";

describe("sidesFor", () => {
  it("offers only before for a missing step", () => {
    expect(sidesFor({ verdict: "missing" })).toEqual(["before"]);
  });
  it("offers only after for a new step", () => {
    expect(sidesFor({ verdict: "new" })).toEqual(["after"]);
  });
  it("offers both sides otherwise", () => {
    expect(sidesFor({ verdict: "ok" })).toEqual(["before", "after"]);
    expect(sidesFor({ verdict: "mismatch" })).toEqual(["before", "after"]);
  });
});

describe("isCardStep", () => {
  it("is false at exactly the hide-below value", () => {
    expect(isCardStep({ verdict: "ok", mismatchPercent: 0.1 }, 0.1)).toBe(false);
  });
  it("is true above the hide-below value", () => {
    expect(isCardStep({ verdict: "ok", mismatchPercent: 0.11 }, 0.1)).toBe(true);
  });
  it("is always true for new and missing steps", () => {
    expect(isCardStep({ verdict: "new", mismatchPercent: 0 }, 0.1)).toBe(true);
    expect(isCardStep({ verdict: "missing", mismatchPercent: 0 }, 0.1)).toBe(true);
  });
  it("ignores the verdict for steps in both runs", () => {
    expect(isCardStep({ verdict: "ok", mismatchPercent: 5 }, 0.1)).toBe(true);
  });
});

describe("validatePicks", () => {
  const available = [
    { name: "open menu", verdict: "mismatch" as const },
    { name: "added step", verdict: "new" as const },
    { name: "gone step", verdict: "missing" as const },
  ];
  it("rejects an unknown step name and names it", () => {
    const r = validatePicks(available, { "no such step": "before" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("no such step");
  });
  it("rejects keep-before on a new step", () => {
    expect(validatePicks(available, { "added step": "before" }).ok).toBe(false);
  });
  it("rejects keep-after on a missing step", () => {
    expect(validatePicks(available, { "gone step": "after" }).ok).toBe(false);
  });
  it("rejects an empty picks object", () => {
    expect(validatePicks(available, {})).toEqual({ ok: false, message: "nothing marked" });
  });
  it("accepts a valid mix", () => {
    expect(
      validatePicks(available, { "open menu": "after", "added step": "after", "gone step": "before" }),
    ).toEqual({ ok: true });
  });
});

function fixture(over: Partial<StepPromptInput> = {}): StepPromptInput {
  return {
    mode: "baseline",
    comparison: "booking-engine",
    targetUrl: "https://example.test/book",
    beforeLabel: 'approved baseline "booking" (approved 2026-10-01T10:00:00Z)',
    afterDir: "/abs/out/2026-10-18",
    steps: [
      {
        name: "open menu",
        side: "before",
        verdict: "mismatch",
        mismatchPercent: 1.234,
        before: "/abs/base/open-menu.png",
        after: "/abs/out/2026-10-18/open-menu.png",
        diff: "/abs/out/2026-10-18/open-menu.diff.png",
      },
      {
        name: "new banner",
        side: "after",
        verdict: "new",
        mismatchPercent: 0,
        after: "/abs/out/2026-10-18/new-banner.png",
      },
      {
        name: "checkout",
        side: "before",
        verdict: "ok",
        mismatchPercent: 3,
        before: "/abs/base/checkout.png",
        after: "/abs/out/2026-10-18/checkout.png",
        diff: "/abs/out/2026-10-18/checkout.diff.png",
      },
      {
        name: "footer",
        side: "after",
        verdict: "mismatch",
        mismatchPercent: 0.5,
        before: "/abs/base/footer.png",
        after: "/abs/out/2026-10-18/footer.png",
        diff: "/abs/out/2026-10-18/footer.diff.png",
      },
      {
        name: "old widget",
        side: "before",
        verdict: "missing",
        mismatchPercent: 0,
        before: "/abs/base/old-widget.png",
      },
    ],
    hideBelow: 0.1,
    rerun: "cd /abs/app && bun run /abs/vigress/src/cli.ts after booking --json",
    ...over,
  };
}

describe("buildStepPrompt", () => {
  it("puts FIX steps under the FIX heading and KEEP under KEEP", () => {
    const t = buildStepPrompt(fixture());
    const fixHead = t.indexOf("FIX these steps");
    const firstFix = t.indexOf("1. open menu");
    const keepHead = t.indexOf("KEEP these steps");
    expect(fixHead).toBeGreaterThanOrEqual(0);
    expect(fixHead).toBeLessThan(firstFix);
    expect(firstFix).toBeLessThan(keepHead);
    expect(t.indexOf("old widget")).toBeLessThan(keepHead);
    expect(t.indexOf("new banner")).toBeGreaterThan(keepHead);
  });

  it("numbers steps across both groups, FIX first", () => {
    const t = buildStepPrompt(fixture());
    expect(t).toContain("1. open menu (1.23% differ)");
    expect(t).toContain("2. checkout (3% differ)");
    expect(t).toContain("3. old widget");
    expect(t).toContain("4. new banner");
    expect(t).toContain("5. footer (0.5% differ)");
  });

  it("omits empty groups", () => {
    const t = buildStepPrompt(fixture({ steps: fixture().steps.filter((s) => s.side === "after") }));
    expect(t).not.toContain("FIX these steps");
    expect(t).toContain("KEEP these steps");
  });

  it("omits the KEEP group when only FIX steps are given", () => {
    const t = buildStepPrompt(fixture({ steps: fixture().steps.filter((s) => s.side === "before") }));
    expect(t).toContain("FIX these steps");
    expect(t).not.toContain("KEEP these steps");
  });

  it("lists diff paths in baseline mode and none in compare mode", () => {
    expect(buildStepPrompt(fixture())).toContain("diff:   /abs/out/2026-10-18/open-menu.diff.png");
    const t = buildStepPrompt(fixture({ mode: "compare", compareCheck: "vigress compare A B --json" }));
    expect(t).not.toContain("diff:");
    expect(t).not.toContain(".diff.png");
  });

  it("writes 'missing from the after run' and no after line for missing steps", () => {
    const t = buildStepPrompt(fixture());
    const block = t.slice(t.indexOf("3. old widget"), t.indexOf("KEEP these steps"));
    expect(block).toContain("3. old widget (missing from the after run)");
    expect(block).toContain("before: /abs/base/old-widget.png");
    expect(block).not.toContain("after:");
  });

  it("writes 'new in the after run' for new steps", () => {
    expect(buildStepPrompt(fixture())).toContain("4. new banner (new in the after run)");
  });

  it("shows only the after path for KEEP steps", () => {
    const t = buildStepPrompt(fixture());
    const block = t.slice(t.indexOf("5. footer"), t.indexOf("How to check your work"));
    expect(block).toContain("after:  /abs/out/2026-10-18/footer.png");
    expect(block).not.toContain("before:");
    expect(block).not.toContain("diff:");
  });

  it("always ends with the do-not-approve line", () => {
    expect(buildStepPrompt(fixture()).endsWith(END)).toBe(true);
    expect(buildStepPrompt(fixture({ mode: "compare", rerun: null })).endsWith(END)).toBe(true);
  });

  it("uses the re-run command, and the compare check in compare mode", () => {
    const base = buildStepPrompt(fixture());
    expect(base).toContain("  cd /abs/app && bun run /abs/vigress/src/cli.ts after booking --json");
    expect(base).not.toContain("vigress compare");
    const cmp = buildStepPrompt(fixture({ mode: "compare", compareCheck: "vigress compare A B --json" }));
    expect(cmp).toContain("  cd /abs/app && bun run /abs/vigress/src/cli.ts after booking --json");
    expect(cmp).toContain("  vigress compare A B --json");
  });

  it("falls back to the ask-me line when rerun is null", () => {
    const t = buildStepPrompt(fixture({ rerun: null }));
    expect(t).toContain(ASK);
    expect(buildStepPrompt(fixture())).not.toContain(ASK);
  });

  it("includes the warning line when given", () => {
    const t = buildStepPrompt(fixture({ warning: "Could not match the baseline version; using the latest." }));
    expect(t).toContain("Could not match the baseline version; using the latest.");
    expect(buildStepPrompt(fixture())).not.toContain("Could not match");
  });

  it("states the header, before and after locations", () => {
    const t = buildStepPrompt(fixture());
    expect(t.startsWith('vigress before/after review for "booking-engine" (https://example.test/book)\n')).toBe(true);
    expect(t).toContain('Before: approved baseline "booking" (approved 2026-10-01T10:00:00Z) · After: /abs/out/2026-10-18');
  });

  it("states the done rule with the hide-below value", () => {
    expect(buildStepPrompt(fixture({ hideBelow: 0.25 }))).toContain("at or below 0.25%");
  });
});

describe("buildStepPrompt when the re-run would use a different baseline version", () => {
  const CMP = "cd /abs/app && bun run /abs/vigress/src/cli.ts compare /abs/out/2026-09-30 <outDir from the re-run JSON> --name booking --json";

  it("baseline mode, compare: prints the compare line, says the re-run's stepDiffs are not the check, and points Done at the compare output", () => {
    const t = buildStepPrompt(fixture({ baselineDrift: "compare", compareCheck: CMP }));
    expect(t).toContain("  cd /abs/app && bun run /abs/vigress/src/cli.ts after booking --json");
    expect(t).toContain(`  ${CMP}`);
    expect(t).toContain("The re-run's own stepDiffs are not the check here");
    expect(t).toContain("Done means: every FIX step's mismatchPercent in the compare output is at or below 0.1%");
    expect(t.endsWith(END)).toBe(true);
  });

  it("baseline mode, images: warns, and replaces the stepDiffs Done rule with comparing the screenshots", () => {
    const t = buildStepPrompt(fixture({ baselineDrift: "images" }));
    expect(t).toContain("the re-run would compare against a different baseline version than these before images");
    expect(t).not.toContain("mismatchPercent is at or below");
    expect(t).toContain("compare your new after screenshots with the before images listed above");
    expect(t).toContain("every KEEP step still looks like its after screenshot");
    expect(t).not.toContain("vigress compare");
    expect(t.endsWith(END)).toBe(true);
  });

  it("falls back to the images wording when compare is asked for without a compare command", () => {
    const t = buildStepPrompt(fixture({ baselineDrift: "compare" }));
    expect(t).toContain("the re-run would compare against a different baseline version");
    expect(t).not.toContain("stepDiffs are not the check here");
    expect(t).not.toContain("mismatchPercent");
  });

  it("is unchanged without baselineDrift", () => {
    const t = buildStepPrompt(fixture());
    expect(t).not.toContain("stepDiffs are not the check");
    expect(t).not.toContain("different baseline version");
    expect(t).toContain("Done means: every FIX step's mismatchPercent is at or below 0.1% (a FIX step that was missing is present again), and every KEEP step still looks like its after screenshot.");
  });
});
