// Coord Dev's plugin: the release's agent bundle (agent-payload.cjs's assemble), renamed, so Claude
// Code and Codex hold it beside the real plugin without the two meeting. Only names change, and a
// marker of the variant is added; the command, the hooks, the tools and every other file are the
// release's, so what Coord Dev tests is what a release ships. Nothing here is part of a release:
// only `npm run dev` (scripts/dev.mjs) calls it.
//
// - The marketplaces and the plugin are `coord-dev` (agents name skills and tools after the plugin,
//   so a second plugin called `coord` would collide), and its MCP server is `coord-dev`.
// - Every skill is `dev-<name>`, its description saying to use it only in a dev session or when the
//   user asks for it with "dev"; the skills' links to each other and their mentions of each other by
//   name follow.
// - command/variant.json says `dev`: the command's hooks then stay silent outside a dev session
//   (packages/coord/src/cli/commands/devSession.ts).
// - The build is the release's with `-dev`, so the agent folder copies it as a build of its own.
const fs = require('node:fs');
const path = require('node:path');

exports.devName = 'coord-dev';
const prefix = 'dev-';

/** A skill's description for Coord Dev's copy of it. */
exports.devDescription = function devDescription(name, original) {
  // The release skill's own description is quoted as that skill's, so its trigger words lead to it, not here.
  return `Coord Dev's copy of the ${name} skill, for trying Coord in development. Use it only in a dev session (the session's context says it is one) or when the user asks for it with "dev", such as "dev ${name.replace(/-/g, ' ')}"; at any other time use ${name} itself, the skill whose description reads: «${original}»`;
};

/** Text with each skill's links and mentions pointing at Coord Dev's copy: `../name/` links, `name` in backticks and Codex's $name. */
function renameMentions(text, skills) {
  // Longest first, so coord-grill is not read as coord.
  for (const name of [...skills].sort((a, b) => b.length - a.length)) {
    const word = name.replace(/[-]/g, '\\-');
    text = text
      .replace(new RegExp(`\\]\\(\\.\\./${word}/`, 'g'), `](../${prefix}${name}/`)
      .replace(new RegExp('`' + word + '`', 'g'), '`' + prefix + name + '`')
      .replace(new RegExp(`\\$${word}(?![\\w-])`, 'g'), `$${prefix}${name}`);
  }
  return text;
}

/** Rewrite the assembled bundle in `bundle` into Coord Dev's, in place. */
exports.devVariant = function devVariant(bundle) {
  const json = (file, change) => {
    const target = path.join(bundle, ...file.split('/'));
    const value = JSON.parse(fs.readFileSync(target, 'utf8'));
    change(value);
    fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
  };
  const name = exports.devName, about = 'Coord Dev: the development build of the Coord plugin, used in dev sessions.';
  json('.claude-plugin/marketplace.json', manifest => {
    manifest.name = name;
    manifest.plugins[0].name = name;
    if (manifest.metadata) manifest.metadata.description = about;
  });
  json('.agents/plugins/marketplace.json', manifest => {
    manifest.name = name;
    if (manifest.interface) manifest.interface.displayName = 'Coord Dev';
    manifest.plugins[0].name = name;
  });
  for (const file of ['plugin/.claude-plugin/plugin.json', 'plugin/.codex-plugin/plugin.json']) json(file, plugin => {
    plugin.name = name;
    plugin.description = about;
    if (plugin.interface) plugin.interface.displayName = 'Coord Dev';
  });
  json('plugin/.mcp.json', file => { file.mcpServers = { [name]: file.mcpServers.coord }; });

  const skillsFolder = path.join(bundle, 'plugin', 'skills');
  const skills = fs.readdirSync(skillsFolder).filter(entry => fs.statSync(path.join(skillsFolder, entry)).isDirectory());
  for (const skill of skills) {
    const folder = path.join(skillsFolder, skill);
    for (const file of fs.readdirSync(folder, { recursive: true })) {
      const target = path.join(folder, file);
      if (!/\.(?:md|ya?ml)$/.test(file) || !fs.statSync(target).isFile()) continue;
      let text = renameMentions(fs.readFileSync(target, 'utf8'), skills);
      if (file === 'SKILL.md') {
        text = text.replace(/^name:.*$/m, `name: ${prefix}${skill}`).replace(/^description:\s*(.*)$/m, (_line, value) => {
          const original = value.startsWith('"') ? JSON.parse(value) : value;
          return 'description: ' + JSON.stringify(exports.devDescription(skill, original));
        });
      } else if (/(?:^|[\\/])agents[\\/]openai\.ya?ml$/.test(file)) {
        text = text.replace(/^(\s*display_name:\s*")(.*)"$/m, (_line, start, value) => `${start}${value.replace(/^Coord\b/, 'Coord Dev')}"`);
      }
      fs.writeFileSync(target, text);
    }
    fs.renameSync(folder, path.join(skillsFolder, prefix + skill));
  }

  fs.writeFileSync(path.join(bundle, 'command', 'variant.json'), JSON.stringify({ variant: 'dev' }, null, 2) + '\n');
  json('build.json', build => { build.build += '-dev'; });
  return { skills: skills.map(skill => prefix + skill) };
};
