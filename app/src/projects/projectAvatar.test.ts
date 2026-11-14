import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, projectFacts, projectHue } from './projectAvatar.ts';

test('a project row shows its initials, and its open plans and whose turn they say they are', () => {
  assert.equal(initials('Harbor platform'), 'HP');
  assert.equal(initials('coord'), 'A');
  assert.equal(initials('envUI-kit'), 'EK');
  const work = (state: 'implementing' | 'closed', turn?: 'working' | 'your_turn') => ({ state, ...turn && { turn: { kind: turn, note: null, since: null } } }) as never;
  assert.deepEqual(projectFacts({ summary: { active: [work('implementing', 'working'), work('implementing', 'your_turn'), work('closed')], closed: [], updated: '2026-10-19', activity: [], now: '2026-10-19T10:00:00Z' } }),
    { open: 2, working: 1, waiting: 1, updated: '2026-10-19' });
  assert.equal(projectFacts({ summary: null }), null);
});

test('a project keeps the colour of its avatar, by its folder', () => {
  assert.equal(projectHue('folder-a'), projectHue('folder-a'));
  assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(projectHue)).size > 1);
});
