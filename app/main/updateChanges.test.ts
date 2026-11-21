// An update's changes, read from GitHub's comparison of two release tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchChanges, readChanges } from './updateChanges.ts';

test("an update's changes are the branch's own steps, newest first, with a merged pull request under its title", () => {
  const commit = (sha: string, parents: string[], message: string) => ({ sha, parents: parents.map(parent => ({ sha: parent })), commit: { message } });
  const changes = readChanges({
    html_url: 'https://github.com/envsemble/coord/compare/v0.9.0...v0.9.1',
    total_commits: 6,
    commits: [
      commit('aaa', ['base'], 'Breadcrumbs float\n\nOn a pill of the page.'),
      commit('bbb', ['base'], 'Inside the pull request'),
      // A pull request merged into the feature's branch keeps the feature one step.
      commit('x1', ['base'], 'A stacked part'),
      commit('b2', ['bbb', 'x1'], 'Merge pull request #70 from envsemble/site-part\n\nA part of the site'),
      commit('ccc', ['aaa', 'b2'], 'Merge pull request #59 from envsemble/site\n\nSite shows the README\'s screenshots'),
      commit('ddd', ['ccc'], 'Nightly builds every six hours'),
    ],
  }, '0.9.1');
  assert.deepEqual(changes, {
    version: '0.9.1', commits: 6, url: 'https://github.com/envsemble/coord/compare/v0.9.0...v0.9.1',
    changes: [
      { title: 'Nightly builds every six hours', sha: 'ddd', pull: null },
      { title: "Site shows the README's screenshots", sha: 'ccc', pull: 59 },
      { title: 'Breadcrumbs float', sha: 'aaa', pull: null },
    ],
  });
});

test('a release merged into main lists the pull requests it brings, not itself, and leaves out merges that bring nothing', () => {
  const commit = (sha: string, parents: string[], message: string) => ({ sha, parents: parents.map(parent => ({ sha: parent })), commit: { message } });
  const { changes } = readChanges({
    html_url: 'https://github.com/envsemble/coord/compare/v0.9.0...v0.10.0',
    total_commits: 8,
    commits: [
      commit('d1', ['base'], 'A commit on dev'),
      commit('e1', ['base'], 'Inside the envUI pull request'),
      commit('d2', ['d1', 'e1'], 'Merge pull request #63 from envsemble/envui-3\n\nCoord on envUI 3'),
      commit('s1', ['base'], 'The site'),
      commit('m2', ['base', 's1'], 'Merge pull request #60 from envsemble/site\n\nSite: current screenshots'),
      commit('r1', ['d2', 'm2'], 'Merge main into the 0.10.0 release'),
      commit('r2', ['r1'], 'Release 0.10.0'),
      commit('m3', ['m2', 'r2'], 'Merge pull request #65 from envsemble/release-0.10.0\n\nRelease 0.10.0'),
    ],
  }, '0.10.0');
  assert.deepEqual(changes.map(change => change.pull ? `#${change.pull} ${change.title}` : change.title), [
    'Release 0.10.0', '#63 Coord on envUI 3', 'A commit on dev', '#60 Site: current screenshots',
  ]);
});

test('when GitHub no longer has the running build\'s tag, the update links to its release instead', async () => {
  const changes = await fetchChanges('0.9.1-nightly.20261101.1', '0.9.1-nightly.20261119.12', async () => new Response('{}', { status: 404 }));
  assert.deepEqual(changes, { version: '0.9.1-nightly.20261119.12', changes: [], commits: null, url: 'https://github.com/envsemble/coord/releases/tag/v0.9.1-nightly.20261119.12' });
});
