// Captures as diagram files: what an adapter read from code or a database,
// written in Atlas's PlantUML subset with its capture header. Source names
// become PlantUML names that stay the same from one capture to the next, so a
// later capture, and a proposal copied from a capture, compare with it element
// by element. Text PlantUML would read as formatting is broken up, and every
// capture is checked before it is returned.
const {
  formatDiagram,
  formattingIn,
  modelProblems,
  parseDiagram,
} = require("../plantuml/diagram.cjs");

const MARKERS = ["**", "//", '""', "__", "~~", "[["];
// Text as written, on one line, with any formatting marker, stereotype and
// member modifier broken by a space. A name has no double quotes, and does
// not end in a backslash, which would join its line with the next.
function plain(text, member = false) {
  let value = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/<<(?=[^<>]*>>)/g, "< < ")
    .replace(/\{(static|abstract|classifier|field|method)\}/gi, "{ $1 }");
  if (!member) value = value.replace(/"/g, "'").replace(/\s*\\+$/, "");
  for (let i = 0; i < 4 && formattingIn(value, member); i++) {
    for (const marker of MARKERS)
      value = value.replaceAll(marker, `${marker[0]} ${marker[1]}`);
    value = value.replace(/<([&$a-z/])/gi, "< $1");
  }
  return value;
}
// A PlantUML name for a source name: letters of the Basic Multilingual Plane,
// digits and underscores. Outside members, PlantUML underlines between two
// `__`, so an element name has single underscores.
function plantName(text, member = false) {
  let name = String(text).replace(
    /[^A-Za-z0-9_\u00C0-\uD7FF\uE000-\uFFEF]+/g,
    "_",
  );
  if (!member) name = name.replace(/_{2,}/g, "_");
  if (!/^[A-Za-z_\u00C0-\uD7FF\uE000-\uFFEF]/.test(name)) name = `_${name}`;
  return name;
}
// A type as an attribute's line reads it: brackets at its end would be read
// as a multiplicity and a backslash as joining the next line, so such a type
// is wrapped.
function typeText(text) {
  const type = plain(text, true) || "unknown";
  return /\[[^\[\]]+\]\s*$|>>\s*$|\\$/.test(type) ? `(${type})` : type;
}
// Parameters between balanced parentheses.
function parameterText(text) {
  const value = plain(text, true);
  let depth = 0;
  for (const c of value) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (depth < 0) break;
  }
  return depth ? value.replace(/\(/g, "[").replace(/\)/g, "]") : value;
}
/**
 * Names for `items`, unique among them and stable across captures: the first
 * choice each one has to itself, else a later, longer one, else the last
 * numbered in the order given.
 */
function uniqueNames(items, choices) {
  const names = new Map(),
    taken = new Set();
  let pending = items;
  for (const choose of choices) {
    const groups = new Map();
    for (const item of pending) {
      const name = plantName(choose(item));
      groups.set(name, [...(groups.get(name) || []), item]);
    }
    pending = [];
    for (const [name, group] of groups)
      if (group.length === 1 && !taken.has(name)) {
        names.set(group[0], name);
        taken.add(name);
      } else pending.push(...group);
  }
  for (const item of pending) {
    const base = plantName(choices[0](item));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    names.set(item, name);
    taken.add(name);
  }
  return names;
}
// Members' names, unique within their element. A literal that starts and
// ends with `__` would be read as a separator, so it starts with one `_`.
function memberNames(members, literals = false) {
  const taken = new Set();
  return members.map((m) => {
    let base = plantName(m.name, true);
    if (literals && /^__/.test(base) && /__$/.test(base)) base = base.slice(1);
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    taken.add(name);
    return name;
  });
}
const VISIBILITY = { public: "+", private: "-", protected: "#" };
const visibilityOf = (modifiers = [], fallback = null) =>
  VISIBILITY[modifiers.find((m) => VISIBILITY[m])] || fallback;
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function finish(diagram, capture) {
  diagram.elements.sort(
    (a, b) => byText(a.package || "", b.package || "") || byText(a.id, b.id),
  );
  diagram.relations.sort(
    (a, b) =>
      byText(a.source, b.source) ||
      byText(a.target, b.target) ||
      byText(a.kind, b.kind) ||
      byText(a.label || "", b.label || ""),
  );
  const text = formatDiagram({ ...diagram, capture });
  const { diagram: read, problems } = parseDiagram(text);
  problems.push(...(read ? modelProblems(read) : []));
  if (problems.length)
    throw new Error(
      `CAPTURE_FORMAT: the capture could not be written as a diagram (line ${problems[0].line}: ${problems[0].message})`,
    );
  return text;
}
const header = (title) => ({
  kind: "class",
  title: plain(title),
  capture: null,
  fingerprint: null,
  proposal: null,
  compares: null,
  scenario: null,
});

/**
 * A class diagram of declarations. Each node has `id` (its identity in the
 * adapter), `name` (qualified within its package), `package`, `kind` (class,
 * interface, enum, record, type alias, annotation type), `abstract`,
 * `attributes` ({name, type, modifiers, optional, evidence}), `methods`
 * ({name, parameters, returns, modifiers, evidence}), `literals` (enum
 * constants), `evidence` and `snippet`. Generalizations name `specificId` and
 * `generalId` with `realization`; dependencies `sourceId` and `targetId`.
 */
function codeDiagram({
  title,
  capture,
  nodes,
  generalizations,
  dependencies,
  memberVisibility = () => null,
}) {
  const ids = uniqueNames(nodes, [
    (n) => n.name.split(".").at(-1),
    (n) => n.name,
    (n) => `${n.package || ""}.${n.name}`,
  ]);
  const kindOf = (n) =>
    n.kind === "interface" || n.kind === "annotation type"
      ? "interface"
      : n.kind === "enum"
        ? "enum"
        : n.abstract
          ? "abstract class"
          : "class";
  const elements = nodes.map((n) => {
    const id = ids.get(n);
    const kind = kindOf(n);
    const attributes = kind === "enum" ? [] : n.attributes;
    const attributeNames = memberNames(attributes);
    const operations = new Map();
    if (kind !== "enum")
      for (const m of n.methods) {
        const operation = {
          name: plantName(m.name, true),
          parameters: parameterText(m.parameters),
          returns: m.returns ? typeText(m.returns) : null,
          visibility: visibilityOf(m.modifiers, memberVisibility(n)),
          ...(m.evidence ? { evidence: m.evidence } : {}),
        };
        const key = `${operation.name}(${operation.parameters.replace(/\s+/g, "")})`;
        if (!operations.has(key)) operations.set(key, operation);
      }
    return {
      id,
      name: n.name === id ? id : plain(n.name.replace(/_{2,}/g, "_")),
      kind,
      package: n.package ? plain(n.package.replace(/_{2,}/g, "_")) : null,
      attributes: attributes.map((a, i) => ({
        name: attributeNames[i],
        // An optional attribute says so by its multiplicity.
        type: typeText(
          a.optional ? a.type.replace(/ \| undefined$/, "") : a.type,
        ),
        multiplicity: a.optional ? "0..1" : null,
        visibility: visibilityOf(a.modifiers, memberVisibility(n)),
        ...(a.evidence ? { evidence: a.evidence } : {}),
      })),
      operations: [...operations.values()],
      literals: memberNames(kind === "enum" ? n.literals || [] : [], true).map(
        (name, i) => ({
          name,
          ...(n.literals[i].evidence
            ? { evidence: n.literals[i].evidence }
            : {}),
        }),
      ),
      slots: [],
      ...(n.evidence ? { evidence: n.evidence } : {}),
      ...(n.snippet ? { snippet: n.snippet } : {}),
    };
  });
  const elementOf = new Map(nodes.map((n, i) => [n.id, elements[i]]));
  const relations = [],
    seen = new Set();
  const relate = (kind, source, target, label = null) => {
    const key = JSON.stringify([kind, source.id, target.id, label]);
    if (seen.has(key)) return;
    seen.add(key);
    relations.push({
      kind,
      source: source.id,
      target: target.id,
      sourceMultiplicity: null,
      targetMultiplicity: null,
      label,
    });
  };
  for (const g of generalizations) {
    const [source, target] = [g.specificId, g.generalId].map((k) =>
      elementOf.get(k),
    );
    if (!source || !target || source === target) continue;
    const interfaces = [source, target].map((e) => e.kind === "interface");
    const enums = source.kind === "enum" || target.kind === "enum";
    // UML has no class implementing a class or an interface extending one,
    // which TypeScript allows: such a heritage is drawn as a labelled use.
    if (!enums && interfaces[1] && !interfaces[0])
      relate("implementation", source, target);
    else if (!enums && interfaces[0] === interfaces[1] && !g.realization)
      relate("inheritance", source, target);
    else
      relate(
        "dependency",
        source,
        target,
        g.realization ? "implements" : "extends",
      );
  }
  for (const d of dependencies) {
    const [source, target] = [d.sourceId, d.targetId].map((k) =>
      elementOf.get(k),
    );
    if (source && target && source !== target)
      relate("dependency", source, target);
  }
  return finish({ ...header(title), elements, relations }, capture);
}

/**
 * An entity diagram of tables. Each table has `id`, `name`, `package` (its
 * schema, or null), `columns` ({name, type, notNull, primaryKey}),
 * `evidence` and `snippet`. A foreign key runs from the referencing table
 * (`sourceId`, with its `columns`) to the referenced one (`targetId`);
 * `targetMultiplicity` counts the referenced rows per referencing row and
 * `sourceMultiplicity` the referencing rows per referenced row. A count Atlas
 * could not establish (`?`) is drawn as the loosest a crow's foot allows.
 */
function entityDiagram({ title, capture, tables, foreignKeys }) {
  const ids = uniqueNames(tables, [
    (t) => t.name,
    (t) => `${t.package || ""}.${t.name}`,
  ]);
  const columnNames = new Map();
  for (const t of tables) {
    const names = memberNames(t.columns);
    columnNames.set(t.id, new Map(t.columns.map((c, i) => [c.name, names[i]])));
  }
  // A column is a foreign key when a drawn relation names it.
  const keyed = new Set();
  const relations = [];
  for (const fk of foreignKeys) {
    const source = tables.find((t) => t.id === fk.sourceId);
    const target = tables.find((t) => t.id === fk.targetId);
    if (!source || !target) continue;
    const columns = fk.columns.map((c) => columnNames.get(source.id).get(c));
    // A key that is part of the primary key keeps <<PK>>, and its relation
    // then names no <<FK>> columns.
    const primary = new Set(
      source.columns.filter((c) => c.primaryKey).map((c) => c.name),
    );
    if (!fk.columns.some((c) => primary.has(c)))
      for (const c of fk.columns) keyed.add(`${source.id}\u0000${c}`);
    relations.push({
      kind: "relationship",
      source: ids.get(target),
      target: ids.get(source),
      sourceMultiplicity: ["0..1", "1"].includes(fk.targetMultiplicity)
        ? fk.targetMultiplicity
        : "0..1",
      targetMultiplicity: ["0..1", "1", "0..*", "1..*"].includes(
        fk.sourceMultiplicity,
      )
        ? fk.sourceMultiplicity
        : "0..*",
      // The columns' PlantUML names exactly, which a label shows as written.
      label: columns.filter(Boolean).join(", ") || null,
    });
  }
  const elements = tables.map((t) => {
    const names = columnNames.get(t.id);
    return {
      id: ids.get(t),
      name:
        t.name === ids.get(t)
          ? ids.get(t)
          : plain(t.name.replace(/_{2,}/g, "_")),
      kind: "entity",
      package: t.package ? plain(t.package.replace(/_{2,}/g, "_")) : null,
      attributes: t.columns.map((c) => ({
        name: names.get(c.name),
        type: typeText(c.type),
        multiplicity: null,
        visibility: null,
        mandatory: !!(c.notNull || c.primaryKey),
        key: c.primaryKey
          ? "PK"
          : keyed.has(`${t.id}\u0000${c.name}`)
            ? "FK"
            : null,
      })),
      operations: [],
      literals: [],
      slots: [],
      ...(t.evidence ? { evidence: t.evidence } : {}),
      ...(t.snippet ? { snippet: t.snippet } : {}),
    };
  });
  return finish(
    { ...header(title), kind: "entity", elements, relations },
    capture,
  );
}

module.exports = { codeDiagram, entityDiagram, plain };
