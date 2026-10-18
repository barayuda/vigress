import { describe, expect, it } from "bun:test";
import { buildCompareCheckCommand, buildRerunCommand, shellQuote } from "./rerun";

const CLI = "/opt/vigress/src/cli.ts";

describe("shellQuote", () => {
  it("leaves safe args alone and single-quotes the rest", () => {
    expect(shellQuote("https://x.test/a.png")).toBe("https://x.test/a.png");
    expect(shellQuote("a b")).toBe("'a b'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("")).toBe("''");
  });
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
  it("drops an inline --out=value style flag whole, and keeps inline values of others", () => {
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

describe("buildCompareCheckCommand", () => {
  it("builds the compare check command", () => {
    expect(buildCompareCheckCommand("/repo", CLI, "/repo/out/2026-a", "home")).toBe(
      "cd /repo && bun run /opt/vigress/src/cli.ts compare /repo/out/2026-a <outDir from the re-run JSON> --name home --json",
    );
  });
});
