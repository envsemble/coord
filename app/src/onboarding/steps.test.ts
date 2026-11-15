import test from 'node:test';
import assert from 'node:assert/strict';
import { chosenAgents, stepFrom, stepsFor } from './steps.ts';
import type { AgentState } from '../types.ts';

const agent = (id: AgentState['id'], found: boolean): AgentState => ({ id, found, program: null, connected: false, version: null, check: null });

test('the onboarding connects only when an agent is chosen, and steps back the way it came', () => {
  assert.deepEqual(stepsFor(['claude']), ['welcome', 'agents', 'connect', 'start']);
  assert.deepEqual(stepsFor([]), ['welcome', 'agents', 'start']);
  assert.equal(stepFrom('agents', 1, ['codex']), 'connect');
  assert.equal(stepFrom('agents', 1, []), 'start');
  assert.equal(stepFrom('start', -1, []), 'agents');
  assert.equal(stepFrom('start', -1, ['claude', 'codex']), 'connect');
  assert.equal(stepFrom('welcome', -1, []), null);
  assert.equal(stepFrom('start', 1, ['claude']), null);
  // On Connect, unticking every agent (going back first) still leads on from where it is.
  assert.equal(stepFrom('connect', 1, []), 'start');
});

test('the agents found start chosen; one unticked stays unticked, and one not found is never chosen', () => {
  const both = [agent('claude', true), agent('codex', false)];
  assert.deepEqual(chosenAgents(both, []), ['claude']);
  assert.deepEqual(chosenAgents([agent('claude', true), agent('codex', true)], ['claude']), ['codex']);
});
