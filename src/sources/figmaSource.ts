import { writeFileSync } from "node:fs";

export function parseFigmaRef(against: string): { fileKey: string; nodeId: string } {
  const ref = against.replace(/^figma:/, "");
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`Malformed figma ref "${against}" — expected figma:FILEKEY/NODEID`);
  }
  return { fileKey: ref.slice(0, slash), nodeId: ref.slice(slash + 1) };
}

// scale=1 keeps the export at the frame's design size — the target screenshot is
// captured at deviceScaleFactor 1, and the diff crops both images to their common
// top-left, so a 2x export would compare the page against a quarter of the design.
export function figmaImageApiUrl(fileKey: string, nodeId: string): string {
  return `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=1`;
}

// Figma REST: get a PNG export URL for the node, then download it. Returns outPath.
export async function figmaSource(against: string, outPath: string, token: string): Promise<string> {
  if (!token) throw new Error("FIGMA_TOKEN is required for a figma: baseline");
  const { fileKey, nodeId } = parseFigmaRef(against);
  const api = figmaImageApiUrl(fileKey, nodeId);
  const meta = await fetch(api, { headers: { "X-Figma-Token": token } });
  if (!meta.ok) throw new Error(`Figma API error ${meta.status} for ${fileKey}`);
  const body = (await meta.json()) as { err?: string; images: Record<string, string | null> };
  if (body.err) throw new Error(`Figma API: ${body.err}`);
  const imageUrl = body.images[nodeId];
  if (!imageUrl) throw new Error(`Figma returned no image for node ${nodeId}`);
  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`Failed to download Figma export: ${img.status}`);
  writeFileSync(outPath, Buffer.from(await img.arrayBuffer()));
  return outPath;
}
