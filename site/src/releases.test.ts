// The builds the page offers: each channel's newest release and its files, and the visitor's system.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchBuilds, newestBuild, visitorPlatform, type GitHubRelease } from './releases.ts';

const release = (tag: string, prerelease: boolean, files: string[], draft = false): GitHubRelease => ({
  tag_name: tag, html_url: `https://github.com/envsemble/coord/releases/tag/${tag}`, published_at: '2026-11-15T03:20:00Z', draft, prerelease,
  assets: files.map(name => ({ name, browser_download_url: `https://github.com/envsemble/coord/releases/download/${tag}/${name}`, size: 120_000_000 })),
});
// Newest first, as GitHub lists them: a draft, two nightlies, then the stable release.
const listing = [
  release('v0.9.1-nightly.20261116.44', true, ['Coord-Setup-0.9.1-nightly.20261116.44.exe'], true),
  release('v0.9.1-nightly.20261115.43', true, ['Coord-Setup-0.9.1-nightly.20261115.43.exe', 'Coord-Setup-0.9.1-nightly.20261115.43.exe.blockmap', 'nightly.yml', 'Coord-0.9.1-nightly.20261115.43-x86_64.AppImage', 'nightly-linux.yml']),
  release('v0.9.1-nightly.20261114.42', true, ['Coord-Setup-0.9.1-nightly.20261114.42.exe']),
  release('v0.9.0', false, ['coord-0.9.0-16d3bd0ca608.zip', 'Coord-0.9.0-x86_64.AppImage', 'Coord-Setup-0.9.0.exe.blockmap', 'Coord-Setup-0.9.0.exe', 'latest.yml', 'latest-linux.yml']),
];

test('each channel offers its newest published build, with the installer and the AppImage', async () => {
  const stable = newestBuild(listing, 'stable')!;
  assert.equal(stable.version, '0.9.0');
  assert.equal(stable.downloads.windows?.name, 'Coord-Setup-0.9.0.exe');
  assert.equal(stable.downloads.linux?.name, 'Coord-0.9.0-x86_64.AppImage');
  const nightly = newestBuild(listing, 'nightly')!;
  assert.equal(nightly.version, '0.9.1-nightly.20261115.43');
  assert.equal(nightly.downloads.windows?.name, 'Coord-Setup-0.9.1-nightly.20261115.43.exe');
  assert.equal(newestBuild(listing.slice(3), 'nightly'), null);

  // One listing serves both channels, and the session keeps it.
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, value); } };
  let requests = 0;
  const load = (async () => { requests++; return new Response(JSON.stringify(listing)); }) as typeof fetch;
  assert.equal((await fetchBuilds(load, storage, 1000)).nightly?.version, '0.9.1-nightly.20261115.43');
  assert.equal((await fetchBuilds(load, storage, 2000)).stable?.version, '0.9.0');
  assert.equal(requests, 1);
});

test('the visitor’s system picks the download button', () => {
  assert.equal(visitorPlatform({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }), 'windows');
  assert.equal(visitorPlatform({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }), 'linux');
  assert.equal(visitorPlatform({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)' }), 'mac');
  assert.equal(visitorPlatform({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 15)' }), null);
});
