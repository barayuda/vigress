import { copyFileSync, writeFileSync } from "node:fs";

// Local path → copy. Remote http(s) png → download. Returns outPath.
export async function imageSource(against: string, outPath: string): Promise<string> {
  if (/^https?:\/\//.test(against)) {
    const res = await fetch(against);
    if (!res.ok) throw new Error(`Failed to download baseline image: ${res.status} ${against}`);
    writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    return outPath;
  }
  copyFileSync(against, outPath);
  return outPath;
}
