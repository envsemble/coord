// Whether Codex trusts Atlas's hooks, from its config.toml: Codex runs a plugin's hooks only once
// the person trusted each in /hooks, and records that as a table per hook,
//
//   [hooks.state."atlas@atlas:hooks/codex.json:session_start:0:0"]
//   trusted_hash = "sha256:…"
//
// keyed by the plugin, the hooks file in it, the event and the hook's place among the event's groups
// and their hooks (codex-rs hooks: hook_key, plugin_hook_key_source). This is not a documented
// format, so it is read cautiously: an entry per hook is looked for, Codex's hash is never computed
// again (a stale one counts as trusted; the hooks' activity shows that case), and a file without a
// hooks.state table, or with keys of another shape, says nothing ('unknown').
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tomlStringAt, tomlStructure } from './grants.ts';

export type HookTrust = 'trusted' | 'untrusted' | 'unknown';

/**
 * Codex's names for the hook events it runs, as its trust keys spell them (hook_event_key_label).
 * Events it does not run (PostToolUseFailure, Notification, StopFailure) have no entry to look for.
 */
const codexEvents: Record<string, string> = {
  PreToolUse: 'pre_tool_use', PermissionRequest: 'permission_request', PostToolUse: 'post_tool_use', PreCompact: 'pre_compact', PostCompact: 'post_compact',
  PreModelRequest: 'pre_model_request', PostModelRequest: 'post_model_request', SessionStart: 'session_start', SessionEnd: 'session_end', UserPromptSubmit: 'user_prompt_submit',
  SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop', Stop: 'stop', Interrupt: 'interrupt',
};
/** A trust key: where the hooks are declared, the event, and the hook's group and place in it. */
const keyShape = /^.+:[a-z]+(?:_[a-z]+)*:\d+:\d+$/;

/** The trust keys of the command hooks in a plugin's hooks file (`file`, relative to the plugin, with forward slashes), for the plugin `plugin@marketplace`. */
export function codexHookKeys(plugin: string, file: string, hooks: unknown): string[] {
  const events = (hooks as { hooks?: unknown } | null)?.hooks;
  if (!events || typeof events !== 'object') return [];
  return Object.entries(events).flatMap(([event, groups]) => {
    const label = codexEvents[event];
    if (!label || !Array.isArray(groups)) return [];
    return groups.flatMap((group: { hooks?: unknown }, index) => (Array.isArray(group?.hooks) ? group.hooks : [])
      .flatMap((hook: { type?: unknown }, place) => hook?.type === 'command' ? [`${plugin}:${file}:${label}:${index}:${place}`] : []));
  });
}

/** Whether a config.toml's text has each of `keys` trusted (with a trusted_hash, and not turned off). */
export function codexHookTrust(config: string | null, keys: string[]): HookTrust {
  if (config === null || !keys.length) return 'unknown';
  let structure: ReturnType<typeof tomlStructure>;
  try { structure = tomlStructure(config); } catch { return 'unknown'; }
  const entries = new Map<string, { trusted: boolean; off: boolean }>();
  const entry = (key: string) => { let found = entries.get(key); if (!found) entries.set(key, found = { trusted: false, off: false }); return found; };
  for (const table of structure.tables) {
    if (table.path[0] !== 'hooks' || table.path[1] !== 'state') continue;
    if (table.array || table.path.length > 3) return 'unknown';
    if (table.path.length === 3) entry(table.path[2]);
  }
  for (const key of structure.keys) {
    const full = [...key.table, ...key.key];
    if (full[0] !== 'hooks' || full[1] !== 'state') continue;
    // hooks.state written another way (an inline table) is a shape this does not read.
    if (full.length !== 4) return 'unknown';
    const value = config.slice(key.value);
    if (full[3] === 'trusted_hash') {
      if (!/^["']/.test(value)) return 'unknown';
      try { entry(full[2]).trusted = tomlStringAt(config, key.value).value.length > 0; } catch { return 'unknown'; }
    } else if (full[3] === 'enabled' && /^false\b/.test(value)) entry(full[2]).off = true;
  }
  if (!entries.size || [...entries.keys()].some(key => !keyShape.test(key))) return 'unknown';
  return keys.every(key => { const found = entries.get(key); return found?.trusted && !found.off; }) ? 'trusted' : 'untrusted';
}

/** The plugin's hooks file that Codex reads (its manifest's `hooks`, else hooks/hooks.json), relative to the plugin. */
function codexHooksFile(manifest: { hooks?: unknown }): string | null {
  if (manifest.hooks === undefined) return 'hooks/hooks.json';
  if (typeof manifest.hooks !== 'string') return null;
  return path.posix.normalize(manifest.hooks.replace(/\\/g, '/')).replace(/^\.\//, '');
}

/**
 * Whether Codex, whose own folder is `codexHome`, trusts the hooks of the Atlas plugin in the
 * marketplace folder `directory` (its plugin/ folder and .agents/plugins/marketplace.json).
 */
export function codexTrust(directory: string, codexHome: string): HookTrust {
  try {
    const plugin = path.join(directory, 'plugin');
    const manifest = JSON.parse(readFileSync(path.join(plugin, '.codex-plugin', 'plugin.json'), 'utf8')) as { name?: unknown; hooks?: unknown };
    const marketplace = (JSON.parse(readFileSync(path.join(directory, '.agents', 'plugins', 'marketplace.json'), 'utf8')) as { name?: unknown }).name;
    const file = codexHooksFile(manifest);
    if (typeof manifest.name !== 'string' || typeof marketplace !== 'string' || !file) return 'unknown';
    const keys = codexHookKeys(`${manifest.name}@${marketplace}`, file, JSON.parse(readFileSync(path.join(plugin, ...file.split('/')), 'utf8')));
    let config: string | null;
    try { config = readFileSync(path.join(codexHome, 'config.toml'), 'utf8'); } catch { config = null; }
    return codexHookTrust(config, keys);
  } catch { return 'unknown'; }
}
