import type { GitInfo } from "./types";

// Pure helpers for recording which commit a run was started from. The I/O (calling
// git) is in cli.ts; everything that decides what is kept is here so it is tested.

const GITHUB_REMOTE = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const SHA = /^[0-9a-f]{40}$/;
export const GITHUB_COMMIT_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/commit\/[0-9a-f]{40}$/;

export function parseGitHubRemote(remote: string): { owner: string; repo: string } | null {
  const m = GITHUB_REMOTE.exec(remote.trim());
  return m ? { owner: m[1], repo: m[2] } : null;
}

// A GitHub commit page also lists the pull requests the commit belongs to, so this one
// link covers "which PR was this run for" without the dashboard calling any API.
export function commitUrl(remote: string | undefined, sha: string): string | undefined {
  const r = remote ? parseGitHubRemote(remote) : null;
  return r ? `https://github.com/${r.owner}/${r.repo}/commit/${sha}` : undefined;
}

export function buildGitInfo(raw: { commit: string; branch?: string; dirty: boolean; remote?: string }): GitInfo | undefined {
  const commit = raw.commit.trim();
  if (!SHA.test(commit)) return undefined;
  const branch = (raw.branch ?? "").trim();
  const url = commitUrl(raw.remote, commit);
  return {
    commit,
    ...(branch && branch !== "HEAD" ? { branch } : {}), // "HEAD" = detached
    dirty: raw.dirty,
    ...(url ? { url } : {}),
  };
}

// Read side: summary.json is a file on disk and could be edited, and the dashboard turns
// `url` into a link — so only an exact GitHub commit URL and a real sha pass through.
export function sanitizeGitInfo(g: GitInfo | undefined): GitInfo | undefined {
  if (!g || typeof g.commit !== "string" || !SHA.test(g.commit)) return undefined;
  return {
    commit: g.commit,
    ...(typeof g.branch === "string" && g.branch ? { branch: g.branch } : {}),
    dirty: g.dirty === true,
    ...(typeof g.url === "string" && GITHUB_COMMIT_URL.test(g.url) ? { url: g.url } : {}),
  };
}
