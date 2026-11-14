#!/usr/bin/env node
// The coord command. Node 24 runs the TypeScript sources directly (type stripping). The hooks run
// on every tool call, and harnesses wait for some of them, so they load as little as they can.
// A state hook with nothing to record (a tool use that neither ran the coord command to change a
// work item nor may have made a commit or a PR; a prompt or end of a session no work is linked to,
// by its stamp; see src/cli/commands/sessionState.ts) is answered here before any TypeScript loads,
// and otherwise only that file loads. So is a PostToolUse with nothing to do: no Coord tool that
// changes a work item, and no file edited in the home's planning folder. Every other hook loads
// src/cli/commands/hook.ts, not the whole command.
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const started = Date.now();
const [command, event] = process.argv.slice(2);

// A command the app installed in a home's agent folder uses that home, unless COORD_HOME chose
// another: the release's in ~/.coord, Coord Dev's in its copy (homePath.ts's installedHome).
if (!process.env.COORD_HOME) {
  const home = (await import("../src/home/homePath.ts")).installedHome(fileURLToPath(import.meta.url));
  if (home) process.env.COORD_HOME = home;
}
const stateEvents = new Set(["UserPromptSubmit", "ToolUse", "SessionEnd"]);
const name = /^[A-Za-z0-9._:-]{1,128}$/;

/** The Coord home, as homePath.ts's coordHome finds it. */
function coordHome() {
  const chosen = process.env.COORD_HOME;
  const tilde = process.platform === "win32" ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
  return chosen ? path.resolve(chosen.replace(tilde, () => homedir())) : path.join(homedir(), ".coord");
}

/**
 * Whether the session's stamp settles a state hook, as sessionState.ts's stateHook would.
 * @param {string} text
 */
function settled(text) {
  try {
    const input = JSON.parse(text), session = input.session_id;
    if (typeof session !== "string" || !name.test(session)) return true;
    if (event === "ToolUse") {
      // The coord command run in a shell to change a work item links the session (sessionState.ts's runsCoordWork).
      const shell = ["Bash", "PowerShell", "shell", "exec_command", "local_shell", "exec"].includes(input.tool_name) && /\bcoord(?:\.js|\.cmd)?["']?\s+work\s+(?!(?:status|search|report)\b)\w+\b/.test(text);
      // A tool call that may have made a commit or a PR is looked at (sessionState.ts's mayCommit).
      const made = (/\bgit\b.{0,300}?\bcommit\b/.test(text) && /\[[^\]"]{1,100} [0-9a-f]{7,40}\] /.test(text)) || (/\bgh(?:\.exe)?\s+pr\s+create\b/.test(text) && /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(text));
      return !shell && !made;
    }
    // A prompt or an end of a session no work is linked to records nothing.
    return readFileSync(path.join(coordHome(), "session-state", session), "utf8") === "none";
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
 * session is not named, or it neither called a Coord tool that changes a work item nor edited a
 * file (hook.ts's editedFiles) in the home's planning folder. Such a hook records nothing: the
 * ToolUse hook that runs for the same tool call records the session's state.
 * @param {string} text
 */
function idle(text) {
  try {
    const input = JSON.parse(text || "{}");
    if (typeof input.session_id !== "string" || !name.test(input.session_id)) return true;
    if (/^mcp__.*coord.*__(?:step$|state$|work_(?!(?:status|search)$))/.test(input.tool_name ?? "")) return false;
    let base;
    try { base = realpathSync.native(path.join(coordHome(), "planning")); } catch { return true; }
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

/**
 * Note that Coord's hooks ran in the session's agent, for the app's check of the connected agents
 * (src/agents/activity.ts reads it, and tells the agent from the hook's input the same way: the
 * session's log, else a turn_id, which only Codex sends). Written whole: a temporary file renamed into place.
 * @param {string} text
 */
function noteHooks(text) {
  let temporary = null;
  try {
    const input = JSON.parse(text || "{}"), transcript = input.transcript_path;
    const agent = typeof transcript === "string" ? (/[\\/]\.codex[\\/]|[\\/]rollout-[^\\/]*\.jsonl$/.test(transcript) ? "codex" : "claude")
      : typeof input.turn_id === "string" ? "codex" : null;
    if (!agent) return;
    const folder = path.join(coordHome(), "agent", "activity"), file = path.join(folder, agent + "-hooks");
    mkdirSync(folder, { recursive: true });
    temporary = file + "." + process.pid + ".tmp";
    writeFileSync(temporary, new Date(started).toISOString());
    renameSync(temporary, file);
  } catch { if (temporary) rmSync(temporary, { force: true }); /* Best effort: the check waits for the next hook. */ }
}

if (command === "hook") {
  let text = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
  if (event === "SessionStart" || event === "UserPromptSubmit") noteHooks(text);
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
