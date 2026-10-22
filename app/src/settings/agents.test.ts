import test from 'node:test';
import assert from 'node:assert/strict';
import { agentWarnings, byHandCommands, finished, withAgent } from './agents.ts';
import type { AgentState } from '../types.ts';

const claude: AgentState = { id: 'claude', found: true, program: null, connected: false, version: null, check: null };
const codex: AgentState = { id: 'codex', found: false, program: null, connected: false, version: null, check: null };

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

test('connecting by hand names the folder and marketplace the app uses; only a connected agent\'s untrusted or idle hooks warn', () => {
  const folder = { directory: 'C:\Users\Ján\.atlas\agent', marketplace: 'atlas' };
  assert.deepEqual(byHandCommands('claude', folder).terminal, ['claude plugin marketplace add "C:\Users\Ján\.atlas\agent"', 'claude plugin install atlas@atlas']);
  assert.deepEqual(byHandCommands('codex', folder).terminal, ['codex plugin marketplace add "C:\Users\Ján\.atlas\agent"', 'codex plugin add atlas@atlas']);
  const connected = { ...claude, connected: true, version: '0.9.0' };
  assert.deepEqual(agentWarnings([
    { ...connected, check: { status: 'waiting' } }, { ...connected, id: 'codex', check: { status: 'untrusted' } }, { ...codex, check: { status: 'no-hooks' } },
  ]).map(agent => agent.id), ['codex']);
});
