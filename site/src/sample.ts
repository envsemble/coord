// Releases to look at the page with before any exist: in development only, at /?sample, a stable
// release and a newer nightly as GitHub would list them. Production builds leave this file out.
import { newestBuild, repository, type GitHubRelease } from './releases.ts';

const release = (tag: string, prerelease: boolean, publishedAt: string): GitHubRelease => {
  const version = tag.replace(/^v/, '');
  const download = `https://github.com/${repository}/releases/download/${tag}/`;
  return {
    tag_name: tag, html_url: `https://github.com/${repository}/releases/tag/${tag}`, published_at: publishedAt, draft: false, prerelease,
    assets: [
      { name: `Coord-Setup-${version}.exe`, browser_download_url: download + `Coord-Setup-${version}.exe`, size: 112_000_000 },
      { name: `Coord-${version}-x86_64.AppImage`, browser_download_url: download + `Coord-${version}-x86_64.AppImage`, size: 131_000_000 },
    ],
  };
};
const releases = [
  release('v0.9.1-nightly.20261114.42', true, '2026-11-14T03:21:00Z'),
  release('v0.9.0', false, '2026-11-10T14:05:00Z'),
];

export const sampleBuilds = () => ({ stable: newestBuild(releases, 'stable'), nightly: newestBuild(releases, 'nightly') });
