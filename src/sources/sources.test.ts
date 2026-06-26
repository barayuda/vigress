import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFigmaRef, imageSource } from "./index";

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "vsrc-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe("parseFigmaRef", () => {
  it("parses figma:FILEKEY/NODEID", () => {
    expect(parseFigmaRef("figma:abc123/12:34")).toEqual({ fileKey: "abc123", nodeId: "12:34" });
  });
  it("throws on malformed ref", () => {
    expect(() => parseFigmaRef("figma:bad")).toThrow();
  });
});

describe("imageSource (local file)", () => {
  it("copies a local png to the out path", async () => {
    const srcPath = join(dir, "design.png");
    writeFileSync(srcPath, Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic bytes
    const out = join(dir, "baseline.png");
    const result = await imageSource(srcPath, out);
    expect(result).toBe(out);
    expect(existsSync(out)).toBe(true);
  });
});
