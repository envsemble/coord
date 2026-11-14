import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildBadge } from './BuildBadge.tsx';

test('the title bar says which build this is when it is not a stable release: Dev for Coord Dev, Nightly for a nightly', () => {
  const badge = (dev: boolean, version: string) => renderToStaticMarkup(createElement(BuildBadge, { info: { dev, version } }));
  assert.match(badge(true, '0.9.0'), />Dev</);
  assert.match(badge(false, '0.9.1-nightly.20261114.42'), />Nightly</);
  assert.equal(badge(false, '0.9.0'), '');
});
