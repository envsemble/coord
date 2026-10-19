// A project's repositories as references and the hooks see them: each registered repository with
// its remote's web page (GitHub's, where the remote is on github.com), and how a name a plan or a
// command uses (an ID, a name, `owner/name`) finds one.
import path from 'node:path';
import { normalizeRemote, readRegistry } from './resolve.ts';

export interface KnownRepository {
  id: string; name: string;
  /** The remote as `host/owner/name`, lowercase; null without one. */
  remote: string | null;
  /** The repository's page, `https://github.com/owner/name`, for a remote on GitHub. */
  web: string | null;
  /** The `path` hint of a repository registered without a remote. */
  path: string | null;
}

/** The page of a remote on GitHub (`https://github.com/owner/name`); null elsewhere. */
export function webOf(remote: string | null): string | null {
  const key = remote ? normalizeRemote(remote) : null;
  const parts = key?.split('/') ?? [];
  return parts.length === 3 && parts[0] === 'github.com' ? `https://github.com/${parts[1]}/${parts[2]}` : null;
}

/** The repositories a planning folder registers, without its own entry (`path: "."`). */
export async function projectRepositories(root: string): Promise<KnownRepository[]> {
  const registry = await readRegistry(root);
  return registry.repositories.flatMap((entry): KnownRepository[] => {
    if (typeof entry.id !== 'string' || entry.path === '.') return [];
    const remote = typeof entry.remote === 'string' ? normalizeRemote(entry.remote) : null;
    return [{ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id, remote, web: webOf(remote), path: typeof entry.path === 'string' && path.isAbsolute(entry.path) ? entry.path : null }];
  });
}

/** The repository a name finds: its ID, its name (any case), or the `owner/name` of its remote. */
export function repositoryNamed(repositories: KnownRepository[], name: string): KnownRepository | null {
  const key = name.toLowerCase().replace(/\.git$/, '');
  return repositories.find(item => item.id === name) ?? repositories.find(item => item.name.toLowerCase() === key)
    ?? repositories.find(item => item.remote !== null && item.remote.split('/').slice(1).join('/') === key) ?? null;
}
