import { describe, expect, it } from "bun:test";
import { parseCli } from "./args";

describe("parseCli", () => {
  it("parses flags and positionals", () => {
    const r = parseCli(["compare", "a", "b", "--name", "x", "--json", "--region", "name=r1", "--region", "name=r2"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.positionals).toEqual(["compare", "a", "b"]);
    expect(r.values.name).toBe("x");
    expect(r.values.json).toBe(true);
    expect(r.values.region).toEqual(["name=r1", "name=r2"]);
  });
  it("turns an unknown option into a message, not a thrown stack trace", () => {
    const r = parseCli(["--nope"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/nope/);
  });
  it("turns an option value starting with a dash into a message that shows the = form", () => {
    const r = parseCli(["prune", "pg", "--keep", "-1"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/--keep=-/);
    const ok = parseCli(["prune", "pg", "--keep=-1"]);
    expect(ok.ok && ok.values.keep).toBe("-1");
  });
  it("turns a missing option value into a message", () => {
    expect(parseCli(["--target"]).ok).toBe(false);
  });
});
