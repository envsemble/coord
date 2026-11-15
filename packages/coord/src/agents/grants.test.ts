import test from 'node:test';
import assert from 'node:assert/strict';
import { grantClaudeDirectory, grantCodexRoot } from './grants.ts';

const home = process.platform === 'win32' ? 'C:\\Users\\me\\.coord' : '/home/me/.coord';
const literal = "'" + home + "'";

test('the home is added to Claude Code\'s additional directories, keeping the rest of the settings', () => {
  assert.equal(grantClaudeDirectory(null, home), JSON.stringify({ permissions: { additionalDirectories: [home] } }, null, 2) + '\n');
  const settings = '{\r\n    "model": "opus",\r\n    "permissions": {\r\n        "allow": ["Bash(git status)"],\r\n        "additionalDirectories": ["/elsewhere"]\r\n    },\r\n    "hooks": {}\r\n}\r\n';
  const granted = grantClaudeDirectory(settings, home)!;
  assert.deepEqual(JSON.parse(granted), { model: 'opus', permissions: { allow: ['Bash(git status)'], additionalDirectories: ['/elsewhere', home] }, hooks: {} });
  assert.equal(granted, settings.replace('["/elsewhere"]', `["/elsewhere", ${JSON.stringify(home)}]`), 'only the list changes');
  assert.equal(grantClaudeDirectory(granted, home), null, 'granted once');
  // A missing key or object is added in the style of its neighbours; everything else stays as written.
  const bare = '{\n  "model": "opus",\n  "env": { "A": "1" }\n}\n';
  assert.equal(grantClaudeDirectory(bare, home), `{\n  "model": "opus",\n  "env": { "A": "1" },\n  "permissions": {\n    "additionalDirectories": [\n      ${JSON.stringify(home)}\n    ]\n  }\n}\n`);
  const noList = '{\n\t"permissions": {\n\t\t"allow": ["Read", "Edit"]\n\t}\n}';
  assert.equal(grantClaudeDirectory(noList, home), `{\n\t"permissions": {\n\t\t"allow": ["Read", "Edit"],\n\t\t"additionalDirectories": [\n\t\t\t${JSON.stringify(home)}\n\t\t]\n\t}\n}`);
  const listed = '{"permissions": {"additionalDirectories": [\n  "/a",\n  "/b"\n]}, "x": [1,2]}';
  assert.equal(grantClaudeDirectory(listed, home), `{"permissions": {"additionalDirectories": [\n  "/a",\n  "/b",\n  ${JSON.stringify(home)}\n]}, "x": [1,2]}`);
  assert.equal(grantClaudeDirectory('{"permissions": {}}', home), `{"permissions": {"additionalDirectories": [ ${JSON.stringify(home)} ]}}`);
  assert.equal(grantClaudeDirectory('{}', home), JSON.stringify({ permissions: { additionalDirectories: [home] } }, null, 2) + '\n');
  assert.throws(() => grantClaudeDirectory('{"permissions": null}', home), /not an object/);
  assert.throws(() => grantClaudeDirectory('{"permissions": []}', home), /not an object/);
  assert.throws(() => grantClaudeDirectory('{ broken', home));
});

test('the home is added to Codex\'s writable roots with a text edit that keeps everything else', () => {
  assert.equal(grantCodexRoot(null, home), `[sandbox_workspace_write]\nwritable_roots = [${literal}]\n`);
  const config = '# My settings\nmodel = "gpt-5.5"\nsandbox_mode = "workspace-write"\n\n[projects."C:\\\\work"]\ntrust_level = "trusted"\n';
  assert.equal(grantCodexRoot(config, home), config + `\n[sandbox_workspace_write]\nwritable_roots = [${literal}]\n`);
  const table = '[sandbox_workspace_write]\nnetwork_access = true # yes\n\n[other]\nx = 1\n';
  assert.equal(grantCodexRoot(table, home), `[sandbox_workspace_write]\nwritable_roots = [${literal}]\nnetwork_access = true # yes\n\n[other]\nx = 1\n`);
  const inline = '[sandbox_workspace_write]\nwritable_roots = ["/tmp/a", \'/tmp/b\'] # roots\n[other]\nwritable_roots = []\n';
  assert.equal(grantCodexRoot(inline, home), inline.replace("'/tmp/b']", `'/tmp/b', ${literal}]`));
  const multiline = '[sandbox_workspace_write]\nwritable_roots = [\n  "/tmp/a",\n  "/tmp/b" # last\n]\n';
  assert.equal(grantCodexRoot(multiline, home), `[sandbox_workspace_write]\nwritable_roots = [\n  "/tmp/a",\n  "/tmp/b", # last\n  ${literal},\n]\n`);
  const crlf = '[sandbox_workspace_write]\r\nwritable_roots = []\r\n';
  assert.equal(grantCodexRoot(crlf, home), `[sandbox_workspace_write]\r\nwritable_roots = [${literal}]\r\n`);
  const dotted = 'sandbox_workspace_write.writable_roots = ["/tmp/a"]\n';
  assert.equal(grantCodexRoot(dotted, home), `sandbox_workspace_write.writable_roots = ["/tmp/a", ${literal}]\n`);
  // A table defined by dotted keys cannot get a header too: the list is added as one more dotted key.
  const dottedOther = 'model = "gpt-5.5"\nsandbox_workspace_write.network_access = true\n\n[other]\nx = 1\n';
  assert.equal(grantCodexRoot(dottedOther, home), `model = "gpt-5.5"\nsandbox_workspace_write.writable_roots = [${literal}]\nsandbox_workspace_write.network_access = true\n\n[other]\nx = 1\n`);
  const dottedBoth = 'sandbox_workspace_write.network_access = true\nsandbox_workspace_write.writable_roots = [\n  "/tmp/a",\n]\n';
  assert.equal(grantCodexRoot(dottedBoth, home), `sandbox_workspace_write.network_access = true\nsandbox_workspace_write.writable_roots = [\n  "/tmp/a",\n  ${literal},\n]\n`);
  const escaped = `[sandbox_workspace_write]\nwritable_roots = [${JSON.stringify(home)}]\n`;
  assert.equal(grantCodexRoot(escaped, home), null, 'already granted, however it is quoted');
  assert.equal(grantCodexRoot(grantCodexRoot(config, home), home), null);
  assert.throws(() => grantCodexRoot('sandbox_workspace_write = { writable_roots = [] }\n', home), /inline table/);
  assert.throws(() => grantCodexRoot('[sandbox_workspace_write]\nwritable_roots = "x"\n', home), /not a list/);
});

test('quoted keys are the keys they name, and nothing inside a string or comment is edited', () => {
  // A quoted dotted key defines the table as much as a bare one does.
  const quoted = '"sandbox_workspace_write".network_access = true\n';
  assert.equal(grantCodexRoot(quoted, home), `sandbox_workspace_write.writable_roots = [${literal}]\n` + quoted);
  const quotedHeader = "[ 'sandbox_workspace_write' ] # sandbox\n\"writable_roots\" = ['/tmp/a']\n";
  assert.equal(grantCodexRoot(quotedHeader, home), quotedHeader.replace("'/tmp/a']", `'/tmp/a', ${literal}]`));
  assert.equal(grantCodexRoot('[sandbox_workspace_write] # sandbox\nnetwork_access = true\n', home), `[sandbox_workspace_write] # sandbox\nwritable_roots = [${literal}]\nnetwork_access = true\n`);
  // A multi-line string or a list spanning lines is not a key or a table, whatever its lines look like.
  const strings = 'notes = """\nsandbox_workspace_write.network_access = true\n[sandbox_workspace_write]\n"""\nraw = \'\'\'\nsandbox_workspace_write = {}\'\'\'\nnested = [\n  [1, 2], # sandbox_workspace_write.x = 1\n  "]",\n]\n';
  assert.equal(grantCodexRoot(strings, home), strings + `\n[sandbox_workspace_write]\nwritable_roots = [${literal}]\n`);
  const later = '[sandbox_workspace_write]\nlists = [\n  [1],\n]\nwritable_roots = []\n';
  assert.equal(grantCodexRoot(later, home), later.replace('writable_roots = []', `writable_roots = [${literal}]`));
  // TOML's own escapes, literal tabs in strings and a byte order mark are ordinary TOML.
  const escapes = '\uFEFFpath = "C:\\\\x\\U0001F600\\e"\nnotify = ["a\tb"]\n';
  assert.equal(grantCodexRoot(escapes, home), escapes + `\n[sandbox_workspace_write]\nwritable_roots = [${literal}]\n`);
  // The byte order mark stays first when the key goes before the first line.
  assert.equal(grantCodexRoot('﻿sandbox_workspace_write.network_access = true\n', home), `﻿sandbox_workspace_write.writable_roots = [${literal}]\nsandbox_workspace_write.network_access = true\n`);
  // Unsure: the file stays as it is, and the message says what to add by hand.
  const refused = (config: string, reason: RegExp) => assert.throws(() => grantCodexRoot(config, home), (error: Error) => reason.test(error.message) && error.message.endsWith(`add ${literal} to [sandbox_workspace_write] writable_roots by hand`));
  refused('"sandbox_workspace_write" = { network_access = true }\n', /inline table/);
  refused('[[sandbox_workspace_write]]\n', /list of tables/);
  refused('[sandbox_workspace_write]\nwritable_roots.x = 1\n', /not a list/);
  refused('notes = """\nnever closed\n', /multi-line string does not end/);
  refused('[sandbox_workspace_write\n', /table header/);
  refused('key = "a" "b"\n', /more than one/);
  refused('key = "x\\\ny"\n', /control character/);
  refused('this is not toml\n', /neither a table header nor a key|key could not be read/);
});
