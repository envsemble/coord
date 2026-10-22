// Assembles resources/agent, what the packaged app copies into the Atlas home's agent/ folder
// (main/agent/agentFolder.ts): the atlas command, which is the @envsemble/atlas package's sources
// (Node and the app's Electron in Node mode run them as they are) with its production dependencies
// as the lockfile resolves them; the plugin; and the two marketplace manifests that name it. Its
// build.json names the build: the version and a hash of every file, so a rebuild of one version
// is copied in too.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** Files of the @envsemble/atlas package the command reads: no tests, no test helpers, no build scripts or viewer sources. */
const commandFiles = relative => /^(?:bin|src|templates)(?:\/|$)/.test(relative) && !/\.test\.ts$|(?:^|\/)testing\.ts$/.test(relative)
  || ['package.json', 'dist', 'dist/plan-viewer.html'].includes(relative);
/** The diagram package's development pages and tooling are not needed (as in electron-builder.yml's files). */
const diagramFiles = relative => !/^(?:development|downloads|scripts|examples|tests)(?:\/|$)|^(?:index\.html|vite\.config\.mjs|tsconfig\.contracts\.json)$/.test(relative);

/**
 * A dependency's files without its type declarations and read-me files, which nothing loads (the
 * TypeScript capture keeps the compiler's own: its lib/*.d.ts are what it type-checks with). Fewer
 * files make the copy into the home quicker; licences stay.
 */
const dependencyFiles = relative => !/\.d\.[cm]?ts$|(?:^|\/)(?:readme|changelog|history)(?:\.\w+)?$/i.test(relative);

/**
 * The installed packages the command can load, by walking the lockfile from @envsemble/atlas: each
 * one's location in the repository, and where it goes under the command's folder.
 */
function dependencies(repository) {
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json'), 'utf8')).packages;
  const resolve = (from, name) => {
    // Node's lookup: the nearest node_modules/<name> from the requiring package upwards.
    let base = from;
    for (;;) {
      const candidate = (base ? base + '/' : '') + 'node_modules/' + name;
      if (lock[candidate]) return candidate;
      if (!base) return null;
      const index = base.lastIndexOf('/node_modules/');
      base = index < 0 ? '' : base.slice(0, index);
    }
  };
  const root = 'packages/atlas';
  // A workspace package linked into node_modules goes where the link is.
  const linked = new Map([[root, '']]);
  const found = new Map();
  const visit = location => {
    if (found.has(location)) return;
    const entry = lock[location];
    if (!entry) return;
    const real = entry.link ? entry.resolved : location;
    if (entry.link) linked.set(real, location);
    found.set(location, real);
    const target = lock[real] ?? {};
    // Peers a package needs (the MCP SDK's zod) are installed beside it; optional ones are not, nor
    // the diagram package's, which only its React viewer uses.
    const peers = real.startsWith('packages/') ? [] : Object.keys(target.peerDependencies ?? {}).filter(name => !target.peerDependenciesMeta?.[name]?.optional);
    for (const name of [...Object.keys({ ...target.dependencies, ...target.optionalDependencies }), ...peers]) {
      const next = resolve(real, name);
      if (next) visit(next);
    }
  };
  visit(root);
  const placed = new Map();
  for (const [location, real] of found) {
    if (location === root) continue;
    let destination = location;
    for (const [workspace, link] of linked) {
      if (location.startsWith(workspace + '/')) { destination = (link ? link + '/' : '') + location.slice(workspace.length + 1); break; }
    }
    if (placed.has(destination)) throw new Error(`Two packages go to ${destination}: ${placed.get(destination).real} and ${real}`);
    // Optional packages for other systems are in the lockfile but not installed.
    if (fs.existsSync(path.join(repository, real))) placed.set(destination, { real, filter: real === 'packages/diagrams' ? diagramFiles : real.endsWith('/typescript-compiler') ? () => true : dependencyFiles });
  }
  return placed;
}

/** Copy the files of `from` that `filter` accepts (never a nested node_modules or source maps), sorted, adding each to the hash. */
function copy(from, to, filter, hash, relative = '') {
  let files = 0, bytes = 0;
  for (const entry of fs.readdirSync(path.join(from, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.name === 'node_modules' || entry.name.endsWith('.map') || !filter(name)) continue;
    if (entry.isDirectory()) {
      const inner = copy(from, to, filter, hash, name);
      files += inner.files; bytes += inner.bytes;
    } else if (entry.isFile()) {
      const content = fs.readFileSync(path.join(from, name));
      fs.mkdirSync(path.dirname(path.join(to, name)), { recursive: true });
      fs.writeFileSync(path.join(to, name), content);
      hash.update(path.relative(hash.base, path.join(to, name)).split(path.sep).join('/') + '\0').update(content);
      files++; bytes += content.length;
    }
  }
  return { files, bytes };
}

/** Write resources/agent into `destination` from the repository; returns its build and size. */
exports.assemble = function assemble(repository, destination, version) {
  fs.rmSync(destination, { recursive: true, force: true });
  const hash = Object.assign(crypto.createHash('sha256'), { base: destination });
  let files = 0, bytes = 0;
  const add = (from, to, filter = () => true) => { const done = copy(path.join(repository, from), path.join(destination, to), filter, hash); files += done.files; bytes += done.bytes; };
  add('packages/atlas', 'command', commandFiles);
  for (const [to, { real, filter }] of dependencies(repository)) add(real, path.join('command', to), filter);
  add('plugin', 'plugin', relative => !/^tests(?:\/|$)/.test(relative));
  add('.claude-plugin', '.claude-plugin', relative => relative === 'marketplace.json');
  add('.agents', '.agents', relative => relative === 'plugins' || relative === 'plugins/marketplace.json');
  const build = version + '-' + hash.digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(destination, 'build.json'), JSON.stringify({ version, build }, null, 2) + '\n');
  return { build, files, bytes };
};
