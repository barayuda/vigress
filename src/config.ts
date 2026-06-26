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
}

export interface MaskSpec {
  target?: string;
  baseline?: string;
  selector?: string;
  clip?: Box;
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
  spec: { target?: string; baseline?: string; selector?: string; [k: string]: unknown },
  side: "target" | "baseline",
): string | undefined {
  return (spec[side] as string | undefined) ?? spec.selector;
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

export function parseRegionFlag(s: string): RegionSpec {
  const kv = parseKv(s);
  return {
    name: kv.name,
    target: kv.target,
    baseline: kv.baseline,
    selector: kv.selector,
    clip: parseClip(kv.clip),
    maxMismatch: kv.max !== undefined ? Number(kv.max) : undefined,
  };
}

export function parseMaskFlag(s: string): MaskSpec {
  const kv = parseKv(s);
  return { target: kv.target, baseline: kv.baseline, selector: kv.selector, clip: parseClip(kv.clip) };
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
      video: r.video ?? true,
      regions: r.regions,
      mask: r.mask,
      checklist: r.checklist,
    }));
    for (const r of runs) {
      for (const rg of r.regions ?? []) {
        if (!rg.name) throw new Error("vigress config: every region needs a non-empty 'name'");
      }
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
        video: values.video === true,
      },
    ],
    opts,
  };
}
