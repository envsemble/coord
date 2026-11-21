// What an update changes: GitHub's comparison of the running build's tag with the update's
// (v0.9.1-nightly.20261116.5...v0.9.1-nightly.20261119.12), read as the branch's own steps. A merged
// pull request is one step, under its title; a commit made on the branch itself is one too.
import type { UpdateChange, UpdateChanges } from '../shared/contract.ts';

/** The repository whose releases Coord updates from (electron-builder.yml's publish). */
export const releaseRepository = 'envsemble/coord';
/** The most steps kept: the card shows the newest, and the comparison's page has them all. */
const kept = 50;

interface CompareCommit { sha: string; parents: { sha: string }[]; commit: { message: string } }
interface Compare { html_url: string; total_commits: number; commits: CompareCommit[] }

/**
 * The comparison's steps along the branch, newest first: from its newest commit, each commit's first
 * parent, which leaves out the commits inside a merged pull request.
 */
export function readChanges(compare: Compare, version: string): UpdateChanges {
  const bySha = new Map(compare.commits.map(commit => [commit.sha, commit]));
  const changes: UpdateChange[] = [];
  for (let commit = compare.commits.at(-1); commit && changes.length < kept; commit = bySha.get(commit.parents[0]?.sha ?? '')) {
    changes.push(change(commit));
    // A commit is never its own ancestor, but a malformed answer must not loop.
    bySha.delete(commit.sha);
  }
  return { version, changes, commits: compare.total_commits, url: compare.html_url };
}

function change(commit: CompareCommit): UpdateChange {
  const lines = commit.commit.message.split('\n').map(line => line.trim()).filter(Boolean);
  // GitHub's merge commit: "Merge pull request #59 from owner/branch", then the pull request's title.
  const merge = /^Merge pull request #(\d+) from (\S+)/.exec(lines[0] ?? '');
  if (merge) return { title: lines[1] ?? merge[2]!, sha: commit.sha, pull: Number(merge[1]) };
  return { title: lines[0] ?? commit.sha.slice(0, 7), sha: commit.sha, pull: null };
}

/** Ask GitHub what changed from one version to the next (each version's release is tagged v<version>). */
export async function fetchChanges(from: string, to: string, fetcher: typeof fetch = fetch): Promise<UpdateChanges> {
  const response = await fetcher(`https://api.github.com/repos/${releaseRepository}/compare/v${encodeURIComponent(from)}...v${encodeURIComponent(to)}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Coord' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} comparing v${from} with v${to}.`);
  return readChanges(await response.json() as Compare, to);
}
