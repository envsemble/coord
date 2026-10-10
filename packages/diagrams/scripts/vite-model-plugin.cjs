const path = require("node:path");
const virtualId = "virtual:atlas/model";
const resolvedId = `\0${virtualId}`;

function createPayloadCache(build) {
  let revision = 0,
    pending = null;
  return {
    invalidate() {
      revision++;
      pending = null;
    },
    async get() {
      while (true) {
        const current = revision;
        if (!pending) pending = Promise.resolve().then(build);
        const active = pending;
        try {
          const payload = await active;
          if (current === revision) return payload;
        } catch (error) {
          if (current === revision) {
            pending = null;
            throw error;
          }
        }
      }
    },
  };
}
function modelPlugin({ root, buildPayload } = {}) {
  root ||= path.resolve(__dirname, "..");
  const modelDirectories = ["examples/r5", "lib", "schemas"].map((dir) =>
    path.join(root, dir),
  );
  const renderingDirectory = path.join(root, "src/visualization");
  const inside = (file, directory) => {
    const relative = path.relative(directory, file);
    return (
      relative === "" ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== ".." &&
        !path.isAbsolute(relative))
    );
  };
  const buildsModel = (file) =>
    [...modelDirectories, renderingDirectory].some((dir) => inside(file, dir));
  const cache = createPayloadCache(
    buildPayload ||
      (async () => {
        // Reload only project-owned CommonJS modules. Registry dependencies remain
        // cached, while generators, evidence, schemas and SVG components stay fresh.
        for (const file of Object.keys(require.cache))
          if (modelDirectories.some((dir) => inside(file, dir)))
            delete require.cache[file];
        const { createProject } = require(
          path.join(root, "examples/r5/create-project.cjs"),
        );
        const { createEvidence, createViews } = require(
          path.join(root, "examples/r5/metadata.cjs"),
        );
        const snippets = require(
          path.join(root, "examples/r5/source-snippets.json"),
        );
        const { prepareViewer } = require(path.join(root, "lib/index.cjs"));
        const project = createProject();
        return (
          await prepareViewer({
            project,
            evidence: createEvidence(project),
            views: createViews(project),
            snippets,
            slug: "r5",
          })
        ).payload;
      }),
  );
  let server,
    timer,
    closed = false;
  async function refresh() {
    try {
      const payload = await cache.get();
      if (closed) return;
      const module = server.moduleGraph.getModuleById(resolvedId);
      if (module) server.moduleGraph.invalidateModule(module);
      // Let Vite clear a previous model error overlay on a successful rebuild.
      server.ws.send({ type: "update", updates: [] });
      server.ws.send({
        type: "custom",
        event: "ontouml:model-update",
        data: payload,
      });
    } catch (error) {
      if (closed) return;
      server.config.logger.error(`Model update failed: ${error.message}`);
      server.ws.send({
        type: "error",
        err: {
          message: error.message,
          stack: error.stack || "",
          plugin: "atlas-model",
        },
      });
    }
  }
  function schedule(file) {
    if (!buildsModel(file) || closed) return;
    cache.invalidate();
    clearTimeout(timer);
    timer = setTimeout(refresh, 80);
  }
  return {
    name: "atlas-model",
    apply: "serve",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    async load(id) {
      if (id !== resolvedId) return;
      return `export default ${JSON.stringify(await cache.get()).replaceAll("<", "\\u003c")};`;
    },
    configureServer(devServer) {
      server = devServer;
      closed = false;
      server.watcher.add([...modelDirectories, renderingDirectory]);
      server.watcher.on("add", schedule);
      server.watcher.on("unlink", schedule);
    },
    handleHotUpdate({ file, modules }) {
      if (!buildsModel(file)) return;
      schedule(file);
      return inside(file, renderingDirectory) ? modules : [];
    },
    closeServer() {
      closed = true;
      clearTimeout(timer);
      server?.watcher.off("add", schedule);
      server?.watcher.off("unlink", schedule);
    },
  };
}
module.exports = { modelPlugin, createPayloadCache };
