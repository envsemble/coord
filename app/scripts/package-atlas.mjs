import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function packCommittedAtlas(source, npm = process.env.npm_execpath) {
  if (!source || !npm) throw new Error('Use npm run atlas:package -- /path/to/atlas-checkout.');
  const env = { ...process.env, GIT_NO_LAZY_FETCH: '1' };
  const git = (...args) => execFileSync('git', ['--no-replace-objects', '-C', source, ...args], { encoding: 'utf8', windowsHide: true, env }).trim();
  if (git('status', '--porcelain')) throw new Error('Commit the Atlas source and generated distribution before packaging.');
  const commit = git('rev-parse', 'HEAD');
  if (git('ls-tree', '-rz', commit).split('\0').filter(Boolean).some(entry => !/^100(?:644|755) blob /.test(entry))) throw new Error('Atlas source must contain regular committed files.');
  const archive = execFileSync('git', ['--no-replace-objects', '-C', source, 'archive', '--format=zip', commit], { windowsHide: true, env, maxBuffer: 128 * 1024 * 1024 });
  let bytes = 0, count = 0;
  const files = unzipSync(archive, { filter(entry) {
    bytes += entry.originalSize; count++;
    if (bytes > 128 * 1024 * 1024 || count > 5000 || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').includes('..')) throw new Error('Atlas committed source exceeds archive bounds.');
    return !entry.name.endsWith('/');
  } });
  const stage = mkdtempSync(path.join(os.tmpdir(), 'atlas-vendor-'));
  try {
    const sealed = path.join(stage, 'source');
    for (const [name, data] of Object.entries(files)) {
      const destination = path.join(sealed, name); mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, data);
    }
    const report = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', stage], { cwd: sealed, env: { ...env, NODE_PATH: path.join(path.resolve(source), 'node_modules') }, encoding: 'utf8', windowsHide: true }));
    const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
    if (Object.entries(files).some(([name, data]) => name.startsWith('dist/') && !Buffer.from(data).equals(readFileSync(path.join(sealed, name))))) throw new Error('Packaging changed committed distribution. Rebuild, commit and rerun.');
    const content = readFileSync(path.join(stage, packed.filename));
    return { packed, content, commit, source: git('remote', 'get-url', 'origin') };
  } finally {
    if (!path.resolve(stage).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe vendor cleanup path');
    rmSync(stage, { recursive: true, force: true });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { packed, content, commit, source } = packCommittedAtlas(process.argv[2]);
  const filename = `ontouml-atlas-${commit.slice(0, 12)}.tgz`;
  mkdirSync(path.join(root, 'vendor'), { recursive: true });
  const manifestFile = path.join(root, 'vendor/atlas-package.json');
  let previous;
  try { previous = JSON.parse(readFileSync(manifestFile)).file; } catch { /* First package. */ }
  writeFileSync(path.join(root, 'vendor', filename), content);
  writeFileSync(manifestFile, JSON.stringify({ name: packed.name, version: packed.version, file: filename, source, commit, sha256: createHash('sha256').update(content).digest('hex') }, null, 2) + '\n');
  const packageFile = path.join(root, 'package.json');
  const dashboard = JSON.parse(readFileSync(packageFile));
  dashboard.dependencies['ontouml-atlas'] = 'file:vendor/' + filename;
  writeFileSync(packageFile, JSON.stringify(dashboard, null, 2) + '\n');
  if (previous && previous !== filename && /^ontouml-atlas-[a-f0-9]{12}\.tgz$/.test(previous)) rmSync(path.join(root, 'vendor', previous));
  rmSync(path.join(root, 'vendor/ontouml-atlas.tgz'), { force: true });
}
