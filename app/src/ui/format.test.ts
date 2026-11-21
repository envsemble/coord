import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsed } from './format.ts';

test('how long it has been is a length of time in whole units, counted down: under a minute is just now', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const length = (count: number, unit: string) => new Intl.NumberFormat(undefined, { style: 'unit', unit, unitDisplay: 'long' }).format(count);
  assert.equal(elapsed('2026-10-15T11:59:30Z', now), 'just now');
  assert.equal(elapsed('2026-10-15T11:15:20Z', now), length(44, 'minute'));
  assert.equal(elapsed('2026-10-15T08:10:00Z', now), length(3, 'hour'));
  assert.equal(elapsed('2026-10-08T13:00:00Z', now), length(6, 'day'));
  assert.equal(elapsed(null, now), '');
});
