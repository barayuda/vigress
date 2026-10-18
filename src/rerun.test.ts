import { describe, expect, it } from "bun:test";
import { buildCompareCheckCommand, buildRerunCommand, pickInvocationEnv, shellQuote } from "./rerun";

const CLI = "/opt/vigress/src/cli.ts";

describe("shellQuote", () => {
  it("leaves safe args alone and single-quotes the rest", () => {
    expect(shellQuote("https://x.test/a.png")).toBe("https://x.test/a.png");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("")).toBe("''");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
    expect(shellQuote("a$b")).toBe("'a$b'");
  });
  it("quotes an arg that starts with = (zsh expands =cmd to a path)", () => {
    expect(shellQuote("=x")).toBe("'=x'");
    expect(shellQuote("=")).toBe("'='");
    expect(shellQuote("a=b")).toBe("a=b");
  });
  // Each quoted arg, given to a real shell, must come back exactly as the original.
  const ARGS = ["plain", "a b", "it's", "", "$HOME", "=ls", "a=b", "x;y", "`id`", "$(id)", "~", "*", "?a", "!x", "#c", "a\\b", "tab\there", "line\nbreak", "https://x.test/?a=1&b=2"];
  const roundTrip = (shell: string): void => {
    for (const arg of ARGS) {
      const res = Bun.spawnSync([shell, "-c", `printf '%s\\n' ${shellQuote(arg)}`], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/home/nobody" } });
      expect(res.exitCode).toBe(0);
      expect(res.stdout.toString()).toBe(arg + "\n");
    }
  };
  it("round-trips through sh", () => roundTrip("sh"));
  it.skipIf(!Bun.which("zsh"))("round-trips through zsh", () => roundTrip("zsh"));
});

describe("buildRerunCommand", () => {
  it("returns null without an invocation", () => {
    expect(buildRerunCommand(undefined, CLI)).toBeNull();
  });
  it("builds cd + bun run + argv + --json", () => {
    expect(buildRerunCommand({ cwd: "/repo", argv: ["after", "home"] }, CLI)).toBe(
      "cd /repo && bun run /opt/vigress/src/cli.ts after home --json",
    );
  });
  it("keeps --json once when already present, and last", () => {
    const cmd = buildRerunCommand({ cwd: "/repo", argv: ["--json", "--config", "a.fullcheck.json"] }, CLI)!;
    expect(cmd.match(/--json/g)).toHaveLength(1);
    expect(cmd.endsWith(" --json")).toBe(true);
    expect(cmd).toContain("--config a.fullcheck.json");
  });
  it("drops --update-baseline and --no-timestamp", () => {
    const cmd = buildRerunCommand(
      { cwd: "/repo", argv: ["--config", "a.fullcheck.json", "--update-baseline", "--no-timestamp", "--out", "o"] },
      CLI,
    )!;
    expect(cmd).not.toContain("--update-baseline");
    expect(cmd).not.toContain("--no-timestamp");
    expect(cmd).toContain("--out o");
    expect(cmd.endsWith(" --json")).toBe(true);
  });
  it("rewrites a before run into after", () => {
    const cmd = buildRerunCommand({ cwd: "/repo", argv: ["before", "home", "--target", "https://x.test/"] }, CLI)!;
    expect(cmd).toContain(" after home ");
    expect(cmd).not.toContain(" before ");
  });
  it("does not rewrite a value that happens to be 'before'", () => {
    const cmd = buildRerunCommand(
      { cwd: "/repo", argv: ["--name", "before", "--target", "https://x.test/", "--against", "https://y.test/"] },
      CLI,
    )!;
    expect(cmd).toContain("--name before");
    expect(cmd).not.toContain(" after ");
  });
  it("only rewrites 'before' when it is the first positional", () => {
    const cmd = buildRerunCommand({ cwd: "/repo", argv: ["--state", "a.state.json", "before", "home"] }, CLI)!;
    expect(cmd).toContain("--state a.state.json after home");
  });
  it("keeps --state and --config as given", () => {
    const cmd = buildRerunCommand(
      { cwd: "/repo", argv: ["--config", "p.fullcheck.json", "--state", "a.state.json"] },
      CLI,
    )!;
    expect(cmd).toContain("--config p.fullcheck.json --state a.state.json");
  });
  it("keeps an inline --out=value as given, and drops --update-baseline", () => {
    const cmd = buildRerunCommand({ cwd: "/repo", argv: ["after", "home", "--out=o", "--update-baseline"] }, CLI)!;
    expect(cmd).toBe("cd /repo && bun run /opt/vigress/src/cli.ts after home --out=o --json");
  });
  it("quotes args with spaces, quotes and shell metacharacters", () => {
    const cmd = buildRerunCommand(
      { cwd: "/my repo", argv: ["--target", "https://x.test/?a=1&b=2", "--name", "it's"] },
      CLI,
    )!;
    expect(cmd).toContain("cd '/my repo' &&");
    expect(cmd).toContain("'https://x.test/?a=1&b=2'");
    expect(cmd).toContain("'it'\\''s'");
  });
  it("returns null for unparseable argv or an option terminator", () => {
    expect(buildRerunCommand({ cwd: "/repo", argv: ["--nope"] }, CLI)).toBeNull();
    expect(buildRerunCommand({ cwd: "/repo", argv: ["after", "--", "home"] }, CLI)).toBeNull();
  });
});

describe("buildRerunCommand env", () => {
  it("puts the recorded env in front of bun run, quoted", () => {
    const cmd = buildRerunCommand(
      { cwd: "/repo", argv: ["after", "home"], env: { VIGRESS_VIEWPORT: "1280x800", VIGRESS_STATE: "/my state/a.state.json" } },
      CLI,
    );
    expect(cmd).toBe(
      "cd /repo && VIGRESS_VIEWPORT=1280x800 VIGRESS_STATE='/my state/a.state.json' bun run /opt/vigress/src/cli.ts after home --json",
    );
  });
  it("is unchanged with no env or an empty one", () => {
    const plain = "cd /repo && bun run /opt/vigress/src/cli.ts after home --json";
    expect(buildRerunCommand({ cwd: "/repo", argv: ["after", "home"] }, CLI)).toBe(plain);
    expect(buildRerunCommand({ cwd: "/repo", argv: ["after", "home"], env: {} }, CLI)).toBe(plain);
  });
  it("never puts a name in front that is not a recorded VIGRESS_ setting", () => {
    const cmd = buildRerunCommand({ cwd: "/repo", argv: ["after", "home"], env: { FIGMA_TOKEN: "secret", "A;rm": "x", VIGRESS_DWELL: "0" } }, CLI)!;
    expect(cmd).toBe("cd /repo && VIGRESS_DWELL=0 bun run /opt/vigress/src/cli.ts after home --json");
  });
});

describe("pickInvocationEnv", () => {
  it("keeps only the six run settings that are set", () => {
    expect(
      pickInvocationEnv({
        VIGRESS_STATE: "a.state.json", VIGRESS_VIEWPORT: "1280x800", VIGRESS_SETTLE: "3000",
        VIGRESS_DWELL: "0", VIGRESS_BROWSER: "msedge", VIGRESS_OUT: "o",
      }),
    ).toEqual({
      VIGRESS_STATE: "a.state.json", VIGRESS_VIEWPORT: "1280x800", VIGRESS_SETTLE: "3000",
      VIGRESS_DWELL: "0", VIGRESS_BROWSER: "msedge", VIGRESS_OUT: "o",
    });
  });
  it("ignores FIGMA_TOKEN, other VIGRESS_ variables and unrelated ones", () => {
    expect(
      pickInvocationEnv({ FIGMA_TOKEN: "secret", VIGRESS_DASHBOARD_WRITERS: "me@x", HOME: "/home/me", PATH: "/bin", VIGRESS_OUT: "o" }),
    ).toEqual({ VIGRESS_OUT: "o" });
  });
  it("returns undefined when none are set", () => {
    expect(pickInvocationEnv({ FIGMA_TOKEN: "secret", VIGRESS_STATE: undefined })).toBeUndefined();
  });
});

describe("buildCompareCheckCommand", () => {
  it("builds the compare check command", () => {
    expect(buildCompareCheckCommand("/repo", CLI, "/repo/out/2026-a", "home")).toBe(
      "cd /repo && bun run /opt/vigress/src/cli.ts compare /repo/out/2026-a <outDir from the re-run JSON> --name home --json",
    );
  });
});
