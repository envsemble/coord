// Validates the Atlas plugin's packaging: its three skills, the standalone babysit-pr skill, their
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

const PLUGIN_SKILLS = ["atlas", "atlas-grill", "atlas-implement"];
const EXTRA_SKILLS = ["babysit-pr"];
const EXPLICIT_ONLY = new Set(["babysit-pr"]);
// Skills the user triggers by saying their names: the description is that trigger and nothing else.
const BY_NAME = {
  "atlas-grill": ["atlas grill", "grill", "grill me"],
  "atlas-implement": ["atlas implement"],
};
const ALL = [
  ...PLUGIN_SKILLS.map((name) => path.join(SKILLS, name)),
  ...EXTRA_SKILLS.map((name) => path.join(EXTRAS, name)),
];
// Keys valid for both Codex and Claude Code skill frontmatter.
const FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "disable-model-invocation",
]);
// Each harness event the plugin hooks, with the Atlas hooks it runs: after every tool use, the
// session's state besides the checks of planning edits. Each harness has its own hooks file without
// the events it lacks (Claude Code warns about unknown ones): Claude Code's hooks/hooks.json, which
// it loads by default, and Codex's hooks/codex.json, which its manifest names instead.
const HOOK_EVENTS = {
  SessionStart: ["SessionStart"],
  UserPromptSubmit: ["UserPromptSubmit"],
  PostToolUse: ["PostToolUse", "ToolUse"],
  PostToolUseFailure: ["ToolUse"],
  Notification: ["Notification"],
  PermissionRequest: ["PermissionRequest"],
  Stop: ["Stop"],
  StopFailure: ["StopFailure"],
  Interrupt: ["Interrupt"],
  SubagentStart: ["SubagentStart"],
  SubagentStop: ["SubagentStop"],
  SessionEnd: ["SessionEnd"],
};
const HOOK_FILES = {
  "hooks.json": ["Interrupt"],
  "codex.json": ["Notification", "PostToolUseFailure", "StopFailure"],
};

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
const textFiles = () =>
  skillFiles().filter(
    (file) =>
      /\.(md|ya?ml|json)$/.test(file) ||
      path.basename(file) === ".gitattributes",
  );

// The command's usage lines (main.ts and the planning commands) and the MCP server's tool names, read from the code.
const CLI = path.join(REPO, "packages", "atlas", "src", "cli", "commands");
const USAGE = [
  read(path.join(CLI, "..", "main.ts")),
  read(path.join(CLI, "planning.ts")),
]
  .flatMap((text) => [
    ...text.matchAll(/(?:^|`) {2}atlas ([a-z][^\n`]*)(?:`;)?$/gm),
  ])
  .map((match) =>
    match[1]
      .split(" ")
      .filter(
        (word, index, words) =>
          /^[a-z][a-z-]*$/.test(word) &&
          words
            .slice(0, index)
            .every((before) => /^[a-z][a-z-]*$/.test(before)),
      ),
  )
  .filter((words) => words.length > 0);
const TOOLS = [
  ...(
    /const tools[\s\S]*?\n\];/.exec(read(path.join(CLI, "mcp.ts")))?.[0] ?? ""
  ).matchAll(/name: '([a-z_]+)'/g),
].map((match) => match[1]);
const TOOL_MENTION =
  /`(?!work_(?:items|id)`)((?:work|step|project)_[a-z_]+|where|step)`/g; // Registry and ledger fields are not tools.

/** Whether `atlas <words>` names a command: it and a usage line agree for as long as both have words. */
function knownCommand(words) {
  return USAGE.some(
    (usage) =>
      usage.every(
        (word, index) => index >= words.length || words[index] === word,
      ) && words.length > 0,
  );
}
function commandMentions(text) {
  return [...text.matchAll(/(?:`|^ {4}|^)atlas((?: [a-z][a-z-]*)+)/gm)].map(
    (match) => match[1].trim().split(" "),
  );
}

function frontmatter(dir) {
  const name = path.basename(dir);
  const text = read(path.join(dir, "SKILL.md"));
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  assert.ok(match, `${name}: SKILL.md starts with a --- frontmatter block`);
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const entry = /^([a-z][a-z-]*): (.+)$/.exec(line);
    assert.ok(
      entry,
      `${name}: frontmatter line is a flat "key: value" pair: ${line}`,
    );
    const [, key, raw] = entry;
    assert.ok(
      FRONTMATTER_KEYS.has(key),
      `${name}: unsupported frontmatter key ${key}`,
    );
    assert.ok(!(key in meta), `${name}: duplicate frontmatter key ${key}`);
    // A double-quoted scalar without escapes, or a plain one without sequences that change its meaning.
    const quoted = /^"([^"\\]*)"$/.exec(raw);
    assert.ok(
      quoted || !/: |\s#|^[\[\]{}&*!|>'"%@`]/.test(raw),
      `${name}: ${key} is a safe YAML scalar`,
    );
    meta[key] = quoted
      ? quoted[1]
      : raw === "true"
        ? true
        : raw === "false"
          ? false
          : raw;
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
      result[section][child[1]] =
        value === "true"
          ? true
          : value === "false"
            ? false
            : value.replace(/^"(.*)"$/, "$1");
    } else assert.fail(`${name}: unexpected agents/openai.yaml line: ${line}`);
  }
  return result;
}

test("the plugin packages exactly the atlas, atlas-grill and atlas-implement skills; babysit-pr stands apart", () => {
  const folders = (dir) =>
    readdirSync(dir)
      .filter((name) => existsSync(path.join(dir, name, "SKILL.md")))
      .sort();
  assert.deepEqual(folders(SKILLS), PLUGIN_SKILLS);
  assert.deepEqual(folders(EXTRAS), EXTRA_SKILLS);
  for (const name of readdirSync(REPO))
    assert.ok(
      !existsSync(path.join(REPO, name, "SKILL.md")),
      `stray skill folder: ${name}`,
    );
});

test("frontmatter is minimal, valid and matches the folder", () => {
  for (const dir of ALL) {
    const { meta } = frontmatter(dir);
    assert.equal(meta.name, path.basename(dir));
    assert.match(meta.name, /^[a-z0-9-]{1,64}$/);
    assert.equal(typeof meta.description, "string");
    assert.ok(
      meta.description.trim().length > 0 && meta.description.length <= 1024,
      `${meta.name}: description length`,
    );
  }
});

test("explicit-only skills declare it for Codex and Claude Code", () => {
  for (const dir of ALL) {
    const name = path.basename(dir);
    const { meta } = frontmatter(dir);
    const implicit =
      openaiMetadata(dir).policy?.allow_implicit_invocation ?? true;
    const explicitOnly = EXPLICIT_ONLY.has(name);
    assert.equal(
      implicit,
      !explicitOnly,
      `${name}: agents/openai.yaml allow_implicit_invocation`,
    );
    assert.equal(
      meta["disable-model-invocation"] ?? false,
      explicitOnly,
      `${name}: disable-model-invocation`,
    );
    if (explicitOnly) assert.match(meta.description, /explicitly invoked/);
  }
});

test("skills triggered by name describe only their trigger", () => {
  for (const [name, phrases] of Object.entries(BY_NAME)) {
    const quoted = phrases.map((phrase) => `"${phrase}"`);
    const list =
      quoted.length > 1
        ? `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`
        : quoted[0];
    assert.equal(
      frontmatter(path.join(SKILLS, name)).meta.description,
      `Use when the user says ${list}.`,
      name,
    );
  }
});

test("Codex interface metadata uses the Atlas names", () => {
  for (const dir of ALL) {
    const name = path.basename(dir);
    const ui = openaiMetadata(dir).interface;
    if (!ui) continue;
    assert.match(ui.display_name, /^Atlas\b/, `${name}: display_name`);
    if (ui.default_prompt)
      assert.ok(
        ui.default_prompt.includes(`$${name} `),
        `${name}: default_prompt names the skill`,
      );
  }
});

test("skills name no model, provider or harness-specific reviewer", () => {
  for (const file of textFiles()) {
    const text = read(file);
    const found = [...text.matchAll(PROVIDER_NAME)].map((m) => m[0]);
    assert.deepEqual(found, [], `${rel(file)} names a model or provider`);
    assert.doesNotMatch(
      text,
      /codex review|reasoning caps?\b/i,
      `${rel(file)} assumes a reviewer or reasoning cap`,
    );
  }
});

test("every atlas command and Atlas tool the skills and docs name exists in the code", () => {
  assert.ok(
    USAGE.length > 15 &&
      USAGE.some((words) => words.join(" ") === "work step set"),
    "read the command's usage lines",
  );
  assert.ok(
    TOOLS.length >= 12 &&
      TOOLS.includes("where") &&
      TOOLS.includes("work_close") &&
      TOOLS.includes("step"),
    "read the MCP tool names",
  );
  const docs = [
    "README.md",
    "docs/README.md",
    "docs/command.md",
    "docs/agent-interface.md",
    "docs/progress-and-statistics.md",
  ].map((name) => path.join(REPO, name));
  for (const file of [...textFiles(), ...docs]) {
    const text = read(file);
    for (const words of commandMentions(text))
      assert.ok(
        knownCommand(words),
        `${rel(file)}: unknown command "atlas ${words.join(" ")}"`,
      );
    for (const [, tool] of text.matchAll(TOOL_MENTION))
      assert.ok(
        TOOLS.includes(tool),
        `${rel(file)}: unknown Atlas tool ${tool}`,
      );
  }
});

test("relative links resolve and stay inside their skill set", () => {
  for (const file of skillFiles().filter((name) => name.endsWith(".md"))) {
    const home = file.startsWith(SKILLS + path.sep)
      ? SKILLS
      : path.join(EXTRAS, path.relative(EXTRAS, file).split(path.sep)[0]);
    // Links quoted as inline code are examples, not links.
    for (const [, target] of withoutFences(read(file))
      .replace(/`[^`\n]*`/g, "")
      .matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#"))
        continue;
      const resolved = path.resolve(
        path.dirname(file),
        decodeURIComponent(target.split("#")[0]),
      );
      assert.ok(
        existsSync(resolved),
        `${rel(file)}: missing link target ${target}`,
      );
      assert.ok(
        !path.relative(home, resolved).startsWith(".."),
        `${rel(file)}: ${target} leaves its installed skill set`,
      );
    }
  }
});

test("the plugin manifests agree with each other and the repository", () => {
  const version = json(path.join(REPO, "package.json")).version;
  assert.equal(
    json(path.join(REPO, "packages", "atlas", "package.json")).version,
    version,
    "the command's version",
  );
  for (const harness of [".claude-plugin", ".codex-plugin"]) {
    const manifest = json(path.join(PLUGIN, harness, "plugin.json"));
    assert.equal(manifest.name, "atlas", `${harness}: name`);
    assert.equal(manifest.version, version, `${harness}: version`);
    for (const field of ["skills", "mcpServers", "hooks"])
      if (manifest[field])
        assert.ok(
          existsSync(path.join(PLUGIN, manifest[field])),
          `${harness}: ${field} exists`,
        );
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
    [
      claude.plugins.find((plugin) => plugin.name === "atlas"),
      (plugin) => plugin.source,
    ],
    [
      codex.plugins.find((plugin) => plugin.name === "atlas"),
      (plugin) => plugin.source.path,
    ],
  ]) {
    assert.ok(entry, "the marketplace lists the atlas plugin");
    assert.equal(
      path.resolve(REPO, source(entry)),
      PLUGIN,
      "the marketplace points at plugin/",
    );
  }
});

test("the plugin's hooks are the ones Atlas handles", () => {
  assert.equal(
    json(path.join(PLUGIN, ".codex-plugin", "plugin.json")).hooks,
    "./hooks/codex.json",
  );
  for (const [file, lacks] of Object.entries(HOOK_FILES)) {
    const { hooks } = json(path.join(PLUGIN, "hooks", file));
    const events = Object.keys(HOOK_EVENTS).filter(
      (event) => !lacks.includes(event),
    );
    assert.deepEqual(Object.keys(hooks).sort(), events.sort(), file);
    for (const event of events) {
      const commands = hooks[event].flatMap((group) =>
        group.hooks.map((hook) => hook.command),
      );
      assert.deepEqual(
        commands,
        HOOK_EVENTS[event].map((name) => `atlas hook ${name}`),
        `${file}: ${event}: runs ${HOOK_EVENTS[event].join(" and ")}`,
      );
    }
  }
  assert.match(
    read(path.join(REPO, "packages", "atlas", "src", "cli", "main.ts")),
    new RegExp(
      `atlas hook <${[...new Set(Object.values(HOOK_EVENTS).flat())].join("\\|")}>`,
    ),
  );
});
