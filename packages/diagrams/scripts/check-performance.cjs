const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const atlas = require("../lib/index.cjs");
async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-performance-"));
  try {
    const model = {
        type: "StructuralModel",
        nodes: Array.from({ length: 100 }, (_, i) => ({
          id: `n-${i}`,
          name: `Node ${i}`,
          attributes: [],
        })),
        relations: Array.from({ length: 99 }, (_, i) => ({
          id: `r-${i}`,
          name: "links",
          sourceId: `n-${i}`,
          targetId: `n-${i + 1}`,
          sourceMultiplicity: "0..*",
          targetMultiplicity: "1",
        })),
        generalizations: [],
        generalizationSets: [],
      },
      document = atlas.createDocument({ profile: "code", model }),
      workspace = atlas.createWorkspace(root),
      saved = await workspace.execute("atlas_create", { input: document });
    await workspace.execute("atlas_inspect", { handle: saved.handle });
    const started = performance.now();
    const inspection = await workspace.execute("atlas_inspect", {
      handle: saved.handle,
    });
    await workspace.execute("atlas_validate", { handle: saved.handle });
    const agentMs = performance.now() - started;
    assert(
      agentMs < 1000,
      `100-node warm inspection/validation took ${agentMs.toFixed(1)} ms`,
    );
    assert(Buffer.byteLength(JSON.stringify(inspection)) <= 16 * 1024);
    await atlas.buildViewer({
      document: atlas.createDocument({
        profile: "code",
        model: { ...model, nodes: model.nodes.slice(0, 1), relations: [] },
      }),
    });
    const layoutStarted = performance.now();
    await atlas.buildViewer({ document });
    const exportMs = performance.now() - layoutStarted;
    assert(
      exportMs < 5000,
      `100-node linked layout/export took ${exportMs.toFixed(1)} ms`,
    );
    console.log(
      JSON.stringify({
        fixture: "100 nodes / 99 links",
        node: process.version,
        agentMs,
        exportMs,
        budgets: { agentMs: 1000, exportMs: 5000 },
      }),
    );
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
      throw new Error("Unsafe performance cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
