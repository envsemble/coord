import test from 'node:test';
import assert from 'node:assert/strict';
import { finished, withAgent } from './agents.ts';
import type { AgentState } from '../types.ts';

const claude: AgentState = { id: 'claude', found: true, connected: false, version: null };
const codex: AgentState = { id: 'codex', found: false, connected: false, version: null };

test('a connect that failed can be tried again; one the person cancelled, or that worked, leaves nothing to retry', () => {
  assert.deepEqual(finished('connect', { change: { agent: claude, error: 'claude: command failed' } }), { running: null, failed: { action: 'connect', error: 'claude: command failed' } });
  assert.deepEqual(finished('disconnect', { error: 'The host is not running.' }).failed, { action: 'disconnect', error: 'The host is not running.' });
  assert.equal(finished('connect', { error: null }).failed, null);
  assert.equal(finished('connect', { change: { agent: { ...claude, connected: true, version: '0.9.0' }, error: null } }).failed, null);
});

test('an agent changed replaces only its own row', () => {
  const connected = { ...claude, connected: true, version: '0.9.0' };
  assert.deepEqual(withAgent([claude, codex], connected), [connected, codex]);
  assert.equal(withAgent(null, connected), null);
});
