import { describe, it, expect } from "bun:test";
import {
  pickSelector,
  isSafeCandidate,
  dedupeCandidates,
  clusterBoxesIntoRegions,
  buildDiscoveredConfig,
  type Candidate,
} from "./discover";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    tag: "button",
    nthPath: "body > button:nth-of-type(1)",
    box: { x: 0, y: 0, width: 100, height: 30 },
    ...overrides,
  };
}

describe("pickSelector", () => {
  it("prefers data-testid", () => {
    expect(pickSelector(candidate({ testid: "download-btn", id: "x", ariaLabel: "y" }))).toBe(
      '[data-testid="download-btn"]',
    );
  });
  it("falls back to id when no testid", () => {
    expect(pickSelector(candidate({ id: "submit", ariaLabel: "y" }))).toBe("#submit");
  });
  it("falls back to aria-label when no testid or id", () => {
    expect(pickSelector(candidate({ ariaLabel: "Close dialog" }))).toBe('[aria-label="Close dialog"]');
  });
  it("falls back to the nth-of-type path when nothing else resolves", () => {
    expect(pickSelector(candidate({ nthPath: "body > div:nth-of-type(2) > button:nth-of-type(1)" }))).toBe(
      "body > div:nth-of-type(2) > button:nth-of-type(1)",
    );
  });
});

describe("isSafeCandidate", () => {
  it("rejects destructive-sounding text", () => {
    expect(isSafeCandidate(candidate({ text: "Delete account" }))).toBe(false);
    expect(isSafeCandidate(candidate({ text: "Log out" }))).toBe(false);
  });
  it("accepts ordinary controls", () => {
    expect(isSafeCandidate(candidate({ text: "Download" }))).toBe(true);
    expect(isSafeCandidate(candidate({ text: undefined }))).toBe(true);
  });
});

describe("dedupeCandidates", () => {
  it("keeps the first candidate per resolved selector", () => {
    const a = candidate({ testid: "same", box: { x: 0, y: 0, width: 10, height: 10 } });
    const b = candidate({ testid: "same", box: { x: 999, y: 999, width: 10, height: 10 } });
    const c = candidate({ testid: "other" });
    expect(dedupeCandidates([a, b, c])).toEqual([a, c]);
  });
});

describe("clusterBoxesIntoRegions", () => {
  it("returns an empty array for no boxes", () => {
    expect(clusterBoxesIntoRegions([])).toEqual([]);
  });
  it("merges boxes within the gap into one band", () => {
    const boxes = [
      { x: 10, y: 10, width: 100, height: 20 },
      { x: 120, y: 15, width: 80, height: 20 },
    ];
    const bands = clusterBoxesIntoRegions(boxes, 32);
    expect(bands).toHaveLength(1);
    expect(bands[0]).toEqual({ x: 10, y: 10, width: 190, height: 25 });
  });
  it("splits boxes into separate bands when the vertical gap exceeds the threshold", () => {
    const boxes = [
      { x: 0, y: 0, width: 50, height: 20 },
      { x: 0, y: 200, width: 50, height: 20 },
    ];
    const bands = clusterBoxesIntoRegions(boxes, 32);
    expect(bands).toHaveLength(2);
  });
  it("sorts input by y before banding, regardless of input order", () => {
    const boxes = [
      { x: 0, y: 200, width: 50, height: 20 },
      { x: 0, y: 0, width: 50, height: 20 },
    ];
    expect(clusterBoxesIntoRegions(boxes, 32)).toHaveLength(2);
  });
});

describe("buildDiscoveredConfig", () => {
  it("builds one region per clustered box, named region-N, with a checklist entry each", () => {
    const cfg = buildDiscoveredConfig({
      page: "contact",
      target: "http://localhost:3000/reports/contact-v2",
      against: "https://staging.example.com/reports/contact",
      regions: [{ x: 0, y: 0, width: 100, height: 50 }, { x: 0, y: 60, width: 100, height: 50 }],
      steps: [],
    });
    expect(cfg).toHaveLength(1);
    const run = cfg[0] as Record<string, unknown>;
    expect(run.name).toBe("contact-fullcheck");
    const regions = run.regions as Array<Record<string, unknown>>;
    expect(regions.map((r) => r.name)).toEqual(["region-1", "region-2"]);
    const checklist = run.checklist as Array<Record<string, unknown>>;
    expect(checklist).toEqual([
      { aspect: "region-1 visual parity", region: "region-1", verdict: "unresolved" },
      { aspect: "region-2 visual parity", region: "region-2", verdict: "unresolved" },
    ]);
  });

  it("emits a click+screenshot pair per step candidate, using the picked selector", () => {
    const cfg = buildDiscoveredConfig({
      page: "contact",
      target: "http://localhost:3000/x",
      against: "https://staging.example.com/x",
      regions: [],
      steps: [
        candidate({ testid: "download-total", text: "Download" }),
        candidate({ id: "channel-select", role: "combobox", text: "All channels" }),
      ],
    });
    const run = cfg[0] as Record<string, unknown>;
    const steps = run.steps as Array<Record<string, unknown>>;
    expect(steps[0]).toEqual({ action: "click", selector: '[data-testid="download-total"]' });
    expect(steps[1]).toEqual({ action: "screenshot", name: "01-download-total" });
    expect(steps[2]).toEqual({ action: "click", selector: "#channel-select" });
    expect(steps[3]).toEqual({ action: "screenshot", name: "02-all-channels" });
    // combobox-role candidates get an Escape to close the popover before the next step
    expect(steps[4]).toEqual({ action: "press", key: "Escape" });
  });

  it("defaults viewport to 1440x1000 when not given", () => {
    const cfg = buildDiscoveredConfig({
      page: "p", target: "http://t", against: "http://b", regions: [], steps: [],
    });
    expect(cfg[0].viewport).toEqual({ width: 1440, height: 1000 });
  });
});
