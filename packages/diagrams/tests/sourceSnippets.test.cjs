const assert = require("node:assert/strict");
const { test } = require("node:test");
const { buildSync } = require("esbuild");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { highlightSnippets } = require("../lib/payload/highlightSnippets.cjs");
// A pinned TypeScript declaration and a table's SQL, as captures cite them.
const COMMIT = "c49e0d2123bc3ddb53419005ddd7c6ef73925faf";
const sources = [
  {
    id: "source:Checkout",
    repo: "example/shop",
    commit: COMMIT,
    file: "src/checkout.ts",
    title: "Checkout declaration",
    claim: "",
    line: 10,
    url: `https://github.com/example/shop/blob/${COMMIT}/src/checkout.ts#L10`,
  },
  {
    id: "source:orders",
    repo: "example/shop",
    commit: COMMIT,
    file: "main.orders",
    title: "orders catalog",
    claim: "",
    url: `https://github.com/example/shop/blob/${COMMIT}/schema.sql#L1`,
  },
];
const excerpts = {
  "source:Checkout": {
    repo: "example/shop",
    commit: COMMIT,
    file: "src/checkout.ts",
    startLine: 10,
    language: "typescript",
    code: [
      "export class Checkout {",
      "  lines: Line[] = [];",
      "  pay(card: string): Promise<string> {",
      "    return this.gateway.charge(card);",
      "  }",
      "}",
    ].join("\n"),
  },
  "source:orders": {
    repo: "example/shop",
    commit: COMMIT,
    file: "main.orders",
    startLine: 1,
    language: "sql",
    code: [
      "CREATE TABLE orders (id INTEGER PRIMARY KEY, total NUMERIC(10,2));",
      "CREATE INDEX orders_total ON orders(total);",
    ].join("\n"),
  },
};

test("Shiki previews preserve pinned source text, exact line ranges, and both GitHub themes", async () => {
  const highlighted = await highlightSnippets(sources, excerpts);
  assert.equal(Object.keys(highlighted).length, sources.length);
  for (const source of sources) {
    const snippet = highlighted[source.id];
    assert.equal(
      snippet.lines
        .map((line) => line.map((t) => t.content).join(""))
        .join("\n"),
      excerpts[source.id].code,
    );
    assert.equal(snippet.endLine - snippet.startLine + 1, snippet.lines.length);
    assert(snippet.lines.length <= 12);
    for (const token of snippet.lines.flat()) {
      assert.match(token.style["--shiki-dark"], /^#[0-9a-f]+$/i);
      assert.match(token.style["--shiki-light"], /^#[0-9a-f]+$/i);
    }
    assert.match(snippet.url, new RegExp(`${source.commit}/`));
  }
  await assert.rejects(
    highlightSnippets([sources[0]], {
      "source:Checkout": { ...excerpts["source:Checkout"], commit: "outdated" },
    }),
    /Stale or missing/,
  );
});

test("code snippets render token text safely instead of executing source markup", () => {
  const code = buildSync({
    entryPoints: ["src/ui/CodeSnippet.jsx"],
    bundle: true,
    platform: "node",
    format: "cjs",
    packages: "external",
    jsx: "automatic",
    write: false,
  }).outputFiles[0].text;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", code)(
    require,
    compiled,
    compiled.exports,
  );
  const html = renderToStaticMarkup(
    createElement(compiled.exports.CodeSnippet, {
      label: "Example",
      snippet: {
        startLine: 42,
        lines: [
          [
            {
              content: '<script>alert("source")</script>',
              style: { "--shiki-dark": "#ff7b72", "--shiki-light": "#cf222e" },
            },
          ],
        ],
      },
    }),
  );
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
  assert(html.includes('data-line="42"'));
  assert(html.includes("--shiki-dark:#ff7b72"));
});
