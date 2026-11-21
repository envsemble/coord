// Assembles resources/agent, what the packaged app copies into the Coord home's agent/ folder
// (main/agent/agentFolder.ts): the coord command, which is the @envsemble/coord package's sources
// (Node runs them as they are) with its production dependencies as the lockfile resolves them, and
// the Node.js it runs on, in runtime/; the plugin; and the two marketplace manifests that name it.
// Its build.json names the build: the version and a hash of every file, so a rebuild of one version
// is copied in too.
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** The Node.js the command runs on: a release of Node 24 (engines: >=24), pinned; CI's setup-node takes the latest 24. */
const nodeVersion = '24.22.1';

/**
 * The official Node.js executable for a platform and architecture (electron-builder's names) and its
 * licence, from nodejs.org, checked against the release's SHASUMS256.txt. The archive and the sums
 * are kept in artifacts/node-runtime (not committed), so packaging works offline once they are there;
 * a kept archive is checked again each time.
 */
exports.nodeRuntime = async function nodeRuntime(repository, platform, arch) {
  const system = { win32: 'win', linux: 'linux', darwin: 'darwin' }[platform];
  const cpu = { x64: 'x64', arm64: 'arm64', ia32: 'x86', armv7l: 'armv7l' }[arch];
  if (!system || !cpu) throw new Error(`No Node.js runtime for ${platform} ${arch}`);
  const name = `node-v${nodeVersion}-${system}-${cpu}`;
  const archive = name + (system === 'win' ? '.zip' : '.tar.gz');
  const cache = path.join(repository, 'artifacts', 'node-runtime', 'v' + nodeVersion);
  const kept = async file => {
    const local = path.join(cache, file);
    if (!fs.existsSync(local)) {
      const url = `https://nodejs.org/dist/v${nodeVersion}/${file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
      fs.mkdirSync(cache, { recursive: true });
      fs.writeFileSync(local + '.download', Buffer.from(await response.arrayBuffer()));
      fs.renameSync(local + '.download', local);
    }
    return fs.readFileSync(local);
  };
  const sums = (await kept('SHASUMS256.txt')).toString('utf8');
  const expected = sums.split('\n').map(line => line.trim().split(/\s+/)).find(([, file]) => file === archive)?.[0];
  if (!expected) {
    // Not the release's sums (a proxy's page, say): removed, so the next run downloads them again.
    fs.rmSync(path.join(cache, 'SHASUMS256.txt'), { force: true });
    throw new Error(`SHASUMS256.txt of Node.js ${nodeVersion} does not list ${archive}; it was removed, so the next run downloads it again`);
  }
  const bytes = await kept(archive);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    fs.rmSync(path.join(cache, archive), { force: true });
    throw new Error(`${archive} does not match its SHA-256 in SHASUMS256.txt (${actual}); it was removed, so the next run downloads it again`);
  }
  const executable = system === 'win' ? 'node.exe' : 'bin/node';
  let files;
  if (system === 'win') {
    const { unzipSync } = require(require.resolve('fflate', { paths: [path.join(repository, 'packages', 'diagrams')] }));
    const wanted = new Set([name + '/' + executable, name + '/LICENSE']);
    const entries = unzipSync(bytes, { filter: file => wanted.has(file.name) });
    files = { executable: Buffer.from(entries[name + '/' + executable] ?? []), license: Buffer.from(entries[name + '/LICENSE'] ?? []) };
  } else {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coord-node-'));
    try {
      fs.writeFileSync(path.join(temporary, archive), bytes);
      execFileSync('tar', ['-xzf', archive, name + '/' + executable, name + '/LICENSE'], { cwd: temporary });
      files = { executable: fs.readFileSync(path.join(temporary, name, executable)), license: fs.readFileSync(path.join(temporary, name, 'LICENSE')) };
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
  if (!files.executable?.length || !files.license?.length) throw new Error(`${archive} has no ${executable} or LICENSE`);
  return { name: path.basename(executable), version: nodeVersion, ...files };
};

/** Files of the @envsemble/coord package the command reads: no tests and no test helpers. */
const commandFiles = relative => /^(?:bin|src|templates)(?:\/|$)/.test(relative) && !/\.test\.ts$|(?:^|\/)testing\.ts$/.test(relative)
  || relative === 'package.json';
/** The diagram package's development pages and tooling are not needed (as in electron-builder.yml's files). */
const diagramFiles = relative => !/^(?:development|downloads|scripts|examples|tests)(?:\/|$)|^(?:index\.html|vite\.config\.mjs|tsconfig\.contracts\.json)$/.test(relative);

/**
 * A dependency's files without what nothing loads: TypeScript (its sources and type declarations,
 * which Node does not run from node_modules), Markdown, and its tools' dot-files (the TypeScript
 * capture keeps the compiler's own: its lib/*.d.ts are what it type-checks with). Every file costs
 * the installer and the copy into the home time; licences stay.
 */
const dependencyFiles = relative => /(?:^|\/)(?:licen[cs]e|copying|notice)[^/]*$/i.test(relative)
  || !/\.[cm]?tsx?$|\.md$|(?:^|\/)\.|(?:^|\/)(?:readme|changelog|history)(?:\.\w+)?$/i.test(relative);

/** Peers of the diagram package that only its standalone viewer loads. */
const viewerOnly = new Set(['@envsemble/envui']);

/**
 * The installed packages the command can load, by walking the lockfile from @envsemble/coord: each
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
  const root = 'packages/coord';
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
    // Peers a package needs are installed beside it: the MCP SDK's zod, and the diagram package's
    // React, which draws each diagram's SVG (lib/render/renderSVG.cjs). Optional ones are not, nor
    // envUI, which only the diagram package's standalone viewer bundles (buildViewer's bundleClient,
    // which the command never calls).
    const peers = Object.keys(target.peerDependencies ?? {}).filter(name => !target.peerDependenciesMeta?.[name]?.optional && !viewerOnly.has(name));
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

/**
 * Copy the files of `from` that `filter` accepts (never a nested node_modules or source maps), sorted,
 * adding each to the hash. Modes are kept: esbuild's binary must stay executable on Linux.
 */
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
      fs.chmodSync(path.join(to, name), fs.statSync(path.join(from, name)).mode & 0o777);
      hash.update(path.relative(hash.base, path.join(to, name)).split(path.sep).join('/') + '\0').update(content);
      files++; bytes += content.length;
    }
  }
  return { files, bytes };
}

/**
 * Write resources/agent into `destination` from the repository, with `runtime` (nodeRuntime's) as
 * command/runtime/; returns its build and size.
 */
exports.assemble = function assemble(repository, destination, version, runtime) {
  fs.rmSync(destination, { recursive: true, force: true });
  const hash = Object.assign(crypto.createHash('sha256'), { base: destination });
  let files = 0, bytes = 0;
  const add = (from, to, filter = () => true) => { const done = copy(path.join(repository, from), path.join(destination, to), filter, hash); files += done.files; bytes += done.bytes; };
  add('packages/coord', 'command', commandFiles);
  for (const [to, { real, filter }] of dependencies(repository)) add(real, path.join('command', to), filter);
  for (const [name, content, mode] of [[runtime.name, runtime.executable, 0o755], ['LICENSE', runtime.license, 0o644]]) {
    const file = path.join(destination, 'command', 'runtime', name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { mode });
    fs.chmodSync(file, mode);
    hash.update(path.relative(destination, file).split(path.sep).join('/') + '\0').update(content);
    files++; bytes += content.length;
  }
  add('plugin', 'plugin', relative => !/^tests(?:\/|$)/.test(relative));
  // envUI's documentation, with its license, for the agents that write pages (the page guide, references/pages.md, points to it).
  add('node_modules/@envsemble/envui/docs', 'plugin/skills/coord/references/envui');
  add('node_modules/@envsemble/envui', 'plugin/skills/coord/references/envui', relative => relative === 'LICENSE');
  add('.claude-plugin', '.claude-plugin', relative => relative === 'marketplace.json');
  add('.agents', '.agents', relative => relative === 'plugins' || relative === 'plugins/marketplace.json');
  const build = version + '-' + hash.digest('hex').slice(0, 12);
  fs.writeFileSync(path.join(destination, 'build.json'), JSON.stringify({ version, build }, null, 2) + '\n');
  return { build, files, bytes };
};

/**
 * Pack an assembled payload's command into one file, command.pack, in place of its command/ folder:
 * the Windows installer spends its time per file, and the command's thousands of small files made
 * every update minutes slower. The plugin and the marketplace manifests stay folders, which the app
 * reads in place. The app unpacks the command into the agent folder (main/agent/agentPack.ts, which
 * describes the format).
 */
exports.packCommand = function packCommand(directory) {
  const command = path.join(directory, 'command');
  const files = [];
  const walk = relative => {
    for (const entry of fs.readdirSync(path.join(command, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push(name);
    }
  };
  walk('');
  const index = files.map(name => { const stat = fs.statSync(path.join(command, name)); return { path: name, size: stat.size, mode: stat.mode & 0o777 }; });
  const header = Buffer.from(JSON.stringify(index));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  const target = path.join(directory, 'command.pack');
  const out = fs.openSync(target + '.tmp', 'w');
  try {
    fs.writeSync(out, length);
    fs.writeSync(out, header);
    for (const name of files) fs.writeSync(out, fs.readFileSync(path.join(command, name)));
  } finally { fs.closeSync(out); }
  fs.renameSync(target + '.tmp', target);
  fs.rmSync(command, { recursive: true, force: true });
  return { files: files.length };
};
