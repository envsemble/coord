// Coord Dev's plugin (scripts/dev-plugin.cjs) is the release's renamed and nothing else; and the
// release's carries nothing of Coord Dev.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dirname, '..', '..', '..');
const { devVariant } = createRequire(import.meta.url)('../../scripts/dev-plugin.cjs') as { devVariant(bundle: string): { skills: string[] } };

/** The parts of an assembled bundle (agent-payload.cjs's assemble) the rename reads: the plugin and the marketplace manifests, a command and build.json. */
function releaseBundle(folder: string) {
  cpSync(path.join(repository, 'plugin'), path.join(folder, 'plugin'), { recursive: true, filter: source => !/[\\/]plugin[\\/]tests(?:[\\/]|$)/.test(source) });
  for (const file of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']) {
    mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
    cpSync(path.join(repository, file), path.join(folder, file));
  }
  mkdirSync(path.join(folder, 'command', 'bin'), { recursive: true });
  writeFileSync(path.join(folder, 'command', 'bin', 'coord.js'), '// the command\n');
  writeFileSync(path.join(folder, 'build.json'), JSON.stringify({ version: '0.9.0', build: '0.9.0-abc' }));
}
const files = (folder: string) => (readdirSync(folder, { recursive: true }) as string[]).map(file => file.split(path.sep).join('/')).filter(file => statSync(path.join(folder, file)).isFile()).sort();
const read = (folder: string, file: string) => readFileSync(path.join(folder, ...file.split('/')), 'utf8');

test("Coord Dev's plugin is the release's with its names changed, and nothing else", () => {
  const root = mkdtempSync(path.join(tmpdir(), 'coord-dev-plugin-'));
  try {
    const release = path.join(root, 'release'), dev = path.join(root, 'dev');
    releaseBundle(release);
    cpSync(release, dev, { recursive: true });
    const { skills } = devVariant(dev);
    const names = skills.map(skill => skill.slice('dev-'.length));
    assert.ok(names.includes('coord') && names.includes('full-stop'));

    // The same files, the skills' folders renamed, and the variant's marker.
    const renamed = (file: string) => file.replace(/^plugin\/skills\/([^/]+)\//, 'plugin/skills/dev-$1/');
    assert.deepEqual(files(dev), [...files(release).map(renamed), 'command/variant.json'].sort());
    assert.deepEqual(JSON.parse(read(dev, 'command/variant.json')), { variant: 'dev' });

    // The plugin, its marketplaces and its tool server are coord-dev.
    assert.equal(JSON.parse(read(dev, '.claude-plugin/marketplace.json')).name, 'coord-dev');
    assert.equal(JSON.parse(read(dev, '.claude-plugin/marketplace.json')).plugins[0].name, 'coord-dev');
    assert.equal(JSON.parse(read(dev, '.agents/plugins/marketplace.json')).plugins[0].name, 'coord-dev');
    assert.equal(JSON.parse(read(dev, 'plugin/.claude-plugin/plugin.json')).name, 'coord-dev');
    assert.equal(JSON.parse(read(dev, 'plugin/.codex-plugin/plugin.json')).name, 'coord-dev');
    assert.deepEqual(JSON.parse(read(dev, 'plugin/.mcp.json')).mcpServers['coord-dev'], JSON.parse(read(release, 'plugin/.mcp.json')).mcpServers.coord);
    assert.equal(JSON.parse(read(dev, 'build.json')).build, '0.9.0-abc-dev');

    for (const file of files(release)) {
      const before = read(release, file), after = read(dev, renamed(file));
      if (/^plugin\/skills\//.test(file)) {
        // A skill's files read as the release's once its names are the release's again: only the
        // frontmatter's name and description, the display name, and the mentions of skills differ.
        const back = (text: string) => text.replace(/^name:.*$/m, '').replace(/^description:.*$/m, '').replace(/^(\s*display_name:\s*").*$/m, '$1')
          .replace(/\bdev-([a-z-]+)/g, (word, name: string) => names.includes(name) ? name : word);
        assert.equal(back(after), back(before), file);
        if (file.endsWith('/SKILL.md')) {
          assert.match(after, /^name: dev-/m, file);
          assert.match(after, /^description: "Coord Dev's copy of the /m, file);
        }
      } else if (!/^(?:\.claude-plugin|\.agents)\/|^plugin\/\.(?:claude|codex)-plugin\/|^plugin\/\.mcp\.json$|^build\.json$/.test(file)) {
        // The hooks, the reviewer agent and the command: as the release's.
        assert.equal(after, before, file);
      }
    }
    // No skill links to a release skill any more.
    for (const file of files(dev).filter(file => file.endsWith('.md'))) {
      for (const name of names) assert.doesNotMatch(read(dev, file), new RegExp(`\\]\\(\\.\\./${name}/`), file);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the release's plugin and command carry nothing of Coord Dev", () => {
  assert.equal(JSON.parse(readFileSync(path.join(repository, '.claude-plugin', 'marketplace.json'), 'utf8')).name, 'coord');
  assert.equal(JSON.parse(readFileSync(path.join(repository, '.agents', 'plugins', 'marketplace.json'), 'utf8')).plugins[0].name, 'coord');
  assert.deepEqual(readdirSync(path.join(repository, 'plugin', 'skills')).filter(skill => skill.startsWith('dev-')), []);
  assert.equal(existsSync(path.join(repository, 'packages', 'coord', 'variant.json')), false);
  // The payload the release packs is assembled without the rename.
  assert.doesNotMatch(readFileSync(path.join(repository, 'app', 'scripts', 'after-pack.cjs'), 'utf8'), /dev-plugin/);
});
