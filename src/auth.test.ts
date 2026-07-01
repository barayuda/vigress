import { describe, it, expect } from "bun:test";
import { storageStateOption } from "./auth";

describe("storageStateOption", () => {
  it("returns an empty object when no path is given", () => {
    expect(storageStateOption(undefined)).toEqual({});
  });
  it("throws a helpful hint when the given path does not exist", () => {
    expect(() => storageStateOption("/tmp/definitely-not-a-real-vigress-state.json")).toThrow(
      /run: vigress login/,
    );
  });
  it("returns { storageState: path } when the file exists", () => {
    // package.json always exists in this repo — any real file proves the happy path.
    expect(storageStateOption("package.json")).toEqual({ storageState: "package.json" });
  });
});
