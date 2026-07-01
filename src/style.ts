import type { Page } from "playwright";

// A sensible default set for the "does color/size/spacing actually match" question —
// callers can override with an explicit property list per region.
export const DEFAULT_STYLE_PROPS: string[] = [
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "fontFamily",
  "padding",
  "margin",
  "border",
  "borderRadius",
  "boxShadow",
];

export type StyleValues = Record<string, string> | null;

export interface StyleDiffEntry {
  property: string;
  target: string | null;
  baseline: string | null;
  match: boolean;
}

// --- pure ---

// Resolves a region's `style` config to the property list to probe: `true` uses
// the default set, a non-empty array is used as-is, anything else disables probing.
export function styleProps(style: string[] | boolean | undefined): string[] | undefined {
  if (style === true) return DEFAULT_STYLE_PROPS;
  if (Array.isArray(style) && style.length > 0) return style;
  return undefined;
}

// Computed-style strings can differ only in incidental whitespace (e.g.
// "rgb(242,244,249)" vs "rgb(242, 244, 249)"); strip all whitespace before
// comparing so that doesn't register as a false mismatch.
function normalize(v: string): string {
  return v.replace(/\s+/g, "");
}

export function diffStyleValues(
  target: StyleValues,
  baseline: StyleValues,
  props: string[],
): StyleDiffEntry[] {
  return props.map((property) => {
    const t = target ? (target[property] ?? null) : null;
    const b = baseline ? (baseline[property] ?? null) : null;
    const match = t !== null && b !== null && normalize(t) === normalize(b);
    return { property, target: t, baseline: b, match };
  });
}

// --- browser (integration; not unit-tested) ---

export interface StyleItem {
  key: string;
  selector?: string;
  props: string[];
}

// Reads computed style for each item's first matching element. A missing
// selector or an element that never resolves reports null for that item
// (mirrors resolveBoxes in regions.ts).
export async function resolveStyles(
  page: Page,
  items: StyleItem[],
): Promise<Record<string, StyleValues>> {
  const out: Record<string, StyleValues> = {};
  for (const it of items) {
    if (!it.selector) {
      out[it.key] = null;
      continue;
    }
    try {
      const values = await page
        .locator(it.selector)
        .first()
        .evaluate((el, props) => {
          const cs = getComputedStyle(el as Element);
          const result: Record<string, string> = {};
          for (const p of props) {
            result[p] = (cs as unknown as Record<string, string>)[p] ?? "";
          }
          return result;
        }, it.props);
      out[it.key] = values;
    } catch {
      out[it.key] = null;
    }
  }
  return out;
}
