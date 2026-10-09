const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".puml": "text/plain; charset=utf-8",
  ".zip": "application/zip",
};

function createPreviewServer(root = path.resolve(__dirname, "..")) {
  return http.createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const file = ["/", "/index.html"].includes(pathname)
        ? "index.html"
        : /^\/downloads\/[\w.-]+$/.test(pathname)
          ? pathname.slice(1)
          : null;
      if (!file || !contentTypes[path.extname(file)]) {
        response.writeHead(404).end();
        return;
      }
      const content = await fs.readFile(path.join(root, file));
      response.writeHead(200, {
        "Content-Type": contentTypes[path.extname(file)],
        "Content-Length": content.length,
        "Cache-Control": "no-cache",
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 400).end();
    }
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be between 1 and 65535");
  const server = createPreviewServer();
  server.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Offline build: http://127.0.0.1:${port}/`);
  });
}

module.exports = { createPreviewServer };
