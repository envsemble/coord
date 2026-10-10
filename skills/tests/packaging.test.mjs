// Validates the portable packaging, naming and invocation boundaries of the atlas-* skills.
// Run with `node --test skills/tests/`.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const GROUP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.dirname(GROUP);

const EXPECTED = [
  "atlas-babysit-pr",
  "atlas-bootstrap",
  "atlas-grill",
  "atlas-implement",
  "atlas-model",
  "atlas-organize",
  "atlas-record",
];
const EXPLICIT_ONLY = new Set(["atlas-implement", "atlas-babysit-pr"]);
// Keys valid for both Codex and Claude Code skill frontmatter.
const FRONTMATTER_KEYS = new Set(["name", "description", "disable-model-invocation"]);
const ATLAS_SUBCOMMANDS = new Set(["model", "planning", "plan", "usage", "mcp"]);

// Old skill and product names. Character classes keep this file itself free of them.
const RETIRED_NAMES = [
  /work[t]rail[\w-]*/gi,
  /ontouml[- ]atla[s]/gi,
  /(?<![\w-])plannin[g]-(?:bootstrap|grill|implement|record|organize)\b/gi,
  /(?<![\w-])implement-pla[n]\b/gi,
  /(?<![\w-])babysit-p[r]\b/gi,
  /(?<![\w-])atlas-modelin[g]\b/gi,
];
// The old folders the README's install section backs up (as they appear there).
const BACKED_UP = [/plannin[g]-\*/, /work[t]rail-\*/, /\bimplement-pla[n]\b/, /(?<![\w-])babysit-p[r]\b/, /\batlas-modelin[g]\b/];
const PROVIDER_NAME =
  /\b(gpt[\w.-]*|chatgpt|openai|codex|anthropic|claude[\w.-]*|opus|sonnet|haiku|fable|gemini|sol|llama|mistral)\b/gi;

const skillDirs = () =>
  readdirSync(GROUP)
    .filter((name) => existsSync(path.join(GROUP, name, "SKILL.md")))
    .sort();

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const skillFiles = () => EXPECTED.flatMap((name) => walk(path.join(GROUP, name)));
const textFiles = () => skillFiles().filter((file) => /\.(md|ya?ml|json)$/.test(file) || path.basename(file) === ".gitattributes");
const rel = (file) => path.relative(GROUP, file).replaceAll(path.sep, "/");
const read = (file) => readFileSync(file, "utf8");
const withoutFences = (text) => text.replace(/```[\s\S]*?```/g, "");
const retiredNames = (text) => RETIRED_NAMES.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]));
const README = path.join(GROUP, "README.md");
// The README's install section is the one place allowed to name the old folders it backs up.
function installSection(text) {
  const match = /^## Install\r?\n[\s\S]*?(?=^## )/m.exec(text);
  assert.ok(match, "skills/README.md has an Install section followed by another section");
  return match[0];
}

function frontmatter(name) {
  const text = read(path.join(GROUP, name, "SKILL.md"));
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
function openaiPolicy(name) {
  const file = path.join(GROUP, name, "agents", "openai.yaml");
  if (!existsSync(file)) return {};
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

test("exactly the seven atlas-* skills are packaged", () => {
  assert.deepEqual(skillDirs(), EXPECTED);
  for (const name of skillDirs()) assert.match(name, /^atlas-[a-z0-9-]+$/);
  for (const dir of [GROUP, REPO]) {
    for (const name of readdirSync(dir)) {
      if (dir === GROUP && EXPECTED.includes(name)) continue;
      assert.ok(!existsSync(path.join(dir, name, "SKILL.md")), `retired or stray skill folder: ${rel(path.join(dir, name))}`);
    }
  }
});

test("frontmatter is minimal, valid and matches the folder", () => {
  for (const name of EXPECTED) {
    const { meta } = frontmatter(name);
    assert.equal(meta.name, name);
    assert.match(meta.name, /^[a-z0-9-]{1,64}$/);
    assert.equal(typeof meta.description, "string");
    assert.ok(meta.description.trim().length > 0 && meta.description.length <= 1024, `${name}: description length`);
  }
});

test("explicit-only skills declare it for Codex and Claude Code", () => {
  for (const name of EXPECTED) {
    const { meta } = frontmatter(name);
    const implicit = openaiPolicy(name).policy?.allow_implicit_invocation ?? true;
    const explicitOnly = EXPLICIT_ONLY.has(name);
    assert.equal(implicit, !explicitOnly, `${name}: agents/openai.yaml allow_implicit_invocation`);
    assert.equal(meta["disable-model-invocation"] ?? false, explicitOnly, `${name}: disable-model-invocation`);
    if (explicitOnly) assert.match(meta.description, /explicitly invoked/);
  }
});

test("Codex interface metadata uses the Atlas names", () => {
  for (const name of EXPECTED) {
    const ui = openaiPolicy(name).interface;
    if (!ui) continue;
    assert.match(ui.display_name, /^Atlas /, `${name}: display_name`);
    if (ui.default_prompt) assert.ok(ui.default_prompt.includes(`$${name} `), `${name}: default_prompt names the skill`);
  }
});

test("no old skill or product name appears anywhere in skills/", () => {
  for (const file of walk(GROUP)) {
    let text = read(file);
    if (file === README) text = text.replace(installSection(text), "");
    assert.deepEqual(retiredNames(text), [], `${rel(file)} mentions old names`);
  }
});

test("skills promise no compatibility with old model layouts", () => {
  const COMPAT_CLAIMS = [
    /stays? readable/i,
    /root-relative record paths? (?:remain|stay|are) valid/i,
    /without editing model JSON/i,
    /legacy planning-root/i,
  ];
  for (const file of textFiles())
    for (const claim of COMPAT_CLAIMS) assert.doesNotMatch(read(file), claim, `${rel(file)} promises compatibility`);
  const organize = read(path.join(GROUP, "atlas-organize", "references", "organization.md"));
  assert.match(organize, /atlas model revise/, "atlas-organize migrates record paths through an Atlas revision");
  assert.match(organize, /expectedRevision/);
});

test("the README install section backs up every old skill folder", () => {
  const section = installSection(read(README));
  for (const old of BACKED_UP) assert.match(section, old, `install section backs up ${old.source}`);
  assert.ok(retiredNames(section).length > 0);
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
  for (const file of textFiles()) {
    const text = read(file);
    assert.doesNotMatch(text, /\bpython\b|\.py\b|requirements-dev/i, `${rel(file)} refers to Python`);
    const commands = [...text.matchAll(/(?:`|^ {4})atlas ([a-z][\w-]*)/gm)].map((m) => m[1]);
    for (const sub of commands) assert.ok(ATLAS_SUBCOMMANDS.has(sub), `${rel(file)}: unknown command "atlas ${sub}"`);
  }
});

test("relative links resolve and installed skills link only to sibling skills", () => {
  const markdown = [...skillFiles(), path.join(GROUP, "README.md")].filter((file) => file.endsWith(".md") && existsSync(file));
  for (const file of markdown) {
    const text = withoutFences(read(file));
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target.split("#")[0]));
      assert.ok(existsSync(resolved), `${rel(file)}: missing link target ${target}`);
      if (path.basename(file) !== "README.md" || path.dirname(file) !== GROUP) {
        const inside = path.relative(GROUP, resolved).split(path.sep)[0];
        assert.ok(EXPECTED.includes(inside), `${rel(file)}: ${target} leaves the installed skill set`);
      }
    }
  }
});
