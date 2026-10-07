const { Unzip, UnzipInflate } = require("fflate");
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
function documentFromInput(input) {
  const name = input.project.name;
  return createDocument({
    id: `atlas-${input.project.id}`,
    title:
      input.evidence?.title ||
      (typeof name === "string"
        ? name
        : name?.en || Object.values(name || {})[0] || "OntoUML"),
    project: input.project,
    evidence: input.evidence,
    views: input.views,
    snippets: input.snippets,
    createdAt: input.project.created || "2000-01-01T00:00:00.000Z",
  });
}
// Read only a JSON object assigned to the legacy export constant, never JS.
function legacyExports(html) {
  const start = /\bconst\s+EXPORTS\s*=\s*(?=\{)/g.exec(html);
  if (!start) throw new Error("IMPORT_FORMAT: no Atlas document payload");
  const offset = start.index + start[0].length;
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = offset; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0)
      return parseData(html.slice(offset, i + 1));
  }
  throw new Error("IMPORT_JSON: truncated legacy export data");
}
function recoverLegacy(html) {
  const { slug, bundle } = legacyExports(html);
  if (
    !/^[\w-]+$/.test(slug) ||
    typeof bundle !== "string" ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(bundle)
  )
    throw new Error("IMPORT_LEGACY: invalid archive metadata");
  const names = new Set([
    `${slug}-atlas-document.json`,
    `${slug}-ontouml.json`,
    `${slug}-evidence.json`,
    `${slug}-views.json`,
  ]);
  const files = new Map();
  let total = 0;
  const archive = new Unzip((file) => {
    if (!names.has(file.name)) return;
    if (files.has(file.name))
      throw new Error("IMPORT_LEGACY: duplicate archive entry");
    const chunks = [];
    files.set(file.name, null);
    file.ondata = (error, data, final) => {
      if (error) throw error;
      total += data.length;
      if (total > MAX_DATA)
        throw new Error("IMPORT_LIMIT: decoded archive exceeds 32 MiB");
      chunks.push(Buffer.from(data));
      if (final) files.set(file.name, Buffer.concat(chunks).toString("utf8"));
    };
    file.start();
  });
  archive.register(UnzipInflate);
  const bytes = Buffer.from(bundle, "base64");
  try {
    for (let i = 0; i < bytes.length; i += 16384)
      archive.push(bytes.subarray(i, i + 16384), i + 16384 >= bytes.length);
  } catch (error) {
    throw new Error(`IMPORT_LEGACY: ${error.message}`);
  }
  const read = (name, required = true) => {
    const data = files.get(`${slug}-${name}.json`);
    if (!data && required)
      throw new Error(`IMPORT_LEGACY: missing ${name} data`);
    return data ? parseData(data) : undefined;
  };
  if (files.has(`${slug}-atlas-document.json`)) return read("atlas-document");
  // Old exports retained model, evidence and views; raw excerpts were omitted.
  // Recover the exact code from the static highlighted snippet data separately.
  const snippetMatch = /\bconst\s+SNIPPETS\s*=\s*(\{[^\r\n]*\});?\s*$/m.exec(
    html,
  );
  const highlighted = snippetMatch
    ? parseData(snippetMatch[1].replace(/;$/, ""))
    : {};
  const evidence = read("evidence");
  const snippets = Object.fromEntries(
    Object.entries(highlighted).map(([id, s]) => [
      id,
      {
        ...Object.fromEntries(
          ["repo", "commit", "file"].map((key) => [
            key,
            evidence.sources?.find((source) => source.id === id)?.[key],
          ]),
        ),
        code: s.code,
        language: s.language,
        startLine: s.startLine,
      },
    ]),
  );
  return documentFromInput({
    project: read("ontouml"),
    evidence,
    views: read("views"),
    snippets,
  });
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
    } else document = recoverLegacy(text);
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
module.exports = { importDocument, documentFromInput, MAX_INPUT, MAX_DATA };
