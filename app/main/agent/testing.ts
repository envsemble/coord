// What the agent folder's tests share.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Bundle } from './agentFolder.ts';

/** A bundle as scripts/agent-payload.cjs assembles it, with one file in each part. */
export function fakeBundle(directory: string, build: string, script = 'console.log("atlas");\n'): Bundle {
  const files: Record<string, string> = {
    'command/bin/atlas.js': script, 'command/package.json': '{"type": "module"}\n',
    'plugin/.claude-plugin/plugin.json': JSON.stringify({ name: 'atlas', version: build }),
    '.claude-plugin/marketplace.json': '{"name": "atlas"}', '.agents/plugins/marketplace.json': '{"name": "atlas"}',
    'build.json': JSON.stringify({ version: '1.0.0', build }),
  };
  for (const [name, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(directory, name)), { recursive: true }); writeFileSync(path.join(directory, name), text); }
  return { directory, version: '1.0.0', build };
}
