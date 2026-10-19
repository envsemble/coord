// Git remotes, as the commits and PRs agents make are recorded: the repository a remote names, as
// `owner/repo`, and its page on GitHub. Atlas keeps no repositories; a remote is read when it is needed.

/**
 * A Git remote as `host/owner/repo`, lowercase, whatever its spelling: `git@host:owner/repo.git`,
 * `ssh://git@host:22/owner/repo`, `https://user@host/owner/repo.git/`. Null for an empty value.
 */
export function normalizeRemote(url: string): string | null {
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

/** A remote URL without its user information (`https://user:token@host/…`), which can hold a credential. */
export function remoteWithoutCredentials(url: string) {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, '$1');
}

/**
 * The repository a remote on a host names: `owner/repo` (its last two segments), and its page when
 * it is on GitHub (`https://github.com/owner/repo`); null for a remote that is a folder on this
 * computer, or that names no owner.
 */
export function remoteRepository(url: string | null): { repository: string; web: string | null } | null {
  const value = url?.trim() ?? '';
  const onHost = /^(?!file:)[a-z][a-z0-9+.-]*:\/\//i.test(value) || (/^(?:[^@/\s]+@)?[^:/\s]+:(?!\/)/.test(value) && !/^[a-z]:[\\/]/i.test(value));
  const parts = (onHost ? normalizeRemote(value) : null)?.split('/') ?? [];
  if (parts.length < 3) return null;
  const repository = parts.slice(-2).join('/');
  return { repository, web: parts.length === 3 && parts[0] === 'github.com' ? 'https://github.com/' + repository : null };
}
