// The newest Coord builds, read from the GitHub Releases of envsemble/coord in the visitor's browser:
// the newest stable release, and the newest nightly (a prerelease tagged vX.Y.Z-nightly.DATE.RUN).
// GitHub's API answers 60 requests an hour per address without a token, so one listing serves both
// channels and is kept for ten minutes in the session.

export const repository = 'envsemble/coord';
export const releasesPage = `https://github.com/${repository}/releases`;
export const sourcePage = `https://github.com/${repository}`;

export type Channel = 'stable' | 'nightly';
export type Platform = 'windows' | 'linux';

/** A release as GitHub's API lists it, with only what the page reads. */
export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

export interface Download { name: string; url: string; size: number }
/** A channel's newest build: its version, its release page and date, and the file for each system. */
export interface Build {
  channel: Channel;
  version: string;
  page: string;
  publishedAt: string | null;
  downloads: Record<Platform, Download | null>;
}

const isNightly = (release: GitHubRelease) => release.prerelease && /-nightly\./.test(release.tag_name);

/** The channel's newest published build in a listing (GitHub lists the newest first), or null. */
export function newestBuild(releases: GitHubRelease[], channel: Channel): Build | null {
  const release = releases.find(item => !item.draft && (channel === 'nightly' ? isNightly(item) : !item.prerelease));
  if (!release) return null;
  const file = (pattern: RegExp): Download | null => {
    const asset = release.assets.find(item => pattern.test(item.name));
    return asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null;
  };
  return {
    channel,
    version: release.tag_name.replace(/^v/, ''),
    page: release.html_url,
    publishedAt: release.published_at,
    // The installer, not its blockmap or the update files beside it.
    downloads: { windows: file(/\.exe$/i), linux: file(/\.AppImage$/) },
  };
}

const cacheKey = 'coord-site-releases';
const cacheTime = 10 * 60 * 1000;

/** The newest stable and nightly builds; a failed request throws. */
export async function fetchBuilds(load: typeof fetch = fetch, storage: Pick<Storage, 'getItem' | 'setItem'> | null = sessionStorage, now = Date.now()): Promise<Record<Channel, Build | null>> {
  let releases: GitHubRelease[] | null = null;
  try {
    const kept = JSON.parse(storage?.getItem(cacheKey) ?? 'null') as { at: number; releases: GitHubRelease[] } | null;
    if (kept && now - kept.at < cacheTime && Array.isArray(kept.releases)) releases = kept.releases;
  } catch { /* A spoiled cache is read again from GitHub. */ }
  if (!releases) {
    const response = await load(`https://api.github.com/repos/${repository}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    releases = await response.json() as GitHubRelease[];
    try { storage?.setItem(cacheKey, JSON.stringify({ at: now, releases })); } catch { /* Private browsing may refuse it. */ }
  }
  return { stable: newestBuild(releases, 'stable'), nightly: newestBuild(releases, 'nightly') };
}

/** The visitor's system, for the one download button; null for one Coord has no build for. */
export function visitorPlatform(agent: { userAgent: string; platform?: string }): Platform | 'mac' | null {
  const text = `${agent.platform ?? ''} ${agent.userAgent}`.toLowerCase();
  if (text.includes('win')) return 'windows';
  if (/android|iphone|ipad/.test(text)) return null;
  if (text.includes('mac')) return 'mac';
  if (text.includes('linux') || text.includes('x11')) return 'linux';
  return null;
}
