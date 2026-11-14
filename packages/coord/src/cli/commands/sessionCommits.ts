// The commits and PRs a session makes, from its tool calls: `git commit` prints `[branch hash]
// subject`, and `gh pr create` prints the PR's URL. Each is recorded for the work item the session
// is on, with its repository (from the checkout's remote, or the PR's address: `owner/repo` on GitHub,
// `host/path` elsewhere; none when the checkout has no remote on a host), once.
import path from 'node:path';
import type { HomeDatabase } from '../../home/database.ts';
import { remoteRepository } from '../../planning/references/remotes.ts';
import { runProgram } from '../../platform/run.ts';

/** Every string in a value, however deep (a tool's input and output hide in their fields). */
export function strings(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (depth > 6 || !value || typeof value !== 'object') return [];
  return (Array.isArray(value) ? value : Object.values(value)).flatMap(item => strings(item, depth + 1));
}

/** A commit or a PR a session made. `amends`: the commit replaces the one before it on its branch (`git commit --amend`). */
interface SessionCommit { kind: 'commit' | 'pull'; ident: string; title: string | null; branch: string | null; url: string | null; repository: string | null; amends?: boolean }

const quoted = (value: string) => value.replace(/^(["'])(.*)\1$/, '$2');
/** The checkout a command ran in: its `git -C <dir>` or leading `cd <dir>`, else the tool's folder (Codex's `workdir`) or the session's. */
function folderOf(command: string, cwd: string) {
  const named = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(command)?.[1] ?? /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&]+)\s*(?:&&|;)/m.exec(command)?.[1];
  return named ? path.resolve(cwd, quoted(named)) : cwd;
}
async function git(folder: string, args: string[]) {
  try { return (await runProgram('git', ['-C', folder, ...args], { timeout: 5000 })).stdout.trim() || null; } catch { return null; }
}

/** What a tool call made: the commits its output shows for a `git commit`, the PRs for a `gh pr create`. */
async function commitsOf(input: { tool_input?: unknown; tool_response?: unknown; cwd?: unknown }): Promise<SessionCommit[]> {
  const command = strings(input.tool_input).join('\n'), output = strings(input.tool_response).join('\n');
  const absolute = (value: unknown) => typeof value === 'string' && path.isAbsolute(value) ? value : null;
  const folder = folderOf(command, absolute((input.tool_input as { workdir?: unknown } | null)?.workdir) ?? absolute(input.cwd) ?? process.cwd());
  const found: SessionCommit[] = [];
  if (/\bgit\b[^\n]*\bcommit\b/.test(command)) {
    // [main 4ab195a] …, [main (root-commit) 4ab195a] …, [detached HEAD 4ab195a] …
    const commits = [...output.matchAll(/^\[([^\]\n]{1,100}?) ([0-9a-f]{7,40})\] (.*)$/gm)];
    if (commits.length) {
      const remote = remoteRepository(await git(folder, ['remote', 'get-url', 'origin']));
      const repository = remote?.repository ?? null, web = remote?.web ?? null;
      for (const [, head, hash, subject] of commits) {
        const branch = head.replace(/ \(root-commit\)$/, '');
        found.push({ kind: 'commit', ident: hash, title: subject.trim() || null, branch: branch === 'detached HEAD' ? null : branch, url: web && web + '/commit/' + hash, repository, amends: /--amend\b/.test(command) });
      }
    }
  }
  if (/\bgh(?:\.exe)?\s+pr\s+create\b/.test(command)) {
    const title = /\s(?:--title|-t)[ =]("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1];
    const head = /\s(?:--head|-H)[ =]("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1];
    for (const [url, owner, name, number] of new Map([...output.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)].map(match => [match[0], match])).values()) {
      const branch = head ? quoted(head) : await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']);
      found.push({ kind: 'pull', ident: number, title: title ? quoted(title) : null, branch, url, repository: (owner + '/' + name).toLowerCase() });
    }
  }
  return found;
}

/** Record the commits and PRs a session's tool call made, for the work item it is on. */
export async function recordCommits(database: HomeDatabase, session: string, input: { tool_input?: unknown; tool_response?: unknown; cwd?: unknown }, at: string) {
  const on = database.db.prepare(`SELECT session_work.project_id, session_work.work_id FROM session JOIN session_work ON session_work.session_id = session.id
    WHERE session.id = ? ORDER BY session_work.id = ifnull(session.focus, -1) DESC, ifnull(session_work.touched_at, session_work.linked_at) DESC, session_work.id DESC LIMIT 1`).get(session) as { project_id: number; work_id: string } | undefined;
  if (!on) return;
  const commits = await commitsOf(input);
  const insert = database.db.prepare(`INSERT INTO session_commit (session_id, project_id, work_id, kind, at, repository, ident, title, url, branch)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM session_commit WHERE project_id = ? AND work_id = ? AND kind = ? AND repository IS ? AND ident = ?)`);
  // An amended commit replaces the session's latest one on the same branch of the same repository.
  const amended = database.db.prepare(`DELETE FROM session_commit WHERE id = (SELECT id FROM session_commit WHERE session_id = ? AND project_id = ? AND work_id = ? AND kind = 'commit'
    AND repository IS ? AND branch IS ? ORDER BY at DESC, id DESC LIMIT 1)`);
  database.transaction(() => {
    for (const commit of commits) {
      const repository = commit.repository;
      if (commit.amends) amended.run(session, on.project_id, on.work_id, repository, commit.branch);
      insert.run(session, on.project_id, on.work_id, commit.kind, at, repository, commit.ident, commit.title, commit.url, commit.branch, on.project_id, on.work_id, commit.kind, repository, commit.ident);
    }
  });
}
