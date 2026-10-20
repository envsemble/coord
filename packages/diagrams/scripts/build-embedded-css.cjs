const fs = require("node:fs"),
  path = require("node:path");
const postcss = require("postcss"),
  selectors = require("postcss-selector-parser");
// Atlas-owned roots: the panel, and Atlas content that envUI portals (popovers
// and dialogs) render outside it. Embedded rules only match inside them.
const SCOPES = ["atlas-panel", "atlas-portal"];
function embeddedCSS(css) {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/i.test(rule.parent.name))
      return;
    rule.selector = selectors((tree) =>
      tree.each((selector) => {
        const first = selector.first;
        if (first?.type === "class" && SCOPES.includes(first.value)) return;
        let rooted = false;
        selector.walk((node) => {
          if (
            (node.type === "pseudo" && node.value === ":root") ||
            (node.type === "tag" && ["html", "body"].includes(node.value))
          ) {
            node.replaceWith(selectors.className({ value: "atlas-panel" }));
            rooted = true;
          }
        });
        if (!rooted) {
          selector.prepend(selectors.combinator({ value: " " }));
          selector.prepend(selectors.className({ value: "atlas-panel" }));
        }
      }),
    ).processSync(rule.selector);
  });
  return root.toString().replace(/[ \t]+$/gm, "");
}
// Only the viewer's own styles: hosts load envUI's stylesheet themselves.
function buildEmbeddedCSS(root) {
  const css =
    ["src/viewer/viewer.css", "src/canvas/canvas.css"]
      .map((file) =>
        embeddedCSS(fs.readFileSync(path.join(root, file), "utf8")),
      )
      .join("\n") +
    "\n" +
    fs.readFileSync(path.join(root, "src/viewer/embedded.css"), "utf8");
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/embedded.css"), css);
}
module.exports = { embeddedCSS, buildEmbeddedCSS, SCOPES };
