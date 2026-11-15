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
  const folder = { directory: String.raw`C:\Users\Ján O\.coord\agent`, marketplace: 'coord', plugin: 'coord@coord' };
  assert.deepEqual(byHandCommands('claude', folder), {
    terminal: [String.raw`claude plugin marketplace add "C:\Users\Ján O\.coord\agent"`, 'claude plugin install coord@coord'],
    // Claude Code's /plugin takes the rest of the line as the path, quotes and all: a path with a space goes in as it is.
    session: [String.raw`/plugin marketplace add C:\Users\Ján O\.coord\agent`, '/plugin install coord@coord'],
  });
  assert.deepEqual(byHandCommands('codex', folder).terminal, [String.raw`codex plugin marketplace add "C:\Users\Ján O\.coord\agent"`, 'codex plugin add coord@coord']);
  const connected = { ...claude, connected: true, version: '0.9.0' };
  assert.deepEqual(agentWarnings([
    { ...connected, check: { status: 'waiting' } }, { ...connected, id: 'codex', check: { status: 'untrusted' } }, { ...codex, check: { status: 'no-hooks' } },
  ]).map(agent => agent.id), ['codex']);
});
