import type { BrowserContext } from "playwright";
import type { Box, RunSpec } from "../config";
import { imageSource } from "./imageSource";
import { figmaSource, figmaImageApiUrl, parseFigmaRef } from "./figmaSource";
import { urlSource } from "./urlSource";
import type { BoxItem } from "../regions";
import type { StyleItem, StyleValues } from "../style";

export { imageSource, figmaSource, figmaImageApiUrl, parseFigmaRef, urlSource };

export async function resolveBaseline(
  spec: RunSpec,
  ctx: BrowserContext,
  outPath: string,
  env: NodeJS.ProcessEnv,
  items: BoxItem[] = [],
  styleItems: StyleItem[] = [],
  statePath?: string,
): Promise<{ path: string; boxes: Record<string, Box | null>; styles: Record<string, StyleValues> }> {
  switch (spec.baselineType) {
    case "url": {
      // Baseline captures share the target's clip/viewport/fullPage, so DOM boxes
      // are translated into the same screenshot coordinate space.
      return urlSource(ctx, spec.against, outPath, spec.viewport, spec.clip, items, styleItems, spec.fullPage, statePath);
    }
    case "image":
      // No DOM to probe — image/figma baselines never resolve style values.
      await imageSource(spec.against, outPath);
      return { path: outPath, boxes: {}, styles: {} };
    case "figma":
      await figmaSource(spec.against, outPath, env.FIGMA_TOKEN ?? "");
      return { path: outPath, boxes: {}, styles: {} };
    case "baseline":
      // cli.ts resolves baseline: refs from the manifest itself; reaching here is a bug.
      throw new Error("baseline: refs are resolved in cli.ts, not resolveBaseline");
  }
}
