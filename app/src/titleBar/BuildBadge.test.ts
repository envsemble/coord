import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BuildBadge } from './BuildBadge.tsx';

test('the title bar says which build this is when it is not a stable release: Dev for Coord Dev (a button, its menu), Nightly for a nightly', () => {
  const badge = (dev: boolean, version: string) => renderToStaticMarkup(createElement(BuildBadge, { info: { dev, version }, run: () => {} }));
  // The Dev tag, as it looks, is the button of its menu.
  assert.match(badge(true, '0.9.0'), /<button[^>]*aria-label="Coord Dev"[^>]*aria-haspopup="menu"[^>]*>.*data-tone="warning".*>Dev</);
  assert.match(badge(false, '0.9.1-nightly.20261114.42'), />Nightly</);
  assert.equal(badge(false, '0.9.0'), '');
});
