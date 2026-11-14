import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRegistryEntries, RegistryFormatError, setRegistryMember, updateRegistryEntry } from './registryText.ts';

const BOM = String.fromCharCode(0xfeff);
const entry = { id: 'work-0005', path: 'active/0005-example', current_plan: 'active/0005-example/plan.md' };

test('appends a work item in the style of the existing entries, preserving other bytes', () => {
  const source = '{\n  "schema_version": 2,\n  "name": "Shop",\n  "folders": [\n    "/work/shop"\n  ],\n  "work_items": [\n    {\n      "id": "work-0001",\n      "path": "active/0001-a",\n      "current_plan": "active/0001-a/plan.md"\n    }\n  ]\n}\n';
  const result = appendRegistryEntries(source, 'work_items', [entry]);
  assert.equal(result, source.replace('"current_plan": "active/0001-a/plan.md"\n    }', '"current_plan": "active/0001-a/plan.md"\n    },\n    {\n      "id": "work-0005",\n      "path": "active/0005-example",\n      "current_plan": "active/0005-example/plan.md"\n    }'));
});

test('keeps CRLF line endings, tabs, compact separators and a byte order mark', () => {
  const source = BOM + '{\r\n\t"schema_version":2,\r\n\t"name":"Shop",\r\n\t"folders":[],\r\n\t"work_items":[\r\n\t\t{"id":"work-0001","path":"active/0001-a","current_plan":"active/0001-a/plan.md"},\r\n\t\t{"id":"work-0002","path":"active/0002-b","current_plan":"active/0002-b/plan.md"}\r\n\t]\r\n}';
  const result = appendRegistryEntries(source, 'work_items', [entry]);
  assert.ok(result.startsWith(BOM));
  assert.ok(result.endsWith('\r\n\t]\r\n}'));
  assert.ok(result.includes('"current_plan":"active/0002-b/plan.md"},\r\n\t\t{"id":"work-0005","path":"active/0005-example","current_plan":"active/0005-example/plan.md"}\r\n\t]'));
  assert.ok(!/[^\r]\n/.test(result));
});

test('fills an empty array and compact single-line files', () => {
  const empty = '{\n    "schema_version": 2,\n    "name": "Shop",\n    "folders": [],\n    "work_items": []\n}\n';
  const filled = appendRegistryEntries(empty, 'work_items', [entry]);
  assert.deepEqual(JSON.parse(filled).work_items, [entry]);
  assert.ok(filled.includes('    "work_items": [\n        {\n            "id": "work-0005",'));
  assert.ok(filled.endsWith('\n    ]\n}\n'));
  const first = { id: 'work-0001', path: 'active/0001-a', current_plan: 'active/0001-a/plan.md' };
  const compact = JSON.stringify({ schema_version: 2, name: 'Shop', folders: [], work_items: [first] });
  assert.deepEqual(JSON.parse(appendRegistryEntries(compact, 'work_items', [entry])).work_items, [first, entry]);
});

test('rejects registries it cannot extend faithfully', () => {
  assert.throws(() => appendRegistryEntries('[]', 'work_items', [entry]), RegistryFormatError);
  assert.throws(() => appendRegistryEntries('{"work_items": {}}', 'work_items', [entry]), RegistryFormatError);
  assert.throws(() => appendRegistryEntries('{"work_items": [}', 'work_items', [entry]), RegistryFormatError);
});

test('updates members of one entry in place, leaving every other byte', () => {
  const source = '{\n  "schema_version": 2,\n  "name": "Shop",\n  "folders": [],\n  "work_items": [\n    {\n      "id": "work-0001",\n      "path": "active/0001-a",\n      "current_plan": "active/0001-a/plan.md"\n    },\n    {"id": "work-0002", "path": "active/0002-b", "current_plan": "active/0002-b/plan.md"}\n  ]\n}\n';
  const moved = updateRegistryEntry(source, 'work_items', 'work-0001', { path: 'archive/0001-a', current_plan: 'archive/0001-a/plan.md' });
  assert.equal(moved, source.replace('"path": "active/0001-a"', '"path": "archive/0001-a"').replace('"current_plan": "active/0001-a/plan.md"', '"current_plan": "archive/0001-a/plan.md"'));
  assert.equal(updateRegistryEntry(source, 'work_items', 'work-0002', { path: 'archive/0002-b', current_plan: 'archive/0002-b/plan.md' }), source.replace('"path": "active/0002-b", "current_plan": "active/0002-b/plan.md"}', '"path": "archive/0002-b", "current_plan": "archive/0002-b/plan.md"}'));
  assert.throws(() => updateRegistryEntry(source, 'work_items', 'work-0009', { path: 'x' }), RegistryFormatError);
  assert.throws(() => updateRegistryEntry(source, 'work_items', 'work-0002', { title: 'x' }), RegistryFormatError);
});

test('a registry is named in place, keeping every other byte', async () => {
  const { setRegistryName } = await import('./registryText.ts');
  const source = '{\n  "schema_version": 2,\n  "folders": [],\n  "work_items": []\n}\n';
  const named = setRegistryName(source, 'Harbor');
  assert.equal(named, '{\n  "schema_version": 2,\n  "name": "Harbor",\n  "folders": [],\n  "work_items": []\n}\n');
  assert.equal(setRegistryName(named, 'Harbor "web"'), named.replace('"Harbor"', '"Harbor \\"web\\""'));
  assert.equal(setRegistryName('{"schema_version": 2}', 'One'), '{"schema_version": 2, "name": "One"}');
});

test('a registry member is set where it is, or added after the first of its neighbours the registry has', () => {
  const compact = '{"schema_version": 2, "name": "Shop", "work_items": []}';
  assert.equal(setRegistryMember(compact, 'folders', ['/work'], ['name']), '{"schema_version": 2, "name": "Shop", "folders": ["/work"], "work_items": []}');
  const pretty = '﻿{\r\n\t"schema_version": 2,\r\n\t"folders": [\r\n\t\t"/a"\r\n\t],\r\n\t"work_items": []\r\n}\r\n';
  assert.equal(setRegistryMember(pretty, 'folders', ['/a', '/b'], ['name']), '﻿{\r\n\t"schema_version": 2,\r\n\t"folders": [\r\n\t\t"/a",\r\n\t\t"/b"\r\n\t],\r\n\t"work_items": []\r\n}\r\n');
  assert.equal(setRegistryMember('{\n  "work_items": []\n}\n', 'folders', [], ['name', 'schema_version']), '{\n  "folders": [],\n  "work_items": []\n}\n', 'first when it has none of them');
});
