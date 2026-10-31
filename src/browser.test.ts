import { describe, it, expect } from "bun:test";
import { browserChannel, launchArgs } from "./browser";

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

describe("launchArgs", () => {
  it("sizes the window to a recorded viewport, so the video is not cropped", () => {
    expect(launchArgs({ width: 393, height: 873 })).toEqual(["--window-size=393,873"]);
  });
  it("adds nothing without a window size", () => {
    expect(launchArgs()).toEqual([]);
  });
});
