// `atlas mcp` as a harness starts it: a process speaking JSON-RPC over stdio, in the checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { command, homeWithPlanning } from '../testing.ts';

interface Response { id: number; result?: { tools?: { name: string }[]; content?: { text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean }; error?: unknown }

test('atlas mcp serves the planning-state tools over stdio, resolving the planning folder from the checkout', async t => {
  const { root, checkout, env } = homeWithPlanning(t);
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
    assert.match(JSON.stringify(initialized.result), /only through these tools/);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const { result: listed } = await request('tools/list', {});
    assert.ok(listed!.tools!.some(tool => tool.name === 'work_status'));
    const call = (name: string, args: object) => request('tools/call', { name, arguments: args }).then(response => response.result!);
    const status = await call('work_status', { work: 'work-0001' });
    assert.deepEqual([status.structuredContent!.workId, status.structuredContent!.planningFolder], ['work-0001', root]);
    const refused = await call('work_start', { work: 'work-0001', steps: ['Build'] });
    assert.equal(refused.isError, true);
  } finally { child.stdin.end(); child.kill(); await exited; }
});
