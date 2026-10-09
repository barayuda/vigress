import { describe, expect, it } from "bun:test";
import { prepareBeforeAfter } from "./beforeAfter";
import { emptyManifest, upsertBaseline } from "./baselines";
import type { ManifestEntry } from "./baselines";

const entry = (over: Partial<ManifestEntry> = {}): ManifestEntry => ({
  storage: "local", approvedAt: "t", approvedFrom: "out/x", viewport: { width: 1280, height: 800 },
  sourceUrl: "https://app.test/contact", artifacts: { main: "out/x/c.target.png", steps: {} }, ...over,
});
const withBaseline = (over: Partial<ManifestEntry> = {}) => upsertBaseline(emptyManifest(), "contact", entry(over));

describe("before", () => {
  it("needs a name and a --target", () => {
    const a = prepareBeforeAfter("before", undefined, {}, null);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe(2);
    const b = prepareBeforeAfter("before", "contact", {}, null);
    expect(b.ok).toBe(false);
    if (!b.ok) { expect(b.code).toBe(2); expect(b.message).toMatch(/--target/); }
  });
  it("captures and blesses: a baseline: run with --update-baseline, named after the baseline", () => {
    const r = prepareBeforeAfter("before", "contact", { target: "https://app.test/contact" }, null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.patch).toEqual({ against: "baseline:contact", name: "contact", "update-baseline": true });
  });
  it("re-blessing an existing baseline defaults to its viewport and capture mode", () => {
    const r = prepareBeforeAfter("before", "contact", { target: "https://app.test/contact" }, withBaseline({ fullPage: true }));
    expect(r.ok && r.patch).toEqual({ against: "baseline:contact", name: "contact", "update-baseline": true, viewport: "1280x800", "full-page": true });
  });
  it("an explicit --viewport is kept (the run's own baseline check then decides)", () => {
    const r = prepareBeforeAfter("before", "contact", { target: "https://x", viewport: "800x600" }, withBaseline());
    expect(r.ok && "viewport" in r.patch).toBe(false);
  });
  it("refuses --against (before/after set it themselves)", () => {
    const r = prepareBeforeAfter("before", "contact", { target: "https://x", against: "https://y" }, null);
    expect(r.ok).toBe(false);
  });
});

describe("after", () => {
  it("needs an approved baseline, and says how to make one", () => {
    const r = prepareBeforeAfter("after", "contact", {}, null);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.code).toBe(1); expect(r.message).toMatch(/vigress before contact --target/); }
    expect(prepareBeforeAfter("after", "nope", {}, withBaseline()).ok).toBe(false);
    expect(prepareBeforeAfter("after", "__proto__", {}, withBaseline()).ok).toBe(false);
  });
  it("re-checks the approved page: target, viewport and capture mode default from the baseline", () => {
    const r = prepareBeforeAfter("after", "contact", {}, withBaseline({ fullPage: true }));
    expect(r.ok && r.patch).toEqual({
      against: "baseline:contact", name: "contact", target: "https://app.test/contact", viewport: "1280x800", "full-page": true,
    });
  });
  it("lets --target point somewhere else (e.g. after deploying to staging); never blesses", () => {
    const r = prepareBeforeAfter("after", "contact", { target: "https://staging.test/contact" }, withBaseline());
    expect(r.ok && "target" in r.patch).toBe(false); // the user's own target stays
    const bad = prepareBeforeAfter("after", "contact", { "update-baseline": true }, withBaseline());
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/never blesses/);
  });
  it("refuses a source URL that is not http(s)", () => {
    const r = prepareBeforeAfter("after", "contact", {}, withBaseline({ sourceUrl: "file:///etc/passwd" }));
    expect(r.ok).toBe(false);
  });
});
