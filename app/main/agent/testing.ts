// What the agent folder's tests share.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Bundle } from './agentFolder.ts';

/** A plugin with Claude Code's and Codex's manifests, `hooks` as both their hooks files, and an MCP server that runs `atlas mcp`. */
export function fakePlugin(directory: string, hooks: unknown, version = '1.0.0') {
  const files: Record<string, string> = {
    '.claude-plugin/plugin.json': JSON.stringify({ name: 'atlas', version }),
    '.codex-plugin/plugin.json': JSON.stringify({ name: 'atlas', version, mcpServers: './.mcp.json', hooks: './hooks/codex.json' }),
    'hooks/hooks.json': JSON.stringify(hooks), 'hooks/codex.json': JSON.stringify(hooks),
    '.mcp.json': JSON.stringify({ mcpServers: { atlas: { command: 'atlas', args: ['mcp'] } } }),
  };
  for (const [name, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(directory, name)), { recursive: true }); writeFileSync(path.join(directory, name), text); }
}

/**
 * A bundle as scripts/agent-payload.cjs assembles it, with one file in each part. Its Node.js is a
 * stand-in for each system, or `runtime` (this one's, to run the command) copied in.
 */
export function fakeBundle(directory: string, build: string, script = 'console.log("atlas");\n', runtime?: string): Bundle {
  const files: Record<string, string> = {
    'command/bin/atlas.js': script, 'command/package.json': '{"type": "module"}\n',
    'command/runtime/LICENSE': 'Node.js\n',
    ...runtime ? {} : { 'command/runtime/node': 'node\n', 'command/runtime/node.exe': 'node\n' },
    '.claude-plugin/marketplace.json': '{"name": "atlas"}', '.agents/plugins/marketplace.json': '{"name": "atlas"}',
    'build.json': JSON.stringify({ version: '1.0.0', build }),
  };
  for (const [name, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(directory, name)), { recursive: true }); writeFileSync(path.join(directory, name), text); }
  fakePlugin(path.join(directory, 'plugin'), { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'atlas hook SessionStart', timeout: 30 }] }] } }, build);
  if (runtime) copyFileSync(runtime, path.join(directory, 'command', 'runtime', process.platform === 'win32' ? 'node.exe' : 'node'));
  return { directory, version: '1.0.0', build };
}
