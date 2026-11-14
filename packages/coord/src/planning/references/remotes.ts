// Git remotes, as the commits and PRs agents make are recorded: the repository a remote names, as
// `owner/repo` on GitHub and in full (`host/path`) elsewhere, and its page on GitHub. Coord keeps no
// repositories; a remote is read when it is needed.

/**
 * A Git remote as `host/owner/repo`, lowercase, whatever its spelling: `git@host:owner/repo.git`,
 * `ssh://git@host:22/owner/repo`, `https://user@host/owner/repo.git/`. Null for an empty value.
 */
function normalizeRemote(url: string): string | null {
  let value = url.trim();
  if (!value) return null;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(value);
  if (scp && !/^[a-z]:[\\/]/i.test(value)) value = scp[1] + '/' + scp[2];
  else {
    const parsed = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?(\/.*)?$/i.exec(value);
    if (parsed) value = parsed[1] + (parsed[2] ?? '');
    else value = value.replace(/\\/g, '/');
  }
  return value.replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/').toLowerCase() || null;
}

/**
 * The repository a remote on a host names: `owner/repo` on GitHub, with its page
 * (`https://github.com/owner/repo`); elsewhere the host and its path in full (`gitlab.com/group/sub/repo`),
 * with no page. Null for a remote that is a folder on this computer, or that names no path on its host.
 */
export function remoteRepository(url: string | null): { repository: string; web: string | null } | null {
  const value = url?.trim() ?? '';
  const onHost = /^(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(value) || (/^(?:[^@/\s]+@)?[^:/\s]+:(?!\/)/.test(value) && !/^[a-z]:[\\/]/i.test(value));
  const normalized = onHost ? normalizeRemote(value) : null;
  if (!normalized?.includes('/')) return null;
  const parts = normalized.split('/');
  if (parts.length !== 3 || parts[0] !== 'github.com') return { repository: normalized, web: null };
  const repository = parts.slice(1).join('/');
  return { repository, web: 'https://github.com/' + repository };
}
