import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
const manifest = JSON.parse(readFileSync(new URL('../vendor/atlas-package.json', import.meta.url)));
assert.match(manifest.commit, /^[a-f0-9]{40}$/);
assert.match(manifest.file, /^ontouml-atlas-[a-f0-9]{12}\.tgz$/);
assert.equal(createHash('sha256').update(readFileSync(new URL('../vendor/' + manifest.file, import.meta.url))).digest('hex'), manifest.sha256);
assert.equal(JSON.parse(readFileSync(new URL('../node_modules/ontouml-atlas/package.json', import.meta.url))).version, manifest.version);
console.log(`Atlas ${manifest.version} / ${manifest.commit.slice(0, 7)} package verified.`);
