// The commits and PRs a session makes, from its tool calls: `git commit` prints `[branch hash]
// subject`, and `gh pr create` prints the PR's URL. Each is recorded for the work item the session
// is on, with its registered repository (by the checkout's remote, or the PR's owner/name), once.
import path from 'node:path';
import type { HomeDatabase } from '../../planning/home/database.ts';
import { normalizeRemote } from '../../planning/projects/resolve.ts';
import { projectRepositories, repositoryNamed, webOf, type KnownRepository } from '../../planning/projects/repositories.ts';
import { runProgram } from '../../planning/system/run.ts';

/** Every string in a value, however deep (a tool's input and output hide in their fields). */
export function strings(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value];
  if (depth > 6 || !value || typeof value !== 'object') return [];
  return (Array.isArray(value) ? value : Object.values(value)).flatMap(item => strings(item, depth + 1));
}

interface Product { kind: 'commit' | 'pull'; ident: string; title: string | null; branch: string | null; url: string | null; repository: KnownRepository | null; folder: string }

const quoted = (value: string) => value.replace(/^(["'])(.*)\1$/, '$2');
/** The checkout a command ran in: its `git -C <dir>` or leading `cd <dir>`, else the session's folder. */
function folderOf(command: string, cwd: string) {
  const named = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(command)?.[1] ?? /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&]+)\s*(?:&&|;)/m.exec(command)?.[1];
  return named ? path.resolve(cwd, quoted(named)) : cwd;
}
async function git(folder: string, args: string[]) {
  try { return (await runProgram('git', ['-C', folder, ...args], { timeout: 5000 })).stdout.trim() || null; } catch { return null; }
}

/** What a tool call made: the commits its output shows for a `git commit`, the PRs for a `gh pr create`. */
async function productsOf(input: { tool_input?: unknown; tool_response?: unknown; cwd?: unknown }, repositories: KnownRepository[]): Promise<Product[]> {
  const command = strings(input.tool_input).join('\n'), output = strings(input.tool_response).join('\n');
  const folder = folderOf(command, typeof input.cwd === 'string' && path.isAbsolute(input.cwd) ? input.cwd : process.cwd());
  const products: Product[] = [];
  if (/\bgit\b[^\n]*\bcommit\b/.test(command)) {
    const commits = [...output.matchAll(/^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.*)$/gm)];
    if (commits.length) {
      const remote = await git(folder, ['remote', 'get-url', 'origin']);
      const repository = remote ? repositories.find(item => item.remote !== null && item.remote === normalizeRemote(remote)) ?? null : null;
      const web = repository?.web ?? webOf(remote);
      for (const [, branch, hash, subject] of commits) products.push({ kind: 'commit', ident: hash, title: subject.trim() || null, branch, url: web && web + '/commit/' + hash, repository, folder });
    }
  }
  if (/\bgh(?:\.exe)?\s+pr\s+create\b/.test(command)) {
    const title = /\s(?:--title|-t)[ =]("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1];
    const head = /\s(?:--head|-H)[ =]("[^"]*"|'[^']*'|\S+)/.exec(command)?.[1];
    for (const [url, owner, name, number] of new Map([...output.matchAll(/https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g)].map(match => [match[0], match])).values()) {
      const branch = head ? quoted(head) : await git(folder, ['rev-parse', '--abbrev-ref', 'HEAD']);
      products.push({ kind: 'pull', ident: number, title: title ? quoted(title) : null, branch, url, repository: repositoryNamed(repositories, owner + '/' + name), folder });
    }
  }
  return products;
}

/** Record the commits and PRs a session's tool call made, for the work item it is on. */
export async function recordProducts(database: HomeDatabase, session: string, input: { tool_input?: unknown; tool_response?: unknown; cwd?: unknown }, at: string) {
  const on = database.db.prepare(`SELECT session_work.project_id, session_work.work_id, project.folder FROM session JOIN session_work ON session_work.session_id = session.id JOIN project ON project.id = session_work.project_id
    WHERE session.id = ? ORDER BY session_work.id = ifnull(session.focus, -1) DESC, ifnull(session_work.touched_at, session_work.linked_at) DESC, session_work.id DESC LIMIT 1`).get(session) as { project_id: number; work_id: string; folder: string } | undefined;
  if (!on) return;
  const products = await productsOf(input, await projectRepositories(on.folder).catch(() => []));
  const insert = database.db.prepare(`INSERT INTO session_product (session_id, project_id, work_id, kind, at, repository, ident, title, url, branch)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM session_product WHERE project_id = ? AND work_id = ? AND kind = ? AND repository IS ? AND ident = ?)`);
  database.transaction(() => {
    for (const product of products) {
      const repository = product.repository?.id ?? path.basename(product.folder);
      insert.run(session, on.project_id, on.work_id, product.kind, at, repository, product.ident, product.title, product.url, product.branch, on.project_id, on.work_id, product.kind, repository, product.ident);
    }
  });
}
