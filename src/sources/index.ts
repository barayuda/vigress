import type { BrowserContext } from "playwright";
import type { Box, RunSpec } from "../config";
import { imageSource } from "./imageSource";
import { figmaSource, parseFigmaRef } from "./figmaSource";
import { urlSource } from "./urlSource";
import type { BoxItem } from "../regions";

export { imageSource, figmaSource, parseFigmaRef, urlSource };

export async function resolveBaseline(
  spec: RunSpec,
  ctx: BrowserContext,
  outPath: string,
  env: NodeJS.ProcessEnv,
  items: BoxItem[] = [],
): Promise<{ path: string; boxes: Record<string, Box | null> }> {
  switch (spec.baselineType) {
    case "url":
      return urlSource(ctx, spec.against, outPath, spec.clip, items);
    case "image":
      await imageSource(spec.against, outPath);
      return { path: outPath, boxes: {} };
    case "figma":
      await figmaSource(spec.against, outPath, env.FIGMA_TOKEN ?? "");
      return { path: outPath, boxes: {} };
  }
}
