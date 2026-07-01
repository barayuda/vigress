import { join } from "node:path";
import type { Page } from "playwright";
import type { Step } from "./config";
import type { Shot, StepResult } from "./types";

// --- pure ---

export function isCheckStep(step: Step): boolean {
  switch (step.action) {
    case "click":
    case "fill":
    case "select":
    case "hover":
      return true;
    case "press":
    case "scroll":
    case "waitFor":
      return !!step.selector;
    case "screenshot":
      return false;
  }
}

export function stepSummary(results: StepResult[]): { ok: number; total: number } {
  const checks = results.filter((r) => r.check);
  return { ok: checks.filter((r) => r.status === "ok").length, total: checks.length };
}

export function isDestructiveText(text: string): boolean {
  return /\b(delete|remove|log\s?out|sign[-\s]?out|hapus)\b/i.test(text);
}

export const EXPLORE_SELECTORS: string[] = [
  "[role=combobox]",
  "[aria-haspopup]",
  '[data-testid$="-input"]',
  "button[aria-expanded]",
];

export function exploreSelector(): string {
  return EXPLORE_SELECTORS.join(", ");
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

// --- browser (integration; not unit-tested) ---

// Run an explicit interaction flow on the target page. Each action is best-effort:
// a failure is recorded (not thrown) and the flow continues. Returns the saved
// screenshots and a per-step pass/fail result. Dwells after each step so the
// recorded video holds each state (VIGRESS_DWELL ms, default 1000).
export async function runSteps(
  page: Page,
  steps: Step[],
  outDir: string,
  name: string,
): Promise<{ shots: Shot[]; results: StepResult[] }> {
  const shots: Shot[] = [];
  const results: StepResult[] = [];
  const dwell = Number(process.env.VIGRESS_DWELL) || 1000;
  let index = 0;
  for (const st of steps) {
    index++;
    const check = isCheckStep(st);
    try {
      const loc = st.selector ? page.locator(st.selector).first() : null;
      switch (st.action) {
        case "click":
          await loc!.click({ timeout: 5000 });
          break;
        case "fill":
          await loc!.fill(st.value ?? "", { timeout: 5000 });
          break;
        case "select":
          await loc!.selectOption(st.value ?? "", { timeout: 5000 });
          break;
        case "hover":
          await loc!.hover({ timeout: 5000 });
          break;
        case "press":
          if (loc) await loc.press(st.key ?? "", { timeout: 5000 });
          else await page.keyboard.press(st.key ?? "");
          break;
        case "waitFor":
          if (st.selector) await loc!.waitFor({ state: "visible", timeout: 8000 });
          else await page.waitForTimeout(st.ms ?? 0);
          break;
        case "scroll":
          if (st.selector) await loc!.scrollIntoViewIfNeeded({ timeout: 5000 });
          else await page.evaluate((by) => window.scrollBy(0, by), st.by ?? 0);
          break;
        case "screenshot": {
          const rel = `${slug(name)}.${slug(st.name ?? "shot")}.png`;
          await page.screenshot({ path: join(outDir, rel), animations: "disabled", caret: "hide" });
          shots.push({ name: st.name ?? "shot", path: rel });
          break;
        }
      }
      results.push({ index, action: st.action, selector: st.selector, check, status: "ok" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ index, action: st.action, selector: st.selector, check, status: "failed", error: msg });
      process.stderr.write(`vigress: step ${index} '${st.action}' failed: ${msg}\n`);
    }
    await page.waitForTimeout(dwell);
  }
  return { shots, results };
}

// Default when no explicit steps: open/close up to 6 safe controls, recorded.
// Never submits/navigates/mutates; aborts and stops if a click changes the URL.
export async function autoExplore(page: Page): Promise<void> {
  const deadline = Date.now() + 12000;
  let handled = 0;
  const controls = await page.locator(exploreSelector()).all();
  for (const c of controls) {
    if (handled >= 6 || Date.now() > deadline) break;
    try {
      if (!(await c.isVisible())) continue;
      const text = (await c.textContent()) ?? "";
      if (isDestructiveText(text)) continue;
      await c.scrollIntoViewIfNeeded({ timeout: 3000 });
      const url = page.url();
      await c.click({ timeout: 3000 });
      handled++;
      await page.waitForTimeout(1000);
      if (page.url() !== url) {
        await page.goBack().catch(() => {});
        break;
      }
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
    } catch {
      /* skip this control */
    }
  }
}
