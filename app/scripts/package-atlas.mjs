import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Use npm run atlas:package -- /path/to/atlas-checkout.');
const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', windowsHide: true }).trim();
if (git('status', '--porcelain')) throw new Error('Commit the Atlas source and generated distribution before packaging.');
const stage = mkdtempSync(path.join(os.tmpdir(), 'atlas-vendor-'));
try {
  const report = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath, 'pack', '--json', '--pack-destination', stage], { cwd: source, encoding: 'utf8', windowsHide: true }));
  const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
  if (git('status', '--porcelain')) throw new Error('Packaging changed the distribution. Commit it and rerun.');
  const content = readFileSync(path.join(stage, packed.filename));
  const commit = git('rev-parse', 'HEAD');
  const filename = `ontouml-atlas-${commit.slice(0, 12)}.tgz`;
  mkdirSync(path.join(root, 'vendor'), { recursive: true });
  const manifestFile = path.join(root, 'vendor/atlas-package.json');
  let previous;
  try { previous = JSON.parse(readFileSync(manifestFile)).file; } catch { /* First package. */ }
  copyFileSync(path.join(stage, packed.filename), path.join(root, 'vendor', filename));
  writeFileSync(manifestFile, JSON.stringify({ name: packed.name, version: packed.version, file: filename, source: git('remote', 'get-url', 'origin'), commit, sha256: createHash('sha256').update(content).digest('hex') }, null, 2) + '\n');
  const packageFile = path.join(root, 'package.json');
  const dashboard = JSON.parse(readFileSync(packageFile));
  dashboard.dependencies['ontouml-atlas'] = 'file:vendor/' + filename;
  writeFileSync(packageFile, JSON.stringify(dashboard, null, 2) + '\n');
  if (previous && previous !== filename && /^ontouml-atlas-[a-f0-9]{12}\.tgz$/.test(previous)) rmSync(path.join(root, 'vendor', previous));
  rmSync(path.join(root, 'vendor/ontouml-atlas.tgz'), { force: true });
} finally { rmSync(stage, { recursive: true, force: true }); }
