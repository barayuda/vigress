import type { BrowserContext } from "playwright";
import type { RunSpec } from "../config";
import { imageSource } from "./imageSource";
import { figmaSource, parseFigmaRef } from "./figmaSource";
import { urlSource } from "./urlSource";

export { imageSource, figmaSource, parseFigmaRef, urlSource };

// Produce a PNG at outPath to diff the target against.
export async function resolveBaseline(
  spec: RunSpec,
  ctx: BrowserContext,
  outPath: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  switch (spec.baselineType) {
    case "url":
      return urlSource(ctx, spec.against, outPath, spec.clip);
    case "image":
      return imageSource(spec.against, outPath);
    case "figma":
      return figmaSource(spec.against, outPath, env.FIGMA_TOKEN ?? "");
  }
}
