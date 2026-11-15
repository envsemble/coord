// electron-builder afterPack hook: drop the diagram package's dependencies that only its command-line
// features use (PostgreSQL and TypeScript capture), which the desktop app never loads; and assemble
// resources/agent, the coord command (which keeps them), the Node.js it runs on and the plugin
// (agent-payload.cjs).
const fs = require('node:fs');
const path = require('node:path');
const { Arch } = require('electron-builder');
const { assemble, nodeRuntime } = require('./agent-payload.cjs');

/** Dependencies of @envsemble/coord-diagrams the app never loads, with everything only they need. */
const unused = new Set(['pg', 'typescript-compiler']);

/** Every installed package the app can load, by walking the lockfile from the app's dependencies. */
function runtimePackages(repository) {
  const lock = JSON.parse(fs.readFileSync(path.join(repository, 'package-lock.json'), 'utf8')).packages;
  const kept = new Set();
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
  const visit = location => {
    let entry = lock[location];
    if (!entry || kept.has(location)) return;
    kept.add(location);
    if (entry.link) entry = lock[entry.resolved];
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) {
      if (unused.has(name)) continue;
      const found = resolve(location, name);
      if (found) visit(found);
    }
  };
  for (const name of Object.keys(lock.app.dependencies)) visit(resolve('', name));
  return kept;
}

function size(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    total += entry.isDirectory() ? size(full) : fs.statSync(full).size;
  }
  return total;
}

exports.default = async function afterPack(context) {
  const repository = path.resolve(context.packager.projectDir, '..');
  const resources = context.electronPlatformName === 'darwin' ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(context.appOutDir, 'resources');
  const app = path.join(resources, 'app');
  const kept = runtimePackages(repository);
  // electron-builder lays node_modules out on its own: a package nested in the lockfile (such as
  // electron-updater's own builder-util-runtime) can land at the top. A package is kept wherever it
  // lands when the app loads one of that name.
  const keptNames = new Set([...kept].map(location => location.slice(location.lastIndexOf('node_modules/') + 'node_modules/'.length)));
  let removed = 0, bytes = 0;
  const prune = (directory, prefix) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      if (entry.name.startsWith('@')) { prune(path.join(directory, entry.name), prefix + entry.name + '/'); continue; }
      const location = prefix + entry.name;
      const full = path.join(directory, entry.name);
      if (kept.has(location) || keptNames.has(prefix.slice(prefix.lastIndexOf('node_modules/') + 'node_modules/'.length) + entry.name)) { prune(path.join(full, 'node_modules'), location + '/node_modules/'); continue; }
      bytes += size(full);
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
    }
  };
  prune(path.join(app, 'node_modules'), 'node_modules/');
  console.log(`  • pruned ${removed} packages the app never loads (${(bytes / 1048576).toFixed(1)} MB)`);
  const runtime = await nodeRuntime(repository, context.electronPlatformName, Arch[context.arch]);
  const agent = assemble(repository, path.join(resources, 'agent'), context.packager.appInfo.version, runtime);
  console.log(`  • assembled the coord command on Node.js ${runtime.version} and the plugin, build ${agent.build} (${agent.files} files, ${(agent.bytes / 1048576).toFixed(1)} MB)`);
};
