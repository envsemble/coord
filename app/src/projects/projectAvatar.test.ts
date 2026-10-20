import test from 'node:test';
import assert from 'node:assert/strict';
import { initials, projectFacts, projectHue } from './projectAvatar.ts';

test('a project row shows its initials, and its open plans and what agents do on them', () => {
  assert.equal(initials('Coord platform'), 'CP');
  assert.equal(initials('atlas'), 'A');
  assert.equal(initials('envUI-kit'), 'EK');
  const work = (state: 'implementing' | 'closed') => ({ state }) as never;
  const activity = (state: 'working' | 'waiting') => ({ state }) as never;
  assert.deepEqual(projectFacts({ summary: { active: [work('implementing'), work('implementing'), work('closed')], closed: [], updated: '2026-10-19', activity: [activity('working'), activity('waiting')], now: '2026-10-19T10:00:00Z' } }),
    { open: 2, working: 1, waiting: 1, updated: '2026-10-19' });
  assert.equal(projectFacts({ summary: null }), null);
});

test('a project keeps the colour of its avatar, by its folder', () => {
  assert.equal(projectHue('folder-a'), projectHue('folder-a'));
  assert.ok(new Set(['a', 'b', 'c', 'd', 'e', 'f'].map(projectHue)).size > 1);
});
