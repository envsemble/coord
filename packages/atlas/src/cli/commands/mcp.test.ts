import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { withDatabase } from '../../home/database.ts';
import { createMcpServer } from './mcp.ts';
import { agentOfClient, readActivity } from '../../agents/activity.ts';
import { homeWithPlanning, run, within } from '../testing.ts';

interface Result { content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }

test('the MCP server serves the planning-state tools, resolving the planning folder from the session\'s folder', async t => {
  const { root, checkout, directory, home, env } = homeWithPlanning(t);
  // As `atlas mcp` started by a harness in the checkout, without the stdio (see mcp.slow.test.ts).
  await within({ env, cwd: checkout }, async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverSide);
    // Named as Claude Code names its client: the first tool call notes that Claude Code uses the tools.
    const client = new Client({ name: 'claude-code', version: '1' });
    await client.connect(clientSide);
    try {
      assert.match(client.getInstructions() ?? '', /only through these tools/);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(tool => tool.name), ['where', 'needs_you', 'project_create', 'work_status', 'work_create', 'work_tag', 'work_search', 'work_accept', 'work_start', 'step', 'work_block', 'work_continue', 'work_close', 'work_archive', 'work_reopen']);
      assert.ok(tools.every(tool => (tool.description ?? '').length > 40), 'every tool says what it is for');

      const call = (name: string, args: object) => client.callTool({ name, arguments: args as Record<string, unknown> }) as Promise<Result>;
      const inRoot = (name: string, args: object) => call(name, { ...args, planningFolder: root });
      const where = await call('where', {});
      assert.match(readActivity(home, 'claude', 'mcp') ?? '', /^\d{4}-/);
      assert.equal(readActivity(home, 'codex', 'mcp'), null);
      // Only Claude Code's and Codex's own clients count: Claude Desktop's (claude-ai) does not.
      assert.deepEqual(['claude-code', 'codex-mcp-client', 'claude-ai', 'codex'].map(agentOfClient), ['claude', 'codex', null, null]);
      assert.equal((where.structuredContent as { matches: { planningFolder: string }[] }).matches[0].planningFolder, root);
      const status = await call('work_status', { work: 'work-0001' });
      assert.equal(status.isError, undefined);
      assert.ok('statistics' in status.structuredContent!, 'work_status keeps the statistics');
      assert.deepEqual([status.structuredContent!.workId, status.structuredContent!.planningFolder, status.structuredContent!.designStatus], ['work-0001', root, 'draft']);
      const refused = await inRoot('work_start', { work: 'work-0001', steps: ['Build'] });
      assert.equal(refused.isError, true);
      assert.match(refused.content![0].text, /accept it before implementation starts/);
      await call('work_accept', { work: 'work-0001', planningFolder: root });
      const started = await call('work_start', { work: 'work-0001', steps: ['Build', 'Review'], cwd: checkout });
      assert.deepEqual((started.structuredContent!.steps as { title: string }[]).map(step => step.title), ['Build', 'Review']);
      assert.ok(!('statistics' in started.structuredContent!) && 'changed' in started.structuredContent!, 'a lifecycle result is the status without statistics');
      // A step change returns the ledger's state only.
      assert.deepEqual(Object.keys((await inRoot('step', { work: 'work-0001', action: 'set', step: 'Build', status: 'done' })).structuredContent!), ['planningFolder', 'workId', 'steps', 'progress', 'blocked'], 'the planning folder stays: the hook links the session to the work item through it');
      // The step tool's other actions; a call missing its action's fields, or carrying another's, is refused with what the action needs.
      const titled = async (args: object) => ((await inRoot('step', { work: 'work-0001', ...args })).structuredContent!.steps as { title: string }[]).map(step => step.title);
      assert.deepEqual(await titled({ action: 'add', steps: ['Docs', 'Spare'] }), ['Build', 'Review', 'Docs', 'Spare']);
      assert.deepEqual(await titled({ action: 'rename', step: 'Docs', to: 'Write docs' }), ['Build', 'Review', 'Write docs', 'Spare']);
      assert.deepEqual(await titled({ action: 'remove', step: 'Spare' }), ['Build', 'Review', 'Write docs']);
      assert.match((await inRoot('step', { work: 'work-0001', action: 'set', step: 'Review' })).content![0].text, /^The step action set needs step \(its title\) and status \(todo, doing or done\)\.$/);
      assert.match((await inRoot('step', { work: 'work-0001', action: 'remove', step: 'Review', status: 'done' })).content![0].text, /needs step \(its title\), and not status\.$/);
      assert.match((await inRoot('step', { work: 'work-0001', action: 'add', steps: [] })).content![0].text, /needs steps, a non-empty list of titles/);
      assert.match((await inRoot('step', { work: 'work-0001', action: 'move' })).content![0].text, /action: add, propose, set, rename or remove/);
      await inRoot('step', { work: 'work-0001', action: 'set', step: 'Write docs', status: 'done' });
      await inRoot('work_block', { work: 'work-0001', reason: 'Waiting' });
      const closing = await inRoot('work_close', { work: 'work-0001' });
      assert.equal(closing.isError, true);
      assert.match(closing.content![0].text, /- Step "Review" is todo\.\n- Blocked: Waiting$/);
      assert.equal((await inRoot('work_block', { work: 'work-0001' })).structuredContent!.blocked, null);
      const created = await call('work_create', { title: 'Payments' });
      assert.equal(created.structuredContent!.workId, 'work-0002');
      assert.deepEqual((await inRoot('work_continue', { work: 'work-0002', continues: ['work-0001'] })).structuredContent!.continues, ['work-0001']);
      assert.match(readFileSync(path.join(root, 'active/0001-cart/ledger.md'), 'utf8'), /status: done/);
      // A reason alone is refused, not dropped; naming the work that supersedes it implies superseded.
      assert.match((await inRoot('work_archive', { work: 'work-0001', reason: 'Replaced' })).content![0].text, /only with a disposition/);
      const archived = await inRoot('work_archive', { work: 'work-0001', supersededBy: 'work-0002', reason: 'Payments covers it' });
      assert.deepEqual([archived.structuredContent!.location, archived.structuredContent!.designStatus], ['archive', 'superseded']);
      assert.equal((await run(['check', root], { env })).status, 0);

      // A project for another folder: made in the home as the app makes one, and from then on that folder's project.
      const returns = path.join(directory, 'returns');
      const made = await call('project_create', { name: 'Shop work', folders: [returns] });
      assert.equal(made.isError, undefined, made.content?.[0].text);
      const planningFolder = path.join(home, 'planning', 'shop-work');
      assert.deepEqual(made.structuredContent, { name: 'Shop work', planningFolder, folders: [returns] });
      assert.ok(existsSync(path.join(planningFolder, '.git')) && existsSync(path.join(planningFolder, 'PLANS.md')));
      assert.ok(withDatabase(home, database => database.projects().some(project => project.name === 'Shop work' && project.folder === planningFolder)), 'its row in the home database');
      assert.deepEqual(((await call('where', { cwd: returns })).structuredContent as { matches: { project: string }[] }).matches.map(match => match.project), ['Shop work']);
      const summarized = await call('work_create', { title: 'Returns', summary: 'Returns by post. Not started.', cwd: returns });
      assert.deepEqual([summarized.structuredContent!.planningFolder, summarized.structuredContent!.summary], [planningFolder, 'Returns by post. Not started.']);
      for (const input of [{ name: 'X' }, { name: 'X', folders: 'nope' }, { name: 'X', folders: ['relative'] }]) assert.equal((await call('project_create', input)).isError, true, JSON.stringify(input));
    } finally { await client.close(); }
  });
});
