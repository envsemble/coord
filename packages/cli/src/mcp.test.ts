import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { withDatabase } from '@envsemble/atlas-planning';
import { atlas, command, homeWithPlanning } from './testing.ts';

interface Response { id: number; result?: { tools?: { name: string; description: string; inputSchema: { required?: string[] } }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }; error?: unknown }

test('atlas mcp serves the planning-state tools over stdio, resolving the planning folder from the checkout', async t => {
  const { root, checkout, directory, home, env } = homeWithPlanning(t);
  const child = spawn(process.execPath, [command, 'mcp'], { env, cwd: checkout, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  // The server ends before the test's folders are removed: Windows cannot remove a running program's folder.
  const exited = new Promise(resolve => child.once('exit', resolve));
  try {
    let output = '';
    const waiting = new Map<number, (response: Response) => void>();
    child.stdout.on('data', chunk => {
      output += chunk;
      const lines = output.split('\n');
      output = lines.pop()!;
      for (const line of lines.filter(Boolean)) { const message = JSON.parse(line) as Response; waiting.get(message.id)?.(message); }
    });
    let next = 1;
    const request = (method: string, params: object) => new Promise<Response>((resolve, reject) => {
      const id = next++;
      const timer = setTimeout(() => reject(new Error('MCP timeout for ' + method)), 30000);
      waiting.set(id, response => { clearTimeout(timer); resolve(response); });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const initialized = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'atlas-cli-test', version: '1' } });
    assert.match(JSON.stringify(initialized.result), /Change planning state only through these tools/);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

    const { result: listed } = await request('tools/list', {});
    assert.deepEqual(listed!.tools!.map(tool => tool.name), ['where', 'project_create', 'work_status', 'work_create', 'work_accept', 'work_start', 'step_add', 'step_set', 'step_rename', 'step_remove', 'work_block', 'work_close', 'work_archive', 'work_reopen']);
    assert.ok(listed!.tools!.every(tool => tool.description.length > 40), 'every tool says what it is for');
    assert.ok(!listed!.tools!.some(tool => /diagram|model/i.test(tool.name)), 'no diagram tools: diagrams are files');

    const call = (name: string, args: object) => request('tools/call', { name, arguments: args }).then(response => response.result!);
    const where = await call('where', {});
    assert.equal((where.structuredContent as { matches: { planningFolder: string }[] }).matches[0].planningFolder, root);
    const status = await call('work_status', { work: 'work-0001' });
    assert.equal(status.isError, undefined);
    assert.deepEqual([status.structuredContent!.workId, status.structuredContent!.planningFolder, status.structuredContent!.designStatus], ['work-0001', root, 'draft']);
    const refused = await call('work_start', { work: 'work-0001', steps: ['Build'] });
    assert.equal(refused.isError, true);
    assert.match(refused.content![0].text, /accept it before implementation starts/);
    await call('work_accept', { work: 'work-0001', planningFolder: root });
    const started = await call('work_start', { work: 'work-0001', steps: ['Build', 'Review'], cwd: checkout });
    assert.deepEqual((started.structuredContent!.steps as { title: string }[]).map(step => step.title), ['Build', 'Review']);
    await call('step_set', { work: 'work-0001', step: 'Build', status: 'done' });
    await call('work_block', { work: 'work-0001', reason: 'Waiting' });
    const closing = await call('work_close', { work: 'work-0001' });
    assert.equal(closing.isError, true);
    assert.match(closing.content![0].text, /- Step "Review" is todo\.\n- Blocked: Waiting$/);
    assert.equal((await call('work_block', { work: 'work-0001' })).structuredContent!.blocked, null);
    const created = await call('work_create', { title: 'Payments' });
    assert.deepEqual([created.structuredContent!.workId, created.structuredContent!.repositories], ['work-0002', ['shop']]);
    assert.match(readFileSync(path.join(root, 'active/0001-cart/ledger.md'), 'utf8'), /status: done/);
    // A reason alone is refused, not dropped; naming the work that supersedes it implies superseded.
    assert.match((await call('work_archive', { work: 'work-0001', reason: 'Replaced' })).content![0].text, /only with a disposition/);
    const archived = await call('work_archive', { work: 'work-0001', supersededBy: 'work-0002', reason: 'Payments covers it' });
    assert.deepEqual([archived.structuredContent!.location, archived.structuredContent!.designStatus], ['archive', 'superseded']);
    assert.equal(atlas(['planning', 'check', root], { env }).status, 0);
    assert.equal(atlas(['mcp', '--root', root], { env }).status, 2, 'the former model server spelling is gone');

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
  } finally { child.stdin.end(); child.kill(); await exited; }
});
