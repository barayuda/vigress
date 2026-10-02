import { describe, it, expect } from "bun:test";
import { browserChannel } from "./browser";

describe("browserChannel", () => {
  it("defaults to chrome", () => {
    expect(browserChannel({})).toBe("chrome");
  });
  it("honors VIGRESS_BROWSER", () => {
    expect(browserChannel({ VIGRESS_BROWSER: "msedge" })).toBe("msedge");
  });
  it("rejects unknown channels instead of failing deep inside Playwright", () => {
    expect(() => browserChannel({ VIGRESS_BROWSER: "netscape" })).toThrow(/VIGRESS_BROWSER/);
  });
});
