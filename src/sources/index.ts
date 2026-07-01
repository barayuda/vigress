import type { BrowserContext } from "playwright";
import type { Box, RunSpec } from "../config";
import { imageSource } from "./imageSource";
import { figmaSource, parseFigmaRef } from "./figmaSource";
import { urlSource } from "./urlSource";
import type { BoxItem } from "../regions";
import type { StyleItem, StyleValues } from "../style";

export { imageSource, figmaSource, parseFigmaRef, urlSource };

export async function resolveBaseline(
  spec: RunSpec,
  ctx: BrowserContext,
  outPath: string,
  env: NodeJS.ProcessEnv,
  items: BoxItem[] = [],
  styleItems: StyleItem[] = [],
): Promise<{ path: string; boxes: Record<string, Box | null>; styles: Record<string, StyleValues> }> {
  switch (spec.baselineType) {
    case "url":
      return urlSource(ctx, spec.against, outPath, spec.clip, items, styleItems);
    case "image":
      // No DOM to probe — image/figma baselines never resolve style values.
      await imageSource(spec.against, outPath);
      return { path: outPath, boxes: {}, styles: {} };
    case "figma":
      await figmaSource(spec.against, outPath, env.FIGMA_TOKEN ?? "");
      return { path: outPath, boxes: {}, styles: {} };
  }
}
