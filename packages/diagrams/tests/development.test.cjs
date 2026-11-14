const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createPayloadCache } = require("../scripts/vite-model-plugin.cjs");
const { createPreviewServer } = require("../scripts/preview.cjs");

test("live payload reads coalesce and ignore builds overtaken by newer edits", async () => {
  const jobs = [];
  const cache = createPayloadCache(
    () => new Promise((resolve) => jobs.push(resolve)),
  );
  const first = cache.get();
  const concurrent = cache.get();
  await Promise.resolve();
  assert.equal(jobs.length, 1);
  cache.invalidate();
  const latest = cache.get();
  await Promise.resolve();
  assert.equal(jobs.length, 2);
  jobs[1]({ version: "new" });
  assert.deepEqual(await latest, { version: "new" });
  jobs[0]({ version: "old" });
  assert.deepEqual(await first, { version: "new" });
  assert.deepEqual(await concurrent, { version: "new" });
});

test("a failed live model build can recover on the next read", async () => {
  let invalid = true;
  const cache = createPayloadCache(() => {
    if (invalid) throw new Error("Broken reference");
    return { valid: true };
  });
  await assert.rejects(cache.get(), /Broken reference/);
  invalid = false;
  assert.deepEqual(await cache.get(), { valid: true });
});

test("static HTTP preview serves offline HTML and downloads without exposing source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "coord-preview-"));
  const server = createPreviewServer(root);
  try {
    await fs.mkdir(path.join(root, "downloads"));
    await fs.writeFile(
      path.join(root, "index.html"),
      "<!doctype html><p>Offline</p>",
    );
    await fs.writeFile(
      path.join(root, "downloads/model.json"),
      '{"type":"Project"}',
    );
    await fs.writeFile(path.join(root, "package.json"), "private source");
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    assert.match(await page.text(), /Offline/);
    const download = await fetch(`${url}/downloads/model.json`);
    assert.deepEqual(await download.json(), { type: "Project" });
    const head = await fetch(url, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal((await fetch(`${url}/package.json`)).status, 404);
    assert.equal(
      (await fetch(`${url}/downloads/%2e%2e%2fpackage.json`)).status,
      404,
    );
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Unsafe temporary cleanup path");
    await fs.rm(root, { recursive: true, force: true });
  }
});
