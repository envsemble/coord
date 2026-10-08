const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const {
  AtlasWorkspace,
  toolDefinitions,
  boundedError,
} = require("./service.cjs");
function createMcpServer(root) {
  const workspace = new AtlasWorkspace(root);
  // Shared JSON schemas keep MCP, CLI and the library on the same contract.
  const server = new Server(
    { name: "atlas", version: require("../../package.json").version },
    {
      capabilities: { tools: {} },
      instructions:
        "Atlas visualizes semantic documents. Inspect focused elements; batch revisions against the returned revision. Captures are frozen. Imported source claims are not reverified. Prepare returns local payload references; export returns offline HTML. Domain interpretation remains with the agent.",
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await workspace.execute(
        request.params.name,
        request.params.arguments || {},
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify(boundedError(error, workspace)),
          },
        ],
      };
    }
  });
  return server;
}
async function serveMcp(root) {
  const server = createMcpServer(root);
  await server.connect(
    new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: 34 * 1024 * 1024,
    }),
  );
  return server;
}
module.exports = { createMcpServer, serveMcp };
