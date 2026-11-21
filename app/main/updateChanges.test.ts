// An update's changes, read from GitHub's comparison of two release tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readChanges } from './updateChanges.ts';

test("an update's changes are the branch's own steps, newest first, with a merged pull request under its title", () => {
  const commit = (sha: string, parents: string[], message: string) => ({ sha, parents: parents.map(parent => ({ sha: parent })), commit: { message } });
  const changes = readChanges({
    html_url: 'https://github.com/envsemble/coord/compare/v0.9.0...v0.9.1',
    total_commits: 4,
    commits: [
      commit('aaa', ['base'], 'Breadcrumbs float\n\nOn a pill of the page.'),
      commit('bbb', ['base'], 'Inside the pull request'),
      commit('ccc', ['aaa', 'bbb'], 'Merge pull request #59 from envsemble/site\n\nSite shows the README\'s screenshots'),
      commit('ddd', ['ccc'], 'Nightly builds every six hours'),
    ],
  }, '0.9.1');
  assert.deepEqual(changes, {
    version: '0.9.1', commits: 4, url: 'https://github.com/envsemble/coord/compare/v0.9.0...v0.9.1',
    changes: [
      { title: 'Nightly builds every six hours', sha: 'ddd', pull: null },
      { title: "Site shows the README's screenshots", sha: 'ccc', pull: 59 },
      { title: 'Breadcrumbs float', sha: 'aaa', pull: null },
    ],
  });
});
