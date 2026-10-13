// What a proposal changes, rolled up per element for review: one entry per
// changed type (its members summarized), per changed relation, and per other
// changed element. Pure functions over the comparison payload and the change
// view's model, so the panel, the canvas and the tests share them.

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

/** Element id → display name, with owner.member names for members. */
export function nameIndex(...models) {
  const names = new Map();
  for (const model of models) {
    if (!model) continue;
    for (const c of model.classes || []) {
      names.set(c.id, c.name);
      for (const m of [...(c.attributes || []), ...(c.methods || [])])
        names.set(m.id, `${c.name}.${m.name}`);
    }
    for (const e of [...(model.relations || []), ...(model.partitions || [])])
      if (e.name) names.set(e.originalId || e.id, e.name);
  }
  return names;
}

/** A compared value as short readable text; nested elements show their names. */
export function readable(value, names = new Map()) {
  if (typeof value === "string") return value;
  if (value === undefined) return "none";
  if (value && typeof value === "object" && typeof value.$element === "string")
    return names.get(value.$element) || value.$element;
  if (Array.isArray(value))
    return value.length
      ? value.map((item) => readable(item, names)).join(", ")
      : "none";
  if (value && typeof value === "object") {
    // Multilingual OntoUML names and descriptions.
    const text = Object.values(value).find((v) => typeof v === "string");
    if (text !== undefined && Object.keys(value).length <= 3) return text;
  }
  const text = JSON.stringify(value, (key, v) =>
    v && typeof v === "object" && typeof v.$element === "string"
      ? names.get(v.$element) || v.$element
      : v,
  );
  return text === undefined ? String(value) : text;
}
export const shorten = (text, limit = MAX_VALUE) =>
  text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

const isMembership = (cell) =>
  !cell.present ||
  (Array.isArray(cell.value) &&
    cell.value.every(
      (v) => v && typeof v === "object" && typeof v.$element === "string",
    ));
/** Property changes that say something the elements' own changes do not:
 * a list of member elements changes exactly when those members do. */
export const meaningfulProperties = (change) =>
  (change?.properties || []).filter(
    (p) => !(isMembership(p.before) && isMembership(p.after)),
  );

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
 * The parts of an identity captured from code (`code:<language>:<repository>:
 * <file>:<name>`) or a database (`db:<engine>:<source>:<schema>:<table>`),
 * each URL-encoded. Proposed elements follow the same convention, so the
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

/** Where a class lives: its captured location, else what its identity says. */
export function elementFile(element) {
  return element?.location?.file || decodeIdentity(element?.id)?.file || null;
}

function edgeEnds(edge) {
  return "specificId" in edge
    ? [edge.specificId, edge.generalId]
    : [edge.sourceId, edge.targetId];
}
// Kinds every relation of a profile shares say nothing in a list of them.
const PLAIN_KINDS = new Set(["dependency", "foreign key"]);
function edgeTag(edge) {
  if ("specificId" in edge) return edge.realization ? "implements" : "inherits";
  if (PLAIN_KINDS.has(edge.stereotype)) return "";
  return edge.stereotype ? `«${edge.stereotype}»` : "";
}

/** Whether a relation's name says more than its kind. */
export function informativeName(edge) {
  const name = typeof edge?.name === "string" ? edge.name.trim() : "";
  return name && name.toLowerCase() !== "declared type use" ? name : "";
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

function memberFromChange(change, names) {
  const data = change.after || change.before || {};
  const method =
    typeof data.type === "string" &&
    (/^[^:]*\(/.test(data.type) || /:method%3A/.test(change.elementId || ""));
  return {
    name:
      typeof data.name === "string" ? data.name : readable(change.name, names),
    type: typeof data.type === "string" ? data.type : undefined,
    method,
  };
}

/**
 * Rolls a comparison up per element. `model` is the change view's model: the
 * proposal plus retained removals, with `changeStatus` on classes, routes and
 * the members of changed classes.
 */
export function rollupChanges(comparison, model) {
  if (!comparison?.changes || !model) return null;
  const { classes, members, edges } = index(model);
  const names = nameIndex(model, comparison.baseline?.model);
  const rows = new Map();
  const row = (key, make) => {
    if (!rows.has(key)) rows.set(key, { key, changes: [], ...make() });
    return rows.get(key);
  };
  const nodeRow = (c, status) =>
    row(`node:${c.id}`, () => ({
      status: status || c.changeStatus || "modified",
      kind: "node",
      target: { kind: "node", id: c.id },
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
      target: { kind: "edge", id: edge.id },
      id: edge.originalId || edge.id,
      name: `${source?.name ?? "?"} → ${target?.name ?? "?"}`,
      sourceName: source?.name,
      targetName: target?.name,
      tag: edgeTag(edge),
      label: informativeName(edge),
      members: [],
      notes: [],
    }));
  };
  for (const change of comparison.changes.changes || []) {
    const id = change.elementId;
    const properties = meaningfulProperties(change);
    if (!id) continue; // The model's own member lists: told by each element.
    if (classes.has(id)) {
      const entry = nodeRow(classes.get(id), change.kind);
      entry.status = change.kind;
      entry.changes.push(change);
      for (const p of properties)
        entry.notes.push({
          key: p.key,
          before: p.before,
          after: p.after,
        });
      continue;
    }
    if (edges.has(id)) {
      const entry = edgeRow(edges.get(id), change.kind);
      entry.status = change.kind;
      entry.changes.push(change);
      for (const p of properties)
        entry.notes.push({ key: p.key, before: p.before, after: p.after });
      continue;
    }
    const owner = change.ownerId;
    if (owner && classes.has(owner)) {
      const ownerClass = classes.get(owner);
      const entry = nodeRow(ownerClass, "modified");
      entry.changes.push(change);
      const known = members.get(id);
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
      // An association end (OntoUML keeps ends as their own elements).
      const entry = edgeRow(edges.get(owner), "modified");
      entry.changes.push(change);
      for (const p of properties)
        entry.notes.push({
          key: `${readable(change.name, names)} ${p.key}`,
          before: p.before,
          after: p.after,
        });
      continue;
    }
    if (!properties.length && change.kind === "modified") continue;
    const entry = row(`other:${id}`, () => ({
      status: change.kind,
      kind: "other",
      target: null,
      id,
      name: readable(change.name, names),
      tag: readable((change.after || change.before || {}).type || "element"),
      members: [],
      notes: [],
    }));
    entry.changes.push(change);
    for (const p of properties)
      entry.notes.push({ key: p.key, before: p.before, after: p.after });
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
      ].map(({ member, method }) => ({
        id: member.id,
        status: entry.status,
        label: memberLabel(member, method),
        member: { name: member.name, type: member.type, method },
      }));
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
  }).filter((g) => g.elements.length || g.relations.length);
  const ordered = groups.flatMap((g) => [...g.elements, ...g.relations]);
  return {
    groups,
    rows: ordered,
    navigable: ordered.filter((r) => r.target),
    conflicts: comparison.conflicts || [],
    total: ordered.length,
    names,
  };
}

function summarize(entry, names) {
  if (entry.kind === "edge") {
    const notes = entry.notes.map(
      (n) =>
        `${n.key}: ${shorten(cellText(n.before, names), 40)} → ${shorten(cellText(n.after, names), 40)}`,
    );
    return {
      text: [entry.label, ...notes].filter(Boolean).join(" · "),
      tokens: [],
      more: 0,
    };
  }
  const members = entry.members;
  if (entry.status === "modified") {
    const tokens = members.map((m) => ({ status: m.status, text: m.label }));
    const notes = entry.notes.map((n) => ({
      status: "modified",
      text: `${n.key}: ${shorten(cellText(n.after, names), 40)}`,
    }));
    const all = [...notes, ...tokens];
    return {
      text: "",
      tokens: all.slice(0, MAX_TOKENS),
      more: Math.max(0, all.length - MAX_TOKENS),
    };
  }
  return {
    text: members
      .slice(0, MAX_TOKENS - 1)
      .map((m) => m.label)
      .join(", "),
    tokens: [],
    more: Math.max(0, members.length - (MAX_TOKENS - 1)),
  };
}

export const cellText = (cell, names) =>
  cell?.present ? readable(cell.value, names) : "none";

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
    changed.push(memberChange(member, method, change, profile, names));
  }
  // Members the change view could not place, such as a removed member of a
  // class whose proposal no longer lists it.
  for (const m of entry.members) {
    if (seen.has(m.id) || entry.status !== "modified") continue;
    const change = byId.get(m.id);
    changed.push(
      memberChange(
        { id: m.id, name: m.member.name, type: m.member.type },
        m.member.method,
        change,
        profile,
        names,
      ),
    );
  }
  return {
    status: entry.status,
    properties: entry.notes.map((n) => ({
      key: n.key,
      before: cellText(n.before, names),
      after: cellText(n.after, names),
      beforePresent: !!n.before?.present,
      afterPresent: !!n.after?.present,
    })),
    members: entry.status === "modified" ? changed : [],
    entry,
  };
}

function memberChange(member, method, change, profile, names) {
  const status = change?.kind || member.changeStatus;
  const properties = meaningfulProperties(change).map((p) => ({
    key: p.key,
    before: cellText(p.before, names),
    after: cellText(p.after, names),
  }));
  const before = change?.before;
  return {
    id: member.id,
    status,
    method,
    name: member.name,
    signature: memberSignature(member, method, profile),
    previous:
      status === "modified" && before
        ? memberSignature(
            { ...member, name: before.name ?? member.name, type: before.type },
            method,
            profile,
          )
        : null,
    properties,
    location: member.location || before?.location || null,
  };
}

/** Whether a file holds any declaration the baseline already had. */
export function fileExists(model, file) {
  if (!file) return false;
  return model.classes.some(
    (c) => c.changeStatus !== "added" && elementFile(c) === file,
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
