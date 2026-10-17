import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { withDatabase } from '@envsemble/atlas-planning';
import { createMcpServer } from './mcp.ts';
import { homeWithPlanning, run, within } from '../testing.ts';

interface Result { content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }

test('the MCP server serves the planning-state tools, resolving the planning folder from the checkout', async t => {
  const { root, checkout, directory, home, env } = homeWithPlanning(t);
  // As `atlas mcp` started by a harness in the checkout, without the stdio (see mcp.slow.test.ts).
  await within({ env, cwd: checkout }, async () => {
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer();
    await server.connect(serverSide);
    const client = new Client({ name: 'atlas-cli-test', version: '1' });
    await client.connect(clientSide);
    try {
      assert.match(client.getInstructions() ?? '', /Change planning state only through these tools/);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map(tool => tool.name), ['where', 'project_create', 'work_status', 'work_create', 'work_accept', 'work_start', 'step_add', 'step_set', 'step_rename', 'step_remove', 'work_block', 'work_close', 'work_archive', 'work_reopen']);
      assert.ok(tools.every(tool => (tool.description ?? '').length > 40), 'every tool says what it is for');

      const call = (name: string, args: object) => client.callTool({ name, arguments: args as Record<string, unknown> }) as Promise<Result>;
      // Once the checkout found it, the planning folder is named: finding it again each time asks Git.
      const inRoot = (name: string, args: object) => call(name, { ...args, planningFolder: root });
      const where = await call('where', {});
      assert.equal((where.structuredContent as { matches: { planningFolder: string }[] }).matches[0].planningFolder, root);
      const status = await call('work_status', { work: 'work-0001' });
      assert.equal(status.isError, undefined);
      assert.deepEqual([status.structuredContent!.workId, status.structuredContent!.planningFolder, status.structuredContent!.designStatus], ['work-0001', root, 'draft']);
      const refused = await inRoot('work_start', { work: 'work-0001', steps: ['Build'] });
      assert.equal(refused.isError, true);
      assert.match(refused.content![0].text, /accept it before implementation starts/);
      await call('work_accept', { work: 'work-0001', planningFolder: root });
      const started = await call('work_start', { work: 'work-0001', steps: ['Build', 'Review'], cwd: checkout });
      assert.deepEqual((started.structuredContent!.steps as { title: string }[]).map(step => step.title), ['Build', 'Review']);
      await inRoot('step_set', { work: 'work-0001', step: 'Build', status: 'done' });
      await inRoot('work_block', { work: 'work-0001', reason: 'Waiting' });
      const closing = await inRoot('work_close', { work: 'work-0001' });
      assert.equal(closing.isError, true);
      assert.match(closing.content![0].text, /- Step "Review" is todo\.\n- Blocked: Waiting$/);
      assert.equal((await inRoot('work_block', { work: 'work-0001' })).structuredContent!.blocked, null);
      const created = await call('work_create', { title: 'Payments' });
      assert.deepEqual([created.structuredContent!.workId, created.structuredContent!.repositories], ['work-0002', ['shop']]);
      assert.match(readFileSync(path.join(root, 'active/0001-cart/ledger.md'), 'utf8'), /status: done/);
      // A reason alone is refused, not dropped; naming the work that supersedes it implies superseded.
      assert.match((await inRoot('work_archive', { work: 'work-0001', reason: 'Replaced' })).content![0].text, /only with a disposition/);
      const archived = await inRoot('work_archive', { work: 'work-0001', supersededBy: 'work-0002', reason: 'Payments covers it' });
      assert.deepEqual([archived.structuredContent!.location, archived.structuredContent!.designStatus], ['archive', 'superseded']);
      assert.equal((await run(['planning', 'check', root], { env })).status, 0);

      // A project for the folder the checkout is in: made in the home as the app makes one, and from then on the checkout's project.
      const made = await call('project_create', { name: 'Shop work', workspaces: [directory] });
      assert.equal(made.isError, undefined, made.content?.[0].text);
      const planningFolder = path.join(home, 'planning', 'shop-work');
      assert.deepEqual(made.structuredContent, { name: 'Shop work', planningFolder, workspaces: [directory], repositories: [{ id: 'shop', name: 'shop', remote: 'https://github.com/example/shop.git' }], skipped: [] });
      assert.ok(existsSync(path.join(planningFolder, '.git')) && existsSync(path.join(planningFolder, 'PLANS.md')));
      assert.ok(withDatabase(home, database => database.projects().some(project => project.name === 'Shop work' && project.folder === planningFolder)), 'its row in the home database');
      assert.deepEqual(((await call('where', {})).structuredContent as { matches: { project: string }[] }).matches.map(match => match.project), ['Shop work']);
      const summarized = await call('work_create', { title: 'Returns', summary: 'Returns by post. Not started.' });
      assert.deepEqual([summarized.structuredContent!.planningFolder, summarized.structuredContent!.summary], [planningFolder, 'Returns by post. Not started.']);
      for (const input of [{ name: 'X', workspaces: [] }, { name: 'X', workspaces: [path.join(directory, 'missing')] }]) assert.equal((await call('project_create', input)).isError, true, JSON.stringify(input));
    } finally { await client.close(); }
  });
});
