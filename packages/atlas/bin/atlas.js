#!/usr/bin/env node
// The atlas command. Node 24 runs the TypeScript sources directly (type stripping). The hooks that
// only record what a session does run on every tool call, and some harnesses wait for them: when the
// session's stamp settles one (a session no work is linked to, or one at work and seen within the
// minute; see src/cli/commands/sessionState.ts), it is answered here before any TypeScript loads,
// and otherwise only that file loads, not the whole command.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const started = Date.now();
const [command, event] = process.argv.slice(2);
const stateEvents = new Set(["UserPromptSubmit", "ToolUse", "Notification", "PermissionRequest", "SessionEnd"]);

/**
 * Whether the session's stamp settles a state hook, as sessionState.ts's stateHook would.
 * @param {string} text
 */
function settled(text) {
  try {
    const session = JSON.parse(text).session_id;
    if (typeof session !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(session)) return true;
    // The Atlas home, as homePath.ts's atlasHome finds it.
    const chosen = process.env.ATLAS_HOME;
    const tilde = process.platform === "win32" ? /^~(?=$|[\\/])/ : /^~(?=$|\/)/;
    const home = chosen ? path.resolve(chosen.replace(tilde, () => homedir())) : path.join(homedir(), ".atlas");
    const stamp = path.join(home, "session-state", session);
    const state = readFileSync(stamp, "utf8");
    if (state === "none") return true;
    // A tool call that may have made a commit or a PR is looked at (sessionState.ts's mayMakeProduct).
    if (event === "ToolUse" && (/\[[^\]\s"]+(?: \(root-commit\))? [0-9a-f]{7,40}\] /.test(text) || /github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(text))) return false;
    return event === "ToolUse" && state === "working" && started - statSync(stamp).mtimeMs < 60_000;
  } catch { return false; }
}

if (command === "hook" && stateEvents.has(event)) {
  let text = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
  if (!settled(text)) await (await import("../src/cli/commands/sessionState.ts")).stateHook(event, text, started);
} else {
  const { main } = await import("../src/cli/main.ts");
  process.exitCode = await main(process.argv.slice(2));
}
