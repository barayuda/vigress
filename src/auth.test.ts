import { describe, it, expect } from "bun:test";
import { storageStateOption, looksLikeLoginRedirect } from "./auth";

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

describe("looksLikeLoginRedirect", () => {
  const app = "https://app.test/reports/contact";
  it("flags a redirect to a login path (expired session)", () => {
    expect(looksLikeLoginRedirect(app, "https://app.test/login")).toBe(true);
    expect(looksLikeLoginRedirect(app, "https://app.test/users/sign-in?next=%2Freports")).toBe(true);
    expect(looksLikeLoginRedirect(app, "https://sso.corp.test/auth/realms/x")).toBe(true);
  });
  it("flags a hash-router login redirect", () => {
    expect(looksLikeLoginRedirect(app, "https://app.test/#/login")).toBe(true);
  });
  it("does not flag staying on (or navigating within) the app", () => {
    expect(looksLikeLoginRedirect(app, app)).toBe(false);
    expect(looksLikeLoginRedirect(app, "https://app.test/reports/contact?tab=all")).toBe(false);
  });
  it("does not flag when the requested URL is itself a login page", () => {
    expect(looksLikeLoginRedirect("https://app.test/login", "https://app.test/login")).toBe(false);
    expect(looksLikeLoginRedirect("https://app.test/signin", "https://app.test/signin?err=1")).toBe(false);
  });
  it("does not false-positive on segments that merely contain a keyword", () => {
    expect(looksLikeLoginRedirect(app, "https://app.test/authors")).toBe(false);
    expect(looksLikeLoginRedirect(app, "https://app.test/blog/sso-explained")).toBe(false);
  });
  it("is false for unparseable URLs", () => {
    expect(looksLikeLoginRedirect(app, "not a url")).toBe(false);
  });
});
