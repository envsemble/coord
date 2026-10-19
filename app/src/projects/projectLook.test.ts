import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarTone, avatarTones, initials, projectFacts } from './projectLook.ts';

test('a project row shows its initials in a colour of its own, and its open plans and what agents do on them', () => {
  assert.equal(initials('Coord platform'), 'CP');
  assert.equal(initials('atlas'), 'A');
  assert.equal(initials('envUI-kit'), 'EK');
  const folderId = 'f-' + 'a'.repeat(32);
  assert.equal(avatarTone({ folderId }), avatarTone({ folderId }), 'the same every time');
  assert.ok(avatarTones.includes(avatarTone({ folderId })));
  const work = (state: 'implementing' | 'closed') => ({ state }) as never;
  const activity = (state: 'working' | 'waiting') => ({ state }) as never;
  assert.deepEqual(projectFacts({ summary: { repositories: [], active: [work('implementing'), work('implementing'), work('closed')], closed: [], updated: '2026-10-19', activity: [activity('working'), activity('waiting')], now: '2026-10-19T10:00:00Z' } }),
    { open: 2, working: 1, waiting: 1, updated: '2026-10-19' });
  assert.equal(projectFacts({ summary: null }), null);
});
