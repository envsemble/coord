// What changed between two models: each element compared by its identity,
// leaving out layout and source locations.
const { clone, fingerprint } = require("../fingerprint.cjs");
const PRESENTATION = new Set([
  "x",
  "y",
  "width",
  "height",
  "position",
  "points",
  "bounds",
  "layout",
  "diagrams",
  "diagram",
  "location",
]);
function semantic(value, depth = 0) {
  if (depth > 100)
    throw new Error("COMPARISON_LIMIT: model nesting exceeds 100");
  if (Array.isArray(value)) {
    const array = value
      .filter(
        (v) =>
          !v ||
          ![
            "Diagram",
            "ClassView",
            "RelationView",
            "GeneralizationView",
          ].includes(v.type),
      )
      .map((v) => semantic(v, depth + 1));
    return array.length && array.every((v) => v && typeof v.id === "string")
      ? array.sort((a, b) => a.id.localeCompare(b.id, "en"))
      : array;
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => !PRESENTATION.has(k))
        .map((k) => [
          k,
          k === "generalizations" &&
          (value.type === "GeneralizationSet" || "complete" in value) &&
          Array.isArray(value[k]) &&
          value[k].every((v) => typeof v === "string")
            ? [...value[k]].sort()
            : semantic(value[k], depth + 1),
        ]),
    );
  return value;
}
function records(model) {
  const output = new Map();
  function visit(value, owner = null, depth = 0) {
    if (depth > 100)
      throw new Error("COMPARISON_LIMIT: model nesting exceeds 100");
    if (Array.isArray(value))
      return value.map((v) => visit(v, owner, depth + 1));
    if (!value || typeof value !== "object") return value;
    if (typeof value.id === "string") {
      const id = value.id;
      const data = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, visit(v, id, depth + 1)]),
      );
      output.set(JSON.stringify(["element", id]), { id, owner, data });
      return { $element: id };
    }
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, visit(v, owner, depth + 1)]),
    );
  }
  const root = visit(semantic(model));
  output.set(JSON.stringify(["root"]), { id: null, owner: null, data: root });
  if (output.size > 20000)
    throw new Error("COMPARISON_LIMIT: at most 20000 semantic records");
  return output;
}
const same = (a, b) => fingerprint(a) === fingerprint(b);
const cell = (value, present = true) =>
  present ? { present: true, value: clone(value) } : { present: false };
function compareModels(base, proposed) {
  const before = records(base),
    after = records(proposed),
    changes = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(key),
      b = after.get(key),
      id = b?.id ?? a?.id;
    if (a && b && same(a, b)) continue;
    const properties =
      a && b
        ? [...new Set([...Object.keys(a.data), ...Object.keys(b.data)])]
            .sort()
            .filter(
              (key) =>
                !same(
                  cell(a.data[key], key in a.data),
                  cell(b.data[key], key in b.data),
                ),
            )
            .map((key) => ({
              key,
              before: cell(a.data[key], key in a.data),
              after: cell(b.data[key], key in b.data),
            }))
        : [];
    changes.push({
      id: `change:${fingerprint(key).slice(0, 24)}`,
      elementId: id,
      ownerId: b?.owner || a?.owner || null,
      kind: !a ? "added" : !b ? "removed" : "modified",
      name: b?.data.name || a?.data.name || id || "Model contents",
      properties,
      ...(a ? { before: a.data } : {}),
      ...(b ? { after: b.data } : {}),
    });
  }
  return {
    changes,
    counts: Object.fromEntries(
      ["added", "removed", "modified"].map((k) => [
        k,
        changes.filter((c) => c.kind === k).length,
      ]),
    ),
    limitations: [
      "Stable identities only; no inference of cross-layer meaning. Layout and source locations are excluded.",
    ],
  };
}
module.exports = { semantic, compareModels };
