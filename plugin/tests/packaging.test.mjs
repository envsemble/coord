// Validates the Atlas plugin's packaging: its two skills, the standalone babysit-pr skill, their
// invocation rules, the commands and tools they name, and the plugin and marketplace manifests.
// Run with `npm run test:skills`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.dirname(PLUGIN);
const SKILLS = path.join(PLUGIN, "skills");
const EXTRAS = path.join(REPO, "extras");

const PLUGIN_SKILLS = ["atlas", "atlas-implement"];
const EXTRA_SKILLS = ["babysit-pr"];
const EXPLICIT_ONLY = new Set(["atlas-implement", "babysit-pr"]);
const ALL = [...PLUGIN_SKILLS.map((name) => path.join(SKILLS, name)), ...EXTRA_SKILLS.map((name) => path.join(EXTRAS, name))];
// Keys valid for both Codex and Claude Code skill frontmatter.
const FRONTMATTER_KEYS = new Set(["name", "description", "disable-model-invocation"]);
const HOOK_EVENTS = ["SessionStart", "PostToolUse", "Stop", "SubagentStop"];

// Old skill and product names. Character classes keep this file itself free of them.
const RETIRED_NAMES = [
  /work[t]rail[\w-]*/gi,
  /ontouml[- ]atla[s]/gi,
  /(?<![\w-])plannin[g]-(?:bootstrap|grill|implement|record|organize)\b/gi,
  /(?<![\w-])implement-pla[n]\b/gi,
  /(?<![\w-])atlas-(?:gril[l]|recor[d]|organiz[e]|bootstra[p]|mode[l]|modelin[g]|babysit-p[r])\b/gi,
];
const PROVIDER_NAME =
  /\b(gpt[\w.-]*|chatgpt|openai|codex|anthropic|claude[\w.-]*|opus|sonnet|haiku|fable|gemini|sol|llama|mistral)\b/gi;

const read = (file) => readFileSync(file, "utf8");
const json = (file) => JSON.parse(read(file));
const rel = (file) => path.relative(REPO, file).replaceAll(path.sep, "/");
const withoutFences = (text) => text.replace(/```[\s\S]*?```/g, "");
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
const skillFiles = () => ALL.flatMap(walk);
const textFiles = () => skillFiles().filter((file) => /\.(md|ya?ml|json)$/.test(file) || path.basename(file) === ".gitattributes");

// The command's usage lines (main.ts and the planning commands) and the MCP server's tool names, read from the code.
const CLI = path.join(REPO, "packages", "cli", "src");
const USAGE = [read(path.join(CLI, "main.ts")), read(path.join(CLI, "planning.ts"))]
  .flatMap((text) => [...text.matchAll(/(?:^|`) {2}atlas ([a-z][^\n`]*)$/gm)])
  .map((match) => match[1].split(" ").filter((word, index, words) => /^[a-z][a-z-]*$/.test(word) && words.slice(0, index).every((before) => /^[a-z][a-z-]*$/.test(before))))
  .filter((words) => words.length > 0);
const TOOLS = [...(/const tools[\s\S]*?\n\];/.exec(read(path.join(CLI, "mcp.ts")))?.[0] ?? "").matchAll(/name: '([a-z_]+)'/g)].map((match) => match[1]);
const TOOL_MENTION = /`(?!work_(?:items|id)`)((?:work|step)_[a-z_]+|where)`/g; // Registry and ledger fields are not tools.

/** Whether `atlas <words>` names a command: it and a usage line agree for as long as both have words. */
function knownCommand(words) {
  return USAGE.some((usage) => usage.every((word, index) => index >= words.length || words[index] === word) && words.length > 0);
}
function commandMentions(text) {
  return [...text.matchAll(/(?:`|^ {4}|^)atlas((?: [a-z][a-z-]*)+)/gm)].map((match) => match[1].trim().split(" "));
}

function frontmatter(dir) {
  const name = path.basename(dir);
  const text = read(path.join(dir, "SKILL.md"));
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  assert.ok(match, `${name}: SKILL.md starts with a --- frontmatter block`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([a-z][a-z-]*): (.+)$/.exec(line);
    assert.ok(entry, `${name}: frontmatter line is a flat "key: value" pair: ${line}`);
    const [, key, raw] = entry;
    assert.ok(FRONTMATTER_KEYS.has(key), `${name}: unsupported frontmatter key ${key}`);
    assert.ok(!(key in meta), `${name}: duplicate frontmatter key ${key}`);
    // Plain YAML scalars must not contain sequences that change their meaning.
    assert.ok(!/: |\s#|^[\[\]{}&*!|>'"%@`]/.test(raw), `${name}: ${key} is a safe plain YAML scalar`);
    meta[key] = raw === "true" ? true : raw === "false" ? false : raw;
  }
  return { meta, body: text.slice(match[0].length) };
}

// Minimal reader for the two-level agents/openai.yaml files.
function openaiMetadata(dir) {
  const name = path.basename(dir);
  const file = path.join(dir, "agents", "openai.yaml");
  assert.ok(existsSync(file), `${name}: has agents/openai.yaml`);
  const result = {};
  let section = null;
  for (const line of read(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const top = /^([a-z_]+):$/.exec(line);
    const child = /^ {2}([a-z_]+): (.+)$/.exec(line);
    if (top) result[(section = top[1])] = {};
    else if (child && section) {
      const value = child[2];
      result[section][child[1]] = value === "true" ? true : value === "false" ? false : value.replace(/^"(.*)"$/, "$1");
    } else assert.fail(`${name}: unexpected agents/openai.yaml line: ${line}`);
  }
  return result;
}

test("the plugin packages exactly the atlas and atlas-implement skills; babysit-pr stands apart", () => {
  const folders = (dir) => readdirSync(dir).filter((name) => existsSync(path.join(dir, name, "SKILL.md"))).sort();
  assert.deepEqual(folders(SKILLS), PLUGIN_SKILLS);
  assert.deepEqual(folders(EXTRAS), EXTRA_SKILLS);
  assert.ok(!existsSync(path.join(REPO, "skills")), "the old skills/ folder is gone");
  for (const name of readdirSync(REPO)) assert.ok(!existsSync(path.join(REPO, name, "SKILL.md")), `stray skill folder: ${name}`);
});

test("frontmatter is minimal, valid and matches the folder", () => {
  for (const dir of ALL) {
    const { meta } = frontmatter(dir);
    assert.equal(meta.name, path.basename(dir));
    assert.match(meta.name, /^[a-z0-9-]{1,64}$/);
    assert.equal(typeof meta.description, "string");
    assert.ok(meta.description.trim().length > 0 && meta.description.length <= 1024, `${meta.name}: description length`);
  }
});

test("explicit-only skills declare it for Codex and Claude Code", () => {
  for (const dir of ALL) {
    const name = path.basename(dir);
    const { meta } = frontmatter(dir);
    const implicit = openaiMetadata(dir).policy?.allow_implicit_invocation ?? true;
    const explicitOnly = EXPLICIT_ONLY.has(name);
    assert.equal(implicit, !explicitOnly, `${name}: agents/openai.yaml allow_implicit_invocation`);
    assert.equal(meta["disable-model-invocation"] ?? false, explicitOnly, `${name}: disable-model-invocation`);
    if (explicitOnly) assert.match(meta.description, /explicitly invoked/);
  }
});

test("Codex interface metadata uses the Atlas names", () => {
  for (const dir of ALL) {
    const name = path.basename(dir);
    const ui = openaiMetadata(dir).interface;
    if (!ui) continue;
    assert.match(ui.display_name, /^Atlas\b/, `${name}: display_name`);
    if (ui.default_prompt) assert.ok(ui.default_prompt.includes(`$${name} `), `${name}: default_prompt names the skill`);
  }
});

test("no old skill or product name appears in the skills", () => {
  for (const file of skillFiles()) {
    const found = RETIRED_NAMES.flatMap((pattern) => [...read(file).matchAll(pattern)].map((m) => m[0]));
    assert.deepEqual(found, [], `${rel(file)} mentions old names`);
  }
});

test("skills name no model, provider or harness-specific reviewer", () => {
  for (const file of textFiles()) {
    const text = read(file);
    const found = [...text.matchAll(PROVIDER_NAME)].map((m) => m[0]);
    assert.deepEqual(found, [], `${rel(file)} names a model or provider`);
    assert.doesNotMatch(text, /codex review|reasoning caps?\b/i, `${rel(file)} assumes a reviewer or reasoning cap`);
  }
});

test("skills use the atlas command, not Python helpers", () => {
  for (const file of skillFiles()) assert.doesNotMatch(rel(file), /\.py$/, "no bundled Python");
  for (const file of textFiles()) assert.doesNotMatch(read(file), /\bpython\b|\.py\b|requirements-dev/i, `${rel(file)} refers to Python`);
});

test("every atlas command and Atlas tool the skills and docs name exists in the code", () => {
  assert.ok(USAGE.length > 15 && USAGE.some((words) => words.join(" ") === "work step set"), "read the command's usage lines");
  assert.ok(TOOLS.length >= 13 && TOOLS.includes("where") && TOOLS.includes("work_close"), "read the MCP tool names");
  const docs = ["README.md", "docs/README.md", "docs/command.md", "docs/agent-interface.md", "docs/progress-and-statistics.md"].map((name) => path.join(REPO, name));
  for (const file of [...textFiles(), ...docs]) {
    const text = read(file);
    for (const words of commandMentions(text)) assert.ok(knownCommand(words), `${rel(file)}: unknown command "atlas ${words.join(" ")}"`);
    for (const [, tool] of text.matchAll(TOOL_MENTION)) assert.ok(TOOLS.includes(tool), `${rel(file)}: unknown Atlas tool ${tool}`);
  }
  const atlas = read(path.join(SKILLS, "atlas", "SKILL.md"));
  for (const tool of TOOLS) assert.ok(atlas.includes("`" + tool + "`"), `the atlas skill names the tool ${tool}`);
});

test("relative links resolve and stay inside their skill set", () => {
  for (const file of skillFiles().filter((name) => name.endsWith(".md"))) {
    const home = file.startsWith(SKILLS + path.sep) ? SKILLS : path.join(EXTRAS, path.relative(EXTRAS, file).split(path.sep)[0]);
    for (const [, target] of withoutFences(read(file)).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target.split("#")[0]));
      assert.ok(existsSync(resolved), `${rel(file)}: missing link target ${target}`);
      assert.ok(!path.relative(home, resolved).startsWith(".."), `${rel(file)}: ${target} leaves its installed skill set`);
    }
  }
});

test("the plugin manifests agree with each other and the repository", () => {
  const version = json(path.join(REPO, "package.json")).version;
  assert.equal(json(path.join(REPO, "packages", "cli", "package.json")).version, version, "the command's version");
  for (const harness of [".claude-plugin", ".codex-plugin"]) {
    const manifest = json(path.join(PLUGIN, harness, "plugin.json"));
    assert.equal(manifest.name, "atlas", `${harness}: name`);
    assert.equal(manifest.version, version, `${harness}: version`);
    for (const field of ["skills", "mcpServers"])
      if (manifest[field]) assert.ok(existsSync(path.join(PLUGIN, manifest[field])), `${harness}: ${field} exists`);
  }
  const servers = json(path.join(PLUGIN, ".mcp.json")).mcpServers;
  assert.deepEqual(Object.keys(servers), ["atlas"]);
  assert.equal(servers.atlas.command, "atlas");
  assert.deepEqual(servers.atlas.args, ["mcp"]);
  const claude = json(path.join(REPO, ".claude-plugin", "marketplace.json"));
  const codex = json(path.join(REPO, ".agents", "plugins", "marketplace.json"));
  assert.equal(claude.name, "atlas");
  assert.equal(codex.name, "atlas");
  for (const [entry, source] of [
    [claude.plugins.find((plugin) => plugin.name === "atlas"), (plugin) => plugin.source],
    [codex.plugins.find((plugin) => plugin.name === "atlas"), (plugin) => plugin.source.path],
  ]) {
    assert.ok(entry, "the marketplace lists the atlas plugin");
    assert.equal(path.resolve(REPO, source(entry)), PLUGIN, "the marketplace points at plugin/");
  }
});

test("the plugin's hooks are the four Atlas handles", () => {
  const { hooks } = json(path.join(PLUGIN, "hooks", "hooks.json"));
  assert.deepEqual(Object.keys(hooks).sort(), [...HOOK_EVENTS].sort());
  for (const event of HOOK_EVENTS) {
    const commands = hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
    assert.deepEqual(commands, [`atlas hook ${event}`], `${event}: runs atlas hook ${event}`);
  }
  assert.match(read(path.join(REPO, "packages", "cli", "src", "main.ts")), new RegExp(`atlas hook <${HOOK_EVENTS.join("\\|")}>`));
});
