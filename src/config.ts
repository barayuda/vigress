import { readFileSync } from "node:fs";

export type BaselineType = "url" | "image" | "figma";

export interface Viewport {
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ChecklistVerdict = "pass" | "fail" | "unresolved" | "manual";

export interface ChecklistItem {
  aspect: string;
  region?: string;
  verdict: ChecklistVerdict;
  workaround?: string;
}

export interface RegionSpec {
  name: string;
  target?: string; // per-side selector
  baseline?: string; // per-side selector
  selector?: string; // both sides
  clip?: Box; // fallback
  maxMismatch?: number;
  // Opt in to a computed-style diff (color/size/spacing) for this region:
  // `true` probes DEFAULT_STYLE_PROPS, an array probes exactly those CSS
  // properties (camelCase, e.g. "backgroundColor"), omitted/false skips it.
  style?: string[] | boolean;
}

export interface MaskSpec {
  target?: string;
  baseline?: string;
  selector?: string;
  clip?: Box;
}

export type StepAction =
  | "click" | "fill" | "select" | "hover" | "press" | "waitFor" | "scroll" | "screenshot";

export interface Step {
  action: StepAction;
  selector?: string;
  value?: string;
  key?: string;
  name?: string; // screenshot name
  ms?: number; // waitFor delay
  by?: number; // scroll px
}

export interface RunSpec {
  name: string;
  target: string;
  against: string;
  baselineType: BaselineType;
  viewport: Viewport;
  clip?: Box;
  video: boolean;
  regions?: RegionSpec[];
  mask?: MaskSpec[];
  checklist?: ChecklistItem[];
  steps?: Step[];
}

export interface GlobalOpts {
  outDir: string;
  statePath?: string;
  json: boolean;
  quiet: boolean;
  maxMismatch?: number;
  threshold: number;
}

export function parseViewport(s?: string): Viewport {
  if (!s) return { width: 1440, height: 900 };
  const m = /^(\d+)x(\d+)$/.exec(s.trim());
  if (!m) return { width: 1440, height: 900 };
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function detectBaselineType(against: string): BaselineType {
  if (/^https?:\/\//.test(against)) return "url";
  if (against.startsWith("figma:")) return "figma";
  return "image";
}

export function parseClip(s?: string): Box | undefined {
  if (!s) return undefined;
  const [x, y, width, height] = s.split(",").map((n) => Number(n.trim()));
  return { x, y, width, height };
}

function nameFromTarget(target: string): string {
  try {
    const segs = new URL(target).pathname.split("/").filter(Boolean);
    return segs[segs.length - 1] ?? "page";
  } catch {
    return "page";
  }
}

export function selectorForSide(
  spec: { target?: string; baseline?: string; selector?: string; clip?: Box },
  side: "target" | "baseline",
): string | undefined {
  return spec[side] ?? spec.selector;
}

// Field-delimited by ';', key/value by the first '='. clip keeps its commas.
function parseKv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// "true"/"1"/"" -> probe DEFAULT_STYLE_PROPS; "false"/"0" -> disabled;
// a comma list -> probe exactly those properties; absent -> undefined (disabled).
function parseStyleKv(v?: string): string[] | boolean | undefined {
  if (v === undefined) return undefined;
  if (v === "true" || v === "1" || v === "") return true;
  if (v === "false" || v === "0") return false;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseRegionFlag(s: string): RegionSpec {
  const kv = parseKv(s);
  return {
    name: kv.name,
    target: kv.target,
    baseline: kv.baseline,
    selector: kv.selector,
    clip: parseClip(kv.clip),
    maxMismatch: kv.max !== undefined ? Number(kv.max) : undefined,
    style: parseStyleKv(kv.style),
  };
}

export function parseMaskFlag(s: string): MaskSpec {
  const kv = parseKv(s);
  return { target: kv.target, baseline: kv.baseline, selector: kv.selector, clip: parseClip(kv.clip) };
}

export function parseStepFlag(s: string): Step {
  const kv = parseKv(s);
  const step: Step = { action: kv.action as StepAction };
  if (kv.selector !== undefined) step.selector = kv.selector;
  if (kv.value !== undefined) step.value = kv.value;
  if (kv.key !== undefined) step.key = kv.key;
  if (kv.name !== undefined) step.name = kv.name;
  if (kv.ms !== undefined) step.ms = Number(kv.ms);
  if (kv.by !== undefined) step.by = Number(kv.by);
  return step;
}

const STEP_ACTIONS = ["click", "fill", "select", "hover", "press", "waitFor", "scroll", "screenshot"];

export function validateStep(step: Step): void {
  if (!STEP_ACTIONS.includes(step.action)) {
    throw new Error(`vigress config: unknown step action '${step.action}'`);
  }
  const need = (cond: boolean, field: string): void => {
    if (!cond) throw new Error(`vigress config: step '${step.action}' needs ${field}`);
  };
  switch (step.action) {
    case "click":
    case "hover":
      need(!!step.selector, "selector");
      break;
    case "fill":
    case "select":
      need(!!step.selector, "selector");
      need(step.value !== undefined, "value");
      break;
    case "press":
      need(!!step.key, "key");
      break;
    case "waitFor":
      need(!!step.selector || step.ms !== undefined, "selector or ms");
      break;
    case "scroll":
      need(!!step.selector || step.by !== undefined, "selector or by");
      break;
    case "screenshot":
      need(!!step.name, "name");
      break;
  }
}

// A filesystem-safe, sortable run stamp: YYYY-MM-DD_HH-MM-SS (local time).
// Each run writes into <out>/<stamp>/ so previous outputs are never overwritten.
export function runStamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export interface ScaffoldOpts {
  page: string;
  target: string;
  against: string;
  viewport?: Viewport;
}

// Builds a starter full-check config (one entry, array-wrapped) with placeholder
// regions/mask/checklist/steps the user replaces. Valid against buildRunConfig:
// every region has a name, every step satisfies validateStep.
export function buildScaffoldConfig(o: ScaffoldOpts): Array<Record<string, unknown>> {
  const viewport = o.viewport ?? { width: 1440, height: 1000 };
  return [
    {
      name: `${o.page}-fullcheck`,
      target: o.target,
      against: o.against,
      viewport,
      regions: [
        { name: "REPLACE-top", clip: { x: 0, y: 0, width: viewport.width, height: 200 }, maxMismatch: 4 },
        { name: "REPLACE-body", selector: "[data-testid=REPLACE-content]", maxMismatch: 5, style: true },
      ],
      mask: [{ selector: "[data-testid=REPLACE-dynamic-element]" }],
      checklist: [
        { aspect: "REPLACE top region parity", region: "REPLACE-top", verdict: "unresolved" },
        { aspect: "REPLACE body region parity", region: "REPLACE-body", verdict: "unresolved" },
      ],
      steps: [
        { action: "click", selector: "[data-testid=REPLACE-filter-input]" },
        { action: "screenshot", name: "01-REPLACE-state" },
        { action: "click", selector: "[data-testid=REPLACE-download-btn]" },
        { action: "screenshot", name: "02-after-download" },
      ],
    },
  ];
}

// Walks a scaffold and returns the unique REPLACE-* tokens an agent must fill in.
export function scaffoldPlaceholders(scaffold: unknown): string[] {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/REPLACE-[\w-]+/g)) found.add(m[0]);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(scaffold);
  return [...found];
}

export function buildRunConfig(
  values: Record<string, unknown>,
  env: NodeJS.ProcessEnv,
): { runs: RunSpec[]; opts: GlobalOpts } {
  const str = (k: string): string | undefined =>
    typeof values[k] === "string" ? (values[k] as string) : undefined;
  const opts: GlobalOpts = {
    outDir: str("out") ?? env.VIGRESS_OUT ?? "out",
    statePath: str("state") ?? env.VIGRESS_STATE,
    json: values.json === true,
    quiet: values.quiet === true,
    maxMismatch: str("max-mismatch") !== undefined ? Number(str("max-mismatch")) : undefined,
    threshold: str("threshold") !== undefined ? Number(str("threshold")) : 0.1,
  };

  const viewport = parseViewport(str("viewport") ?? env.VIGRESS_VIEWPORT);
  // Video records by default (all artifacts on); --no-video opts out.
  const videoOff = values["no-video"] === true;

  // Batch via --config file
  const configPath = str("config");
  if (configPath) {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as Array<
      Partial<RunSpec> & { target: string; against: string }
    >;
    const runs = raw.map((r) => ({
      name: r.name ?? nameFromTarget(r.target),
      target: r.target,
      against: r.against,
      baselineType: detectBaselineType(r.against),
      viewport: r.viewport ?? viewport,
      clip: r.clip,
      video: r.video ?? !videoOff,
      regions: r.regions,
      mask: r.mask,
      checklist: r.checklist,
      steps: r.steps,
    }));
    for (const r of runs) {
      for (const rg of r.regions ?? []) {
        if (!rg.name) throw new Error("vigress config: every region needs a non-empty 'name'");
      }
      for (const st of r.steps ?? []) validateStep(st);
    }
    return { runs, opts };
  }

  // Single run from args
  const target = str("target");
  const against = str("against");
  if (!target || !against) {
    return { runs: [], opts };
  }
  const baselineType =
    (str("against-type") as BaselineType | undefined) ?? detectBaselineType(against);
  return {
    runs: [
      {
        name: str("name") ?? nameFromTarget(target),
        target,
        against,
        baselineType,
        viewport,
        clip: parseClip(str("clip")),
        video: !videoOff,
      },
    ],
    opts,
  };
}
