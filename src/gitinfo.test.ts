import { describe, expect, it } from "bun:test";
import { parseGitHubRemote, commitUrl, buildGitInfo } from "./gitinfo";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("parseGitHubRemote", () => {
  it("reads owner and repo from https and ssh GitHub remotes, with or without .git", () => {
    for (const r of [
      "https://github.com/barayuda/vigress.git",
      "https://github.com/barayuda/vigress",
      "git@github.com:barayuda/vigress.git",
      "ssh://git@github.com/barayuda/vigress.git",
      "  https://github.com/barayuda/vigress.git\n",
    ]) {
      expect(parseGitHubRemote(r)).toEqual({ owner: "barayuda", repo: "vigress" });
    }
  });
  it("is null for other hosts, lookalikes and junk", () => {
    for (const r of ["", "https://gitlab.com/a/b.git", "https://github.com.evil.example/a/b", "https://evil.example/github.com/a/b", "git@github.com:a", "not a url", "https://github.com/a/b/c/d"]) {
      expect(parseGitHubRemote(r)).toBeNull();
    }
  });
});

describe("commitUrl", () => {
  it("builds the GitHub commit page URL", () => {
    expect(commitUrl("git@github.com:barayuda/vigress.git", SHA)).toBe(`https://github.com/barayuda/vigress/commit/${SHA}`);
  });
  it("is undefined for a non-GitHub remote", () => {
    expect(commitUrl("https://gitlab.com/a/b.git", SHA)).toBeUndefined();
    expect(commitUrl(undefined, SHA)).toBeUndefined();
  });
});

describe("buildGitInfo", () => {
  it("keeps a full 40-hex commit, the branch, the dirty flag and the commit URL", () => {
    expect(buildGitInfo({ commit: SHA + "\n", branch: "feat/x\n", dirty: true, remote: "https://github.com/o/r.git" })).toEqual({
      commit: SHA, branch: "feat/x", dirty: true, url: `https://github.com/o/r/commit/${SHA}`,
    });
  });
  it("omits branch for a detached HEAD, and url when there is no GitHub remote", () => {
    const g = buildGitInfo({ commit: SHA, branch: "HEAD", dirty: false });
    expect(g).toEqual({ commit: SHA, dirty: false });
    expect("branch" in g!).toBe(false);
    expect("url" in g!).toBe(false);
  });
  it("is undefined when there is no valid commit (not a repo, empty repo, junk)", () => {
    for (const commit of ["", "fatal: not a git repository", "abc123", "Z".repeat(40)]) {
      expect(buildGitInfo({ commit, dirty: false })).toBeUndefined();
    }
  });
});
