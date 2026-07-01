import type { Page } from "playwright";
import type { Box, Viewport } from "./config";
import { isDestructiveText } from "./steps";

// A DOM element vigress considers a candidate for functional testing: something
// clickable/fillable/selectable with a resolvable box and (ideally) a stable
// identifier. Plain JSON-serializable — produced in-browser, consumed in Node.
export interface Candidate {
  tag: string;
  role?: string;
  hasPopup?: boolean;
  testid?: string;
  id?: string;
  ariaLabel?: string;
  text?: string;
  nthPath: string; // fallback CSS path when nothing else identifies the element
  box: Box;
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "control"
  );
}

// --- pure ---

// Chooses the most stable selector for a candidate: data-testid > id >
// aria-label > the fallback DOM path. Matches the precedence a human would
// use when hand-writing a fullcheck config.
export function pickSelector(c: Candidate): string {
  if (c.testid) return `[data-testid="${c.testid}"]`;
  if (c.id) return `#${c.id}`;
  if (c.ariaLabel) return `[aria-label="${c.ariaLabel}"]`;
  return c.nthPath;
}

// Discovery must never suggest a step that could mutate or destroy data —
// reuses the same destructive-text heuristic auto-explore already trusts.
export function isSafeCandidate(c: Candidate): boolean {
  return !isDestructiveText(c.text ?? "");
}

// Keeps the first candidate seen for each resolved selector — a data-testid
// or id can appear more than once in a raw DOM scan (e.g. a wrapper and its
// inner icon both carry attributes the scan matched).
export function dedupeCandidates(cs: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cs) {
    const key = pickSelector(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// Groups boxes into horizontal bands: sorts by y, then merges any box whose
// top edge is within `gapPx` of the running band's bottom edge. Mirrors how a
// human eyeballs a page into sections (header, filter row, cards, table) —
// deliberately coarse; a generated region is a starting point, not a verdict.
export function clusterBoxesIntoRegions(boxes: Box[], gapPx = 32): Box[] {
  if (boxes.length === 0) return [];
  const sorted = [...boxes].sort((a, b) => a.y - b.y);
  const bands: Box[] = [];
  let top = sorted[0].y;
  let bottom = sorted[0].y + sorted[0].height;
  let left = sorted[0].x;
  let right = sorted[0].x + sorted[0].width;
  for (let i = 1; i < sorted.length; i++) {
    const b = sorted[i];
    if (b.y <= bottom + gapPx) {
      bottom = Math.max(bottom, b.y + b.height);
      left = Math.min(left, b.x);
      right = Math.max(right, b.x + b.width);
    } else {
      bands.push({ x: left, y: top, width: right - left, height: bottom - top });
      top = b.y;
      bottom = b.y + b.height;
      left = b.x;
      right = b.x + b.width;
    }
  }
  bands.push({ x: left, y: top, width: right - left, height: bottom - top });
  return bands;
}

export interface DiscoveredConfigInput {
  page: string;
  target: string;
  against: string;
  viewport?: Viewport;
  regions: Box[]; // pre-clustered (see clusterBoxesIntoRegions)
  steps: Candidate[]; // pre-filtered/deduped/capped, in the order to click them
}

// Assembles a run-ready fullcheck config from already-discovered data. Pure —
// the DOM crawl (extractCandidates) and this assembly are deliberately split
// so the assembly logic (naming, selector choice, step shape) is unit-tested
// without a browser.
export function buildDiscoveredConfig(input: DiscoveredConfigInput): Array<Record<string, unknown>> {
  const viewport = input.viewport ?? { width: 1440, height: 1000 };
  const regions = input.regions.map((box, i) => ({
    name: `region-${i + 1}`,
    clip: box,
    maxMismatch: 5,
  }));
  const checklist = regions.map((r) => ({
    aspect: `${r.name} visual parity`,
    region: r.name,
    verdict: "unresolved" as const,
  }));
  const steps: Record<string, unknown>[] = [];
  input.steps.forEach((c, i) => {
    const n = String(i + 1).padStart(2, "0");
    const label = slug(c.testid || c.ariaLabel || c.text || c.id || c.tag);
    steps.push({ action: "click", selector: pickSelector(c) });
    steps.push({ action: "screenshot", name: `${n}-${label}` });
    if (c.hasPopup || c.role === "combobox" || c.tag === "select") {
      steps.push({ action: "press", key: "Escape" });
    }
  });
  return [
    {
      name: `${input.page}-fullcheck`,
      target: input.target,
      against: input.against,
      viewport,
      regions,
      mask: [],
      checklist,
      steps,
    },
  ];
}

// --- browser (integration; not unit-tested) ---

// Read-only DOM crawl — never clicks or types. Runs a single page.evaluate to
// collect every visible, enabled, functionally-relevant element and its box.
// The generated steps only click when the resulting config is later *run*
// (via `--config <page>.fullcheck.json`), not during discovery itself.
export async function extractCandidates(page: Page, max = 200): Promise<Candidate[]> {
  return page.evaluate((maxCount) => {
    function nthPath(el: Element): string {
      const parts: string[] = [];
      let node: Element | null = el;
      while (node && node.nodeType === 1 && parts.length < 6) {
        let idx = 1;
        let sib = node.previousElementSibling;
        while (sib) {
          if (sib.tagName === node.tagName) idx++;
          sib = sib.previousElementSibling;
        }
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${idx})`);
        node = node.parentElement;
      }
      return parts.join(" > ");
    }
    function isVisible(el: Element): boolean {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el as HTMLElement);
      return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0;
    }
    const SELECTOR =
      "button, [role=button], a[href], input:not([type=hidden]), select, textarea, " +
      "[data-testid], [role=combobox], [aria-haspopup]";
    const out: Array<{
      tag: string;
      role?: string;
      hasPopup?: boolean;
      testid?: string;
      id?: string;
      ariaLabel?: string;
      text?: string;
      nthPath: string;
      box: { x: number; y: number; width: number; height: number };
    }> = [];
    for (const el of Array.from(document.querySelectorAll(SELECTOR))) {
      if (out.length >= maxCount) break;
      if (!isVisible(el)) continue;
      const he = el as HTMLButtonElement;
      if (he.disabled) continue;
      const r = he.getBoundingClientRect();
      out.push({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute("role") || undefined,
        hasPopup: el.hasAttribute("aria-haspopup") || undefined,
        testid: el.getAttribute("data-testid") || undefined,
        id: el.id || undefined,
        ariaLabel: el.getAttribute("aria-label") || undefined,
        text: (he.innerText || he.getAttribute("value") || "").trim().slice(0, 60) || undefined,
        nthPath: nthPath(el),
        box: { x: r.x, y: r.y, width: r.width, height: r.height },
      });
    }
    return out;
  }, max);
}

// Lightweight navigate-and-settle for discovery — no screenshot/video needed,
// just enough of capturePage's wait strategy to let the SPA hydrate.
export async function gotoAndSettle(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
}
