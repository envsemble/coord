// Code captures refuse what they cannot capture before running a compiler:
// oversized sources and dependencies, and wrong configurations. The captures
// themselves are in code-capture.slow.test.cjs (TypeScript) and
// code-capture-java.slow.test.cjs (Java).
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { captureTypeScript, captureFromConfig } = require("../lib/index.cjs");
const { fixture, tsProject } = require("./code-fixtures.cjs");

test("Code capture rejects oversized sources before publication", async (t) => {
  const root = fixture(t);
  const project = tsProject(root, " ".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(
    captureTypeScript({ identity: "limit", projects: [project] }),
    /CAPTURE_LIMIT/,
  );
  fs.writeFileSync(
    path.join(root, "source.json"),
    JSON.stringify({
      formatVersion: 1,
      adapter: "typescript",
      identity: "bad",
      projects: [{ identity: "fixture", path: "." }],
    }),
  );
  await assert.rejects(
    captureFromConfig(path.join(root, "source.json")),
    /CAPTURE_LIMIT/,
  );
});

test("TypeScript compiler rejects oversized dependencies before reading them", async (t) => {
  const root = fixture(t),
    project = tsProject(
      root,
      "import type { Huge } from './dependency'; export class Item { value!: Huge; }\n",
    );
  const file = path.join(root, "dependency.d.ts");
  fs.writeFileSync(file, " ".repeat(32 * 1024 * 1024 + 1));
  const original = fs.readFileSync;
  let readOversized = false;
  fs.readFileSync = function (candidate, ...args) {
    if (path.resolve(String(candidate)) === file) readOversized = true;
    return original.call(this, candidate, ...args);
  };
  try {
    await assert.rejects(
      captureTypeScript({ identity: "bounded", projects: [project] }),
      /CAPTURE_LIMIT/,
    );
    assert(!readOversized);
  } finally {
    fs.readFileSync = original;
  }
});

test("a wrong source configuration is refused with its reason", async (t) => {
  const file = path.join(fixture(t), "capture.json");
  const write = (config) =>
    fs.writeFileSync(file, JSON.stringify({ formatVersion: 1, ...config }));
  write({ adapter: "typescript", identity: "shop", projects: [], extra: 1 });
  await assert.rejects(
    captureFromConfig(file),
    /CAPTURE_CONFIG: .*code-source/,
  );
  write({ adapter: "cobol", identity: "shop" });
  await assert.rejects(
    captureFromConfig(file),
    /CAPTURE_CONFIG: name the adapter/,
  );
  fs.writeFileSync(file, "{");
  await assert.rejects(captureFromConfig(file), /CAPTURE_CONFIG/);
});
