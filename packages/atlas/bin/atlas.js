#!/usr/bin/env node
// The atlas command. Node 24 runs the TypeScript sources directly (type stripping). The hooks run
// on every tool call, and harnesses wait for some of them, so they load as little as they can.
// When the session's stamp settles a state hook (a session no work is linked to, or one at work and
// seen within the minute; a subagent's tool use by its own stamp; see src/cli/commands/sessionState.ts),
// it is answered here before any TypeScript loads, and otherwise only that file loads. So is a
// PostToolUse with nothing to do: no Atlas tool that changes a work item, and no file edited in the
// home's planning folder. Every other hook loads src/cli/commands/hook.ts, not the whole command.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const started = Date.now();
const [command, event] = process.argv.slice(2);
const stateEvents = new Set(["UserPromptSubmit", "ToolUse", "Notification", "PermissionRequest", "SessionEnd", "SubagentStart"]);
const name = /^[A-Za-z0-9._:-]{1,128}$/;

/** The Atlas home, as homePath.ts's atlasHome finds it. */
function atlasHome() {
  const chosen = process.env.ATLAS_HOME;
  const tilde = process.platform === "win32" ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
  return chosen ? path.resolve(chosen.replace(tilde, () => homedir())) : path.join(homedir(), ".atlas");
}

/**
 * Whether the session's stamp settles a state hook, as sessionState.ts's stateHook would.
 * @param {string} text
 */
function settled(text) {
  try {
    const input = JSON.parse(text), session = input.session_id;
    if (typeof session !== "string" || !name.test(session)) return true;
    const agent = event === "ToolUse" && typeof input.agent_id === "string" && name.test(input.agent_id) ? input.agent_id : null;
    const stamp = path.join(atlasHome(), "session-state", agent ? session + "~" + agent : session);
    const state = readFileSync(stamp, "utf8");
    if (state === "none" && !agent) return true;
    // A tool call that may have made a commit or a PR is looked at (sessionState.ts's mayMakeProduct).
    if (event === "ToolUse" && ((/\bgit\b.{0,300}?\bcommit\b/.test(text) && /\[[^\]"]{1,100} [0-9a-f]{7,40}\] /.test(text)) || (/\bgh(?:\.exe)?\s+pr\s+create\b/.test(text) && /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(text)))) return false;
    // A subagent's stamp says it was seen, or that its session links no work, within the minute.
    return event === "ToolUse" && (state === "working" || (agent !== null && state === "none")) && started - statSync(stamp).mtimeMs < 60_000;
  } catch { return false; }
}

/**
 * Every string in a value, however deep, as hook.ts's strings finds them.
 * @param {unknown} value
 * @returns {string[]}
 */
function strings(value, depth = 0) {
  if (typeof value === "string") return [value];
  if (depth > 6 || !value || typeof value !== "object") return [];
  return (Array.isArray(value) ? value : Object.values(value)).flatMap(item => strings(item, depth + 1));
}

/**
 * Whether a PostToolUse has nothing to do, as hook.ts's runHook and postToolUse would find: its
 * session is not named, or it neither called an Atlas tool that changes a work item nor edited a
 * file (hook.ts's editedFiles) in the home's planning folder. Such a hook records nothing: the
 * ToolUse hook that runs for the same tool call records the session's state.
 * @param {string} text
 */
function idle(text) {
  try {
    const input = JSON.parse(text || "{}");
    if (typeof input.session_id !== "string" || !name.test(input.session_id)) return true;
    if (/^mcp__.*atlas.*__(?:work|step)_(?!status$)/.test(input.tool_name ?? "")) return false;
    let base;
    try { base = realpathSync.native(path.join(atlasHome(), "planning")); } catch { return true; }
    const files = [], toolInput = input.tool_input;
    if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(input.tool_name ?? "") && toolInput) {
      for (const field of ["file_path", "notebook_path"]) if (typeof toolInput[field] === "string") files.push(toolInput[field]);
    }
    for (const value of strings(toolInput)) {
      for (const match of value.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+?)\s*$|^\*\*\* Move to: (.+?)\s*$/gm)) files.push(match[1] ?? match[2]);
    }
    const folder = input.cwd && path.isAbsolute(input.cwd) ? input.cwd : process.cwd();
    const key = process.platform === "win32" || process.platform === "darwin" ? (/** @type {string} */ value) => value.toLowerCase() : (/** @type {string} */ value) => value;
    return files.every(file => {
      const absolute = path.resolve(folder, file);
      let resolved = absolute;
      try { resolved = realpathSync.native(absolute); } catch { /* A file that is gone is taken as named. */ }
      const relative = path.relative(key(base), key(resolved));
      return relative === "" || relative.startsWith("..") || path.isAbsolute(relative);
    });
  } catch { return false; }
}

if (command === "hook") {
  let text = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
  if (stateEvents.has(event)) {
    if (!settled(text)) await (await import("../src/cli/commands/sessionState.ts")).stateHook(event, text, started);
  } else if (!(event === "PostToolUse" && idle(text))) {
    const output = { stdout: (/** @type {string} */ line) => process.stdout.write(line + "\n"), stderr: (/** @type {string} */ line) => process.stderr.write(line + "\n") };
    await (await import("../src/cli/commands/hook.ts")).hook(event === undefined ? [] : [event], output, text, new Date(started).toISOString());
  }
} else {
  const { main } = await import("../src/cli/main.ts");
  process.exitCode = await main(process.argv.slice(2));
}
