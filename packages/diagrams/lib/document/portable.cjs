const { parse } = require("parse5");
const {
  createDocument,
  reviseDocument,
  assertDocument,
  clone,
} = require("./document.cjs");
const MAX_INPUT = 64 * 1024 * 1024;
const MAX_DATA = 32 * 1024 * 1024;
function parseData(text) {
  if (Buffer.byteLength(text) > MAX_DATA)
    throw new Error("IMPORT_LIMIT: model data exceeds 32 MiB");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("IMPORT_JSON: malformed model data");
  }
}
function importDocument(input) {
  if (input instanceof Uint8Array) input = Buffer.from(input);
  if (typeof input !== "string" && !Buffer.isBuffer(input))
    throw new Error("IMPORT_INPUT: expected HTML or JSON text");
  if (Buffer.byteLength(input) > MAX_INPUT)
    throw new Error("IMPORT_LIMIT: input exceeds 64 MiB");
  const text = input.toString("utf8");
  let document;
  if (text.trimStart().startsWith("{")) document = parseData(text);
  else {
    const tree = parse(text, {
      onParseError: (error) => {
        if (error.code === "duplicate-attribute")
          throw new Error("IMPORT_FORMAT: duplicate HTML attribute");
      },
    });
    const tags = [],
      pending = [tree];
    while (pending.length) {
      const node = pending.pop();
      if (
        node.tagName === "script" &&
        node.attrs.some((a) => a.name === "id" && a.value === "atlas-document")
      )
        tags.push(node);
      pending.push(...(node.childNodes || []));
    }
    if (tags.length > 1)
      throw new Error("IMPORT_FORMAT: repeated Atlas document payload");
    if (tags.length) {
      if (
        !tags[0].attrs.some(
          (a) => a.name === "type" && a.value === "application/json",
        )
      )
        throw new Error("IMPORT_FORMAT: model payload must be inert JSON");
      document = parseData(
        tags[0].childNodes.map((n) => n.value || "").join(""),
      );
    } else throw new Error("IMPORT_FORMAT: no Atlas document payload");
  }
  if (Buffer.byteLength(JSON.stringify(document)) > MAX_DATA)
    throw new Error("IMPORT_LIMIT: recovered document exceeds 32 MiB");
  assertDocument(document);
  const imported = clone(document);
  imported.imported = true;
  const revised = reviseDocument(imported, {
    reason: "Imported document; preserved source claims are not reverified",
  });
  if (Buffer.byteLength(JSON.stringify(revised)) > MAX_DATA)
    throw new Error("IMPORT_LIMIT: imported document exceeds 32 MiB");
  return revised;
}
module.exports = { importDocument, MAX_INPUT, MAX_DATA };
