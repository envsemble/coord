import test from 'node:test';
import assert from 'node:assert/strict';
import { effortStep, modelPalette, orderModels, shownEffort, unrecordedColour } from './modelColours.ts';

const hue = (colour: string) => colour.match(/oklch\([\d.]+ [\d.]+ (\d+)\)/)![1];
const lightness = (colour: string) => Number(colour.match(/oklch\(([\d.]+)/)![1]);

test('each model its own hue, by its provider first; its efforts steps of lightness from low to high; a model not recorded grey', () => {
  const colour = modelPalette([{ model: 'claude-opus-5-5' }, { model: 'gpt-6.1-sol' }, { model: 'claude-sonnet-5' }, { model: null }]);
  assert.notEqual(hue(colour('claude-opus-5-5', null)), hue(colour('gpt-6.1-sol', null)));
  assert.notEqual(hue(colour('claude-opus-5-5', null)), hue(colour('claude-sonnet-5', null)), 'two models of a provider apart');
  assert.equal(hue(colour('claude-opus-5-5', 'low')), hue(colour('claude-opus-5-5', 'max')), 'an effort keeps its model\'s hue');
  assert.ok(lightness(colour('claude-opus-5-5', 'low')) > lightness(colour('claude-opus-5-5', 'medium')));
  assert.ok(lightness(colour('claude-opus-5-5', 'medium')) > lightness(colour('claude-opus-5-5', 'high')));
  assert.equal(colour(null, null), unrecordedColour);
  assert.match(unrecordedColour, /oklch\([\d.]+ 0 0\)/);
  // The same model alone in its hue takes the same colour on another page.
  assert.equal(modelPalette([{ model: 'claude-opus-5-5' }])('claude-opus-5-5', 'high'), modelPalette([{ model: 'claude-opus-5-5' }, { model: 'gpt-6.1-sol' }])('claude-opus-5-5', 'high'));
  assert.equal(effortStep('HIGH'), 3);
  assert.equal(effortStep(null), 2.5);
});

test('models stack and list by their time, a model\'s efforts together from low to high, a model not recorded last', () => {
  const ordered = orderModels([
    { model: null, effort: null, agentMs: 50 },
    { model: 'gpt-6.1-sol', effort: null, agentMs: 4 },
    { model: 'claude-opus-5-5', effort: 'high', agentMs: 3 },
    { model: 'claude-opus-5-5', effort: 'low', agentMs: 3 },
  ]);
  assert.deepEqual(ordered.map(item => [item.model, item.effort]), [['claude-opus-5-5', 'low'], ['claude-opus-5-5', 'high'], ['gpt-6.1-sol', null], [null, null]]);
  const rows = [{ model: 'claude-opus-5-5', effort: 'high' }, { model: 'claude-opus-5-5', effort: null }, { model: 'gpt-6.1-sol', effort: null }];
  assert.equal(shownEffort(rows, 'claude-opus-5-5', null), 'effort not recorded');
  assert.equal(shownEffort(rows, 'gpt-6.1-sol', null), null);
});
