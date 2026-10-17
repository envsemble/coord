import test from 'node:test';
import assert from 'node:assert/strict';
import { appendRegistryEntries, RegistryFormatError, setRegistryMember, updateRegistryEntry } from './registryText.ts';

const BOM = String.fromCharCode(0xfeff);
const entry = { id: 'work-0005', path: 'active/0005-example', repositories: ['shop', 'planning'], current_plan: 'active/0005-example/plan.md' };

test('appends a work item in the style of the existing entries, preserving other bytes', () => {
  const source = '{\n  "schema_version": 1,\n  "repositories": [\n    {\n      "id": "shop",\n      "name": "Shop"\n    }\n  ],\n  "work_items": [\n    {\n      "id": "work-0001",\n      "path": "active/0001-a",\n      "repositories": ["shop"],\n      "current_plan": "active/0001-a/plan.md"\n    }\n  ]\n}\n';
  const result = appendRegistryEntries(source, 'work_items', [entry]);
  assert.equal(result, source.replace('"current_plan": "active/0001-a/plan.md"\n    }', '"current_plan": "active/0001-a/plan.md"\n    },\n    {\n      "id": "work-0005",\n      "path": "active/0005-example",\n      "repositories": ["shop", "planning"],\n      "current_plan": "active/0005-example/plan.md"\n    }'));
});

test('keeps CRLF line endings, tabs, compact separators and a byte order mark', () => {
  const source = BOM + '{\r\n\t"schema_version":1,\r\n\t"repositories":[],\r\n\t"work_items":[\r\n\t\t{"id":"work-0001","path":"active/0001-a","repositories":[],"current_plan":null},\r\n\t\t{"id":"work-0002","path":"active/0002-b","repositories":[],"current_plan":null}\r\n\t]\r\n}';
  const result = appendRegistryEntries(source, 'work_items', [{ ...entry, repositories: ['shop'] }]);
  assert.ok(result.startsWith(BOM));
  assert.ok(result.endsWith('\r\n\t]\r\n}'));
  assert.ok(result.includes('"current_plan":null},\r\n\t\t{"id":"work-0005","path":"active/0005-example","repositories":["shop"],"current_plan":"active/0005-example/plan.md"}\r\n\t]'));
  assert.ok(!/[^\r]\n/.test(result));
});

test('fills an empty array and compact single-line files', () => {
  const empty = '{\n    "schema_version": 1,\n    "repositories": [],\n    "work_items": []\n}\n';
  const filled = appendRegistryEntries(empty, 'work_items', [entry]);
  assert.deepEqual(JSON.parse(filled).work_items, [entry]);
  assert.ok(filled.includes('    "work_items": [\n        {\n            "id": "work-0005",'));
  assert.ok(filled.endsWith('\n    ]\n}\n'));
  const compact = JSON.stringify({ schema_version: 1, repositories: [{ id: 'a', name: 'A' }], work_items: [] });
  assert.deepEqual(JSON.parse(appendRegistryEntries(compact, 'repositories', [{ id: 'b', name: 'B' }])).repositories, [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
});

test('rejects registries it cannot extend faithfully', () => {
  assert.throws(() => appendRegistryEntries('[]', 'work_items', [entry]), RegistryFormatError);
  assert.throws(() => appendRegistryEntries('{"work_items": {}}', 'work_items', [entry]), RegistryFormatError);
  assert.throws(() => appendRegistryEntries('{"work_items": [}', 'work_items', [entry]), RegistryFormatError);
});

test('updates members of one entry in place, leaving every other byte', () => {
  const source = '{\n  "schema_version": 1,\n  "repositories": [{ "id": "shop", "name": "Shop", "path": "../shop" }],\n  "work_items": [\n    {\n      "id": "work-0001",\n      "path": "active/0001-a",\n      "repositories": ["shop"],\n      "current_plan": "active/0001-a/plan.md"\n    },\n    {"id": "work-0002", "path": "active/0002-b", "repositories": [], "current_plan": null}\n  ]\n}\n';
  const moved = updateRegistryEntry(source, 'work_items', 'work-0001', { path: 'archive/0001-a', current_plan: 'archive/0001-a/plan.md' });
  assert.equal(moved, source.replace('"path": "active/0001-a"', '"path": "archive/0001-a"').replace('"current_plan": "active/0001-a/plan.md"', '"current_plan": "archive/0001-a/plan.md"'));
  assert.equal(updateRegistryEntry(source, 'work_items', 'work-0002', { current_plan: 'active/0002-b/plan.md' }), source.replace('"current_plan": null}', '"current_plan": "active/0002-b/plan.md"}'));
  assert.equal(updateRegistryEntry(source, 'repositories', 'shop', { path: 'C:\\work\\shop' }), source.replace('"../shop"', JSON.stringify('C:\\work\\shop')));
  assert.throws(() => updateRegistryEntry(source, 'work_items', 'work-0009', { path: 'x' }), RegistryFormatError);
  assert.throws(() => updateRegistryEntry(source, 'work_items', 'work-0002', { title: 'x' }), RegistryFormatError);
});

test('a registry is named in place, keeping every other byte', async () => {
  const { setRegistryName } = await import('./registryText.ts');
  const source = '{\n  "schema_version": 1,\n  "repositories": [],\n  "work_items": []\n}\n';
  const named = setRegistryName(source, 'Coord');
  assert.equal(named, '{\n  "schema_version": 1,\n  "name": "Coord",\n  "repositories": [],\n  "work_items": []\n}\n');
  assert.equal(setRegistryName(named, 'Coord "web"'), named.replace('"Coord"', '"Coord \\"web\\""'));
  assert.equal(setRegistryName('{"schema_version": 1}', 'One'), '{"schema_version": 1, "name": "One"}');
});

test('a registry member is set where it is, or added after the first of its neighbours the registry has', () => {
  const compact = '{"schema_version": 1, "name": "Shop", "repositories": [], "work_items": []}';
  assert.equal(setRegistryMember(compact, 'workspaces', ['/work'], ['name']), '{"schema_version": 1, "name": "Shop", "workspaces": ["/work"], "repositories": [], "work_items": []}');
  const pretty = '﻿{\r\n\t"schema_version": 1,\r\n\t"workspaces": [\r\n\t\t"/a"\r\n\t],\r\n\t"work_items": []\r\n}\r\n';
  assert.equal(setRegistryMember(pretty, 'workspaces', ['/a', '/b'], ['name']), '﻿{\r\n\t"schema_version": 1,\r\n\t"workspaces": [\r\n\t\t"/a",\r\n\t\t"/b"\r\n\t],\r\n\t"work_items": []\r\n}\r\n');
  assert.equal(setRegistryMember('{\n  "work_items": []\n}\n', 'workspaces', [], ['name', 'schema_version']), '{\n  "workspaces": [],\n  "work_items": []\n}\n', 'first when it has none of them');
});
