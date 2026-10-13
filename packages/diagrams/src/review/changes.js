// What a proposal changes, rolled up per element for review: one entry per
// changed type (its members summarized), per changed relation, per other
// changed element, and for the model itself. Pure functions over the
// comparison payload and the change view's model and views, so the panel,
// the canvas and the tests share them.

export const CHANGE_LABELS = {
  added: "New",
  modified: "Changed",
  removed: "Removed",
};
export const CHANGE_STATUSES = ["added", "modified", "removed"];
const GLYPHS = { added: "+", modified: "~", removed: "−" };
export const changeGlyph = (status) => GLYPHS[status] || "";

const MAX_TOKENS = 4;
const MAX_VALUE = 160;
// A value longer than this reads as "changed" in the list; the element's
// details show it whole.
const MAX_INLINE = 40;

// Names that only repeat what a relation is: every captured type use has the
// first, and OntoUML gives the second to relations without a name.
const GENERIC_RELATION_NAMES = new Set(["declared type use", "association"]);

/** Whether a relation's name says more than its kind. */
export function informativeName(edge) {
  const name = typeof edge?.name === "string" ? edge.name.trim() : "";
  return name && !GENERIC_RELATION_NAMES.has(name.toLowerCase()) ? name : "";
}

const edgeEnds = (edge) =>
  "specificId" in edge
    ? [edge.specificId, edge.generalId]
    : [edge.sourceId, edge.targetId];

/**
 * Element id → display name: classes, their members (owner.member), and
 * relations, which read as their ends when their own name says nothing more.
 */
export function nameIndex(...models) {
  const names = new Map();
  // The first model's name wins: the proposal's, then the baseline's for
  // what the proposal removed.
  const put = (id, name) => {
    if (id && !names.has(id)) names.set(id, name);
  };
  const present = models.filter(Boolean);
  for (const model of present)
    for (const c of model.classes || []) {
      put(c.id, c.name);
      for (const m of [...(c.attributes || []), ...(c.methods || [])])
        put(m.id, `${c.name}.${m.name}`);
    }
  for (const model of present) {
    for (const e of model.relations || []) {
      const [source, target] = edgeEnds(e).map((id) => names.get(id));
      put(
        e.originalId || e.id,
        informativeName(e) || `${source ?? "?"} → ${target ?? "?"}`,
      );
    }
    for (const g of model.generalizations || []) {
      const [specific, general] = edgeEnds(g).map((id) => names.get(id));
      put(
        g.originalId || g.id,
        `${specific ?? "?"} ${g.realization ? "implements" : "inherits"} ${general ?? "?"}`,
      );
    }
    for (const p of model.partitions || []) if (p.name) put(p.id, p.name);
  }
  return names;
}

/** A text: a string, or the first text of a multilingual OntoUML value. */
const textOf = (value) =>
  typeof value === "string"
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? (Object.values(value).find((v) => typeof v === "string") ?? null)
      : null;

// A part of a table: a key, an index, a constraint or trigger (each named),
// or a foreign key (its columns and the table they refer to).
const isForeignKey = (item) =>
  Array.isArray(item?.columns) && typeof item.target === "string";
const isPart = (item) =>
  !!item &&
  typeof item === "object" &&
  !Array.isArray(item) &&
  typeof item.$element !== "string" &&
  (isForeignKey(item) || (typeof item.name === "string" && !!item.name));
const foreignKeyText = (key) =>
  `${key.columns.join(", ")} → ${key.target}(${(key.targetColumns || []).join(", ")})`;
/** What a part of a table is called in a summary: its name, or what a foreign key joins. */
function partName(item) {
  return isForeignKey(item) ? foreignKeyText(item) : item.name;
}
/**
 * A part of a table as its details show it, so a change to any of its fields
 * reads: its definition when it has one, else its columns and what it is.
 */
export function describePart(item) {
  if (isForeignKey(item))
    return [
      foreignKeyText(item),
      item.onDelete && `on delete ${String(item.onDelete).toLowerCase()}`,
      item.onUpdate && `on update ${String(item.onUpdate).toLowerCase()}`,
    ]
      .filter(Boolean)
      .join(", ");
  const statement =
    typeof item.definition === "string"
      ? item.definition
      : typeof item.sql === "string"
        ? item.sql
        : "";
  // A key or an index over plain columns reads as its columns; a partial or
  // expression index, a check and a trigger only as their statement.
  const plain =
    Array.isArray(item.columns) &&
    item.columns.length > 0 &&
    item.columns.every((c) => typeof c === "string") &&
    !item.partial &&
    !item.predicate &&
    !item.expressions &&
    !CHECKS.has(item.type);
  if (!plain && statement) return statement;
  const columns = Array.isArray(item.columns)
    ? `(${item.columns.filter(Boolean).join(", ")})`
    : "";
  const flags = ["unique", "partial"].filter((flag) => item[flag] === true);
  return [columns, ...flags].filter(Boolean).join(", ") || item.name;
}
// PostgreSQL's constraint types that only their statement describes: check,
// exclusion, foreign key and constraint trigger.
const CHECKS = new Set(["c", "x", "f", "t"]);
/** A part before and after a change, by what tells them apart. */
export function partChange(before, after) {
  const was = describePart(before),
    is = describePart(after);
  if (was !== is) return [was, is];
  // The difference is in a field the description leaves out, such as a
  // collation: list each such field.
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => [k, readable(before[k]), readable(after[k])]);
  return [
    `${was}; ${fields.map(([k, b]) => `${k} ${b}`).join("; ")}`,
    `${is}; ${fields.map(([k, , a]) => `${k} ${a}`).join("; ")}`,
  ];
}
// A part keeps its identity by its name; a foreign key by its columns.
// A part keeps its identity by its name; a foreign key by its columns and
// the table it refers to.
export const partKey = (item) =>
  isPart(item)
    ? isForeignKey(item)
      ? `key:${JSON.stringify([item.columns, item.target])}`
      : `name:${item.name}`
    : JSON.stringify(item);
/**
 * A list's change item by item: what it gains, what it loses, and each named
 * part that changed in place. Empty when the list was only reordered.
 */
export function itemChanges(note) {
  const before = note.before?.present ? note.before.value : [];
  const after = note.after?.present ? note.after.value : [];
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const was = new Map(before.map((item) => [partKey(item), item]));
  const now = new Map(after.map((item) => [partKey(item), item]));
  const out = [];
  for (const [key, item] of now)
    if (!was.has(key)) out.push({ status: "added", after: item });
    else if (JSON.stringify(was.get(key)) !== JSON.stringify(item))
      out.push({ status: "modified", before: was.get(key), after: item });
  for (const [key, item] of was)
    if (!now.has(key)) out.push({ status: "removed", before: item });
  return out;
}

/** A compared value as short readable text: elements, and their identities, show their names. */
export function readable(value, names = new Map()) {
  if (typeof value === "string") return names.get(value) ?? value;
  if (value === undefined || value === null) return "none";
  if (typeof value === "object" && typeof value.$element === "string")
    return names.get(value.$element) || value.$element;
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => readable(item, names)).join(", ")
      : "none";
  if (typeof value === "object") {
    // A part of a table (a key, an index, a trigger), with what it holds.
    if (isPart(value)) return describePart(value);
    // Multilingual OntoUML names and descriptions.
    const text = Object.values(value).find((v) => typeof v === "string");
    if (text !== undefined && Object.keys(value).length <= 3) return text;
  }
  const text = JSON.stringify(value, (key, v) =>
    v && typeof v === "object" && typeof v.$element === "string"
      ? names.get(v.$element) || v.$element
      : typeof v === "string"
        ? (names.get(v) ?? v)
        : v,
  );
  return text === undefined ? String(value) : text;
}
export const shorten = (text, limit = MAX_VALUE) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

// Lists that hold elements: each element's own change tells what changed.
// Structural models and OntoUML's project list nested elements; OntoUML's
// packages, classes and relations list their contents, attributes, literals
// and ends by identity.
const CONTAINER_KEYS = new Set(["contents", "properties", "literals"]);
// Member lists and package contents: an item that moves between two of them
// keeps its identity and may change nothing of its own, so only the lists
// tell where it went.
const MEMBER_LISTS = new Set([
  "attributes",
  "methods",
  "properties",
  "literals",
  "contents",
]);
const isElementList = (cell) =>
  !cell.present ||
  (Array.isArray(cell.value) &&
    cell.value.every(
      (v) => v && typeof v === "object" && typeof v.$element === "string",
    ));
const isIdentityList = (cell) =>
  !cell.present ||
  (Array.isArray(cell.value) && cell.value.every((v) => typeof v === "string"));
/** Property changes that say something the elements' own changes do not:
 * a list of member elements changes when those members do, or move. */
export const meaningfulProperties = (change) =>
  (change?.properties || []).filter(
    (p) =>
      !(isElementList(p.before) && isElementList(p.after)) &&
      !(
        CONTAINER_KEYS.has(p.key) &&
        isIdentityList(p.before) &&
        isIdentityList(p.after)
      ),
  );

// The identities a list holds: `{$element}` references or plain ids.
const listItems = (cell) =>
  cell?.present && Array.isArray(cell.value)
    ? cell.value
        .map((v) => (typeof v === "string" ? v : v?.$element))
        .filter((v) => typeof v === "string")
    : [];
function listDelta(p) {
  const before = listItems(p.before),
    after = listItems(p.after);
  return {
    joined: after.filter((id) => !before.includes(id)),
    left: before.filter((id) => !after.includes(id)),
  };
}
/** What a change's lists of members or contents gained and lost, by list. */
function listChanges(change) {
  const cell = (data, key) =>
    data && key in data ? { present: true, value: data[key] } : undefined;
  if (change.kind === "modified")
    return (change.properties || [])
      .filter((p) => MEMBER_LISTS.has(p.key))
      .map((p) => ({ key: p.key, ...listDelta(p) }));
  // A new element gains everything it lists; a removed one loses it.
  const data = change.kind === "added" ? change.after : change.before;
  return [...MEMBER_LISTS]
    .map((key) => ({ key, items: listItems(cell(data, key)) }))
    .filter(({ items }) => items.length)
    .map(({ key, items }) => ({
      key,
      joined: change.kind === "added" ? items : [],
      left: change.kind === "removed" ? items : [],
    }));
}
/**
 * Items that moved between member lists or package contents: identity →
 * `{ from, to }`, the elements whose lists lost and gained it (either may be
 * missing, as when a member's class is new or removed with it).
 */
function movesOf(changes) {
  const createdOrDeleted = new Set(
    changes.filter((c) => c.kind !== "modified").map((c) => c.elementId),
  );
  const moves = new Map();
  for (const change of changes)
    for (const { joined, left } of listChanges(change)) {
      for (const id of joined)
        if (!createdOrDeleted.has(id))
          moves.set(id, { ...moves.get(id), to: change.elementId });
      for (const id of left)
        if (!createdOrDeleted.has(id))
          moves.set(id, { ...moves.get(id), from: change.elementId });
    }
  return moves;
}

/** A member's short name in a summary: methods get parentheses. */
export const memberLabel = (member, method) =>
  method ? `${member.name}()` : member.name;

/** A member as it reads in code: a method's signature, or name and type. */
export function memberSignature(member, method, profile) {
  if (method) return member.type || `${member.name}()`;
  if (!member.type) return member.name;
  return profile === "database"
    ? `${member.name} ${member.type}`
    : `${member.name}: ${member.type}`;
}

/**
 * The parts of an identity captured from code or a database, each
 * URL-encoded: TypeScript `code:ts:<repository>:<file>:<name>`, Java
 * `code:java:<repository>:<qualified name>` and `db:<engine>:<source>:
 * <schema>:<table>`. Proposed elements follow the same convention, so the
 * identity says where a new declaration is meant to live.
 */
export function decodeIdentity(id) {
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  try {
    if (parts[0] === "code" && parts.length >= 5)
      return {
        source: "code",
        language: parts[1],
        repository: decodeURIComponent(parts[2]),
        file: decodeURIComponent(parts[3]),
        name: decodeURIComponent(parts[4]),
      };
    if (parts[0] === "code" && parts.length === 4)
      return {
        source: "code",
        language: parts[1],
        repository: decodeURIComponent(parts[2]),
        file: null,
        name: decodeURIComponent(parts[3]),
      };
    if (parts[0] === "db" && parts.length >= 5)
      return {
        source: "database",
        engine: parts[1],
        repository: decodeURIComponent(parts[2]),
        schema: decodeURIComponent(parts[3]),
        name: decodeURIComponent(parts[4]),
      };
  } catch {
    // A malformed escape is not a location.
  }
  return null;
}

/**
 * Where a class lives: its captured location, else what its identity says.
 * A Java identity names a class rather than its file (see javaFile).
 */
export function elementFile(element, model) {
  if (element?.location?.file) return element.location.file;
  const identity = decodeIdentity(element?.id);
  if (!identity || identity.source !== "code") return null;
  if (identity.file) return identity.file;
  return identity.language === "java" ? javaFile(identity, model) : null;
}

// A Java class nested in a captured class lives in that class's file; any
// other is where its package puts it, under the source root the captured
// classes of its repository share (src/main/java/com/shop/Cart.java for
// com.shop.Cart).
function javaFile({ name: qualified, repository }, model) {
  const captured = (model?.classes || []).filter((c) => {
    const identity = decodeIdentity(c.id);
    return (
      c.location?.file &&
      identity?.language === "java" &&
      identity.repository === repository
    );
  });
  const nameOf = (c) => decodeIdentity(c.id).name;
  for (let end = qualified.lastIndexOf("."); end > 0; ) {
    const outer = captured.find((c) => nameOf(c) === qualified.slice(0, end));
    if (outer) return outer.location.file;
    end = qualified.lastIndexOf(".", end - 1);
  }
  // Packages are lower case by convention; the first capitalized name is the
  // top-level class, whose file holds any class nested in it.
  const parts = qualified.split(".");
  const top = parts.findIndex((part) => /^[A-Z]/.test(part));
  const relative = `${parts.slice(0, top < 0 ? parts.length : top + 1).join("/")}.java`;
  for (const c of captured) {
    const own = `${nameOf(c).replace(/\./g, "/")}.java`;
    const file = c.location.file;
    if (file === own || file.endsWith(`/${own}`))
      return file.slice(0, file.length - own.length) + relative;
  }
  return null;
}

// Kinds every relation of a profile shares say nothing in a list of them.
const PLAIN_KINDS = new Set(["dependency", "foreign key"]);
function edgeTag(edge) {
  if ("specificId" in edge) return edge.realization ? "implements" : "inherits";
  if (PLAIN_KINDS.has(edge.stereotype)) return "";
  return edge.stereotype ? `«${edge.stereotype}»` : "";
}

function index(model) {
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  const members = new Map();
  for (const c of model.classes) {
    for (const member of c.attributes || [])
      members.set(member.id, { owner: c, member, method: false });
    for (const member of c.methods || [])
      members.set(member.id, { owner: c, member, method: true });
  }
  // A relation keeps its identity when its route changes: the change view
  // holds the current route and the retained previous one. Prefer the current.
  const edges = new Map();
  for (const edge of [...model.relations, ...model.generalizations]) {
    const id = edge.originalId || edge.id;
    if (!edges.has(id) || edge.changeStatus !== "removed") edges.set(id, edge);
  }
  return { classes, members, edges };
}

// What the views draw: a row opens only an element the canvas can show. A
// relation whose ends sit in different views is drawn in none of them.
function drawn(views) {
  if (!views) return null;
  const nodes = new Set(),
    edges = new Set();
  for (const view of views)
    for (const diagram of [view.diagram, view.diagramFields].filter(Boolean)) {
      for (const node of diagram.nodes || []) nodes.add(node.id);
      for (const edge of diagram.edges || []) edges.add(edge.id);
      // Inheritance sharing a supertype is drawn as one joined group.
      for (const group of diagram.generalizationGroups || [])
        for (const id of group.memberIds || []) edges.add(id);
    }
  return { nodes, edges };
}

// OntoUML attributes and literals: `type` names the element's own type, and
// an attribute's type is the class its `propertyType` refers to ("?" without
// one, as the diagram shows it).
const ONTOUML_MEMBERS = new Set(["Property", "Literal"]);
function typeOf(data, names) {
  if (data.type === "Literal") return undefined;
  if (data.type === "Property")
    return data.propertyType ? readable(data.propertyType, names) : "?";
  return typeof data.type === "string" ? data.type : undefined;
}
function memberFromChange(change, names) {
  const data = change.after || change.before || {};
  const type = typeOf(data, names);
  const method =
    !ONTOUML_MEMBERS.has(data.type) &&
    typeof type === "string" &&
    (/^[^:]*\(/.test(type) || /:method%3A/.test(change.elementId || ""));
  return {
    name: textOf(data.name) ?? readable(change.name, names),
    type,
    method,
  };
}

// The model's own record (a structural model's root, an OntoUML project) and
// OntoUML packages: what they list is told by each element, but their other
// properties (constraints, a name) are changes of their own.
const modelLevelType = (change, ontouml) => {
  if (!change.elementId) return "model";
  const type = (change.after || change.before || {}).type;
  return ontouml && (type === "Project" || type === "Package")
    ? type.toLowerCase()
    : null;
};

/**
 * A list's change as tokens: what it gains, loses and changes, each by name
 * (a part of a table by its name only). Null for a list that was only
 * reordered, which reads as before → after instead.
 */
function listTokens(note, names, prefix = "") {
  const changes = itemChanges(note);
  if (!changes?.length) return null;
  const order = { modified: 0, added: 1, removed: 2 };
  return changes
    .sort((a, b) => order[a.status] - order[b.status])
    .map(({ status, before, after }) => {
      const item = after ?? before;
      const text = isPart(item) ? partName(item) : readable(item, names);
      return {
        status,
        text: shorten(prefix ? `${prefix} ${text}` : text, 60),
      };
    });
}

/**
 * Rolls a comparison up per element. `model` is the change view's model: the
 * proposal plus retained removals, with `changeStatus` on classes, routes and
 * the members of changed classes. `views` (the change view's) decide which
 * rows can open their element on the canvas.
 */
export function rollupChanges(comparison, model, views) {
  if (!comparison?.changes || !model) return null;
  const { classes, members, edges } = index(model);
  const names = nameIndex(model, comparison.baseline?.model);
  const canvas = drawn(views);
  const profile = model.document?.profile;
  const ontouml = profile === "ontouml";
  const changes = comparison.changes.changes || [];
  const recorded = new Map(
    changes.filter((c) => c.elementId).map((c) => [c.elementId, c]),
  );
  const moves = movesOf(changes);
  const rows = new Map();
  const row = (key, make) => {
    if (!rows.has(key)) rows.set(key, { key, changes: [], ...make() });
    return rows.get(key);
  };
  const nodeRow = (c, status) =>
    row(`node:${c.id}`, () => ({
      status: status || c.changeStatus || "modified",
      kind: "node",
      target:
        !canvas || canvas.nodes.has(c.id) ? { kind: "node", id: c.id } : null,
      id: c.id,
      name: c.name,
      tag: c.stereotype || c.kind || "",
      members: [],
      notes: [],
    }));
  const edgeRow = (edge, status) => {
    const [source, target] = edgeEnds(edge).map((id) => classes.get(id));
    return row(`edge:${edge.originalId || edge.id}`, () => ({
      status: status || edge.changeStatus || "modified",
      kind: "edge",
      target:
        !canvas || canvas.edges.has(edge.id)
          ? { kind: "edge", id: edge.id }
          : null,
      id: edge.originalId || edge.id,
      name: `${source?.name ?? "?"} → ${target?.name ?? "?"}`,
      sourceName: source?.name,
      targetName: target?.name,
      tag: edgeTag(edge),
      label: informativeName(edge),
      // A type-use dependency says which of the source's members use the target.
      via:
        edge.stereotype === "dependency" && !informativeName(edge)
          ? dependencyMembers(source, target).map(({ member, method }) =>
              memberLabel(member, method),
            )
          : [],
      members: [],
      notes: [],
    }));
  };
  const modelRow = () =>
    row("model", () => ({
      status: "model",
      kind: "model",
      target: null,
      id: model.id,
      name: "Model",
      tag: "",
      members: [],
      notes: [],
    }));
  // `key` is how the change reads; `property` the compared property itself.
  const note = (p, key = p.key) => ({
    key,
    property: p.key,
    before: p.before,
    after: p.after,
  });
  const text = (value) => ({ present: true, value });
  // A database capture also lists each table's definition and constraints at
  // the model's level; the table's own record tells them.
  const scoped = (cell) =>
    !cell.present ||
    (Array.isArray(cell.value) &&
      cell.value.every((item) => Array.isArray(item) && classes.has(item[0])));
  const fromModel = (p) =>
    !(
      profile === "database" &&
      p.key === "constraints" &&
      scoped(p.before) &&
      scoped(p.after)
    );
  // A member that moved, as its class lists it in the change view.
  const memberIn = (classId, id) => {
    const c = classes.get(classId);
    const attribute = (c?.attributes || []).find((m) => m.id === id);
    if (attribute) return { member: attribute, method: false };
    const method = (c?.methods || []).find((m) => m.id === id);
    return method ? { member: method, method: true } : null;
  };
  const currentOwner = (id) =>
    model.classes.find((c) =>
      [...(c.attributes || []), ...(c.methods || [])].some(
        (m) => m.id === id && m.changeStatus !== "removed",
      ),
    )?.id;
  const placeName = (id) =>
    names.get(id) ??
    textOf(recorded.get(id)?.after?.name) ??
    textOf(recorded.get(id)?.before?.name) ??
    id;
  const movedMember = (classId, id, status, other) => {
    const found = memberIn(classId, id);
    const member = found
      ? {
          name: found.member.name,
          type: found.member.type,
          method: found.method,
        }
      : recorded.has(id)
        ? memberFromChange(recorded.get(id), names)
        : { name: names.get(id) ?? id, method: false };
    return {
      id,
      status,
      label: memberLabel(member, member.method),
      member,
      ...(other
        ? { moved: { [status === "added" ? "from" : "to"]: placeName(other) } }
        : {}),
    };
  };
  for (const change of changes) {
    const id = change.elementId;
    const properties = meaningfulProperties(change);
    const level = modelLevelType(change, ontouml);
    if (level) {
      const notes = properties
        .filter(fromModel)
        .map((p) => note(p, level === "package" ? `package ${p.key}` : p.key));
      if (level === "package" && change.kind !== "modified")
        notes.push({
          key: `${placeName(id)} package`,
          property: "presence",
          status: change.kind,
        });
      // What moved into this package, from where.
      if (level === "package")
        for (const { key, joined } of listChanges(change))
          if (key === "contents")
            for (const item of joined)
              if (moves.has(item))
                notes.push({
                  key: placeName(item),
                  property: "moved",
                  before: text(
                    moves.get(item).from
                      ? placeName(moves.get(item).from)
                      : "none",
                  ),
                  after: text(placeName(id)),
                });
      if (!notes.length) continue; // Only its element lists changed.
      const entry = modelRow();
      entry.changes.push(change);
      entry.notes.push(...notes);
      continue;
    }
    if (classes.has(id)) {
      const entry = nodeRow(classes.get(id), change.kind);
      entry.status = change.kind;
      entry.changes.push(change);
      // (A table's foreign keys that relations show are left out when the
      // comparison is prepared.)
      for (const p of properties) entry.notes.push(note(p));
      // Members that moved in or out.
      for (const { joined, left } of listChanges(change)) {
        for (const item of joined)
          if (moves.has(item))
            entry.members.push(
              movedMember(id, item, "added", moves.get(item).from),
            );
        for (const item of left)
          if (moves.has(item))
            entry.members.push(
              movedMember(
                id,
                item,
                "removed",
                moves.get(item).to ?? currentOwner(item),
              ),
            );
      }
      continue;
    }
    if (edges.has(id)) {
      const entry = edgeRow(edges.get(id), change.kind);
      entry.status = change.kind;
      entry.changes.push(change);
      for (const p of properties) entry.notes.push(note(p));
      continue;
    }
    if (moves.has(id)) {
      // A moved member is listed where it went and where it left; its own
      // changes, if any, go with it.
      const to = moves.get(id).to ?? currentOwner(id);
      if (to && classes.has(to))
        nodeRow(classes.get(to), "modified").changes.push(change);
      continue;
    }
    const known = members.get(id);
    const owner = known ? known.owner.id : change.ownerId;
    if (owner && classes.has(owner)) {
      const entry = nodeRow(classes.get(owner), "modified");
      entry.changes.push(change);
      const member = known
        ? {
            name: known.member.name,
            type: known.member.type,
            method: known.method,
          }
        : memberFromChange(change, names);
      entry.members.push({
        id,
        status: change.kind,
        label: memberLabel(member, member.method),
        member,
      });
      continue;
    }
    if (owner && edges.has(owner)) {
      // An association end: OntoUML keeps ends as elements of their own,
      // named by their role, or by the class at that end (and which end, when
      // a relation joins a class to itself).
      const edge = edges.get(owner);
      const entry = edgeRow(edge, "modified");
      entry.changes.push(change);
      const data = change.after || change.before || {};
      const [source, target] = edgeEnds(edge);
      const at = readable(data.propertyType, names);
      const end =
        textOf(data.name) ||
        (source === target && change.end
          ? `${at} ${change.end} end`
          : `${at} end`);
      for (const p of properties) entry.notes.push(note(p, `${end} ${p.key}`));
      continue;
    }
    if (!properties.length && change.kind === "modified") continue;
    const type = (change.after || change.before || {}).type;
    const entry = row(`other:${id}`, () => ({
      status: change.kind,
      kind: "other",
      target: null,
      id,
      name: names.get(id) || readable(change.name, names),
      tag:
        type === "GeneralizationSet"
          ? "generalization set"
          : typeof type === "string"
            ? type.toLowerCase()
            : "element",
      members: [],
      notes: [],
    }));
    entry.changes.push(change);
    for (const p of properties) entry.notes.push(note(p));
  }
  const all = [...rows.values()];
  for (const entry of all) {
    // A changed type lists its members in the order it declares them.
    if (entry.kind === "node" && entry.status === "modified") {
      const c = classes.get(entry.id);
      const order = [...(c?.attributes || []), ...(c?.methods || [])].map(
        (m) => m.id,
      );
      const at = (id) => {
        const i = order.indexOf(id);
        return i < 0 ? order.length : i;
      };
      entry.members.sort((x, y) => at(x.id) - at(y.id));
    }
    // Members of a new or removed type share its status; list what it holds.
    if (entry.kind === "node" && entry.status !== "modified") {
      const c = classes.get(entry.id);
      entry.members = [
        ...(c?.attributes || []).map((m) => ({ member: m, method: false })),
        ...(c?.methods || []).map((m) => ({ member: m, method: true })),
      ].map(({ member, method }) => {
        const move = moves.get(member.id);
        const other =
          entry.status === "added"
            ? move?.from
            : (move?.to ?? (move ? currentOwner(member.id) : undefined));
        return {
          id: member.id,
          status: entry.status,
          label: memberLabel(member, method),
          member: { name: member.name, type: member.type, method },
          ...(other
            ? {
                moved: {
                  [entry.status === "added" ? "from" : "to"]: placeName(other),
                },
              }
            : {}),
        };
      });
    }
    entry.summary = summarize(entry, names);
  }
  const byName = (a, b) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const groups = CHANGE_STATUSES.map((status) => {
    const of = (kind) =>
      all.filter((r) => r.status === status && r.kind === kind).sort(byName);
    return {
      status,
      label: CHANGE_LABELS[status],
      elements: [...of("node"), ...of("other")],
      relations: of("edge"),
    };
  });
  groups.push({
    status: "model",
    label: "Model",
    elements: all.filter((r) => r.kind === "model"),
    relations: [],
  });
  const listed = groups.filter((g) => g.elements.length || g.relations.length);
  const ordered = listed.flatMap((g) => [...g.elements, ...g.relations]);
  const conflicts = comparison.conflicts || [];
  return {
    groups: listed,
    rows: ordered,
    // What Previous and Next step through: the changes the canvas can show.
    navigable: ordered.filter((r) => r.target),
    conflicts,
    total: ordered.length,
    // What the Changes button counts: every listed change, and conflicts.
    count: ordered.length + conflicts.length,
    names,
  };
}

// Singular names for the parts a table lists, in a list's tokens.
const SINGULAR = {
  foreignKeys: "foreign key",
  keys: "key",
  indexes: "index",
  constraints: "constraint",
  triggers: "trigger",
  modifiers: "modifier",
};
/** A note in a summary: before → after, a list's gains and losses, or that a long value changed. */
function noteTokens(n, names, lists = true) {
  if (lists && n.property !== "moved") {
    const tokens = listTokens(n, names, SINGULAR[n.property] ?? n.property);
    if (tokens?.length) return tokens;
  }
  const before = cellText(n.before, names, n.property),
    after = cellText(n.after, names, n.property);
  if (
    before.length > MAX_INLINE ||
    after.length > MAX_INLINE ||
    /\n/.test(before + after)
  )
    return [{ status: "modified", text: `${n.key} changed` }];
  return [{ status: "modified", text: `${n.key}: ${before} → ${after}` }];
}

function summarize(entry, names) {
  const note =
    entry.target || !["node", "edge"].includes(entry.kind)
      ? null
      : "Not drawn in any view";
  if (entry.kind === "edge") {
    const notes = entry.notes.flatMap((n) =>
      noteTokens(n, names, false).map((t) => t.text),
    );
    const via = entry.via.length
      ? `via ${entry.via.slice(0, MAX_TOKENS - 1).join(", ")}`
      : "";
    return {
      text: [entry.label || via, ...notes].filter(Boolean).join(" · "),
      tokens: [],
      more: Math.max(0, entry.via.length - (MAX_TOKENS - 1)),
      note,
    };
  }
  if (entry.kind === "model") {
    // The model's constraints read as what the list gains and loses; a new or
    // removed package, as itself.
    const tokens = entry.notes.flatMap((n) =>
      n.property === "presence"
        ? [{ status: n.status, text: n.key }]
        : (n.property === "constraints" && listTokens(n, names)) ||
          noteTokens(n, names),
    );
    return {
      text: "",
      tokens: tokens.slice(0, MAX_TOKENS),
      more: Math.max(0, tokens.length - MAX_TOKENS),
      note,
    };
  }
  const members = entry.members;
  if (entry.status === "modified") {
    const tokens = members.map((m) => ({ status: m.status, text: m.label }));
    const notes = entry.notes.flatMap((n) => noteTokens(n, names));
    const all = [...notes, ...tokens];
    return {
      text: "",
      tokens: all.slice(0, MAX_TOKENS),
      more: Math.max(0, all.length - MAX_TOKENS),
      note,
    };
  }
  // A new or removed type: what comes or goes with it, not what moved.
  const own = members.filter((m) => !m.moved);
  return {
    text: own
      .slice(0, MAX_TOKENS - 1)
      .map((m) => m.label)
      .join(", "),
    tokens: [],
    more: Math.max(0, own.length - (MAX_TOKENS - 1)),
    note,
  };
}

// Names and descriptions are text, never identities to look up; so are the
// places a moved element went between, already named.
const TEXT_KEYS = new Set(["name", "description", "documentation", "moved"]);
/** A compared cell as readable text; `key` is the property it belongs to. */
export const cellText = (cell, names, key) =>
  cell?.present
    ? readable(cell.value, TEXT_KEYS.has(key) ? undefined : names)
    : "none";

/** The rollup entry for a canvas target, by its semantic identity. */
export function rowFor(rollup, target, model) {
  if (!rollup || !target) return null;
  if (target.kind === "node")
    return rollup.rows.find((r) => r.kind === "node" && r.id === target.id);
  const edge = [...(model?.relations || []), ...(model?.generalizations || [])]
    .filter(Boolean)
    .find((e) => e.id === target.id);
  const id = edge?.originalId || target.id;
  return rollup.rows.find((r) => r.kind === "edge" && r.id === id) || null;
}

/**
 * What a proposal changes about one class, for its details: its own property
 * changes and each changed member, with before and after for modified ones.
 */
export function describeClassChange(rollup, element, profile) {
  const entry = rollup?.rows.find(
    (r) => r.kind === "node" && r.id === element.id,
  );
  if (!entry) return null;
  const names = rollup.names;
  const byId = new Map(entry.changes.map((c) => [c.elementId, c]));
  const moved = new Map(
    entry.members.filter((m) => m.moved).map((m) => [m.id, m.moved]),
  );
  const members = [
    ...(element.attributes || []).map((m) => ({ member: m, method: false })),
    ...(element.methods || []).map((m) => ({ member: m, method: true })),
  ];
  const seen = new Set();
  const changed = [];
  for (const { member, method } of members) {
    const change = byId.get(member.id);
    if (
      !change &&
      !(member.changeStatus && member.changeStatus !== "unchanged")
    )
      continue;
    seen.add(member.id);
    changed.push(
      memberChange(
        member,
        method,
        change,
        profile,
        names,
        moved.get(member.id),
      ),
    );
  }
  // Members the change view could not place, such as a removed member of a
  // class whose proposal no longer lists it.
  for (const m of entry.members) {
    if (seen.has(m.id) || entry.status !== "modified") continue;
    seen.add(m.id);
    changed.push(
      memberChange(
        {
          id: m.id,
          name: m.member.name,
          type: m.member.type,
          changeStatus: m.status,
        },
        m.member.method,
        byId.get(m.id),
        profile,
        names,
        m.moved,
      ),
    );
  }
  return {
    status: entry.status,
    properties: entry.notes.flatMap((n) => {
      const parts = itemChanges(n);
      // A list of a table's parts reads part by part, with what each holds.
      if (parts?.length && parts.every((c) => isPart(c.after ?? c.before)))
        return parts.map(({ status, before, after }) => {
          const part = after ?? before;
          const [was, is] =
            before && after
              ? partChange(before, after)
              : [
                  before ? describePart(before) : "none",
                  after ? describePart(after) : "none",
                ];
          return {
            key: isForeignKey(part)
              ? "foreign key"
              : `${SINGULAR[n.property] ?? n.property} ${partName(part)}`,
            status,
            before: was,
            after: is,
          };
        });
      return [
        {
          key: n.key,
          status: "modified",
          before: cellText(n.before, names, n.property),
          after: cellText(n.after, names, n.property),
        },
      ];
    }),
    members: entry.status === "modified" ? changed : [],
    // Members of a new or removed type that moved there or away.
    moved:
      entry.status === "modified" ? [] : entry.members.filter((m) => m.moved),
    entry,
  };
}

// The name and type a member had before the proposal, in the terms the
// change view shows it now.
function previousMember(before, member, names) {
  const conceptual = ONTOUML_MEMBERS.has(before.type);
  return {
    ...member,
    name: textOf(before.name) ?? member.name,
    type: conceptual
      ? (typeOf(before, names) ?? member.type)
      : typeof before.type === "string"
        ? before.type
        : member.type,
  };
}

function memberChange(member, method, change, profile, names, moved) {
  // The change view's status for this class wins: a member that moved in is
  // new here, whatever else its own change says.
  const status =
    member.changeStatus && member.changeStatus !== "unchanged"
      ? member.changeStatus
      : change?.kind;
  const properties = meaningfulProperties(change).map((p) => ({
    key: p.key,
    before: cellText(p.before, names, p.key),
    after: cellText(p.after, names, p.key),
  }));
  const before = change?.before;
  return {
    id: member.id,
    status,
    method,
    name: member.name,
    signature: memberSignature(member, method, profile),
    // A member that moved in may also have changed on the way.
    previous:
      (status === "modified" || moved?.from) && before
        ? memberSignature(
            previousMember(before, member, names),
            method,
            profile,
          )
        : null,
    properties,
    moved: moved || null,
    location: member.location || before?.location || null,
  };
}

/** Whether a file holds any declaration the baseline already had. */
export function fileExists(model, file) {
  if (!file) return false;
  return model.classes.some(
    (c) => c.changeStatus !== "added" && elementFile(c, model) === file,
  );
}

/** Classes whose members a code dependency's source declares with the target's type. */
export function dependencyMembers(source, target) {
  if (!source || !target?.name) return [];
  const pattern = new RegExp(
    `(^|[^\\w$])${target.name.replace(/[$.*+?^(){}[\]|\\]/g, "\\$&")}([^\\w$]|$)`,
  );
  return [
    ...(source.attributes || []).map((m) => ({ member: m, method: false })),
    ...(source.methods || []).map((m) => ({ member: m, method: true })),
  ].filter(
    ({ member }) =>
      typeof member.type === "string" && pattern.test(member.type),
  );
}
