import { describe, it, expect } from "bun:test";
import { styleProps, diffStyleValues, DEFAULT_STYLE_PROPS } from "./style";

describe("styleProps", () => {
  it("returns the default set when style is true", () => {
    expect(styleProps(true)).toEqual(DEFAULT_STYLE_PROPS);
  });
  it("returns the explicit list when given", () => {
    expect(styleProps(["color", "padding"])).toEqual(["color", "padding"]);
  });
  it("returns undefined for false, undefined, or an empty array", () => {
    expect(styleProps(false)).toBeUndefined();
    expect(styleProps(undefined)).toBeUndefined();
    expect(styleProps([])).toBeUndefined();
  });
});

describe("diffStyleValues", () => {
  it("matches identical values", () => {
    const t = { color: "rgb(0, 0, 0)" };
    const b = { color: "rgb(0, 0, 0)" };
    expect(diffStyleValues(t, b, ["color"])).toEqual([
      { property: "color", target: "rgb(0, 0, 0)", baseline: "rgb(0, 0, 0)", match: true },
    ]);
  });

  it("normalizes incidental whitespace before comparing", () => {
    const t = { color: "rgb(0,0,0)" };
    const b = { color: "rgb(0, 0, 0)" };
    expect(diffStyleValues(t, b, ["color"])[0].match).toBe(true);
  });

  it("flags a real mismatch", () => {
    const t = { backgroundColor: "rgb(255, 255, 255)" };
    const b = { backgroundColor: "rgb(242, 244, 249)" };
    expect(diffStyleValues(t, b, ["backgroundColor"])[0]).toEqual({
      property: "backgroundColor",
      target: "rgb(255, 255, 255)",
      baseline: "rgb(242, 244, 249)",
      match: false,
    });
  });

  it("treats a null side (unresolved selector) as a non-match", () => {
    expect(diffStyleValues(null, { color: "red" }, ["color"])[0].match).toBe(false);
    expect(diffStyleValues({ color: "red" }, null, ["color"])[0].match).toBe(false);
    expect(diffStyleValues(null, null, ["color"])[0].match).toBe(false);
  });

  it("reports a property missing from one side as null, not thrown", () => {
    const out = diffStyleValues({ color: "red" }, {}, ["color"]);
    expect(out).toEqual([{ property: "color", target: "red", baseline: null, match: false }]);
  });

  it("preserves property order from the requested props list", () => {
    const t = { a: "1", b: "2" };
    const b2 = { a: "1", b: "9" };
    const out = diffStyleValues(t, b2, ["b", "a"]);
    expect(out.map((o) => o.property)).toEqual(["b", "a"]);
  });
});
