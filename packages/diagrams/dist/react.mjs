var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/viewer/DiagramViewer.jsx
import { useMemo as useMemo7, useRef as useRef6, useState as useState10 } from "react";

// src/canvas/DiagramCanvas.jsx
import {
  forwardRef,
  memo as memo2,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect as useLayoutEffect3,
  useRef as useRef3,
  useState as useState2
} from "react";

// src/canvas/UMLDiagram.jsx
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// src/canvas/interaction.js
var sameTarget = (a, b) => a === b || !!a && !!b && a.kind === b.kind && a.id === b.id;
function readTarget(element) {
  const item = element?.closest?.("[data-element-kind]");
  return item ? { kind: item.dataset.elementKind, id: item.dataset.elementId } : null;
}
var indexes = /* @__PURE__ */ new WeakMap();
function interactionIndex(diagram) {
  if (indexes.has(diagram)) return indexes.get(diagram);
  const nodes = new Map(diagram.nodes.map((node) => [node.id, node]));
  const edges = /* @__PURE__ */ new Map();
  const incident = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  const groupsByEdge = /* @__PURE__ */ new Map();
  const append = (map, id, value) => {
    if (!map.has(id)) map.set(id, /* @__PURE__ */ new Set());
    map.get(id).add(value);
  };
  for (const edge of diagram.edges) {
    edges.set(edge.id, edge);
    append(incident, edge.source, edge);
    append(incident, edge.target, edge);
  }
  for (const group of diagram.generalizationGroups || []) {
    groups.set(group.id, group);
    for (const id of group.memberIds) append(groupsByEdge, id, group.id);
  }
  const index2 = { nodes, edges, incident, groups, groupsByEdge };
  indexes.set(diagram, index2);
  return index2;
}
function focusedElements(diagram, target) {
  if (!target) return null;
  const nodes = /* @__PURE__ */ new Set();
  const edges = /* @__PURE__ */ new Set();
  const groups = /* @__PURE__ */ new Set();
  const index2 = interactionIndex(diagram);
  if (target.kind === "node") {
    if (!index2.nodes.has(target.id)) return null;
    nodes.add(target.id);
    for (const edge of index2.incident.get(target.id) || []) {
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  } else if (target.kind === "group") {
    const group = index2.groups.get(target.id);
    if (!group) return null;
    group.memberIds.forEach((id) => edges.add(id));
    group.sourceIds.forEach((id) => nodes.add(id));
    nodes.add(group.target);
  } else {
    const edge = index2.edges.get(target.id);
    if (!edge) return null;
    edges.add(edge.id);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  for (const id of edges)
    for (const groupId of index2.groupsByEdge.get(id) || []) groups.add(groupId);
  return { nodes, edges, groups, primary: target };
}
function elementClass(kind, id, focus, selected) {
  const target = { kind, id };
  const classes = ["diagram-element", kind === "node" ? "node" : "edge"];
  if (focus)
    classes.push(
      focus[kind === "node" ? "nodes" : kind === "group" ? "groups" : "edges"]?.has(id) ? "highlighted" : "dimmed"
    );
  if (sameTarget(target, focus?.primary)) classes.push("primary");
  if (sameTarget(target, selected)) classes.push("selected");
  return classes.join(" ");
}
function interactionProps(target, handlers, focusable = true) {
  if (!handlers) return {};
  return {
    onPointerEnter: () => handlers.onHover(target),
    onPointerLeave: (event) => handlers.onHover(readTarget(event.relatedTarget)),
    onClick: (e) => {
      e.stopPropagation();
      handlers.onActivate(target, e);
    },
    ...focusable ? {
      role: "button",
      tabIndex: 0,
      onFocus: () => handlers.onFocus(target),
      onBlur: () => handlers.onFocus(null),
      onKeyDown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          handlers.onActivate(target, e);
        }
      }
    } : {}
  };
}

// src/canvas/UMLNode.jsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var CHANGE_COLORS = {
  added: "var(--change-added,#1a7f37)",
  modified: "var(--change-modified,#9a6700)",
  removed: "var(--change-removed,#cf222e)"
};
var CHANGE_TAGS = { added: "New", modified: "Changed", removed: "Removed" };
var MEMBER_GLYPHS = { added: "+", modified: "~", removed: "\u2212" };
var isChanged = (status) => !!CHANGE_COLORS[status];
var Tooltip = ({ text }) => text ? /* @__PURE__ */ jsx("title", { children: text }) : null;
function MemberText({ member, x, y, method }) {
  const status = isChanged(member.changeStatus) ? member.changeStatus : null;
  const text = method ? member.type : member.slot ? `${member.name} = ${member.type}` : !member.type ? member.name : `${member.name} : ${member.type}${member.multiplicity ? ` [${member.multiplicity}]` : ""}`;
  if (!status)
    return /* @__PURE__ */ jsxs("text", { x, y, children: [
      /* @__PURE__ */ jsx(Tooltip, { text: member.description }),
      text
    ] });
  return /* @__PURE__ */ jsxs("g", { className: "member-change", "data-change": status, children: [
    /* @__PURE__ */ jsx(
      "text",
      {
        x: x - 9,
        y,
        textAnchor: "middle",
        fill: CHANGE_COLORS[status],
        fontWeight: "700",
        children: MEMBER_GLYPHS[status]
      }
    ),
    /* @__PURE__ */ jsxs(
      "text",
      {
        x,
        y,
        fill: CHANGE_COLORS[status],
        textDecoration: status === "removed" ? "line-through" : void 0,
        children: [
          /* @__PURE__ */ jsx(Tooltip, { text: member.description }),
          text
        ]
      }
    )
  ] });
}
function UMLNode({ node, focus, selected, handlers, idPrefix = "" }) {
  const target = { kind: "node", id: node.id };
  const methods = node.methods || [];
  const header = node.attributes.length || methods.length ? 56 : node.height;
  const change = isChanged(node.changeStatus) ? node.changeStatus : null;
  const tag = change && CHANGE_TAGS[change];
  const tagWidth = tag ? tag.length * 6.4 + 12 : 0;
  return /* @__PURE__ */ jsxs(
    "g",
    {
      id: `${idPrefix}node-${node.id}`,
      className: `${elementClass("node", node.id, focus, selected)}${change ? " changed" : ""}`,
      "data-name": node.name,
      "data-node-id": node.id,
      "data-element-kind": "node",
      "data-element-id": node.id,
      "data-change": node.changeStatus,
      "aria-label": tag ? `${node.name}, ${tag.toLowerCase()}` : node.name,
      "aria-pressed": handlers ? sameTarget(target, selected) : void 0,
      transform: `translate(${node.x} ${node.y})`,
      ...interactionProps(target, handlers),
      children: [
        /* @__PURE__ */ jsx(Tooltip, { text: node.description }),
        change && /* @__PURE__ */ jsx(
          "rect",
          {
            className: "node-ring",
            x: "-5",
            y: "-5",
            width: node.width + 10,
            height: node.height + 10,
            rx: "6",
            fill: "none",
            stroke: "transparent",
            strokeWidth: "2.5",
            vectorEffect: "non-scaling-stroke"
          }
        ),
        /* @__PURE__ */ jsx(
          "rect",
          {
            className: "node-box",
            width: node.width,
            height: node.height,
            rx: "3",
            fill: "var(--surface,#f6f8fa)",
            stroke: change ? CHANGE_COLORS[change] : "var(--diagram-border,#818b98)",
            strokeWidth: change ? "2.25" : "1.25",
            strokeDasharray: change === "removed" ? "6 4" : void 0,
            vectorEffect: "non-scaling-stroke"
          }
        ),
        tag && /* @__PURE__ */ jsxs("g", { className: "change-tag", transform: "translate(7 7)", children: [
          /* @__PURE__ */ jsx(
            "rect",
            {
              width: tagWidth,
              height: "17",
              rx: "8.5",
              fill: CHANGE_COLORS[change],
              fillOpacity: "0.16"
            }
          ),
          /* @__PURE__ */ jsx(
            "text",
            {
              x: tagWidth / 2,
              y: "12.5",
              textAnchor: "middle",
              fill: CHANGE_COLORS[change],
              fontSize: "10.5",
              fontWeight: "600",
              children: tag
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          "text",
          {
            x: node.width / 2,
            y: header / 2 + 8,
            textAnchor: "middle",
            fill: "var(--text,#1f2328)",
            fontSize: "15",
            fontWeight: "600",
            fontStyle: node.isAbstract ? "italic" : void 0,
            textDecoration: change === "removed" ? "line-through" : void 0,
            children: node.name
          }
        ),
        (node.attributes.length > 0 || methods.length > 0) && /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsx(
            "path",
            {
              d: `M0 56 H${node.width}`,
              stroke: "var(--diagram-divider,#d1d9e0)"
            }
          ),
          /* @__PURE__ */ jsx(
            "g",
            {
              className: "attributes",
              fill: "var(--diagram-attribute,#59636e)",
              fontSize: "12",
              children: node.attributes.map((attribute, i) => /* @__PURE__ */ jsx(
                MemberText,
                {
                  member: attribute,
                  x: 14,
                  y: 75 + i * 20
                },
                attribute.id || i
              ))
            }
          ),
          methods.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(
              "path",
              {
                d: `M0 ${node.attributes.length ? 66 + node.attributes.length * 20 : 56} H${node.width}`,
                stroke: "var(--diagram-divider,#d1d9e0)"
              }
            ),
            /* @__PURE__ */ jsx(
              "g",
              {
                className: "methods",
                fill: "var(--diagram-attribute,#59636e)",
                fontSize: "12",
                children: methods.map((method, i) => /* @__PURE__ */ jsx(
                  MemberText,
                  {
                    member: method,
                    method: true,
                    x: 14,
                    y: (node.attributes.length ? 87 + node.attributes.length * 20 : 75) + i * 20
                  },
                  method.id || i
                ))
              }
            )
          ] })
        ] })
      ]
    }
  );
}

// src/model/multiplicity.js
var knownMultiplicity = (value) => typeof value === "string" && value.trim() !== "" && value.trim() !== "?";

// src/review/changes.js
var CHANGE_LABELS = {
  added: "New",
  modified: "Changed",
  removed: "Removed"
};
var CHANGE_STATUSES = ["added", "modified", "removed"];
var GLYPHS = { added: "+", modified: "~", removed: "\u2212" };
var changeGlyph = (status) => GLYPHS[status] || "";
var MAX_TOKENS = 4;
var MAX_VALUE = 160;
var MAX_INLINE = 40;
var GENERIC_RELATION_NAMES = /* @__PURE__ */ new Set(["declared type use", "association"]);
function informativeName(edge) {
  const name = typeof edge?.name === "string" ? edge.name.trim() : "";
  return name && !GENERIC_RELATION_NAMES.has(name.toLowerCase()) ? name : "";
}
var edgeEnds = (edge) => "specificId" in edge ? [edge.specificId, edge.generalId] : [edge.sourceId, edge.targetId];
function nameIndex(...models) {
  const names = /* @__PURE__ */ new Map();
  const put = (id, name) => {
    if (id && !names.has(id)) names.set(id, name);
  };
  const present = models.filter(Boolean);
  for (const model of present)
    for (const c of model.classes || []) {
      put(c.id, c.name);
      for (const m of [...c.attributes || [], ...c.methods || []])
        put(m.id, `${c.name}.${m.name}`);
    }
  for (const model of present) {
    for (const e of model.relations || []) {
      const [source, target] = edgeEnds(e).map((id) => names.get(id));
      put(
        e.originalId || e.id,
        informativeName(e) || `${source ?? "?"} \u2192 ${target ?? "?"}`
      );
    }
    for (const g of model.generalizations || []) {
      const [specific, general] = edgeEnds(g).map((id) => names.get(id));
      put(
        g.originalId || g.id,
        `${specific ?? "?"} ${g.realization ? "implements" : "inherits"} ${general ?? "?"}`
      );
    }
    for (const p of model.partitions || []) if (p.name) put(p.id, p.name);
  }
  return names;
}
var textOf = (value) => typeof value === "string" ? value : null;
var isForeignKey = (item) => Array.isArray(item?.columns) && typeof item.target === "string";
var isPart = (item) => !!item && typeof item === "object" && !Array.isArray(item) && typeof item.$element !== "string" && (isForeignKey(item) || typeof item.name === "string" && !!item.name);
var referencedColumns = (columns) => {
  const known = knownColumns(columns);
  return known.length ? `(${known.join(", ")})` : "";
};
var foreignKeyText = (key) => `${key.columns.join(", ")} \u2192 ${key.target}${referencedColumns(key.targetColumns)}`;
function partName(item) {
  return isForeignKey(item) ? foreignKeyText(item) : item.name;
}
function describePart(item) {
  if (isForeignKey(item))
    return [
      foreignKeyText(item),
      item.onDelete && `on delete ${String(item.onDelete).toLowerCase()}`,
      item.onUpdate && `on update ${String(item.onUpdate).toLowerCase()}`
    ].filter(Boolean).join(", ");
  const statement = typeof item.definition === "string" ? item.definition : typeof item.sql === "string" ? item.sql : "";
  const plain = Array.isArray(item.columns) && item.columns.length > 0 && item.columns.every((c) => typeof c === "string") && !item.partial && !item.predicate && !item.expressions && !CHECKS.has(item.type);
  if (!plain && statement) return statement;
  const columns = Array.isArray(item.columns) ? `(${item.columns.filter(Boolean).join(", ")})` : "";
  const flags = ["unique", "partial"].filter((flag) => item[flag] === true);
  return [columns, ...flags].filter(Boolean).join(", ") || item.name;
}
var CHECKS = /* @__PURE__ */ new Set(["c", "x", "f", "t"]);
var knownColumns = (columns) => Array.isArray(columns) && columns.some((c) => c != null) ? columns : [];
var comparable = (item) => {
  if (!isForeignKey(item)) return item;
  const { targetColumns, ...rest } = item;
  return { ...rest, targetColumns: knownColumns(targetColumns) };
};
var partKey = (item) => isPart(item) ? isForeignKey(item) ? `key:${JSON.stringify([item.columns, item.target, knownColumns(item.targetColumns)])}` : `name:${item.name}` : JSON.stringify(item);
function itemChanges(note) {
  const before = note.before?.present ? note.before.value : [];
  const after = note.after?.present ? note.after.value : [];
  if (!Array.isArray(before) || !Array.isArray(after)) return null;
  const was = new Map(before.map((item) => [partKey(item), item]));
  const now = new Map(after.map((item) => [partKey(item), item]));
  const out = [];
  for (const [key, item] of now)
    if (!was.has(key)) out.push({ status: "added", after: item });
    else if (JSON.stringify(comparable(was.get(key))) !== JSON.stringify(comparable(item)))
      out.push({ status: "modified", before: was.get(key), after: item });
  for (const [key, item] of was)
    if (!now.has(key)) out.push({ status: "removed", before: item });
  return out;
}
function readable(value, names = /* @__PURE__ */ new Map()) {
  if (typeof value === "string") return names.get(value) ?? value;
  if (value === void 0 || value === null) return "none";
  if (typeof value === "object" && typeof value.$element === "string")
    return names.get(value.$element) || value.$element;
  if (Array.isArray(value))
    return value.length ? value.map((item) => readable(item, names)).join(", ") : "none";
  if (typeof value === "object") {
    if (isPart(value)) return describePart(value);
  }
  const text = JSON.stringify(
    value,
    (key, v) => v && typeof v === "object" && typeof v.$element === "string" ? names.get(v.$element) || v.$element : typeof v === "string" ? names.get(v) ?? v : v
  );
  return text === void 0 ? String(value) : text;
}
var shorten = (text, limit = MAX_VALUE) => text.length > limit ? `${text.slice(0, limit - 1)}\u2026` : text;
var CONTAINER_KEYS = /* @__PURE__ */ new Set(["contents", "properties", "literals"]);
var MEMBER_LISTS = /* @__PURE__ */ new Set([
  "attributes",
  "methods",
  "properties",
  "literals",
  "contents"
]);
var isElementList = (cell) => !cell.present || Array.isArray(cell.value) && cell.value.every(
  (v) => v && typeof v === "object" && typeof v.$element === "string"
);
var isIdentityList = (cell) => !cell.present || Array.isArray(cell.value) && cell.value.every((v) => typeof v === "string");
var meaningfulProperties = (change) => (change?.properties || []).filter(
  (p) => !(isElementList(p.before) && isElementList(p.after)) && !(CONTAINER_KEYS.has(p.key) && isIdentityList(p.before) && isIdentityList(p.after))
);
var listItems = (cell) => cell?.present && Array.isArray(cell.value) ? cell.value.map((v) => typeof v === "string" ? v : v?.$element).filter((v) => typeof v === "string") : [];
function listDelta(p) {
  const before = listItems(p.before), after = listItems(p.after);
  return {
    joined: after.filter((id) => !before.includes(id)),
    left: before.filter((id) => !after.includes(id))
  };
}
function listChanges(change) {
  const cell = (data2, key) => data2 && key in data2 ? { present: true, value: data2[key] } : void 0;
  if (change.kind === "modified")
    return (change.properties || []).filter((p) => MEMBER_LISTS.has(p.key)).map((p) => ({ key: p.key, ...listDelta(p) }));
  const data = change.kind === "added" ? change.after : change.before;
  return [...MEMBER_LISTS].map((key) => ({ key, items: listItems(cell(data, key)) })).filter(({ items }) => items.length).map(({ key, items }) => ({
    key,
    joined: change.kind === "added" ? items : [],
    left: change.kind === "removed" ? items : []
  }));
}
function movesOf(changes) {
  const createdOrDeleted = new Set(
    changes.filter((c) => c.kind !== "modified").map((c) => c.elementId)
  );
  const moves = /* @__PURE__ */ new Map();
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
var memberLabel = (member, method) => method ? `${member.name}()` : member.name;
var PLAIN_KINDS = /* @__PURE__ */ new Set(["dependency", "foreign key"]);
function edgeTag(edge) {
  if ("specificId" in edge) return edge.realization ? "implements" : "inherits";
  if (PLAIN_KINDS.has(edge.stereotype)) return "";
  return edge.stereotype || "";
}
function index(model) {
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  const members = /* @__PURE__ */ new Map();
  for (const c of model.classes) {
    for (const member of c.attributes || [])
      members.set(member.id, { owner: c, member, method: false });
    for (const member of c.methods || [])
      members.set(member.id, { owner: c, member, method: true });
  }
  const edges = /* @__PURE__ */ new Map();
  for (const edge of [...model.relations, ...model.generalizations]) {
    const id = edge.originalId || edge.id;
    if (!edges.has(id) || edge.changeStatus !== "removed") edges.set(id, edge);
  }
  return { classes, members, edges };
}
function drawn(views) {
  if (!views) return null;
  const nodes = /* @__PURE__ */ new Set(), edges = /* @__PURE__ */ new Set();
  for (const view of views)
    for (const diagram of [view.diagram]) {
      for (const node of diagram.nodes || []) nodes.add(node.id);
      for (const edge of diagram.edges || []) edges.add(edge.id);
      for (const group of diagram.generalizationGroups || [])
        for (const id of group.memberIds || []) edges.add(id);
    }
  return { nodes, edges };
}
function memberFromChange(change, names) {
  const data = change.after || change.before || {};
  const type = typeof data.type === "string" ? data.type : void 0;
  const method = typeof type === "string" && (/^[^:]*\(/.test(type) || /:method%3A/.test(change.elementId || ""));
  return {
    name: textOf(data.name) ?? readable(change.name, names),
    type,
    method
  };
}
var modelLevelType = (change) => change.elementId ? null : "model";
function listTokens(note, names, prefix = "") {
  const changes = itemChanges(note);
  if (!changes?.length) return null;
  const order = { modified: 0, added: 1, removed: 2 };
  return changes.sort((a, b) => order[a.status] - order[b.status]).map(({ status, before, after }) => {
    const item = after ?? before;
    const text = isPart(item) ? partName(item) : readable(item, names);
    return {
      status,
      text: shorten(prefix ? `${prefix} ${text}` : text, 60)
    };
  });
}
function rollupChanges(comparison, model, views) {
  if (!comparison?.changes || !model) return null;
  const { classes, members, edges } = index(model);
  const names = nameIndex(model, comparison.baseline?.model);
  const canvas = drawn(views);
  const profile = model.document?.profile;
  const changes = comparison.changes.changes || [];
  const recorded = new Map(
    changes.filter((c) => c.elementId).map((c) => [c.elementId, c])
  );
  const moves = movesOf(changes);
  const rows = /* @__PURE__ */ new Map();
  const row = (key, make) => {
    if (!rows.has(key)) rows.set(key, { key, changes: [], ...make() });
    return rows.get(key);
  };
  const nodeRow = (c, status) => row(`node:${c.id}`, () => ({
    status: status || c.changeStatus || "modified",
    kind: "node",
    target: !canvas || canvas.nodes.has(c.id) ? { kind: "node", id: c.id } : null,
    id: c.id,
    name: c.name,
    tag: c.stereotype || c.kind || "",
    members: [],
    notes: []
  }));
  const edgeRow = (edge, status) => {
    const [source, target] = edgeEnds(edge).map((id) => classes.get(id));
    return row(`edge:${edge.originalId || edge.id}`, () => ({
      status: status || edge.changeStatus || "modified",
      kind: "edge",
      target: !canvas || canvas.edges.has(edge.id) ? { kind: "edge", id: edge.id } : null,
      id: edge.originalId || edge.id,
      name: `${source?.name ?? "?"} \u2192 ${target?.name ?? "?"}`,
      sourceName: source?.name,
      targetName: target?.name,
      tag: edgeTag(edge),
      label: informativeName(edge),
      // A type-use dependency says which of the source's members use the target.
      via: edge.stereotype === "dependency" && !informativeName(edge) ? dependencyMembers(source, target).map(
        ({ member, method }) => memberLabel(member, method)
      ) : [],
      members: [],
      notes: []
    }));
  };
  const modelRow = () => row("model", () => ({
    status: "model",
    kind: "model",
    target: null,
    id: model.id,
    name: "Model",
    tag: "",
    members: [],
    notes: []
  }));
  const note = (p, key = p.key) => ({
    key,
    property: p.key,
    before: p.before,
    after: p.after
  });
  const scoped = (cell) => !cell.present || Array.isArray(cell.value) && cell.value.every((item) => Array.isArray(item) && classes.has(item[0]));
  const fromModel = (p) => !(profile === "database" && p.key === "constraints" && scoped(p.before) && scoped(p.after));
  const memberIn = (classId, id) => {
    const c = classes.get(classId);
    const attribute = (c?.attributes || []).find((m) => m.id === id);
    if (attribute) return { member: attribute, method: false };
    const method = (c?.methods || []).find((m) => m.id === id);
    return method ? { member: method, method: true } : null;
  };
  const currentOwner = (id) => model.classes.find(
    (c) => [...c.attributes || [], ...c.methods || []].some(
      (m) => m.id === id && m.changeStatus !== "removed"
    )
  )?.id;
  const placeName = (id) => names.get(id) ?? textOf(recorded.get(id)?.after?.name) ?? textOf(recorded.get(id)?.before?.name) ?? id;
  const movedMember = (classId, id, status, other) => {
    const found = memberIn(classId, id);
    const member = found ? {
      name: found.member.name,
      type: found.member.type,
      method: found.method
    } : recorded.has(id) ? memberFromChange(recorded.get(id), names) : { name: names.get(id) ?? id, method: false };
    return {
      id,
      status,
      label: memberLabel(member, member.method),
      member,
      ...other ? { moved: { [status === "added" ? "from" : "to"]: placeName(other) } } : {}
    };
  };
  for (const change of changes) {
    const id = change.elementId;
    const properties = meaningfulProperties(change);
    if (modelLevelType(change)) {
      const notes = properties.filter(fromModel).map((p) => note(p));
      if (!notes.length) continue;
      const entry2 = modelRow();
      entry2.changes.push(change);
      entry2.notes.push(...notes);
      continue;
    }
    if (classes.has(id)) {
      const entry2 = nodeRow(classes.get(id), change.kind);
      entry2.status = change.kind;
      entry2.changes.push(change);
      for (const p of properties) entry2.notes.push(note(p));
      for (const { joined, left } of listChanges(change)) {
        for (const item of joined)
          if (moves.has(item))
            entry2.members.push(
              movedMember(id, item, "added", moves.get(item).from)
            );
        for (const item of left)
          if (moves.has(item))
            entry2.members.push(
              movedMember(
                id,
                item,
                "removed",
                moves.get(item).to ?? currentOwner(item)
              )
            );
      }
      continue;
    }
    if (edges.has(id)) {
      const entry2 = edgeRow(edges.get(id), change.kind);
      entry2.status = change.kind;
      entry2.changes.push(change);
      for (const p of properties) entry2.notes.push(note(p));
      continue;
    }
    if (moves.has(id)) {
      const to = moves.get(id).to ?? currentOwner(id);
      if (to && classes.has(to))
        nodeRow(classes.get(to), "modified").changes.push(change);
      continue;
    }
    const known = members.get(id);
    const owner = known ? known.owner.id : change.ownerId;
    if (owner && classes.has(owner)) {
      const entry2 = nodeRow(classes.get(owner), "modified");
      entry2.changes.push(change);
      const member = known ? {
        name: known.member.name,
        type: known.member.type,
        method: known.method
      } : memberFromChange(change, names);
      entry2.members.push({
        id,
        status: change.kind,
        label: memberLabel(member, member.method),
        member
      });
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
      tag: type === "GeneralizationSet" ? "generalization set" : typeof type === "string" ? type.toLowerCase() : "element",
      members: [],
      notes: []
    }));
    entry.changes.push(change);
    for (const p of properties) entry.notes.push(note(p));
  }
  const all = [...rows.values()];
  for (const entry of all) {
    if (entry.kind === "node" && entry.status === "modified") {
      const c = classes.get(entry.id);
      const order = [...c?.attributes || [], ...c?.methods || []].map(
        (m) => m.id
      );
      const at = (id) => {
        const i = order.indexOf(id);
        return i < 0 ? order.length : i;
      };
      entry.members.sort((x, y) => at(x.id) - at(y.id));
    }
    if (entry.kind === "node" && entry.status !== "modified") {
      const c = classes.get(entry.id);
      entry.members = [
        ...(c?.attributes || []).map((m) => ({ member: m, method: false })),
        ...(c?.methods || []).map((m) => ({ member: m, method: true }))
      ].map(({ member, method }) => {
        const move = moves.get(member.id);
        const other = entry.status === "added" ? move?.from : move?.to ?? (move ? currentOwner(member.id) : void 0);
        return {
          id: member.id,
          status: entry.status,
          label: memberLabel(member, method),
          member: { name: member.name, type: member.type, method },
          ...other ? {
            moved: {
              [entry.status === "added" ? "from" : "to"]: placeName(other)
            }
          } : {}
        };
      });
    }
    entry.summary = summarize(entry, names);
  }
  const byName = (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const groups = CHANGE_STATUSES.map((status) => {
    const of = (kind) => all.filter((r) => r.status === status && r.kind === kind).sort(byName);
    return {
      status,
      label: CHANGE_LABELS[status],
      elements: [...of("node"), ...of("other")],
      relations: of("edge")
    };
  });
  groups.push({
    status: "model",
    label: "Model",
    elements: all.filter((r) => r.kind === "model"),
    relations: []
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
    names
  };
}
var rollups = /* @__PURE__ */ new WeakMap();
function cachedRollup(comparison, model, views) {
  const cached = rollups.get(comparison);
  if (cached && cached.model === model && cached.views === views)
    return cached.rollup;
  const rollup = rollupChanges(comparison, model, views);
  rollups.set(comparison, { model, views, rollup });
  return rollup;
}
function changeCount(payload) {
  const comparison = payload?.comparison;
  if (!comparison?.changes) return null;
  const view = comparison.changeView || payload;
  return cachedRollup(comparison, view.model, view.views)?.count ?? 0;
}
var SINGULAR = {
  foreignKeys: "foreign key",
  keys: "key",
  indexes: "index",
  constraints: "constraint",
  triggers: "trigger",
  modifiers: "modifier"
};
function noteTokens(n, names, lists = true) {
  if (lists && n.property !== "moved") {
    const tokens = listTokens(n, names, SINGULAR[n.property] ?? n.property);
    if (tokens?.length) return tokens;
  }
  const before = cellText(n.before, names, n.property), after = cellText(n.after, names, n.property);
  if (before.length > MAX_INLINE || after.length > MAX_INLINE || /\n/.test(before + after))
    return [{ status: "modified", text: `${n.key} changed` }];
  return [{ status: "modified", text: `${n.key}: ${before} \u2192 ${after}` }];
}
function summarize(entry, names) {
  const note = entry.target || !["node", "edge"].includes(entry.kind) ? null : "Not drawn in any view";
  if (entry.kind === "edge") {
    const notes = entry.notes.flatMap(
      (n) => noteTokens(n, names, false).map((t) => t.text)
    );
    const via = entry.via.length ? `via ${entry.via.slice(0, MAX_TOKENS - 1).join(", ")}` : "";
    return {
      text: [entry.label || via, ...notes].filter(Boolean).join(" \xB7 "),
      tokens: [],
      more: Math.max(0, entry.via.length - (MAX_TOKENS - 1)),
      note
    };
  }
  if (entry.kind === "model") {
    const tokens = entry.notes.flatMap(
      (n) => n.property === "presence" ? [{ status: n.status, text: n.key }] : n.property === "constraints" && listTokens(n, names) || noteTokens(n, names)
    );
    return {
      text: "",
      tokens: tokens.slice(0, MAX_TOKENS),
      more: Math.max(0, tokens.length - MAX_TOKENS),
      note
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
      note
    };
  }
  const own = members.filter((m) => !m.moved);
  return {
    text: own.slice(0, MAX_TOKENS - 1).map((m) => m.label).join(", "),
    tokens: [],
    more: Math.max(0, own.length - (MAX_TOKENS - 1)),
    note
  };
}
var TEXT_KEYS = /* @__PURE__ */ new Set(["name", "description", "documentation", "moved"]);
var cellText = (cell, names, key) => cell?.present ? readable(cell.value, TEXT_KEYS.has(key) ? void 0 : names) : "none";
function rowFor(rollup, target, model) {
  if (!rollup || !target) return null;
  if (target.kind === "node")
    return rollup.rows.find((r) => r.kind === "node" && r.id === target.id);
  const edge = [...model?.relations || [], ...model?.generalizations || []].filter(Boolean).find((e) => e.id === target.id);
  const id = edge?.originalId || target.id;
  return rollup.rows.find((r) => r.kind === "edge" && r.id === id) || null;
}
function dependencyMembers(source, target) {
  if (!source || !target?.name) return [];
  const pattern = new RegExp(
    `(^|[^\\w$])${target.name.replace(/[$.*+?^(){}[\]|\\]/g, "\\$&")}([^\\w$]|$)`
  );
  return [
    ...(source.attributes || []).map((m) => ({ member: m, method: false })),
    ...(source.methods || []).map((m) => ({ member: m, method: true }))
  ].filter(
    ({ member }) => typeof member.type === "string" && pattern.test(member.type)
  );
}

// src/canvas/UMLRelation.jsx
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function relationName(edge) {
  if (edge.type === "generalization")
    return `${edge.sourceName} ${edge.realization ? "implements" : "inherits"} ${edge.targetName}`;
  const own = informativeName(edge);
  if (!own && edge.stereotype === "dependency")
    return `${edge.sourceName} uses ${edge.targetName}`;
  const end = (name, count) => knownMultiplicity(count) ? `${name} (${count})` : name;
  return `${own || edge.stereotype || "Association"}: ${end(edge.sourceName, edge.sourceMultiplicity)}, ${end(edge.targetName, edge.targetMultiplicity)}`;
}
var MARK_GAP = 9;
var MARK_END = 18;
var MARK_PLACES = [0.5, 0.35, 0.65, 0.2, 0.8];
function changeMarkPoint(paths, labels = []) {
  const segments = [];
  for (const d of paths) {
    const n = (d.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    for (let i = 2; i + 1 < n.length; i += 2)
      segments.push({
        from: [n[i - 2], n[i - 1]],
        to: [n[i], n[i + 1]],
        length: Math.abs(n[i] - n[i - 2]) + Math.abs(n[i + 1] - n[i - 1])
      });
  }
  const free = ({ x, y }) => !labels.some(
    (l) => x > l.x - MARK_GAP && x < l.x + l.width + MARK_GAP && y > l.y - MARK_GAP && y < l.y + l.height + MARK_GAP
  );
  for (const { from, to, length } of segments.sort(
    (a, b) => b.length - a.length
  ))
    for (const place of MARK_PLACES) {
      if (Math.min(place, 1 - place) * length < MARK_END) continue;
      const point = {
        x: from[0] + (to[0] - from[0]) * place,
        y: from[1] + (to[1] - from[1]) * place
      };
      if (free(point)) return point;
    }
  return null;
}
function ChangeMarkGlyph({ change, at }) {
  return /* @__PURE__ */ jsxs2(
    "g",
    {
      className: "edge-change-mark",
      transform: `translate(${at.x} ${at.y})`,
      "aria-hidden": "true",
      children: [
        /* @__PURE__ */ jsx2("circle", { r: "7.5", fill: CHANGE_COLORS[change] }),
        /* @__PURE__ */ jsx2(
          "text",
          {
            y: "4.5",
            textAnchor: "middle",
            fill: "var(--canvas,#ffffff)",
            fontSize: "13",
            fontWeight: "700",
            children: changeGlyph(change)
          }
        )
      ]
    }
  );
}
function UMLRelation({
  edge,
  focus,
  selected,
  handlers,
  markerId,
  kind = "edge",
  accessibleName
}) {
  const target = { kind, id: edge.id };
  const highlighted = focus?.[kind === "group" ? "groups" : "edges"]?.has(
    edge.id
  );
  const change = isChanged(edge.changeStatus) ? edge.changeStatus : null;
  const markerState = change ? `-${change}` : sameTarget(target, focus?.primary) ? "-primary" : highlighted ? "-active" : "";
  const aggregationMarker = (kind2) => ["SHARED", "COMPOSITE"].includes(kind2) ? `url(#${markerId}-${kind2}${markerState})` : void 0;
  const name = accessibleName || `${relationName(edge)}${change ? `, ${change === "added" ? "new" : change === "removed" ? "removed" : "changed"}` : ""}`;
  const routes = edge.branchPaths || edge.paths;
  const mark = change ? changeMarkPoint(routes, edge.labels) : null;
  return /* @__PURE__ */ jsxs2(
    "g",
    {
      className: `${elementClass(kind, edge.id, focus, selected)} relation-route${edge.type === "generalization" ? " generalization" : ""}${change ? " changed" : ""}`,
      "data-edge": edge.id,
      "data-element-kind": kind,
      "data-element-id": edge.id,
      "data-source": edge.source,
      "data-target": edge.target,
      "data-change": edge.changeStatus,
      "aria-label": name,
      "aria-pressed": handlers ? sameTarget(target, selected) : void 0,
      ...interactionProps(target, handlers),
      children: [
        /* @__PURE__ */ jsx2("title", { children: name }),
        routes.map((d, i) => /* @__PURE__ */ jsxs2("g", { children: [
          change && /* @__PURE__ */ jsx2(
            "path",
            {
              className: "edge-halo",
              d,
              fill: "none",
              stroke: "transparent",
              strokeWidth: "7",
              strokeLinecap: "round",
              strokeLinejoin: "round"
            }
          ),
          /* @__PURE__ */ jsx2(
            "path",
            {
              className: "edge-path",
              d,
              fill: "none",
              stroke: change ? CHANGE_COLORS[change] : edge.type === "generalization" ? "var(--diagram-inheritance,#59636e)" : "var(--diagram-edge,#59636e)",
              strokeWidth: change ? "2" : "1.4",
              strokeDasharray: change === "removed" ? "2 4" : edge.realization || edge.stereotype === "dependency" ? "6 4" : void 0,
              markerStart: edge.type === "association" ? aggregationMarker(edge.sourceAggregation) : void 0,
              markerEnd: edge.type === "generalization" && !edge.branchPaths ? `url(#${markerId}${markerState})` : edge.stereotype === "dependency" || edge.navigable ? `url(#${markerId}-DEPENDENCY${markerState})` : aggregationMarker(edge.targetAggregation)
            }
          ),
          handlers && /* @__PURE__ */ jsx2(
            "path",
            {
              className: "edge-hit",
              d,
              fill: "none",
              stroke: "transparent",
              strokeWidth: "10",
              vectorEffect: "non-scaling-stroke",
              pointerEvents: "stroke"
            }
          )
        ] }, i)),
        mark && /* @__PURE__ */ jsx2(ChangeMarkGlyph, { change, at: mark })
      ]
    }
  );
}
function MultiplicityLabel({ label }) {
  return /* @__PURE__ */ jsxs2(
    "g",
    {
      className: "multiplicity",
      "data-end": label.kind,
      "data-node-id": label.nodeId,
      children: [
        /* @__PURE__ */ jsx2(
          "rect",
          {
            width: label.width,
            height: label.height,
            rx: "4",
            fill: "var(--canvas,#ffffff)",
            stroke: "var(--diagram-border,#818b98)",
            strokeWidth: "0.9"
          }
        ),
        /* @__PURE__ */ jsx2(
          "text",
          {
            x: label.width / 2,
            y: label.height / 2 + 4.5,
            textAnchor: "middle",
            fill: "var(--text,#1f2328)",
            fontSize: "13.5",
            fontWeight: "650",
            children: label.text
          }
        )
      ]
    }
  );
}
function UMLRelationLabels({
  edge,
  focus,
  selected,
  handlers,
  kind = "edge"
}) {
  const target = { kind, id: edge.id };
  if (!edge.labels.length) return null;
  return /* @__PURE__ */ jsx2(
    "g",
    {
      className: `${elementClass(kind, edge.id, focus, selected)} relation-labels`,
      "data-edge": edge.id,
      "data-element-kind": kind,
      "data-element-id": edge.id,
      "data-change": edge.changeStatus,
      "aria-hidden": "true",
      ...interactionProps(target, handlers, false),
      children: edge.labels.map((label) => /* @__PURE__ */ jsx2(
        "g",
        {
          className: "edge-label",
          transform: `translate(${label.x} ${label.y})`,
          children: label.kind !== "name" ? /* @__PURE__ */ jsx2(MultiplicityLabel, { label }) : /* @__PURE__ */ jsxs2(Fragment2, { children: [
            /* @__PURE__ */ jsx2(
              "rect",
              {
                width: label.width,
                height: label.height,
                rx: "3",
                fill: "var(--canvas,#ffffff)"
              }
            ),
            /* @__PURE__ */ jsx2(
              "text",
              {
                x: label.width / 2,
                textAnchor: "middle",
                fill: "var(--diagram-label,#1f2328)",
                fontSize: "13",
                children: label.text.split("\n").map((line, i) => /* @__PURE__ */ jsx2("tspan", { x: label.width / 2, y: 17 + i * 17, children: line }, i))
              }
            )
          ] })
        },
        label.id
      ))
    }
  );
}

// src/canvas/UMLGeneralizationGroup.jsx
import { jsx as jsx3 } from "react/jsx-runtime";
function generalizationGroupName(group) {
  const constraints = group.type === "generalizationSet" ? `; ${group.complete ? "complete" : "incomplete"}, ${group.disjoint ? "disjoint" : "overlapping"}` : "";
  return `${group.name}: ${group.sourceNames.join(", ")} ${group.realization ? "implement" : "inherit"} ${group.targetName}${constraints}`;
}
function UMLGeneralizationGroup({ group, labels = false, ...props }) {
  const edge = { ...group, type: "generalization" };
  return labels ? /* @__PURE__ */ jsx3(UMLRelationLabels, { ...props, edge, kind: "group" }) : /* @__PURE__ */ jsx3(
    UMLRelation,
    {
      ...props,
      edge,
      kind: "group",
      accessibleName: generalizationGroupName(group)
    }
  );
}

// src/canvas/highlight.js
var keyFor = (target) => target && `${target.kind}:${target.id}`;
var focusKeys = (focus) => new Set(
  focus ? [
    ...[...focus.nodes].map((id) => `node:${id}`),
    ...[...focus.edges].map((id) => `edge:${id}`),
    ...[...focus.groups].map((id) => `group:${id}`)
  ] : []
);
function createHighlightController(svg, diagram) {
  const records = /* @__PURE__ */ new Map();
  let previousKeys = /* @__PURE__ */ new Set();
  let previousPrimary = null;
  let previousSelection = /* @__PURE__ */ new Set();
  for (const element of svg.querySelectorAll("[data-element-kind]")) {
    const key = keyFor({
      kind: element.dataset.elementKind,
      id: element.dataset.elementId
    });
    if (!records.has(key)) records.set(key, []);
    element.classList.remove("dimmed");
    const markers = [];
    const paths = element.classList.contains("changed") ? [] : element.querySelectorAll(".edge-path");
    for (const path of paths) {
      for (const name of ["marker-start", "marker-end"]) {
        const value = path.getAttribute(name);
        if (value)
          markers.push({
            path,
            name,
            value: value.replace(/-(active|primary)\)$/, ")")
          });
      }
    }
    records.get(key).push({
      element,
      markers,
      highlighted: element.classList.contains("highlighted"),
      primary: element.classList.contains("primary"),
      selected: element.classList.contains("selected"),
      accessible: element.getAttribute("role") === "button"
    });
    if (element.classList.contains("highlighted")) previousKeys.add(key);
    if (element.classList.contains("primary")) previousPrimary = key;
    if (element.classList.contains("selected")) previousSelection.add(key);
  }
  let previousActive = null;
  let previousSelected = null;
  let initialized = false;
  return {
    update(active, selected) {
      if (initialized && sameTarget(active, previousActive) && sameTarget(selected, previousSelected))
        return;
      const focus = focusedElements(diagram, active);
      const nextKeys = focusKeys(focus);
      const primary = keyFor(focus?.primary);
      const selectedKey = keyFor(selected);
      svg.classList.toggle("has-focus", !!focus);
      const changed = /* @__PURE__ */ new Set([
        ...previousKeys,
        ...nextKeys,
        previousPrimary,
        primary,
        ...previousSelection,
        selectedKey
      ]);
      for (const key of changed) {
        for (const record of records.get(key) || []) {
          const updateMarkers = record.highlighted !== nextKeys.has(key) || record.primary !== (key === primary);
          for (const [name, enabled] of [
            ["highlighted", nextKeys.has(key)],
            ["primary", key === primary],
            ["selected", key === selectedKey]
          ]) {
            if (record[name] === enabled) continue;
            record[name] = enabled;
            record.element.classList.toggle(name, enabled);
            if (name === "selected" && record.accessible)
              record.element.setAttribute("aria-pressed", String(enabled));
          }
          if (updateMarkers) {
            const state = record.primary ? "-primary" : record.highlighted ? "-active" : "";
            for (const { path, name: attribute, value } of record.markers)
              path.setAttribute(attribute, value.replace(/\)$/, `${state})`));
          }
        }
      }
      previousKeys = nextKeys;
      previousPrimary = primary;
      previousActive = active;
      previousSelected = selected;
      previousSelection = new Set(selectedKey ? [selectedKey] : []);
      initialized = true;
    }
  };
}

// src/canvas/UMLDiagram.jsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
var markerStates = ["", "-active", "-primary"];
var changeStates = Object.keys(CHANGE_COLORS).map((change) => `-${change}`);
var markerColor = (state, normal) => state === "-primary" ? "var(--diagram-selection,#9a6700)" : state === "-active" ? "var(--accent,#0969da)" : CHANGE_COLORS[state.slice(1)] || normal;
function UMLPackages({ packages }) {
  if (!packages?.length) return null;
  return /* @__PURE__ */ jsx4("g", { className: "package-layer", "aria-hidden": "true", children: packages.map((p) => /* @__PURE__ */ jsxs3("g", { transform: `translate(${p.x} ${p.y})`, children: [
    /* @__PURE__ */ jsx4(
      "rect",
      {
        width: p.width,
        height: p.height,
        rx: "10",
        fill: "var(--diagram-package,rgba(130,140,155,0.07))",
        stroke: "var(--diagram-package-border,rgba(130,140,155,0.3))",
        vectorEffect: "non-scaling-stroke"
      }
    ),
    /* @__PURE__ */ jsx4(
      "text",
      {
        x: "14",
        y: "21",
        fill: "var(--diagram-muted,#59636e)",
        fontSize: "12.5",
        fontWeight: "600",
        children: p.name
      }
    )
  ] }, p.name)) });
}
var UMLDiagram = memo(function UMLDiagram2({
  diagram,
  active = null,
  selected = null,
  handlers,
  backgroundURL
}) {
  const markerId = `inheritance-${useId().replaceAll(":", "")}`;
  const states = useMemo(
    () => diagram.edges.some((edge) => isChanged(edge.changeStatus)) ? [...markerStates, ...changeStates] : markerStates,
    [diagram]
  );
  const svgRef = useRef(null);
  const highlight = useRef(null);
  const latestHandlers = useRef(handlers);
  const interactive = !!handlers;
  const [loadedBackground, setLoadedBackground] = useState(null);
  const bitmap = interactive && !!backgroundURL && loadedBackground === backgroundURL;
  const focus = useMemo(
    () => focusedElements(diagram, active),
    [diagram, active]
  );
  const stableHandlers = useMemo(
    () => interactive ? {
      onHover: (...args) => latestHandlers.current.onHover(...args),
      onFocus: (...args) => latestHandlers.current.onFocus(...args),
      onActivate: (...args) => latestHandlers.current.onActivate(...args)
    } : void 0,
    [interactive]
  );
  useLayoutEffect(() => {
    latestHandlers.current = handlers;
  }, [handlers]);
  const initial = useMemo(
    () => ({
      active: interactive ? null : active,
      selected,
      focus: interactive ? null : focusedElements(diagram, active)
    }),
    [diagram, interactive]
  );
  useLayoutEffect(() => {
    highlight.current = createHighlightController(svgRef.current, diagram);
    return () => {
      highlight.current = null;
    };
  }, [diagram, initial, bitmap]);
  useLayoutEffect(() => {
    highlight.current.update(interactive ? null : active, selected);
  }, [diagram, active, selected, initial, interactive, bitmap]);
  const geometry = useMemo(() => {
    const { focus: focus2, selected: selected2 } = initial;
    const handlers2 = stableHandlers;
    return /* @__PURE__ */ jsxs3(
      "svg",
      {
        ref: svgRef,
        className: interactive ? bitmap ? "diagram-hit-layer" : "diagram-base" : focus2 ? "has-focus" : void 0,
        xmlns: "http://www.w3.org/2000/svg",
        width: diagram.width,
        height: diagram.height,
        viewBox: `0 0 ${diagram.width} ${diagram.height}`,
        role: handlers2 ? "group" : "img",
        "aria-label": diagram.title,
        textRendering: "geometricPrecision",
        style: {
          fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif"
        },
        children: [
          /* @__PURE__ */ jsxs3("defs", { children: [
            states.map((state) => /* @__PURE__ */ jsx4(
              "marker",
              {
                id: `${markerId}-DEPENDENCY${state}`,
                markerWidth: "12",
                markerHeight: "12",
                refX: "10",
                refY: "6",
                orient: "auto",
                markerUnits: "userSpaceOnUse",
                children: /* @__PURE__ */ jsx4(
                  "path",
                  {
                    d: "M1 1 L10 6 L1 11",
                    fill: "none",
                    stroke: markerColor(state, "var(--diagram-edge,#59636e)"),
                    strokeWidth: "1.4"
                  }
                )
              },
              `dependency${state}`
            )),
            ["SHARED", "COMPOSITE"].flatMap(
              (aggregation) => states.map((state) => /* @__PURE__ */ jsx4(
                "marker",
                {
                  id: `${markerId}-${aggregation}${state}`,
                  markerWidth: "15",
                  markerHeight: "12",
                  refX: "1",
                  refY: "6",
                  orient: "auto-start-reverse",
                  markerUnits: "userSpaceOnUse",
                  children: /* @__PURE__ */ jsx4(
                    "path",
                    {
                      d: "M1 6 L7 1 L13 6 L7 11 Z",
                      fill: aggregation === "COMPOSITE" ? markerColor(state, "var(--diagram-edge,#59636e)") : "var(--canvas,#ffffff)",
                      stroke: markerColor(state, "var(--diagram-edge,#59636e)"),
                      strokeWidth: "1.4"
                    }
                  )
                },
                `${aggregation}${state}`
              ))
            ),
            states.map((state) => /* @__PURE__ */ jsx4(
              "marker",
              {
                id: `${markerId}${state}`,
                markerWidth: "13",
                markerHeight: "12",
                refX: "11",
                refY: "6",
                orient: "auto",
                markerUnits: "userSpaceOnUse",
                children: /* @__PURE__ */ jsx4(
                  "path",
                  {
                    d: "M1 1 L11 6 L1 11 Z",
                    fill: "var(--canvas,#ffffff)",
                    stroke: markerColor(
                      state,
                      "var(--diagram-inheritance,#59636e)"
                    ),
                    strokeWidth: "1.4"
                  }
                )
              },
              state
            ))
          ] }),
          /* @__PURE__ */ jsx4(UMLPackages, { packages: diagram.packages }),
          /* @__PURE__ */ jsxs3("g", { className: "relation-routes", children: [
            (diagram.generalizationGroups || []).map((group) => /* @__PURE__ */ jsx4(
              UMLGeneralizationGroup,
              {
                ...{ group, focus: focus2, selected: selected2, handlers: handlers2, markerId }
              },
              group.id
            )),
            diagram.edges.map((edge) => /* @__PURE__ */ jsx4(
              UMLRelation,
              {
                ...{ edge, focus: focus2, selected: selected2, handlers: handlers2, markerId }
              },
              edge.id
            ))
          ] }),
          /* @__PURE__ */ jsxs3("g", { className: "relation-label-layer", children: [
            (diagram.generalizationGroups || []).map((group) => /* @__PURE__ */ jsx4(
              UMLGeneralizationGroup,
              {
                labels: true,
                ...{ group, focus: focus2, selected: selected2, handlers: handlers2 }
              },
              group.id
            )),
            diagram.edges.map((edge) => /* @__PURE__ */ jsx4(
              UMLRelationLabels,
              {
                ...{ edge, focus: focus2, selected: selected2, handlers: handlers2 }
              },
              edge.id
            ))
          ] }),
          /* @__PURE__ */ jsx4("g", { className: "node-layer", children: diagram.nodes.map((node) => /* @__PURE__ */ jsx4(UMLNode, { ...{ node, focus: focus2, selected: selected2, handlers: handlers2 } }, node.id)) })
        ]
      }
    );
  }, [diagram, initial, stableHandlers, markerId, interactive, bitmap, states]);
  const overlay = useMemo(() => {
    if (!interactive || !focus) return null;
    const index2 = interactionIndex(diagram);
    const groups = [...focus.groups].map((id) => index2.groups.get(id));
    const edges = [...focus.edges].map((id) => index2.edges.get(id));
    const nodes = [...focus.nodes].map((id) => index2.nodes.get(id)).filter(Boolean);
    return /* @__PURE__ */ jsxs3(
      "svg",
      {
        className: "diagram-overlay",
        width: diagram.width,
        height: diagram.height,
        viewBox: `0 0 ${diagram.width} ${diagram.height}`,
        "aria-hidden": "true",
        textRendering: "geometricPrecision",
        style: {
          fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif"
        },
        children: [
          /* @__PURE__ */ jsxs3("g", { className: "relation-routes", children: [
            groups.map((group) => /* @__PURE__ */ jsx4(
              UMLGeneralizationGroup,
              {
                ...{ group, focus, selected, markerId }
              },
              group.id
            )),
            edges.map((edge) => /* @__PURE__ */ jsx4(
              UMLRelation,
              {
                ...{ edge, focus, selected, markerId }
              },
              edge.id
            ))
          ] }),
          /* @__PURE__ */ jsxs3("g", { className: "relation-label-layer", children: [
            groups.map((group) => /* @__PURE__ */ jsx4(
              UMLGeneralizationGroup,
              {
                labels: true,
                ...{ group, focus, selected }
              },
              group.id
            )),
            edges.map((edge) => /* @__PURE__ */ jsx4(UMLRelationLabels, { ...{ edge, focus, selected } }, edge.id))
          ] }),
          /* @__PURE__ */ jsx4("g", { className: "node-layer", children: nodes.map((node) => /* @__PURE__ */ jsx4(
            UMLNode,
            {
              idPrefix: `overlay-${markerId}-`,
              ...{ node, focus, selected }
            },
            node.id
          )) })
        ]
      },
      `${focus.primary.kind}:${focus.primary.id}`
    );
  }, [diagram, focus, selected, markerId, interactive]);
  if (!interactive) return geometry;
  return /* @__PURE__ */ jsxs3(
    "div",
    {
      className: `uml-diagram${focus ? " has-focus" : ""}`,
      style: { width: diagram.width, height: diagram.height },
      children: [
        interactive && backgroundURL && // eslint-disable-next-line envui/no-raw-graphics -- the diagram's own bitmap backdrop, at the diagram's pixel size under its SVG geometry, not a picture at one of envUI's sizes
        /* @__PURE__ */ jsx4(
          "img",
          {
            className: `diagram-background${bitmap ? " ready" : ""}`,
            src: backgroundURL,
            width: diagram.width,
            height: diagram.height,
            alt: "",
            draggable: false,
            onLoad: () => setLoadedBackground(backgroundURL)
          }
        ),
        geometry,
        overlay
      ]
    }
  );
});

// src/canvas/useDiagramCamera.js
import { useLayoutEffect as useLayoutEffect2, useMemo as useMemo2, useRef as useRef2 } from "react";

// src/canvas/camera.js
var WHEEL_ZOOM_SENSITIVITY = 15e-4;
var PINCH_GESTURE_SENSITIVITY = 0.15;
var PAN_EASING_MS = 50;
var DRAG_EASING_MS = 28;
var ZOOM_EASING_MS = 90;
var clampScale = (scale) => Math.max(0.08, Math.min(3.5, scale));
var MAX_FIT_SCALE = 1.5;
var FIT_PADDING = 24;
var NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
var GRID_OVERHANG = 64;
var GRID_LEVELS = 8;
function createCamera({
  canvasRef,
  worldRef,
  onZoom,
  onTap,
  onMotion,
  insets = () => NO_INSETS,
  // A press on an element drags it, when this says it may: `start(target,
  // point)` returns whether it takes the press; `move(point)` follows the
  // pointer and `end(moved)` lets go. Points are in diagram coordinates.
  elementDrag = null
}) {
  let camera = { x: 0, y: 0, scale: 1, fitted: true };
  let destination = { ...camera };
  let activeKey = null;
  let motionFrame = null;
  let motionTime = 0;
  let easing = PAN_EASING_MS;
  let reducedMotion = false;
  let grid = null;
  let gridLevel = null;
  let zoomReadout = null;
  let drag = null;
  let moved = false;
  let initialFocus = [];
  const cameras = /* @__PURE__ */ new Map();
  const pointers = /* @__PURE__ */ new Map();
  function cancelMotion() {
    if (motionFrame !== null) cancelAnimationFrame(motionFrame);
    motionFrame = null;
    destination = { ...camera };
  }
  function paint() {
    worldRef.current.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    if (grid) {
      const level = 2 ** (Math.floor(Math.log2(camera.scale) * GRID_LEVELS) / GRID_LEVELS);
      const step = 20 * 2 ** Math.ceil(Math.log2(16 / (20 * level)));
      const raster = step * level;
      const spacing = step * camera.scale;
      const phase = (n) => (n % spacing + spacing) % spacing;
      if (gridLevel !== level) {
        gridLevel = level;
        const fine = Math.max(0, Math.min(1, raster / 16 - 1));
        grid.style.backgroundImage = [fine, 1 - fine].map(
          (opacity) => `radial-gradient(color-mix(in srgb,var(--grid) ${opacity * 100}%,transparent) 0.7px,transparent 0.7px)`
        ).join(",");
        grid.style.backgroundSize = `${raster / 2}px ${raster / 2}px,${raster}px ${raster}px`;
        grid.style.backgroundPosition = `${GRID_OVERHANG - raster / 4}px ${GRID_OVERHANG - raster / 4}px,${GRID_OVERHANG - raster / 2}px ${GRID_OVERHANG - raster / 2}px`;
      }
      grid.style.transform = `translate3d(${phase(camera.x)}px,${phase(camera.y)}px,0) scale(${camera.scale / level})`;
    }
    const value = Math.round(camera.scale * 100);
    if (value !== zoomReadout) {
      zoomReadout = value;
      onZoom(value);
    }
  }
  function snapTo(next) {
    cancelMotion();
    camera = { ...next };
    destination = { ...next };
    paint();
  }
  function animateMotion(time) {
    const elapsed = Math.max(0, Math.min(time - motionTime, 64));
    motionTime = time;
    const scaleGap = Math.log(destination.scale / camera.scale);
    const dx = destination.x - camera.x;
    const dy = destination.y - camera.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 0.05 && Math.abs(scaleGap) < 1e-4) {
      motionFrame = null;
      camera = { ...destination };
      paint();
      return;
    }
    const amount = 1 - Math.exp(-elapsed / easing);
    const scale = camera.scale * Math.exp(scaleGap * amount);
    const progress = Math.abs(destination.scale - camera.scale) > 1e-10 ? (scale - camera.scale) / (destination.scale - camera.scale) : amount;
    camera = {
      x: camera.x + dx * progress,
      y: camera.y + dy * progress,
      scale,
      fitted: false
    };
    paint();
    motionFrame = requestAnimationFrame(animateMotion);
  }
  function moveTo(next, duration) {
    if (reducedMotion) {
      snapTo(next);
      return;
    }
    destination = { ...next };
    easing = duration;
    camera.fitted = false;
    if (motionFrame === null) {
      motionTime = performance.now();
      motionFrame = requestAnimationFrame(animateMotion);
    }
  }
  function readInsets() {
    return { ...NO_INSETS, ...insets(canvasRef.current) || {} };
  }
  function visibleArea(i = readInsets(), { fullWidth = false } = {}) {
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const rightInset = fullWidth ? 0 : i.right;
    const left = i.left + rightInset < w * 0.6 ? i.left : 0;
    const right = i.left + rightInset < w * 0.6 ? rightInset : 0;
    const top = i.top + i.bottom < h * 0.6 ? i.top : 0;
    const bottom = i.top + i.bottom < h * 0.6 ? i.bottom : 0;
    return {
      x: left,
      y: top,
      width: Math.max(1, w - left - right),
      height: Math.max(1, h - top - bottom)
    };
  }
  function fit(animate = true) {
    const b = worldRef.current.querySelector("svg").viewBox.baseVal;
    const area = visibleArea();
    const scale = Math.min(
      Math.max(1, area.width - 2 * FIT_PADDING) / b.width,
      Math.max(1, area.height - 2 * FIT_PADDING) / b.height,
      MAX_FIT_SCALE
    );
    const next = {
      x: area.x + (area.width - b.width * scale) / 2,
      y: area.y + (area.height - b.height * scale) / 2,
      scale,
      fitted: true
    };
    if (animate) moveTo(next, ZOOM_EASING_MS);
    else snapTo(next);
  }
  function initialCamera() {
    fit(false);
    if (camera.scale >= 0.7 || !initialFocus.length) return;
    const anchors = initialFocus.map((id) => {
      const node = worldRef.current.querySelector(
        `.node[data-node-id="${id}"]`
      );
      const m = node.transform.baseVal.consolidate().matrix;
      const r = node.querySelector("rect");
      return {
        x: m.e,
        y: m.f,
        w: Number(r.getAttribute("width")),
        h: Number(r.getAttribute("height"))
      };
    });
    const x = (Math.min(...anchors.map((n) => n.x)) + Math.max(...anchors.map((n) => n.x + n.w))) / 2;
    const y = (Math.min(...anchors.map((n) => n.y)) + Math.max(...anchors.map((n) => n.y + n.h))) / 2;
    const area = visibleArea();
    const width = Math.max(...anchors.map((n) => n.x + n.w)) - Math.min(...anchors.map((n) => n.x));
    const height = Math.max(...anchors.map((n) => n.y + n.h)) - Math.min(...anchors.map((n) => n.y));
    const scale = Math.max(
      camera.scale,
      0.5,
      Math.min(
        0.7,
        (area.width - 2 * FIT_PADDING) / Math.max(1, width),
        (area.height - 2 * FIT_PADDING) / Math.max(1, height)
      )
    );
    snapTo({
      scale,
      x: area.x + area.width / 2 - x * scale,
      y: area.y + area.height / 2 - y * scale,
      fitted: false
    });
  }
  function zoomTo(scale, x = canvasRef.current.clientWidth / 2, y = canvasRef.current.clientHeight / 2, duration = ZOOM_EASING_MS) {
    scale = clampScale(scale);
    const ratio = scale / destination.scale;
    moveTo(
      {
        x: x - (x - destination.x) * ratio,
        y: y - (y - destination.y) * ratio,
        scale,
        fitted: false
      },
      duration
    );
  }
  function pinchZoomBy(delta, x, y) {
    zoomTo(destination.scale * Math.exp(delta), x, y);
  }
  function pan(dx, dy, duration = PAN_EASING_MS) {
    const next = {
      ...destination,
      x: destination.x + dx,
      y: destination.y + dy,
      fitted: false
    };
    if (duration) moveTo(next, duration);
    else snapTo(next);
  }
  function clearPointers(canvas = canvasRef.current) {
    if (drag?.element) {
      drag.element = false;
      elementDrag?.end(false);
    }
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    drag = null;
    canvas.classList.remove("dragging", "moving");
  }
  function restoreView(key, focusIds = []) {
    cancelMotion();
    clearPointers();
    if (activeKey) cameras.set(activeKey, { ...camera });
    initialFocus = focusIds;
    activeKey = key;
    if (cameras.has(activeKey)) {
      snapTo(cameras.get(activeKey));
    } else initialCamera();
  }
  function focusNode(id, rightInset = 0) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    cancelMotion();
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const area = visibleArea();
    const freeWidth = Math.max(1, area.width - rightInset);
    const scale = Math.max(camera.scale, 0.85);
    moveTo(
      {
        scale,
        x: area.x + freeWidth / 2 - (m.e + Number(r.getAttribute("width")) / 2) * scale,
        y: area.y + area.height / 2 - (m.f + Number(r.getAttribute("height")) / 2) * scale,
        fitted: false
      },
      ZOOM_EASING_MS
    );
  }
  function focusNodes(ids, rightInset = 0) {
    const boxes = ids.map(
      (id) => worldRef.current.querySelector(`.node[data-node-id="${id}"]`)
    ).filter(Boolean).map((node) => {
      const m = node.transform.baseVal.consolidate().matrix;
      const r = node.querySelector("rect");
      return {
        x: m.e,
        y: m.f,
        right: m.e + Number(r.getAttribute("width")),
        bottom: m.f + Number(r.getAttribute("height"))
      };
    });
    if (!boxes.length) return;
    cancelMotion();
    const left = Math.min(...boxes.map((b) => b.x)), top = Math.min(...boxes.map((b) => b.y)), right = Math.max(...boxes.map((b) => b.right)), bottom = Math.max(...boxes.map((b) => b.bottom));
    const area = visibleArea();
    const freeWidth = Math.max(1, area.width - rightInset);
    const fits = Math.min(
      (freeWidth - 2 * FIT_PADDING) / Math.max(1, right - left),
      (area.height - 2 * FIT_PADDING) / Math.max(1, bottom - top)
    );
    const scale = clampScale(
      Math.min(Math.max(camera.scale, 0.85), Math.max(0.3, fits))
    );
    moveTo(
      {
        scale,
        x: area.x + freeWidth / 2 - (left + right) / 2 * scale,
        y: area.y + area.height / 2 - (top + bottom) / 2 * scale,
        fitted: false
      },
      ZOOM_EASING_MS
    );
  }
  function revealNode(id) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const left = destination.x + m.e * destination.scale;
    const top = destination.y + m.f * destination.scale;
    const width = Number(r.getAttribute("width")) * destination.scale;
    const height = Number(r.getAttribute("height")) * destination.scale;
    const i = readInsets();
    const area = visibleArea(i, { fullWidth: true });
    const shift = (start, size, origin, available) => size > available - 48 ? origin + (available - size) / 2 - start : start < origin + 24 ? origin + 24 - start : start + size > origin + available - 24 ? origin + available - 24 - start - size : 0;
    let dx = shift(left, width, area.x, area.width);
    const dy = shift(top, height, area.y, area.height);
    for (const o of i.obstacles || []) {
      const x = left + dx, y = top + dy;
      if (x >= o.right || x + width <= o.left || y >= o.bottom || y + height <= o.top)
        continue;
      const room = o.left - area.x;
      if (room >= width + 48) dx = o.left - 24 - width - left;
      else if (room > 0) dx = area.x + (room - width) / 2 - left;
    }
    if (dx || dy) {
      pan(dx, dy, motionFrame === null ? 0 : easing);
    }
  }
  function gesture() {
    const p = [...pointers.values()];
    if (p.length < 2) return null;
    return {
      x: (p[0].x + p[1].x) / 2,
      y: (p[0].y + p[1].y) / 2,
      d: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y)
    };
  }
  function attach() {
    const canvas = canvasRef.current;
    const world = worldRef.current;
    grid = canvas.querySelector(".canvas-grid");
    gridLevel = null;
    if (grid)
      grid.style.transformOrigin = `${GRID_OVERHANG}px ${GRID_OVERHANG}px`;
    const cleanup = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };
    const position = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const inDiagram = (p) => ({
      x: (p.x - camera.x) / camera.scale,
      y: (p.y - camera.y) / camera.scale
    });
    const letGo = (moved2) => {
      if (!drag?.element) return;
      drag.element = false;
      elementDrag?.end(moved2);
    };
    const motionPreference = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    reducedMotion = motionPreference?.matches || false;
    if (motionPreference)
      listen(motionPreference, "change", (e) => {
        reducedMotion = e.matches;
        if (reducedMotion) snapTo(destination);
      });
    paint();
    listen(
      canvas,
      "wheel",
      (e) => {
        e.preventDefault();
        if (!e.deltaY) return;
        onMotion?.();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
        const p = position(e);
        pinchZoomBy(-e.deltaY * unit * WHEEL_ZOOM_SENSITIVITY, p.x, p.y);
      },
      { passive: false }
    );
    listen(canvas, "pointerdown", (e) => {
      if (e.button !== 0) return;
      cancelMotion();
      moved = false;
      const p = position(e);
      pointers.set(e.pointerId, p);
      canvas.setPointerCapture(e.pointerId);
      if (pointers.size > 1) letGo(false);
      drag = {
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        target: e.target,
        gesture: gesture(),
        element: pointers.size === 1 && !!elementDrag?.start(e.target, inDiagram(p))
      };
      canvas.classList.add(drag.element ? "moving" : "dragging");
    });
    listen(canvas, "pointermove", (e) => {
      if (!pointers.has(e.pointerId) || !drag) return;
      const p = position(e);
      pointers.set(e.pointerId, p);
      const g = gesture();
      if (g && drag.gesture) {
        const old = drag.gesture;
        pan(g.x - old.x, g.y - old.y, DRAG_EASING_MS);
        if (old.d > 0)
          zoomTo(destination.scale * g.d / old.d, g.x, g.y, DRAG_EASING_MS);
        drag.moved = true;
        if (!moved) onMotion?.();
        moved = true;
        drag.gesture = g;
      } else if (g) drag.gesture = g;
      else if (drag.element) {
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4)
          drag.moved = true;
        if (drag.moved && !moved) onMotion?.();
        if (drag.moved) {
          moved = true;
          elementDrag.move(inDiagram(p));
        }
      } else {
        const wasMoved = drag.moved;
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4)
          drag.moved = true;
        if (drag.moved && !moved) onMotion?.();
        if (drag.moved) moved = true;
        if (drag.moved)
          pan(
            p.x - (wasMoved ? drag.lastX : drag.startX),
            p.y - (wasMoved ? drag.lastY : drag.startY),
            DRAG_EASING_MS
          );
        drag.lastX = p.x;
        drag.lastY = p.y;
      }
    });
    function pointerEnd(e) {
      if (!pointers.has(e.pointerId)) return;
      if (e.type === "pointercancel") moved = true;
      pointers.delete(e.pointerId);
      if (!pointers.size) {
        letGo(e.type === "pointerup" && !!drag?.moved);
        if (e.type === "pointerup" && drag && !drag.moved && drag.target)
          onTap?.(drag.target);
        drag = null;
        canvas.classList.remove("dragging", "moving");
      } else {
        const p = [...pointers.values()][0];
        drag = {
          startX: p.x,
          startY: p.y,
          lastX: p.x,
          lastY: p.y,
          moved: true,
          gesture: gesture()
        };
      }
    }
    listen(canvas, "pointerup", pointerEnd);
    listen(canvas, "pointercancel", pointerEnd);
    listen(document, "keydown", (e) => {
      if (e.target.matches("input,textarea,[contenteditable='true']")) return;
      if (e.key === "+" || e.key === "=") {
        zoomTo(destination.scale * 1.25);
        e.preventDefault();
      }
      if (e.key === "-") {
        zoomTo(destination.scale / 1.25);
        e.preventDefault();
      }
      if (e.key === "0") {
        fit();
        e.preventDefault();
      }
    });
    let safariScale = 1;
    listen(
      canvas,
      "gesturestart",
      (e) => {
        e.preventDefault();
        onMotion?.();
        cancelMotion();
        safariScale = 1;
      },
      { passive: false }
    );
    listen(
      canvas,
      "gesturechange",
      (e) => {
        e.preventDefault();
        if (!(e.scale > 0)) return;
        onMotion?.();
        const p = position(e);
        pinchZoomBy(
          Math.log(e.scale / safariScale) * PINCH_GESTURE_SENSITIVITY,
          p.x,
          p.y
        );
        safariScale = e.scale;
      },
      { passive: false }
    );
    listen(canvas, "gestureend", (e) => e.preventDefault(), { passive: false });
    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    const observer = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === width && h === height) return;
      if (w !== width && h === height) {
        camera.fitted = false;
        destination.fitted = false;
        paint();
      } else if (destination.fitted) fit(false);
      else {
        cancelMotion();
        pan((w - width) / 2, (h - height) / 2, 0);
      }
      width = w;
      height = h;
    });
    observer.observe(canvas);
    return () => {
      cleanup.forEach((remove) => remove());
      observer.disconnect();
      cancelMotion();
      clearPointers(canvas);
      grid = null;
      gridLevel = null;
    };
  }
  return {
    attach,
    restoreView,
    focusNode,
    focusNodes,
    revealNode,
    hasDragged: () => moved,
    fit,
    reset: () => zoomTo(1),
    zoomBy: (factor) => zoomTo(destination.scale * factor)
  };
}

// src/canvas/useDiagramCamera.js
function useDiagramCamera({
  canvasRef,
  worldRef,
  diagram,
  focusRequest,
  onZoom,
  onTap,
  onMotion,
  insets,
  elementDrag = null
}) {
  const callbacks = useRef2({ onZoom, onTap, onMotion, insets, elementDrag });
  const controls = useMemo2(
    () => createCamera({
      canvasRef,
      worldRef,
      onZoom: (value) => callbacks.current.onZoom(value),
      onTap: (element) => callbacks.current.onTap(element),
      onMotion: () => callbacks.current.onMotion(),
      insets: (canvas) => {
        const value = callbacks.current.insets;
        return typeof value === "function" ? value(canvas) : value;
      },
      elementDrag: {
        start: (target, point) => !!callbacks.current.elementDrag?.start(target, point),
        move: (point) => callbacks.current.elementDrag?.move(point),
        end: (moved) => callbacks.current.elementDrag?.end(moved)
      }
    }),
    // A new camera implementation during Vite refresh needs a new controller.
    [createCamera]
  );
  useLayoutEffect2(() => {
    callbacks.current = { onZoom, onTap, onMotion, insets, elementDrag };
  }, [onZoom, onTap, onMotion, insets, elementDrag]);
  useLayoutEffect2(() => {
    controls.restoreView(diagram.key, diagram.initialFocus);
  }, [controls, diagram.key, diagram.initialFocus]);
  useLayoutEffect2(() => {
    if (focusRequest?.ids)
      controls.focusNodes(focusRequest.ids, focusRequest.rightInset);
    else if (focusRequest)
      controls.focusNode(focusRequest.id, focusRequest.rightInset);
  }, [controls, focusRequest]);
  useLayoutEffect2(() => controls.attach(), [controls]);
  return controls;
}

// src/canvas/DiagramCanvas.jsx
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
var DiagramCanvas = memo2(
  forwardRef(function DiagramCanvas2({
    diagram,
    selected,
    hovered,
    focusRequest,
    backgroundURL,
    fitInsets,
    onSelect,
    onZoom,
    onHover,
    onClearHover,
    elementDrag = null
  }, ref) {
    const canvasRef = useRef3(null), worldRef = useRef3(null);
    const [focused, setFocused] = useState2(null);
    const clearTransient = useCallback(() => {
      onClearHover();
      setFocused(null);
    }, [onClearHover]);
    const controls = useDiagramCamera({
      canvasRef,
      worldRef,
      diagram,
      focusRequest,
      onZoom,
      // A background tap has no model target and clears selection. The camera
      // invokes this only for taps, so panning and zooming retain selection.
      onTap: (element) => onSelect(readTarget(element)),
      onMotion: clearTransient,
      insets: fitInsets,
      elementDrag
    });
    useImperativeHandle(ref, () => controls, [controls]);
    useLayoutEffect3(() => {
      if (selected?.kind === "node") controls.revealNode(selected.id);
    }, [controls, diagram.key, diagram.initialFocus, selected]);
    useLayoutEffect3(clearTransient, [
      clearTransient,
      diagram.key,
      diagram.initialFocus
    ]);
    useLayoutEffect3(clearTransient, [clearTransient, selected]);
    useEffect(() => {
      const escape = (e) => {
        if (e.key === "Escape") clearTransient();
      };
      document.addEventListener("keydown", escape);
      return () => document.removeEventListener("keydown", escape);
    }, [clearTransient]);
    const handlers = {
      onHover,
      onFocus: (value) => setFocused((old) => sameTarget(old, value) ? old : value),
      onActivate: (value, e) => {
        if (e.type === "keydown" || !controls.hasDragged()) onSelect(value);
      }
    };
    return /* @__PURE__ */ jsxs4(
      "main",
      {
        ref: canvasRef,
        id: "canvas",
        className: elementDrag ? "arrangeable" : void 0,
        "aria-label": "Interactive diagram",
        onPointerLeave: () => onHover(null),
        children: [
          /* @__PURE__ */ jsx5("div", { className: "canvas-grid", "aria-hidden": "true" }),
          /* @__PURE__ */ jsx5("div", { ref: worldRef, id: "world", children: /* @__PURE__ */ jsx5(
            UMLDiagram,
            {
              diagram,
              active: hovered || focused || selected,
              selected,
              backgroundURL,
              handlers
            }
          ) })
        ]
      }
    );
  })
);

// src/canvas/useSVGExport.js
import { useEffect as useEffect2, useState as useState3 } from "react";
var THEME_VARS = [
  "--canvas",
  "--surface",
  "--text",
  "--diagram-border",
  "--diagram-divider",
  "--diagram-edge",
  "--diagram-inheritance",
  "--diagram-label",
  "--diagram-muted",
  "--diagram-attribute",
  "--change-added",
  "--change-modified",
  "--change-removed"
];
var EMPTY_URLS = { diagramURL: void 0, backgroundURL: void 0 };
function resolvedColours(element) {
  const declared = getComputedStyle(element);
  const probe = document.createElement("span");
  probe.hidden = true;
  element.appendChild(probe);
  const colours = /* @__PURE__ */ new Map();
  for (const name of THEME_VARS) {
    if (!declared.getPropertyValue(name).trim()) continue;
    probe.style.color = `var(${name})`;
    colours.set(name, getComputedStyle(probe).color);
  }
  probe.remove();
  return colours;
}
function useSVGExport(svgSource, theme, scope, fade = false) {
  const [urls, setURLs] = useState3(EMPTY_URLS);
  useEffect2(() => {
    const svg = new DOMParser().parseFromString(
      svgSource,
      "image/svg+xml"
    ).documentElement;
    const colours = resolvedColours(scope?.current || document.documentElement);
    for (const [name, colour] of colours) svg.style.setProperty(name, colour);
    svg.querySelectorAll(".selected,.dimmed").forEach((n) => n.classList.remove("selected", "dimmed"));
    const faded = fade ? [...svg.querySelectorAll('[data-change="unchanged"]')] : [];
    for (const element of faded) element.setAttribute("opacity", "0.32");
    const backgroundURL = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml"
      })
    );
    const background = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    background.setAttribute("width", svg.viewBox.baseVal.width);
    background.setAttribute("height", svg.viewBox.baseVal.height);
    background.setAttribute("fill", colours.get("--canvas") ?? "#ffffff");
    svg.insertBefore(background, svg.firstChild);
    for (const element of faded) element.removeAttribute("opacity");
    const diagramURL = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml"
      })
    );
    setURLs({ diagramURL, backgroundURL, source: svgSource, theme, fade });
    return () => {
      URL.revokeObjectURL(diagramURL);
      URL.revokeObjectURL(backgroundURL);
    };
  }, [svgSource, theme, fade]);
  return urls.source === svgSource && urls.theme === theme && urls.fade === fade ? urls : EMPTY_URLS;
}

// src/viewer/DiagramViewer.jsx
import { Dialog, useTheme, useThemePreference } from "@envsemble/envui";

// src/ui/EmptyState.jsx
import { createElement } from "react";
import { Column, Text } from "@envsemble/envui";
import { jsx as jsx6, jsxs as jsxs5 } from "react/jsx-runtime";
function EmptyState({
  title,
  description,
  headingLevel = 4,
  className
}) {
  return /* @__PURE__ */ jsxs5(
    Column,
    {
      gap: 2,
      className: `atlas-empty-state${className ? ` ${className}` : ""}`,
      children: [
        /* @__PURE__ */ jsx6(
          Text,
          {
            render: createElement(`h${headingLevel}`),
            variant: "title",
            className: "atlas-section-heading",
            children: title
          }
        ),
        description && /* @__PURE__ */ jsx6(Text, { variant: "body-sm", children: description })
      ]
    }
  );
}

// src/viewer/ViewerToolbar.jsx
import { forwardRef as forwardRef2 } from "react";
import { Text as Text3, ThemeToggle } from "@envsemble/envui";

// src/ui/ToolButton.jsx
import { IconButton, Tooltip as Tooltip2 } from "@envsemble/envui";
import { jsx as jsx7 } from "react/jsx-runtime";
function ToolButton({
  label,
  tooltip = label,
  icon,
  pressed,
  variant,
  side = "bottom",
  ...props
}) {
  return /* @__PURE__ */ jsx7(Tooltip2, { content: tooltip, side, children: /* @__PURE__ */ jsx7(
    IconButton,
    {
      ...props,
      "aria-label": label,
      "aria-pressed": pressed,
      icon,
      variant: variant ?? (pressed ? "primary" : "secondary")
    }
  ) });
}

// src/viewer/CameraControls.jsx
import { useSyncExternalStore } from "react";
import { Button, ButtonGroup, Kbd, Tooltip as Tooltip3 } from "@envsemble/envui";

// src/ui/icons.jsx
import { IconAdd } from "@envsemble/envui/icons/Add";
import { IconChevronLeft } from "@envsemble/envui/icons/ChevronLeft";
import { IconChevronRight } from "@envsemble/envui/icons/ChevronRight";
import { IconClose } from "@envsemble/envui/icons/Close";
import { IconCode } from "@envsemble/envui/icons/Code";
import { IconContrast } from "@envsemble/envui/icons/Contrast";
import { IconDatabase } from "@envsemble/envui/icons/Database";
import { IconDescription } from "@envsemble/envui/icons/Description";
import { IconDifference } from "@envsemble/envui/icons/Difference";
import { IconDownload } from "@envsemble/envui/icons/Download";
import { IconEditNote } from "@envsemble/envui/icons/EditNote";
import { IconFitScreen } from "@envsemble/envui/icons/FitScreen";
import { IconFolderZip } from "@envsemble/envui/icons/FolderZip";
import { IconImage } from "@envsemble/envui/icons/Image";
import { IconInfo } from "@envsemble/envui/icons/Info";
import { IconRemove } from "@envsemble/envui/icons/Remove";
import { IconRestartAlt } from "@envsemble/envui/icons/RestartAlt";
import { IconSchool } from "@envsemble/envui/icons/School";

// src/viewer/CameraControls.jsx
import { Fragment as Fragment3, jsx as jsx8, jsxs as jsxs6 } from "react/jsx-runtime";
function ZoomReadout({ zoom, onReset }) {
  return /* @__PURE__ */ jsx8(Tooltip3, { content: "Reset to 100%", side: "bottom", children: /* @__PURE__ */ jsxs6(
    Button,
    {
      id: "zoom-value",
      variant: "secondary",
      className: "zoom-readout",
      "aria-label": `Zoom ${zoom}%; reset to 100%`,
      onClick: onReset,
      children: [
        zoom,
        "%"
      ]
    }
  ) });
}
function ObservedZoomReadout({ store, onReset }) {
  const zoom = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return /* @__PURE__ */ jsx8(ZoomReadout, { zoom, onReset });
}
function CameraControls({
  zoom,
  zoomStore,
  onZoom,
  onReset,
  onFit,
  compact = false
}) {
  return /* @__PURE__ */ jsxs6(ButtonGroup, { "aria-label": "Zoom", className: "camera-controls", children: [
    !compact && /* @__PURE__ */ jsx8(
      ToolButton,
      {
        id: "zoom-out",
        label: "Zoom out",
        tooltip: /* @__PURE__ */ jsxs6(Fragment3, { children: [
          "Zoom out ",
          /* @__PURE__ */ jsx8(Kbd, { children: "\u2212" })
        ] }),
        "aria-keyshortcuts": "-",
        icon: /* @__PURE__ */ jsx8(IconRemove, {}),
        onClick: () => onZoom(1 / 1.25)
      }
    ),
    zoomStore ? /* @__PURE__ */ jsx8(ObservedZoomReadout, { store: zoomStore, onReset }) : /* @__PURE__ */ jsx8(ZoomReadout, { zoom, onReset }),
    !compact && /* @__PURE__ */ jsx8(
      ToolButton,
      {
        id: "zoom-in",
        label: "Zoom in",
        tooltip: /* @__PURE__ */ jsxs6(Fragment3, { children: [
          "Zoom in ",
          /* @__PURE__ */ jsx8(Kbd, { children: "+" })
        ] }),
        "aria-keyshortcuts": "+",
        icon: /* @__PURE__ */ jsx8(IconAdd, {}),
        onClick: () => onZoom(1.25)
      }
    ),
    /* @__PURE__ */ jsx8(
      ToolButton,
      {
        id: "fit",
        label: "Fit diagram",
        tooltip: /* @__PURE__ */ jsxs6(Fragment3, { children: [
          "Fit diagram ",
          /* @__PURE__ */ jsx8(Kbd, { children: "0" })
        ] }),
        "aria-keyshortcuts": "0",
        icon: /* @__PURE__ */ jsx8(IconFitScreen, {}),
        onClick: onFit
      }
    )
  ] });
}

// src/ui/ExportMenu.jsx
import { Menu } from "@envsemble/envui";
import { jsx as jsx9 } from "react/jsx-runtime";
function downloadURL(href, filename) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}
function downloadData(data, filename, type = "text/plain;charset=utf-8") {
  const href = URL.createObjectURL(new Blob([data], { type }));
  downloadURL(href, filename);
  setTimeout(() => URL.revokeObjectURL(href), 1e4);
}
function ExportMenu({ items }) {
  return /* @__PURE__ */ jsx9(
    Menu.Root,
    {
      "aria-label": "Export",
      trigger: /* @__PURE__ */ jsx9(
        ToolButton,
        {
          id: "export",
          label: "Export",
          tooltip: "Export the diagram or model",
          icon: /* @__PURE__ */ jsx9(IconDownload, {})
        }
      ),
      children: items.map((item) => /* @__PURE__ */ jsx9(
        Menu.Item,
        {
          className: item.key,
          icon: item.icon,
          description: item.description,
          onClick: item.onSelect,
          children: item.label
        },
        item.key
      ))
    }
  );
}

// src/ui/Island.jsx
import { Surface } from "@envsemble/envui";
import { jsx as jsx10 } from "react/jsx-runtime";
function Island({ label, className = "", children, ...props }) {
  return /* @__PURE__ */ jsx10(
    Surface,
    {
      background: "default",
      radius: "full",
      padding: 1,
      role: "group",
      "aria-label": label,
      className: `atlas-island${className ? ` ${className}` : ""}`,
      ...props,
      children
    }
  );
}
function IslandDivider() {
  return /* @__PURE__ */ jsx10("span", { className: "island-divider", "aria-hidden": "true" });
}

// src/ui/ViewSwitcher.jsx
import { SegmentedControl, Select } from "@envsemble/envui";
import { jsx as jsx11 } from "react/jsx-runtime";
function ViewSwitcher({
  items,
  value,
  onChange,
  label = "Diagram view",
  compact = false
}) {
  const choices = items.map((item) => ({ value: item.key, label: item.label }));
  if (compact)
    return /* @__PURE__ */ jsx11(
      Select,
      {
        className: "view-select",
        "aria-label": label,
        items: choices,
        value,
        onValueChange: (next) => next && onChange(next)
      }
    );
  return /* @__PURE__ */ jsx11(
    SegmentedControl,
    {
      className: "view-switcher",
      "aria-label": label,
      items: choices,
      value,
      onValueChange: onChange
    }
  );
}

// src/ui/AtlasMark.jsx
import { jsx as jsx12, jsxs as jsxs7 } from "react/jsx-runtime";
function AtlasMark({ size = 28, label = "Atlas" }) {
  return /* @__PURE__ */ jsxs7(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "27 26.5 189 189",
      role: label ? "img" : void 0,
      "aria-label": label || void 0,
      "aria-hidden": label ? void 0 : true,
      children: [
        /* @__PURE__ */ jsx12("rect", { x: "27", y: "27", width: "189", height: "188", rx: "43", fill: "#111820" }),
        /* @__PURE__ */ jsxs7(
          "g",
          {
            fill: "none",
            stroke: "#fff",
            strokeWidth: "12",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            children: [
              /* @__PURE__ */ jsx12("path", { d: "M76 163 L120 77 L164 163" }),
              /* @__PURE__ */ jsx12("path", { d: "M96 132 H144" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs7("g", { fill: "#fff", children: [
          /* @__PURE__ */ jsx12("circle", { cx: "120", cy: "77", r: "18" }),
          /* @__PURE__ */ jsx12("circle", { cx: "76", cy: "163", r: "18" }),
          /* @__PURE__ */ jsx12("circle", { cx: "164", cy: "163", r: "18" })
        ] })
      ]
    }
  );
}

// src/viewer/ProvenanceBadge.jsx
import { Badge, Surface as Surface2, Text as Text2 } from "@envsemble/envui";

// src/viewer/provenance.js
var MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec"
];
var SOURCE_KINDS = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  java: "Java",
  sqlite: "SQLite",
  d1: "Cloudflare D1",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  authored: "Authored model"
};
function formatCaptureDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}
function sourceKindLabel(kind) {
  if (typeof kind !== "string" || !kind) return "";
  return SOURCE_KINDS[kind.toLowerCase()] || kind.charAt(0).toUpperCase() + kind.slice(1);
}
function baselineSnapshot(document2) {
  const snapshots = Array.isArray(document2.snapshots) ? document2.snapshots : [];
  const own = document2.state === "snapshot" && document2.captureId;
  return snapshots.find((s) => s.id === (own || document2.baselineId)) || (document2.state === "snapshot" ? snapshots[0] : void 0);
}
function captureDetail(snapshot) {
  const capture = snapshot?.capture;
  if (!capture) return "";
  const date = formatCaptureDate(capture.capturedAt);
  return [
    sourceKindLabel(capture.source?.kind),
    capture.source?.identity,
    date && `captured ${date}`,
    capture.coverage?.status && `${capture.coverage.status} coverage`
  ].filter(Boolean).join(" \xB7 ");
}
function describeProvenance(document2) {
  if (!document2 || typeof document2 !== "object")
    return { kind: "unknown", label: "", detail: "", tone: "neutral" };
  let result;
  if (document2.state === "snapshot") {
    const label = document2.profile === "code" ? "Generated from code" : document2.profile === "database" ? "Generated from database" : "Generated snapshot";
    result = {
      kind: "generated",
      label,
      detail: captureDetail(baselineSnapshot(document2)),
      tone: "primary"
    };
  } else if (document2.state === "proposal") {
    const date = formatCaptureDate(
      baselineSnapshot(document2)?.capture?.capturedAt
    );
    result = {
      kind: "proposal",
      label: "Agent proposal",
      detail: date ? `Changes to source captured ${date}` : "",
      tone: "accent"
    };
  } else if (document2.state === "authored") {
    result = {
      kind: "authored",
      label: "Agent-authored",
      detail: document2.profile === "object" ? "Object diagram" : document2.profile === "class" ? "Class diagram" : document2.profile === "database" ? "Entity diagram" : "Structural model",
      tone: "success"
    };
  } else return { kind: "unknown", label: "", detail: "", tone: "neutral" };
  return result;
}

// src/viewer/ProvenanceBadge.jsx
import { jsx as jsx13, jsxs as jsxs8 } from "react/jsx-runtime";
function ProvenanceIcon({ provenance, profile }) {
  if (provenance.kind === "proposal") return /* @__PURE__ */ jsx13(IconDifference, {});
  if (provenance.kind === "authored") return /* @__PURE__ */ jsx13(IconEditNote, {});
  if (profile === "database") return /* @__PURE__ */ jsx13(IconDatabase, {});
  if (profile === "code") return /* @__PURE__ */ jsx13(IconCode, {});
  return /* @__PURE__ */ jsx13(IconDescription, {});
}
function ProvenanceLabel({ document: document2 }) {
  const provenance = describeProvenance(document2);
  if (provenance.kind === "unknown") return null;
  return /* @__PURE__ */ jsx13(
    Badge,
    {
      tone: provenance.tone,
      icon: /* @__PURE__ */ jsx13(ProvenanceIcon, { provenance, profile: document2?.profile }),
      children: provenance.label
    }
  );
}
function ProvenanceBadge({ document: document2, className = "" }) {
  const provenance = describeProvenance(document2);
  if (provenance.kind === "unknown") return null;
  return /* @__PURE__ */ jsxs8(
    Surface2,
    {
      background: "default",
      radius: "full",
      padding: 1,
      className: `atlas-provenance${className ? ` ${className}` : ""}`,
      title: provenance.detail ? `${provenance.label} \xB7 ${provenance.detail}` : provenance.label,
      children: [
        /* @__PURE__ */ jsx13(ProvenanceLabel, { document: document2 }),
        provenance.detail && /* @__PURE__ */ jsx13(Text2, { render: /* @__PURE__ */ jsx13("span", {}), variant: "body-sm", className: "provenance-detail", children: provenance.detail })
      ]
    }
  );
}

// src/viewer/ViewerToolbar.jsx
import { Fragment as Fragment4, jsx as jsx14, jsxs as jsxs9 } from "react/jsx-runtime";
function exportChoices({ exports, viewKey, theme, diagramURL }) {
  const sourceFile = `${exports.slug}.puml`;
  return [
    {
      key: "svg-download",
      label: "SVG image",
      description: `This view, ${theme} theme`,
      icon: /* @__PURE__ */ jsx14(IconImage, {}),
      onSelect: () => diagramURL && downloadURL(diagramURL, `${exports.slug}-${viewKey}-${theme}.svg`)
    },
    {
      key: "source-download",
      label: "PlantUML",
      description: "The diagram's source",
      icon: /* @__PURE__ */ jsx14(IconCode, {}),
      onSelect: () => downloadData(exports.readText(sourceFile), sourceFile)
    },
    {
      key: "bundle-download",
      label: "Models ZIP",
      description: "Every export, with evidence and validation",
      icon: /* @__PURE__ */ jsx14(IconFolderZip, {}),
      onSelect: () => downloadData(
        exports.bundle,
        `${exports.slug}-models.zip`,
        "application/zip"
      )
    }
  ];
}
var ViewerToolbar = forwardRef2(function ViewerToolbar2({
  model,
  views,
  exports,
  viewKey,
  theme,
  zoomStore,
  diagramURL,
  scenariosOpen,
  aboutOpen,
  reviewControls,
  provenance,
  hasScenarios = false,
  density = 0,
  themeToggle = false,
  onView,
  onAbout,
  onScenarios,
  onZoom,
  onReset,
  onFit
}, ref) {
  const origin = describeProvenance(provenance);
  return /* @__PURE__ */ jsxs9(
    "header",
    {
      className: `atlas-overlay-top viewer-toolbar${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`,
      ref,
      children: [
        /* @__PURE__ */ jsxs9(Island, { label: "Diagram navigation", className: "island-start", children: [
          /* @__PURE__ */ jsx14("span", { className: "brand-mark", children: /* @__PURE__ */ jsx14(AtlasMark, { label: "" }) }),
          /* @__PURE__ */ jsx14(
            Text3,
            {
              render: /* @__PURE__ */ jsx14("span", {}),
              variant: "title",
              className: "atlas-section-heading island-title",
              title: model.title,
              children: model.title
            }
          ),
          origin.kind !== "unknown" && /* @__PURE__ */ jsx14(
            "span",
            {
              className: "island-provenance",
              title: origin.detail || void 0,
              children: /* @__PURE__ */ jsx14(ProvenanceLabel, { document: provenance })
            }
          ),
          (views.length > 1 || reviewControls) && /* @__PURE__ */ jsx14(IslandDivider, {}),
          views.length > 1 && /* @__PURE__ */ jsx14(
            ViewSwitcher,
            {
              items: views,
              value: viewKey,
              onChange: onView,
              compact: density > 0
            }
          ),
          views.length > 1 && reviewControls && /* @__PURE__ */ jsx14(IslandDivider, {}),
          reviewControls
        ] }),
        /* @__PURE__ */ jsxs9(Island, { label: "Diagram tools", className: "island-end", children: [
          /* @__PURE__ */ jsx14(
            CameraControls,
            {
              ...{ zoomStore, onZoom, onReset, onFit },
              compact: density > 2
            }
          ),
          /* @__PURE__ */ jsx14(IslandDivider, {}),
          hasScenarios && /* @__PURE__ */ jsxs9(Fragment4, { children: [
            /* @__PURE__ */ jsx14(
              ToolButton,
              {
                id: "scenarios-toggle",
                label: "Understand the model",
                pressed: scenariosOpen,
                "aria-controls": "side-panel",
                icon: /* @__PURE__ */ jsx14(IconSchool, {}),
                onClick: onScenarios
              }
            ),
            /* @__PURE__ */ jsx14(IslandDivider, {})
          ] }),
          themeToggle && /* @__PURE__ */ jsx14(ThemeToggle, { id: "theme-toggle" }),
          /* @__PURE__ */ jsx14(
            ExportMenu,
            {
              items: exportChoices({
                exports,
                viewKey,
                theme,
                diagramURL
              })
            }
          ),
          /* @__PURE__ */ jsx14(
            ToolButton,
            {
              id: "info",
              label: "About and controls",
              "aria-haspopup": "dialog",
              "aria-expanded": aboutOpen,
              icon: /* @__PURE__ */ jsx14(IconInfo, {}),
              onClick: onAbout
            }
          )
        ] })
      ]
    }
  );
});

// src/viewer/About.jsx
import { Kbd as Kbd2, Column as Column2, Text as Text4 } from "@envsemble/envui";

// src/ui/DownloadLink.jsx
import { Button as Button2 } from "@envsemble/envui";

// src/ui/useBlobURL.js
import { useEffect as useEffect3, useState as useState4 } from "react";
function useBlobURL(data, type = "text/plain;charset=utf-8") {
  const [url, setURL] = useState4(void 0);
  useEffect3(() => {
    const next = URL.createObjectURL(new Blob([data], { type }));
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [data, type]);
  return url;
}

// src/ui/DownloadLink.jsx
import { jsx as jsx15 } from "react/jsx-runtime";
function DownloadLink({ data, filename, type, children, ...props }) {
  const href = useBlobURL(data, type);
  return /* @__PURE__ */ jsx15(
    Button2,
    {
      ...props,
      variant: "text",
      startIcon: /* @__PURE__ */ jsx15(IconDownload, {}),
      ...href ? { href, download: filename } : { disabled: true },
      children
    }
  );
}

// src/viewer/About.jsx
import { Fragment as Fragment5, jsx as jsx16, jsxs as jsxs10 } from "react/jsx-runtime";
function About({ model, exports, provenance }) {
  return /* @__PURE__ */ jsxs10(Column2, { gap: 4, className: "atlas-portal about-content", children: [
    /* @__PURE__ */ jsx16(ProvenanceBadge, { document: provenance, className: "inline" }),
    /* @__PURE__ */ jsx16(Text4, { emphasis: "muted", children: model.status }),
    /* @__PURE__ */ jsx16("dl", { className: "shortcut-list", children: [
      ["Scroll or pinch", "Zoom"],
      ["Drag", "Pan"],
      [
        /* @__PURE__ */ jsxs10(Fragment5, { children: [
          /* @__PURE__ */ jsx16(Kbd2, { children: "+" }),
          " ",
          /* @__PURE__ */ jsx16(Kbd2, { children: "\u2212" })
        ] }),
        "Zoom in or out"
      ],
      [/* @__PURE__ */ jsx16(Kbd2, { children: "0" }), "Fit the diagram"],
      [/* @__PURE__ */ jsx16(Kbd2, { children: "Esc" }), "Clear the selection"]
    ].map(([keys, action], i) => /* @__PURE__ */ jsxs10("div", { className: "shortcut", children: [
      /* @__PURE__ */ jsx16("dt", { children: keys }),
      /* @__PURE__ */ jsx16("dd", { children: action })
    ] }, i)) }),
    /* @__PURE__ */ jsxs10(Column2, { gap: 1, align: "start", children: [
      /* @__PURE__ */ jsx16(
        DownloadLink,
        {
          data: exports.readText(`${exports.slug}-model-notes.txt`),
          filename: `${exports.slug}-model-notes.txt`,
          children: "Source notes"
        }
      ),
      /* @__PURE__ */ jsx16(
        DownloadLink,
        {
          data: exports.readText(`${exports.slug}-validation.json`),
          filename: `${exports.slug}-validation.json`,
          type: "application/json",
          children: "Validation report"
        }
      )
    ] })
  ] });
}

// src/viewer/useArtifactArchive.js
import { useMemo as useMemo3 } from "react";
import { unzipSync, strFromU8 } from "fflate";
function useArtifactArchive(exportData) {
  return useMemo3(() => {
    const bundle = Uint8Array.from(
      atob(exportData.bundle),
      (c) => c.charCodeAt(0)
    );
    const entries = unzipSync(bundle);
    const textCache = /* @__PURE__ */ new Map();
    return {
      slug: exportData.slug,
      bundle,
      readText(name) {
        if (!entries[name]) throw new Error(`Missing export ${name}`);
        if (!textCache.has(name)) textCache.set(name, strFromU8(entries[name]));
        return textCache.get(name);
      }
    };
  }, [exportData]);
}

// src/viewer/zoomStore.js
function createZoomStore() {
  let zoom = 100;
  const listeners = /* @__PURE__ */ new Set();
  return {
    getSnapshot: () => zoom,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(value) {
      if (value === zoom) return;
      zoom = value;
      listeners.forEach((listener) => listener());
    }
  };
}

// src/viewer/reviewedPayload.js
var reviews = /* @__PURE__ */ new WeakMap();
function reviewedPayload(payload) {
  const comparison = payload.comparison;
  const document2 = payload.model.document;
  if (!comparison)
    return { payload, review: null, provenanceDocument: document2 };
  let review = reviews.get(comparison);
  if (!review) {
    const capturedAt = document2?.snapshots?.find(
      (s) => s.id === document2.baselineId
    )?.capture?.capturedAt;
    review = { comparison, baselineDate: formatCaptureDate(capturedAt) };
    reviews.set(comparison, review);
  }
  return {
    payload: {
      ...payload,
      ...comparison.changeView || {},
      comparison: void 0
    },
    review,
    provenanceDocument: document2
  };
}

// src/viewer/useOverlayInsets.js
import { useCallback as useCallback2, useLayoutEffect as useLayoutEffect4 } from "react";
var GAP = 8;
function useOverlayInsets(viewerRef, topRef) {
  useLayoutEffect4(() => {
    const viewer = viewerRef.current, top = topRef.current;
    if (!viewer || !top || typeof ResizeObserver !== "function") return;
    const update = () => viewer.style.setProperty(
      "--atlas-top-inset",
      `${Math.round(top.offsetTop + top.offsetHeight + GAP)}px`
    );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(top);
    return () => observer.disconnect();
  }, [viewerRef, topRef]);
  return useCallback2(
    (canvas) => {
      const viewer = viewerRef.current || canvas?.parentElement;
      if (!viewer) return null;
      const box = viewer.getBoundingClientRect();
      const edge = (selector) => viewer.querySelector(selector)?.getBoundingClientRect();
      const top = edge(":scope > .atlas-overlay-top");
      const inspector = edge(":scope > .side-panel.open");
      const layers = edge(":scope > .atlas-overlay-layers");
      return {
        top: top ? Math.max(0, top.bottom - box.top) : 0,
        bottom: 0,
        left: layers && layers.width < box.width * 0.4 ? Math.max(0, layers.right - box.left) : 0,
        // A full-width inspector on narrow panels covers the diagram anyway.
        right: inspector && inspector.width < box.width * 0.6 ? Math.max(0, box.right - inspector.left) : 0,
        // Panels that may cover a selected node, in canvas coordinates.
        obstacles: inspector && inspector.width < box.width * 0.6 ? [
          {
            left: inspector.left - box.left,
            top: inspector.top - box.top,
            right: inspector.right - box.left,
            bottom: inspector.bottom - box.top
          }
        ] : []
      };
    },
    [viewerRef]
  );
}

// src/viewer/useToolbarDensity.js
import { useLayoutEffect as useLayoutEffect5, useRef as useRef4, useState as useState5 } from "react";
var MAX_LEVEL = 3;
var HYSTERESIS = 24;
function useToolbarDensity(topRef, resetKey, contentKey) {
  const [level, setLevel] = useState5(0);
  const limits = useRef4([]);
  useLayoutEffect5(() => {
    limits.current = [];
    setLevel(0);
  }, [resetKey]);
  useLayoutEffect5(() => {
    const top = topRef.current;
    if (!top || typeof ResizeObserver !== "function") return;
    const check = () => {
      const width = top.clientWidth;
      const islands = [...top.children].filter(
        (child) => child.classList.contains("atlas-island")
      );
      if (!width || !islands.length) return;
      const stacked = top.classList.contains("stacked");
      const row = Math.min(...islands.map((island) => island.offsetTop));
      const wrapped = (island) => {
        const controls = Math.max(
          0,
          ...[...island.children].map((child) => child.offsetHeight)
        );
        return island.offsetHeight > controls * 1.5 + 12;
      };
      const crowded = islands.some(
        (island) => !stacked && island.offsetTop > row + 4 || wrapped(island)
      );
      setLevel((current) => {
        if (current > 0 && width > limits.current[current - 1] + HYSTERESIS)
          return current - 1;
        if (crowded && current < MAX_LEVEL) {
          limits.current[current] = width;
          return current + 1;
        }
        return current;
      });
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(top);
    for (const child of top.children) observer.observe(child);
    return () => observer.disconnect();
  }, [topRef, level, resetKey, contentKey]);
  return level;
}

// src/viewer/useViewerState.jsx
import {
  useCallback as useCallback5,
  useEffect as useEffect4,
  useLayoutEffect as useLayoutEffect6,
  useMemo as useMemo5,
  useRef as useRef5,
  useState as useState9
} from "react";

// src/model/viewerModelIndex.js
function indexViewerModel(model, generalizationGroups = []) {
  const nodes = new Map(model.classes.map((node) => [node.id, node]));
  const names = new Map(model.classes.map((node) => [node.name, node]));
  const edges = new Map([
    ...model.relations.map((edge) => [
      edge.id,
      {
        ...edge,
        type: "association",
        source: nodes.get(edge.sourceId),
        target: nodes.get(edge.targetId)
      }
    ]),
    ...model.generalizations.map((edge) => [
      edge.id,
      {
        ...edge,
        type: "generalization",
        source: nodes.get(edge.specificId),
        target: nodes.get(edge.generalId)
      }
    ])
  ]);
  const sets = new Map((model.partitions || []).map((set) => [set.id, set]));
  const groups = new Map(
    generalizationGroups.map((group) => [
      group.id,
      {
        ...group,
        ...sets.get(group.id),
        evidence: sets.get(group.id)?.evidence || [],
        sources: group.sourceIds.map((id) => nodes.get(id)),
        target: nodes.get(group.target)
      }
    ])
  );
  return {
    nodes,
    names,
    edges,
    groups,
    getElement: (target) => target?.kind === "node" ? nodes.get(target.id) : target?.kind === "group" ? groups.get(target.id) : edges.get(target?.id)
  };
}
function viewForNode(views, currentKey, node) {
  return views.find(
    (view) => view.key === currentKey && view.nodeIds.includes(node.id)
  ) || views.find((view) => view.nodeIds.includes(node.id));
}

// src/model/inspectionTarget.js
function inspectionTarget(model, index2, views, viewKey, id) {
  const node = index2.nodes.get(id) || model.classes.find(
    (c) => [...c.attributes, ...c.methods || []].some((m) => m.id === id)
  );
  if (node) {
    const view2 = viewForNode(views, viewKey, node);
    return view2 ? {
      viewKey: view2.key,
      target: { kind: "node", id: node.id },
      nodeId: node.id,
      ...node.id !== id ? { memberId: id } : {}
    } : null;
  }
  const holds = (v) => v.diagram.edges.some((e) => e.id === id) || v.diagram.generalizationGroups?.some(
    (g) => g.id === id || g.memberIds.includes(id)
  );
  const view = views.find((v) => v.key === viewKey && holds(v)) || views.find(holds);
  if (!view) return null;
  const edge = view.diagram.edges.find((e) => e.id === id);
  return {
    viewKey: view.key,
    target: { kind: index2.edges.has(id) ? "edge" : "group", id },
    ...edge ? { nodeIds: [edge.source, edge.target] } : {}
  };
}

// src/viewer/useHover.js
import { useCallback as useCallback3, useState as useState6 } from "react";
import { flushSync } from "react-dom";
function useHover() {
  const [hovered, setHovered] = useState6(null);
  const hover = useCallback3((target) => {
    flushSync(
      () => setHovered((old) => sameTarget(old, target) ? old : target)
    );
  }, []);
  const clearHover = useCallback3(() => setHovered(null), []);
  return { hovered, hover, clearHover };
}

// src/review/useChangeReview.jsx
import { useCallback as useCallback4, useMemo as useMemo4, useState as useState8 } from "react";
import { Badge as Badge3, Button as Button3, Tooltip as Tooltip4 } from "@envsemble/envui";

// src/review/ChangesOverview.jsx
import { memo as memo3, useState as useState7 } from "react";
import { Badge as Badge2, Column as Column3, Disclosure, Text as Text5 } from "@envsemble/envui";

// src/review/ChangeMark.jsx
import { jsx as jsx17 } from "react/jsx-runtime";
function ChangeMark({ status }) {
  if (!CHANGE_LABELS[status]) return null;
  return /* @__PURE__ */ jsx17("span", { className: "change-mark", "data-change": status, "aria-hidden": "true", children: changeGlyph(status) });
}

// src/review/ChangesOverview.jsx
import { Fragment as Fragment6, jsx as jsx18, jsxs as jsxs11 } from "react/jsx-runtime";
function Summary({ row }) {
  const { summary } = row;
  const note = summary.note && /* @__PURE__ */ jsx18("span", { className: "change-row-note", children: summary.note });
  if (summary.tokens.length)
    return /* @__PURE__ */ jsxs11(Fragment6, { children: [
      /* @__PURE__ */ jsxs11("span", { className: "change-row-summary", children: [
        summary.tokens.map((token, i) => /* @__PURE__ */ jsxs11("span", { className: "change-token", "data-change": token.status, children: [
          /* @__PURE__ */ jsx18("span", { className: "change-token-glyph", "aria-hidden": "true", children: changeGlyph(token.status) }),
          /* @__PURE__ */ jsxs11("span", { className: "visually-hidden", children: [
            CHANGE_LABELS[token.status],
            " "
          ] }),
          token.text
        ] }, i)),
        summary.more > 0 && /* @__PURE__ */ jsxs11("span", { className: "change-token more", children: [
          "+",
          summary.more,
          " more"
        ] })
      ] }),
      note
    ] });
  if (!summary.text && !summary.more) return note || null;
  return /* @__PURE__ */ jsxs11(Fragment6, { children: [
    /* @__PURE__ */ jsxs11("span", { className: "change-row-summary", children: [
      summary.text,
      summary.more > 0 && /* @__PURE__ */ jsxs11("span", { className: "change-token more", children: [
        summary.text ? " " : "",
        "+",
        summary.more,
        " more"
      ] })
    ] }),
    note
  ] });
}
function ChangeRow({ row, active, onSelect, onHover }) {
  const content = /* @__PURE__ */ jsxs11(Fragment6, { children: [
    /* @__PURE__ */ jsx18(ChangeMark, { status: row.status }),
    /* @__PURE__ */ jsxs11("span", { className: "change-row-text", children: [
      /* @__PURE__ */ jsxs11("span", { className: "change-row-title", children: [
        /* @__PURE__ */ jsx18("span", { className: "change-row-name", children: row.name }),
        row.tag && /* @__PURE__ */ jsx18("span", { className: "change-row-tag", children: row.tag })
      ] }),
      /* @__PURE__ */ jsx18(Summary, { row })
    ] })
  ] });
  if (!row.target)
    return /* @__PURE__ */ jsx18("li", { className: "change-row static", "data-change": row.status, children: content });
  return /* @__PURE__ */ jsx18("li", { children: /* @__PURE__ */ jsx18(
    "button",
    {
      type: "button",
      className: "change-row",
      "data-change": row.status,
      "data-key": row.key,
      "aria-current": active ? "true" : void 0,
      onClick: () => onSelect(row),
      onPointerEnter: () => onHover?.(row.target),
      onPointerLeave: () => onHover?.(null),
      onFocus: () => onHover?.(row.target),
      onBlur: () => onHover?.(null),
      children: content
    }
  ) });
}
function RowList({ rows, label, active, onSelect, onHover }) {
  return /* @__PURE__ */ jsx18("ul", { className: "change-rows", "aria-label": label, children: rows.map((row) => /* @__PURE__ */ jsx18(
    ChangeRow,
    {
      row,
      active: active === row.key,
      onSelect,
      onHover
    },
    row.key
  )) });
}
function RelationRows({ group, active, onSelect, onHover }) {
  const rows = group.relations;
  const [open, setOpen] = useState7(() => rows.some((r) => r.key === active));
  const list = /* @__PURE__ */ jsx18(
    RowList,
    {
      rows,
      label: `${group.label} relations`,
      active,
      onSelect,
      onHover
    }
  );
  if (rows.length <= 3)
    return /* @__PURE__ */ jsxs11(Fragment6, { children: [
      /* @__PURE__ */ jsx18(Text5, { render: /* @__PURE__ */ jsx18("h4", {}), variant: "body-sm", className: "change-subheading", children: "Relations" }),
      list
    ] });
  return /* @__PURE__ */ jsx18(
    Disclosure,
    {
      className: "change-relations",
      title: `Relations \xB7 ${rows.length}`,
      open,
      onOpenChange: setOpen,
      children: list
    }
  );
}
function shown(item) {
  const own = item.closest("details");
  const fold = item.tagName === "SUMMARY" ? own?.parentElement?.closest("details") : own;
  return !fold || fold.open;
}
function moveFocus(event) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const buttons = [
    ...event.currentTarget.querySelectorAll("button.change-row, summary")
  ].filter(shown);
  const at = buttons.indexOf(document.activeElement);
  if (at < 0 && !["Home", "End"].includes(event.key)) return;
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.min(
    buttons.length - 1,
    Math.max(0, at + (event.key === "ArrowDown" ? 1 : -1))
  );
  event.preventDefault();
  buttons[next]?.focus();
}
var ChangesOverview = memo3(function ChangesOverview2({
  rollup,
  baselineDate,
  profile,
  active,
  onSelect,
  onHover
}) {
  const source = profile === "code" ? "the code" : profile === "database" ? "the database" : "the model";
  return /* @__PURE__ */ jsxs11(Column3, { gap: 4, className: "changes-overview", children: [
    /* @__PURE__ */ jsx18(Text5, { variant: "body-sm", children: rollup.total ? `Compared with ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.` : `No changes to ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.` }),
    rollup.conflicts.length > 0 && /* @__PURE__ */ jsxs11("section", { className: "change-group", "data-change": "conflict", children: [
      /* @__PURE__ */ jsxs11(
        Text5,
        {
          render: /* @__PURE__ */ jsx18("h3", {}),
          variant: "title",
          className: "atlas-section-heading change-group-heading",
          children: [
            "Conflicts",
            /* @__PURE__ */ jsx18(Badge2, { count: rollup.conflicts.length })
          ]
        }
      ),
      rollup.conflicts.map((conflict) => /* @__PURE__ */ jsx18(
        Disclosure,
        {
          title: conflict.path.join(" / ") || "References",
          children: /* @__PURE__ */ jsx18(Text5, { emphasis: "muted", children: conflict.reason })
        },
        conflict.id
      ))
    ] }),
    /* @__PURE__ */ jsx18("div", { className: "change-groups", onKeyDown: moveFocus, children: rollup.groups.map((group) => /* @__PURE__ */ jsxs11(
      "section",
      {
        className: "change-group",
        "data-change": group.status,
        "aria-label": `${group.label}, ${group.elements.length + group.relations.length}`,
        children: [
          /* @__PURE__ */ jsxs11(
            Text5,
            {
              render: /* @__PURE__ */ jsx18("h3", {}),
              variant: "title",
              className: "atlas-section-heading change-group-heading",
              children: [
                /* @__PURE__ */ jsx18(ChangeMark, { status: group.status }),
                group.label,
                /* @__PURE__ */ jsx18(Badge2, { count: group.elements.length + group.relations.length })
              ]
            }
          ),
          group.elements.length > 0 && /* @__PURE__ */ jsx18(
            RowList,
            {
              rows: group.elements,
              label: `${group.label} elements`,
              active,
              onSelect,
              onHover
            }
          ),
          group.relations.length > 0 && /* @__PURE__ */ jsx18(
            RelationRows,
            {
              group,
              active,
              onSelect,
              onHover
            }
          )
        ]
      },
      group.status
    )) })
  ] });
});
function ChangeNavigation({ position, total, name, onStep }) {
  if (!total) return null;
  return /* @__PURE__ */ jsxs11("span", { className: "change-stepper", role: "group", "aria-label": "Changes", children: [
    /* @__PURE__ */ jsx18(
      ToolButton,
      {
        label: "Previous change",
        icon: /* @__PURE__ */ jsx18(IconChevronLeft, {}),
        "aria-disabled": position === 0 || void 0,
        onClick: () => onStep(-1)
      }
    ),
    /* @__PURE__ */ jsxs11("span", { className: "change-position", "aria-live": "polite", "aria-atomic": "true", children: [
      position >= 0 ? `${position + 1} of ${total}` : `${total} ${total === 1 ? "change" : "changes"}`,
      position >= 0 && name && /* @__PURE__ */ jsxs11("span", { className: "visually-hidden", children: [
        ": ",
        name
      ] })
    ] }),
    /* @__PURE__ */ jsx18(
      ToolButton,
      {
        label: "Next change",
        icon: /* @__PURE__ */ jsx18(IconChevronRight, {}),
        "aria-disabled": position === total - 1 || void 0,
        onClick: () => onStep(1)
      }
    )
  ] });
}

// src/review/useChangeReview.jsx
import { Fragment as Fragment7, jsx as jsx19, jsxs as jsxs12 } from "react/jsx-runtime";
var ROOMY_WIDTH = 1280;
var overviewByDefault = () => typeof window !== "undefined" && window.innerWidth >= ROOMY_WIDTH;
function useChangeReview({
  review,
  model,
  views,
  selected,
  choose,
  hover
}) {
  const rollup = useMemo4(
    () => review ? cachedRollup(review.comparison, model, views) : null,
    [review, model, views]
  );
  const [fade, setFade] = useState8(true);
  const current = rollup && selected ? rowFor(rollup, selected, model) : null;
  const position = current ? rollup.navigable.indexOf(current) : -1;
  const total = rollup?.navigable.length || 0;
  const open = useCallback4(
    (row) => {
      if (row?.target) choose(row.target.id);
    },
    [choose]
  );
  const step = useCallback4(
    (delta) => {
      if (!rollup) return;
      const next = position < 0 ? delta > 0 ? 0 : total - 1 : position + delta;
      if (next < 0 || next >= total) return;
      open(rollup.navigable[next]);
    },
    [rollup, position, total, open]
  );
  const baselineDate = review?.baselineDate;
  const profile = model.document?.profile;
  const activeKey = current?.key;
  const content = useMemo4(
    () => rollup ? /* @__PURE__ */ jsx19(
      ChangesOverview,
      {
        rollup,
        baselineDate,
        profile,
        active: activeKey,
        onSelect: open,
        onHover: hover
      }
    ) : null,
    [rollup, baselineDate, profile, activeKey, open, hover]
  );
  if (!rollup) return null;
  return {
    rollup,
    fade,
    position,
    total,
    /** Toolbar controls: the Changes panel's toggle and fading. */
    controls: (showing, onToggle) => /* @__PURE__ */ jsxs12(Fragment7, { children: [
      /* @__PURE__ */ jsx19(
        Tooltip4,
        {
          content: showing ? "Hide the changes" : "Show every change",
          side: "bottom",
          children: /* @__PURE__ */ jsxs12(
            Button3,
            {
              variant: showing ? "primary" : "secondary",
              className: "changes-toggle",
              "aria-pressed": showing,
              "aria-label": `Changes, ${rollup.count}`,
              startIcon: /* @__PURE__ */ jsx19(IconDifference, {}),
              onClick: onToggle,
              children: [
                /* @__PURE__ */ jsx19("span", { className: "collapsible-label", children: "Changes" }),
                /* @__PURE__ */ jsx19(Badge3, { count: rollup.count })
              ]
            }
          )
        }
      ),
      /* @__PURE__ */ jsx19(
        ToolButton,
        {
          label: "Fade unchanged elements",
          pressed: fade,
          icon: /* @__PURE__ */ jsx19(IconContrast, {}),
          onClick: () => setFade((value) => !value)
        }
      )
    ] }),
    /** In the Changes panel's header: the previous and next change. */
    navigation: /* @__PURE__ */ jsx19(
      ChangeNavigation,
      {
        position,
        total,
        name: current?.label && current.label !== current.name ? `${current.name}, ${current.label}` : current?.name,
        onStep: step
      }
    ),
    /** The overview list for the Changes panel. */
    content
  };
}

// src/viewer/useViewerState.jsx
function useViewerState({
  model,
  views,
  scenarios,
  review,
  focus,
  identity,
  cameraRef
}) {
  const [viewKey, setViewKey] = useState9(views[0].key);
  const [selected, setSelected] = useState9(null);
  const [focusRequest, setFocusRequest] = useState9(null);
  const [side, setSide] = useState9(
    () => overviewByDefault() ? "changes" : null
  );
  const { hovered, hover, clearHover } = useHover();
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = view.diagram;
  const index2 = useMemo5(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups]
  );
  const select = useCallback5(
    (target) => {
      clearHover();
      setSelected((old) => sameTarget(old, target) ? old : target);
    },
    [clearHover]
  );
  const choose = useCallback5(
    (id) => {
      const next = inspectionTarget(model, index2, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      if (next.nodeId) setFocusRequest({ id: next.nodeId });
      else if (next.nodeIds) setFocusRequest({ ids: next.nodeIds });
    },
    [index2, model, views, viewKey, select]
  );
  const changes = useChangeReview({
    review,
    model,
    views,
    selected,
    choose,
    hover
  });
  const panel = side === "changes" && changes ? "changes" : side === "scenarios" && scenarios ? "scenarios" : null;
  const togglePanel = useCallback5(
    (kind) => setSide(panel === kind ? null : kind),
    [panel]
  );
  const closePanel = useCallback5(() => setSide(null), []);
  const changeView = useCallback5(
    (key) => {
      setViewKey(key);
      setFocusRequest(null);
      clearHover();
    },
    [clearHover]
  );
  const lastFocus = useRef5(null);
  useEffect4(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [identity, select]);
  useEffect4(() => {
    if (!selected) return;
    const shown2 = selected.kind === "node" ? diagram.nodes.some((n) => n.id === selected.id) : selected.kind === "edge" ? diagram.edges.some((e) => e.id === selected.id) || diagram.generalizationGroups?.some(
      (g) => g.memberIds.includes(selected.id)
    ) : diagram.generalizationGroups?.some((g) => g.id === selected.id);
    if (!index2.getElement(selected) || !shown2) select(null);
  }, [index2, diagram, selected, select]);
  useEffect4(() => {
    if (sameTarget(lastFocus.current, focus)) return;
    lastFocus.current = focus;
    if (!focus) return;
    if (focus.kind === "view" && views.some((v) => v.key === focus.id))
      setViewKey(focus.id);
    else choose(focus.id);
  }, [focus, choose, views]);
  useEffect4(() => {
    const escape = (e) => {
      if (e.key === "Escape" && e.target.closest?.(".viewer")) select(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [select]);
  useLayoutEffect6(() => {
    if (panel && selected?.kind === "node")
      cameraRef.current?.revealNode(selected.id);
  }, [panel]);
  const inspectScenario = useCallback5(
    (id) => {
      if (index2.nodes.has(id)) return choose(id);
      const groupView = views.find(
        (v) => v.diagram.generalizationGroups?.some((g) => g.id === id)
      );
      if (!groupView) return choose(id);
      setViewKey(groupView.key);
      select({ kind: "group", id });
    },
    [index2, views, choose, select]
  );
  return {
    view,
    diagram,
    selected,
    select,
    hovered,
    hover,
    clearHover,
    focusRequest,
    choose,
    changes,
    panel,
    togglePanel,
    closePanel,
    changeView,
    inspectScenario
  };
}

// src/scenarios/ScenarioPanel.jsx
import { useMemo as useMemo6 } from "react";
import {
  Alert,
  Badge as Badge4,
  Button as Button4,
  Column as Column4,
  Disclosure as Disclosure2,
  Text as Text6
} from "@envsemble/envui";
import { Fragment as Fragment8, jsx as jsx20, jsxs as jsxs13 } from "react/jsx-runtime";
function verdict(scenario) {
  const met = scenario.result.expectationMet;
  const expected = scenario.expected === "invalid" ? "Invalid" : "Valid";
  if (met === null)
    return { tone: "neutral", text: `${expected} \xB7 not fully checked` };
  return met ? { tone: "success", text: `${expected} \xB7 as expected` } : { tone: "danger", text: `${expected} expected \xB7 differs` };
}
function Examples({ examples, model, names, onInspect }) {
  const classNames = new Map(model.classes.map((c) => [c.id, c.name]));
  return /* @__PURE__ */ jsx20(Column4, { gap: 5, children: examples.map((scenario) => {
    const { tone, text } = verdict(scenario);
    const labels = new Map(
      scenario.instances.map((i) => [i.id, i.label || i.id])
    );
    return /* @__PURE__ */ jsxs13(Column4, { gap: 2, className: "example", children: [
      /* @__PURE__ */ jsxs13("div", { className: "example-head", children: [
        /* @__PURE__ */ jsx20(
          Text6,
          {
            render: /* @__PURE__ */ jsx20("h3", {}),
            variant: "title",
            className: "atlas-section-heading",
            children: scenario.title
          }
        ),
        /* @__PURE__ */ jsx20(Badge4, { tone, children: text })
      ] }),
      scenario.description && /* @__PURE__ */ jsx20(Text6, { children: scenario.description }),
      scenario.result.issues.map((issue, i) => /* @__PURE__ */ jsxs13(Alert, { tone: "warning", children: [
        issue.message,
        issue.elementId && names.has(issue.elementId) && /* @__PURE__ */ jsxs13(Fragment8, { children: [
          " ",
          /* @__PURE__ */ jsx20(
            Button4,
            {
              variant: "text",
              className: "inline-action",
              onClick: () => onInspect(issue.elementId),
              children: names.get(issue.elementId)
            }
          )
        ] })
      ] }, i)),
      /* @__PURE__ */ jsxs13(
        Disclosure2,
        {
          title: `${scenario.instances.length} instances \xB7 ${scenario.links.length} links`,
          children: [
            /* @__PURE__ */ jsx20("ul", { className: "example-list", children: scenario.instances.map((instance) => /* @__PURE__ */ jsxs13("li", { children: [
              /* @__PURE__ */ jsx20("strong", { children: instance.label || instance.id }),
              ": ",
              instance.classIds.map((id) => classNames.get(id) || id).join(", ")
            ] }, instance.id)) }),
            scenario.links.length > 0 && /* @__PURE__ */ jsx20("ul", { className: "example-list", children: scenario.links.map((link, i) => /* @__PURE__ */ jsxs13("li", { children: [
              labels.get(link.sourceId) || link.sourceId,
              " \u2192",
              " ",
              /* @__PURE__ */ jsx20("em", { children: names.get(link.relationId) || link.relationId }),
              " \u2192",
              " ",
              labels.get(link.targetId) || link.targetId
            ] }, i)) }),
            scenario.result.unassessed.map((u, i) => /* @__PURE__ */ jsx20(Text6, { emphasis: "muted", children: u.message }, i))
          ]
        }
      )
    ] }, scenario.id);
  }) });
}
function ScenarioPanel({ model, scenarios = null, onInspect }) {
  const elementNames = useMemo6(
    () => new Map(
      [...model.classes, ...model.relations, ...model.partitions || []].map(
        (e) => [e.originalId || e.id, e.name]
      )
    ),
    [model]
  );
  const examples = scenarios?.scenarios || [];
  if (!examples.length) return null;
  return /* @__PURE__ */ jsx20(Column4, { gap: 6, className: "scenario-panel", children: /* @__PURE__ */ jsxs13(Column4, { render: /* @__PURE__ */ jsx20("section", {}), gap: 3, "aria-label": "Examples", children: [
    /* @__PURE__ */ jsx20(
      Text6,
      {
        render: /* @__PURE__ */ jsx20("h3", {}),
        variant: "body-sm",
        className: "detail-section-title",
        children: "Examples"
      }
    ),
    /* @__PURE__ */ jsx20(
      Examples,
      {
        examples,
        model,
        names: elementNames,
        onInspect
      }
    )
  ] }) });
}

// src/ui/Panel.jsx
import { Surface as Surface3, Text as Text7 } from "@envsemble/envui";
import { jsx as jsx21, jsxs as jsxs14 } from "react/jsx-runtime";
function Panel({
  open,
  onClose,
  label,
  title = label,
  toolbar = null,
  closeLabel = "Close",
  children,
  id = "panel",
  className = "",
  ...props
}) {
  return /* @__PURE__ */ jsx21(
    Surface3,
    {
      render: /* @__PURE__ */ jsx21("aside", {}),
      background: "default",
      padding: 0,
      id,
      className: `panel${open ? " open" : ""}${className ? ` ${className}` : ""}`,
      "aria-label": label,
      ...props,
      children: /* @__PURE__ */ jsxs14("div", { className: "panel-scroll", children: [
        /* @__PURE__ */ jsxs14("div", { className: "panel-header", children: [
          /* @__PURE__ */ jsx21(
            Text7,
            {
              render: /* @__PURE__ */ jsx21("h2", {}),
              variant: "title",
              className: "atlas-section-heading panel-title",
              children: title
            }
          ),
          toolbar,
          onClose && /* @__PURE__ */ jsx21(
            ToolButton,
            {
              className: "panel-close",
              label: closeLabel,
              icon: /* @__PURE__ */ jsx21(IconClose, {}),
              onClick: onClose
            }
          )
        ] }),
        /* @__PURE__ */ jsx21("div", { className: "panel-content", children })
      ] })
    }
  );
}

// src/viewer/SidePanel.jsx
import { jsx as jsx22, jsxs as jsxs15 } from "react/jsx-runtime";
function SidePanel({ state, model, scenarios }) {
  const { panel, changes, closePanel, hover, inspectScenario } = state;
  if (!panel) return null;
  const showsChanges = panel === "changes";
  return /* @__PURE__ */ jsxs15(
    Panel,
    {
      id: "side-panel",
      className: "side-panel",
      open: true,
      title: showsChanges ? "Changes" : "Understand the model",
      label: showsChanges ? "Changes in this proposal" : "Model guide",
      toolbar: showsChanges ? changes.navigation : null,
      closeLabel: showsChanges ? "Hide the changes" : "Close the guide",
      onClose: closePanel,
      onPointerLeave: () => hover(null),
      children: [
        showsChanges && changes.content,
        panel === "scenarios" && /* @__PURE__ */ jsx22(
          ScenarioPanel,
          {
            model,
            scenarios,
            onInspect: inspectScenario
          }
        )
      ]
    }
  );
}

// src/viewer/DiagramViewer.jsx
import { jsx as jsx23, jsxs as jsxs16 } from "react/jsx-runtime";
function DiagramViewer(props) {
  const { payload, review, provenanceDocument } = reviewedPayload(props);
  if (!payload.views.length)
    return /* @__PURE__ */ jsxs16("main", { className: "viewer-error", children: [
      /* @__PURE__ */ jsx23(ProvenanceBadge, { document: provenanceDocument, className: "inline" }),
      /* @__PURE__ */ jsx23(
        EmptyState,
        {
          headingLevel: 1,
          title: payload.model.title,
          description: "No entities in this model."
        }
      )
    ] });
  return /* @__PURE__ */ jsx23(
    ViewerContent,
    {
      ...payload,
      focus: props.focus,
      review,
      provenanceDocument
    }
  );
}
function useOptionalThemePreference() {
  try {
    return useThemePreference();
  } catch {
    return null;
  }
}
function ViewerContent({
  model,
  views,
  exports: exportData,
  scenarios = null,
  focus = null,
  review = null,
  provenanceDocument
}) {
  const exports = useArtifactArchive(exportData);
  const preference = useOptionalThemePreference();
  const ambientTheme = useTheme();
  const theme = preference?.theme || ambientTheme;
  const [aboutOpen, setAboutOpen] = useState10(false);
  const zoomStore = useMemo7(createZoomStore, []);
  const cameraRef = useRef6(null);
  const viewerRef = useRef6(null), toolbarRef = useRef6(null);
  const fitInsets = useOverlayInsets(viewerRef, toolbarRef);
  const density = useToolbarDensity(
    toolbarRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`
  );
  const state = useViewerState({
    model,
    views,
    scenarios,
    review,
    focus,
    identity: model.id,
    cameraRef
  });
  const { view, diagram, changes, panel } = state;
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(`${exports.slug}-${view.key}.svg`),
    theme,
    viewerRef,
    !!changes?.fade
  );
  return /* @__PURE__ */ jsxs16(
    "div",
    {
      ref: viewerRef,
      className: `viewer${panel ? " with-panel" : ""}${changes?.fade ? " fade-unchanged" : ""}`,
      children: [
        /* @__PURE__ */ jsx23(
          ViewerToolbar,
          {
            ref: toolbarRef,
            density,
            reviewControls: changes?.controls(
              panel === "changes",
              () => state.togglePanel("changes")
            ),
            provenance: provenanceDocument,
            hasScenarios: !!scenarios,
            scenariosOpen: panel === "scenarios",
            ...{
              model,
              views,
              exports,
              theme,
              zoomStore,
              diagramURL
            },
            viewKey: view.key,
            aboutOpen,
            onView: state.changeView,
            themeToggle: !!preference,
            onScenarios: () => state.togglePanel("scenarios"),
            onAbout: () => setAboutOpen(true),
            onZoom: (factor) => cameraRef.current.zoomBy(factor),
            onReset: () => cameraRef.current.reset(),
            onFit: () => cameraRef.current.fit()
          }
        ),
        /* @__PURE__ */ jsx23(
          DiagramCanvas,
          {
            ref: cameraRef,
            diagram,
            selected: state.selected,
            hovered: state.hovered,
            focusRequest: state.focusRequest,
            backgroundURL,
            fitInsets,
            onSelect: state.select,
            onZoom: zoomStore.set,
            onHover: state.hover,
            onClearHover: state.clearHover
          }
        ),
        /* @__PURE__ */ jsx23(SidePanel, { state, model, scenarios }),
        /* @__PURE__ */ jsx23(
          Dialog,
          {
            open: aboutOpen,
            onOpenChange: setAboutOpen,
            title: model.title,
            description: "About this diagram and its controls",
            children: /* @__PURE__ */ jsx23(
              About,
              {
                model,
                exports,
                provenance: provenanceDocument
              }
            )
          }
        )
      ]
    }
  );
}

// src/viewer/DiagramPanel.jsx
import { memo as memo4, useMemo as useMemo9, useRef as useRef8 } from "react";
import { Theme } from "@envsemble/envui";

// src/viewer/useArrangement.js
import { useCallback as useCallback6, useEffect as useEffect5, useMemo as useMemo8, useRef as useRef7, useState as useState11 } from "react";

// src/canvas/arrange.mjs
var MARGIN = 12;
var STUB = 18;
var PORT_GAP = 20;
var BEND = 24;
var SOFT = 4;
var JUNCTION = 28;
var PADDING = 28;
var PLACE_GAP = 40;
var NUDGE = 8;
var PACKAGE_MARGIN = 16;
var PACKAGE_HEADER = 22;
var REGION = 64;
var CELL = 96;
var RANK = 0.1;
var TRACK = 10;
var SHARED = 12;
var CROSSING = 240;
var LABEL_CROSSING = 120;
var DX = [1, 0, -1, 0];
var DY = [0, 1, 0, -1];
var round = (n) => Number(n.toFixed(2));
var clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
var centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
var pointBox = (p) => ({ x: p.x, y: p.y, width: 0, height: 0 });
function parsePath(d) {
  const n = (d.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) || []).map(Number);
  const points = [];
  for (let i = 0; i + 1 < n.length; i += 2)
    points.push({ x: n[i], y: n[i + 1] });
  return points;
}
var pathOf = (points) => points.map((p, i) => (i ? "L" : "M") + round(p.x) + " " + round(p.y)).join(" ");
function simplify(points) {
  const out = [];
  const same2 = (a, b) => Math.abs(a - b) < 0.01;
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same2(last.x, p.x) && same2(last.y, p.y)) continue;
    const before = out[out.length - 2];
    if (before && (same2(before.x, last.x) && same2(last.x, p.x) || same2(before.y, last.y) && same2(last.y, p.y))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}
function segmentsOf(points) {
  const out = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]]);
  return out;
}
function crosses(a, b, box, inset) {
  const left = box.x + inset, right = box.x + box.width - inset, top = box.y + inset, bottom = box.y + box.height - inset;
  if (left >= right || top >= bottom) return false;
  return Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom;
}
function hits(points, boxes, skip) {
  for (let i = 1; i < points.length; i++)
    for (const box of boxes)
      if (!skip?.has(box.id) && crosses(points[i - 1], points[i], box, 1))
        return true;
  return false;
}
function overlapping(a, b, gap = 0) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}
function rectTouchesSegment(r, a, b, gap) {
  return Math.max(a.x, b.x) > r.x - gap && Math.min(a.x, b.x) < r.x + r.width + gap && Math.max(a.y, b.y) > r.y - gap && Math.min(a.y, b.y) < r.y + r.height + gap;
}
var alongY = (side) => side % 2 === 0;
function sideRange(box, side) {
  return alongY(side) ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
}
function portPoint(box, side, t) {
  if (side === 0) return { x: box.x + box.width, y: t };
  if (side === 1) return { x: t, y: box.y + box.height };
  if (side === 2) return { x: box.x, y: t };
  return { x: t, y: box.y };
}
function facing(box, other) {
  const gapX = Math.max(
    other.x - (box.x + box.width),
    box.x - (other.x + other.width)
  );
  const gapY = Math.max(
    other.y - (box.y + box.height),
    box.y - (other.y + other.height)
  );
  const a = centreOf(box), b = centreOf(other);
  if (gapX >= gapY) return b.x >= a.x ? 0 : 2;
  return b.y >= a.y ? 1 : 3;
}
function sideOf(box, p) {
  for (let side = 0; side < 4; side++) {
    const t = alongY(side) ? p.y : p.x;
    const q = portPoint(box, side, t);
    const [lo, hi] = sideRange(box, side);
    if (Math.abs(q.x - p.x) < 1.5 && Math.abs(q.y - p.y) < 1.5 && t >= lo - 1 && t <= hi + 1)
      return side;
  }
  return -1;
}
function sideSpan(box, side) {
  const [lo, hi] = sideRange(box, side);
  const inset = Math.min(16, (hi - lo) / 4);
  return [lo + inset, hi - inset];
}
function preferredAlong(box, side, other) {
  const [lo, hi] = sideSpan(box, side);
  const [olo, ohi] = sideSpan(other, side + 2 & 3);
  const from = Math.max(lo, olo), to = Math.min(hi, ohi);
  if (from <= to) return (from + to) / 2;
  const c = alongY(side) ? centreOf(other).y : centreOf(other).x;
  return clamp(c, lo, hi);
}
function spread(items, lo, hi) {
  const n = items.length;
  const gap = n > 1 ? Math.min(PORT_GAP, Math.max(0, hi - lo) / (n - 1)) : 0;
  const top = Math.max(lo, hi - (n - 1) * gap);
  const blocks = [];
  items.forEach((item, i) => {
    let block = {
      total: (item.pref - i * gap) * item.weight,
      weight: item.weight,
      count: 1
    };
    while (blocks.length && blocks[blocks.length - 1].total / blocks[blocks.length - 1].weight >= block.total / block.weight) {
      const last = blocks.pop();
      block = {
        total: last.total + block.total,
        weight: last.weight + block.weight,
        count: last.count + block.count
      };
    }
    blocks.push(block);
  });
  const out = [];
  for (const block of blocks) {
    const v = clamp(block.total / block.weight, lo, top);
    for (let k = 0; k < block.count; k++) out.push(v + out.length * gap);
  }
  return out;
}
function freePlace(pref, taken, lo, hi, gap) {
  const clear = (v) => taken.every((t) => Math.abs(t - v) >= gap - 0.01);
  const candidates = [clamp(pref, lo, hi)];
  for (const t of taken) candidates.push(t - gap, t + gap);
  let best = null;
  for (const c of candidates)
    if (c >= lo - 0.01 && c <= hi + 0.01 && clear(c)) {
      if (best === null || Math.abs(c - pref) < Math.abs(best - pref)) best = c;
    }
  if (best !== null) return best;
  const edges = [lo, ...taken.filter((t) => t > lo && t < hi), hi].sort(
    (a, b) => a - b
  );
  let at = clamp(pref, lo, hi), widest = -1;
  for (let k = 1; k < edges.length; k++)
    if (edges[k] - edges[k - 1] > widest) {
      widest = edges[k] - edges[k - 1];
      at = (edges[k] + edges[k - 1]) / 2;
    }
  return at;
}
function stubLength(box, side, port, boxes) {
  let room = Infinity;
  for (const o of boxes) {
    if (o.id === box.id) continue;
    if (alongY(side)) {
      if (port.y <= o.y - MARGIN || port.y >= o.y + o.height + MARGIN) continue;
      const d = side === 0 ? o.x - port.x : port.x - (o.x + o.width);
      if (d >= 0) room = Math.min(room, d);
    } else {
      if (port.x <= o.x - MARGIN || port.x >= o.x + o.width + MARGIN) continue;
      const d = side === 1 ? o.y - port.y : port.y - (o.y + o.height);
      if (d >= 0) room = Math.min(room, d);
    }
  }
  return clamp(room / 2, 2, STUB);
}
var Heap = class {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = i - 1 >> 1;
      if (keys[parent] <= key) break;
      keys[i] = keys[parent];
      values[i] = values[parent];
      i = parent;
    }
    keys[i] = key;
    values[i] = value;
  }
  pop() {
    const { keys, values } = this;
    const top = values[0];
    const key = keys.pop(), value = values.pop();
    if (keys.length) {
      let i = 0;
      const n = keys.length;
      for (; ; ) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= key) break;
        keys[i] = keys[child];
        values[i] = values[child];
        i = child;
      }
      keys[i] = key;
      values[i] = value;
    }
    return top;
  }
};
function uniqueSorted(values) {
  values.sort((a, b) => a - b);
  const out = [];
  for (const v of values)
    if (!out.length || v !== out[out.length - 1]) out.push(v);
  return out;
}
function indexIn(sorted, v) {
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return sorted[lo] === v ? lo : -1;
}
function firstAt(sorted, v) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = lo + hi >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function search(from, fromDir, to, arrival, obstacles, region, occupied) {
  const xv = [region.x0, region.x1, from.x, to.x];
  const yv = [region.y0, region.y1, from.y, to.y];
  for (const o of obstacles) {
    xv.push(round(o.x - MARGIN), round(o.x + o.width + MARGIN));
    yv.push(round(o.y - MARGIN), round(o.y + o.height + MARGIN));
  }
  const inside = (v, lo, hi) => v >= lo && v <= hi;
  const flat = (occupied?.flat || []).filter(
    (g) => inside(g.y, region.y0, region.y1) && g.x1 >= region.x0 && g.x0 <= region.x1
  );
  const upright = (occupied?.upright || []).filter(
    (g) => inside(g.x, region.x0, region.x1) && g.y1 >= region.y0 && g.y0 <= region.y1
  );
  flat.sort((a, b) => a.y - b.y);
  upright.sort((a, b) => a.x - b.x);
  const flatAt = flat.map((g) => g.y), uprightAt = upright.map((g) => g.x);
  if (!occupied?.wide) {
    for (const g of flat)
      for (const y of [g.y - TRACK, g.y + TRACK])
        if (inside(y, region.y0, region.y1)) yv.push(round(y));
    for (const g of upright)
      for (const x of [g.x - TRACK, g.x + TRACK])
        if (inside(x, region.x0, region.x1)) xv.push(round(x));
  }
  const labels = (occupied?.labels || []).filter(
    (l) => l.x < region.x1 && l.x + l.width > region.x0 && l.y < region.y1 && l.y + l.height > region.y0
  );
  const xs = uniqueSorted(xv), ys = uniqueSorted(yv);
  const nx = xs.length, ny = ys.length;
  const si = indexIn(xs, from.x), sj = indexIn(ys, from.y), gi = indexIn(xs, to.x), gj = indexIn(ys, to.y);
  if (si < 0 || sj < 0 || gi < 0 || gj < 0) return null;
  const states = nx * ny * 4;
  const GOAL = states;
  const cost = new Float64Array(states + 1).fill(Infinity);
  const parent = new Int32Array(states + 1).fill(-1);
  const closed = new Uint8Array(states + 1);
  const across = new Float64Array(Math.max(0, (nx - 1) * ny)).fill(-1);
  const down = new Float64Array(Math.max(0, nx * (ny - 1))).fill(-1);
  const cells = /* @__PURE__ */ new Map();
  const cellOf = (v) => Math.floor(v / CELL);
  obstacles.forEach((o, n) => {
    for (let cx = cellOf(o.x - MARGIN); cx <= cellOf(o.x + o.width + MARGIN); cx++)
      for (let cy = cellOf(o.y - MARGIN); cy <= cellOf(o.y + o.height + MARGIN); cy++) {
        const key = cx * 65536 + cy;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(n);
      }
  });
  const labelCells = /* @__PURE__ */ new Map();
  labels.forEach((l, n) => {
    for (let cx = cellOf(l.x); cx <= cellOf(l.x + l.width); cx++)
      for (let cy = cellOf(l.y); cy <= cellOf(l.y + l.height); cy++) {
        const key = cx * 65536 + cy;
        if (!labelCells.has(key)) labelCells.set(key, []);
        labelCells.get(key).push(n);
      }
  });
  let visit = 0;
  const seen = new Int32Array(obstacles.length);
  const labelSeen = new Int32Array(labels.length);
  const classify = (x1, y1, x2, y2) => {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    let soft = false;
    visit++;
    for (let cx = cellOf(x1); cx <= cellOf(x2); cx++)
      for (let cy = cellOf(y1); cy <= cellOf(y2); cy++)
        for (const n of cells.get(cx * 65536 + cy) || []) {
          if (seen[n] === visit) continue;
          seen[n] = visit;
          const o = obstacles[n];
          if (crosses(a, b, o, 0.5)) return Infinity;
          if (!soft && crosses(a, b, o, 0.5 - MARGIN)) soft = true;
        }
    const length = x2 - x1 + (y2 - y1);
    let extra = 0;
    if (y1 === y2) {
      const near = firstAt(flatAt, y1 - TRACK + 0.5);
      for (let k = near; k < flat.length && flatAt[k] < y1 + TRACK - 0.5; k++)
        extra += Math.max(0, Math.min(x2, flat[k].x1) - Math.max(x1, flat[k].x0)) * (SHARED - 1);
      for (let k = firstAt(uprightAt, x1 + 1e-6); k < upright.length; k++) {
        if (uprightAt[k] > x2 + 1e-6) break;
        if (y1 > upright[k].y0 && y1 < upright[k].y1) extra += CROSSING;
      }
    } else {
      const near = firstAt(uprightAt, x1 - TRACK + 0.5);
      for (let k = near; k < upright.length && uprightAt[k] < x1 + TRACK - 0.5; k++)
        extra += Math.max(
          0,
          Math.min(y2, upright[k].y1) - Math.max(y1, upright[k].y0)
        ) * (SHARED - 1);
      for (let k = firstAt(flatAt, y1 + 1e-6); k < flat.length; k++) {
        if (flatAt[k] > y2 + 1e-6) break;
        if (x1 > flat[k].x0 && x1 < flat[k].x1) extra += CROSSING;
      }
    }
    for (let cx = cellOf(x1); cx <= cellOf(x2); cx++)
      for (let cy = cellOf(y1); cy <= cellOf(y2); cy++)
        for (const n of labelCells.get(cx * 65536 + cy) || []) {
          if (labelSeen[n] === visit) continue;
          labelSeen[n] = visit;
          if (crosses(a, b, labels[n], 0.5))
            extra += length * (SOFT - 1) + LABEL_CROSSING;
        }
    return (soft ? length * SOFT : length) + extra;
  };
  const step = (i, j, d) => {
    if (d === 0 || d === 2) {
      const a = d === 0 ? i : i - 1;
      const k2 = j * (nx - 1) + a;
      if (across[k2] < 0) across[k2] = classify(xs[a], ys[j], xs[a + 1], ys[j]);
      return across[k2];
    }
    const b = d === 1 ? j : j - 1;
    const k = i * (ny - 1) + b;
    if (down[k] < 0) down[k] = classify(xs[i], ys[b], xs[i], ys[b + 1]);
    return down[k];
  };
  const goalPoint = gj * nx + gi;
  const heap = new Heap();
  const start = (sj * nx + si) * 4 + fromDir;
  cost[start] = 0;
  heap.push(Math.abs(from.x - to.x) + Math.abs(from.y - to.y), start);
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    if (s === GOAL) break;
    const p = s >> 2, d = s & 3;
    const i = p % nx, j = (p - i) / nx;
    if (p === goalPoint) {
      const total = cost[s] + arrival[d];
      if (total < cost[GOAL]) {
        cost[GOAL] = total;
        parent[GOAL] = s;
        heap.push(total, GOAL);
      }
    }
    for (let nd = 0; nd < 4; nd++) {
      if (nd === (d + 2 & 3)) continue;
      const ni = i + DX[nd], nj = j + DY[nd];
      if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
      const c = step(i, j, nd);
      if (c === Infinity) continue;
      const ns = (nj * nx + ni) * 4 + nd;
      const g = cost[s] + c + (nd === d ? 0 : BEND);
      if (g < cost[ns]) {
        cost[ns] = g;
        parent[ns] = s;
        heap.push(g + Math.abs(xs[ni] - to.x) + Math.abs(ys[nj] - to.y), ns);
      }
    }
  }
  if (parent[GOAL] < 0) return null;
  const points = [];
  for (let s = parent[GOAL]; s >= 0; s = parent[s]) {
    const p = s >> 2;
    const i = p % nx;
    points.push({ x: xs[i], y: ys[(p - i) / nx] });
  }
  return points.reverse();
}
function occupancy() {
  const flat = [], upright = [], labels = [];
  return {
    flat,
    upright,
    // Labels that stay: a route may cross one, at a cost.
    labels,
    wide: false,
    add(points) {
      for (let k = 1; k < (points?.length || 0); k++) {
        const a = points[k - 1], b = points[k];
        if (a.y === b.y && a.x !== b.x)
          flat.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) });
        else if (a.x === b.x && a.y !== b.y)
          upright.push({
            x: a.x,
            y0: Math.min(a.y, b.y),
            y1: Math.max(a.y, b.y)
          });
      }
    }
  };
}
function regionAround(points, boxes, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of [...points.map(pointBox), ...boxes]) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return {
    x0: round(x0 - pad),
    y0: round(y0 - pad),
    x1: round(x1 + pad),
    y1: round(y1 + pad)
  };
}
function routeBetween(start, end, boxes, near, everything, occupied) {
  const local = regionAround([start.stub, end.stub], near, REGION);
  const tries = [
    [
      local,
      boxes.filter(
        (o) => o.x - MARGIN < local.x1 && o.x + o.width + MARGIN > local.x0 && o.y - MARGIN < local.y1 && o.y + o.height + MARGIN > local.y0
      )
    ],
    [regionAround([start.stub, end.stub], [everything], REGION), boxes]
  ];
  for (const [region, obstacles] of tries) {
    const found = search(
      start.stub,
      start.dir,
      end.stub,
      end.arrival,
      obstacles,
      region,
      obstacles === boxes && occupied && !occupied.wide ? { ...occupied, wide: true } : occupied
    );
    if (!found) continue;
    const points = simplify([start.port, ...found, end.port]);
    if (obstacles === boxes || !hits(points, boxes)) return points;
  }
  return simplify([
    start.port,
    start.stub,
    { x: end.stub.x, y: start.stub.y },
    end.stub,
    end.port
  ]);
}
function arrivalInto(side) {
  const arrival = [BEND, BEND, BEND, BEND];
  arrival[side + 2 & 3] = 0;
  arrival[side] = Infinity;
  return arrival;
}
function selfLoop(box, k, boxes) {
  const a = Math.min(16 + 12 * k, box.width / 2, box.height / 2);
  const r = 20 + 10 * k;
  const loopAt = (corner) => {
    const sx = corner === 0 || corner === 1 ? 1 : -1;
    const sy = corner === 1 || corner === 2 ? 1 : -1;
    const kx = sx > 0 ? box.x + box.width : box.x;
    const ky = sy > 0 ? box.y + box.height : box.y;
    const points = [
      { x: kx, y: ky - sy * a },
      { x: kx + sx * r, y: ky - sy * a },
      { x: kx + sx * r, y: ky + sy * r },
      { x: kx - sx * a, y: ky + sy * r },
      { x: kx - sx * a, y: ky }
    ].map((p) => ({ x: round(p.x), y: round(p.y) }));
    return { points, sides: [sx > 0 ? 0 : 2, sy > 0 ? 1 : 3] };
  };
  for (const corner of [0, 1, 3, 2]) {
    const loop = loopAt(corner);
    const area = regionAround(loop.points, [], MARGIN);
    const clear = !boxes.some(
      (o) => o.id !== box.id && overlapping(
        {
          x: area.x0,
          y: area.y0,
          width: area.x1 - area.x0,
          height: area.y1 - area.y0
        },
        o
      )
    );
    if (clear) return loop;
  }
  return loopAt(0);
}
function centreJogs(route, boxes, others = []) {
  const p = route.points;
  for (let k = 1; k < p.length - 2; k++) {
    const a = p[k], b = p[k + 1], before = p[k - 1], after = p[k + 2];
    const vertical = Math.abs(a.x - b.x) < 0.01;
    const axis = vertical ? "x" : "y", cross = vertical ? "y" : "x", size = vertical ? "width" : "height", crossSize = vertical ? "height" : "width";
    const c = a[axis];
    const d1 = c - before[axis], d2 = after[axis] - c;
    if (d1 * d2 <= 0) continue;
    const firstMin = k === 1 ? route.stubs[0] : 4;
    const lastMin = k + 2 === p.length - 1 ? route.stubs[1] : 4;
    let lo = d1 > 0 ? before[axis] + firstMin : after[axis] + lastMin;
    let hi = d1 > 0 ? after[axis] - lastMin : before[axis] - firstMin;
    const spanLo = Math.min(a[cross], b[cross]), spanHi = Math.max(a[cross], b[cross]);
    let blocked = false;
    for (const o of boxes) {
      if (o[cross] - MARGIN > spanHi || o[cross] + o[crossSize] + MARGIN < spanLo)
        continue;
      const from = o[axis] - MARGIN, to = o[axis] + o[size] + MARGIN;
      if (to <= c) lo = Math.max(lo, to);
      else if (from >= c) hi = Math.min(hi, from);
      else blocked = true;
    }
    for (const [m, n] of others) {
      if (vertical ? m.x !== n.x : m.y !== n.y) continue;
      if (Math.max(m[cross], n[cross]) < spanLo || Math.min(m[cross], n[cross]) > spanHi)
        continue;
      const v = m[axis];
      if (v <= c) lo = Math.max(lo, v + TRACK);
      else hi = Math.min(hi, v - TRACK);
    }
    if (blocked || lo > hi || c < lo - 0.01 || c > hi + 0.01) continue;
    a[axis] = b[axis] = round((lo + hi) / 2);
  }
}
function nudge(routes, boxes) {
  const lines = /* @__PURE__ */ new Map();
  routes.forEach((route, r) => {
    const p = route.points;
    for (let k = 0; k + 1 < p.length; k++) {
      const vertical = Math.abs(p[k].x - p[k + 1].x) < 0.01;
      const c = vertical ? p[k].x : p[k].y;
      const ends = vertical ? [p[k].y, p[k + 1].y] : [p[k].x, p[k + 1].x];
      const key = (vertical ? "v" : "h") + c;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({
        r,
        k,
        vertical,
        lo: Math.min(...ends),
        hi: Math.max(...ends),
        movable: route.movable && k > 0 && k < p.length - 2
      });
    }
  });
  const offsets = [
    0,
    NUDGE,
    -NUDGE,
    2 * NUDGE,
    -2 * NUDGE,
    3 * NUDGE,
    -3 * NUDGE
  ];
  const shift = (seg, offset) => {
    const p = routes[seg.r].points;
    const axis = seg.vertical ? "x" : "y";
    const moved = p.map((q) => ({ ...q }));
    moved[seg.k][axis] = round(moved[seg.k][axis] + offset);
    moved[seg.k + 1][axis] = round(moved[seg.k + 1][axis] + offset);
    for (const [i, j] of [
      [seg.k - 1, seg.k],
      [seg.k + 1, seg.k + 2]
    ]) {
      const before = p[j][axis] - p[i][axis], after = moved[j][axis] - moved[i][axis];
      if (before * after <= 0 || Math.abs(after) < 4) return false;
      if (boxes.some((o) => crosses(moved[i], moved[j], o, 0.5))) return false;
    }
    if (boxes.some((o) => crosses(moved[seg.k], moved[seg.k + 1], o, -MARGIN / 2)))
      return false;
    routes[seg.r].points = moved;
    return true;
  };
  for (const segments of lines.values()) {
    if (segments.length < 2) continue;
    segments.sort((a, b) => a.lo - b.lo);
    let cluster = [];
    let reach = -Infinity;
    const settle = () => {
      if (new Set(cluster.map((s) => s.r)).size > 1 && cluster.some((s) => s.movable)) {
        const used = new Set(cluster.some((s) => !s.movable) ? [0] : []);
        for (const seg of cluster.filter((s) => s.movable))
          for (const offset of offsets) {
            if (used.has(offset)) continue;
            if (offset === 0 || shift(seg, offset)) {
              used.add(offset);
              break;
            }
          }
      }
    };
    for (const seg of segments) {
      if (seg.lo >= reach - 1 && cluster.length) {
        settle();
        cluster = [];
      }
      cluster.push(seg);
      reach = Math.max(reach, seg.hi);
    }
    settle();
  }
}
function nameCandidates(label, routes) {
  const segments = routes.flatMap(segmentsOf).map(([a, b]) => ({
    a,
    b,
    length: Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
  })).filter((s) => s.length > 0).sort((s, t) => t.length - s.length);
  const out = [];
  for (const { a, b, length } of segments) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const ux = Math.sign(b.x - a.x), uy = Math.sign(b.y - a.y);
    for (let n = 0; n < 41; n++) {
      const offset = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 8;
      if (Math.abs(offset) > length / 2) break;
      const x = mid.x + ux * offset, y = mid.y + uy * offset;
      if (uy === 0)
        out.push(
          { x: x - label.width / 2, y: y - label.height - 4 },
          { x: x - label.width / 2, y: y + 4 }
        );
      else
        out.push(
          { x: x + 6, y: y - label.height / 2 },
          { x: x - label.width - 6, y: y - label.height / 2 }
        );
    }
  }
  return out;
}
function endCandidates(label, points) {
  const endpoint = points[0];
  const candidates = [];
  for (const x of [endpoint.x + 4, endpoint.x - label.width - 4])
    for (const y of [endpoint.y + 4, endpoint.y - label.height - 4])
      candidates.push({ x, y, score: label.width / 2 + label.height / 2 + 24 });
  let traveled = 0;
  for (let i = 1; i < points.length && traveled < 260; i++) {
    const a = points[i - 1], b = points[i], dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y), length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    for (let d = 10; d < Math.min(length, 260 - traveled); d += 8) {
      const x = a.x + dx * d, y = a.y + dy * d;
      if (dx) {
        const left = dx > 0 ? x : x - label.width;
        candidates.push(
          { x: left, y: y - label.height - 3, score: traveled + d + 4 },
          { x: left, y: y + 3, score: traveled + d + 6 }
        );
      } else
        candidates.push(
          { x: x + 4, y: y - label.height / 2, score: traveled + d + 12 },
          {
            x: x - label.width - 4,
            y: y - label.height / 2,
            score: traveled + d + 14
          }
        );
    }
    traveled += length;
  }
  return candidates.filter(
    (c) => Math.abs(c.x + label.width / 2 - endpoint.x) + Math.abs(c.y + label.height / 2 - endpoint.y) <= 80
  ).sort((a, b) => a.score - b.score);
}
function placeLabels(tasks, boxes, fixedLabels, allSegments) {
  const occupied = [...boxes, ...fixedLabels];
  for (const names of [true, false])
    for (const task of tasks) {
      const own = task.routes.flatMap(segmentsOf);
      for (const label of task.labels) {
        if (label.kind === "name" !== names) continue;
        const candidates = names ? nameCandidates(label, task.nameRoutes) : endCandidates(
          label,
          label.kind === "target" ? task.routes[0].slice().reverse() : task.routes[0]
        );
        const fits = (c, tier) => {
          const r = {
            x: c.x,
            y: c.y,
            width: label.width,
            height: label.height
          };
          const others = tier < 3 ? occupied : boxes;
          if (others.some((o) => overlapping(r, o, 2))) return false;
          if (tier < 2 && own.some(([a, b]) => rectTouchesSegment(r, a, b, 1)))
            return false;
          if (tier < 1 && allSegments.some(([a, b]) => rectTouchesSegment(r, a, b, 1)))
            return false;
          return true;
        };
        let chosen = null, lowest = Infinity;
        for (let rank = 0; rank < candidates.length; rank++) {
          if (rank * RANK >= lowest) break;
          const c = candidates[rank];
          const r = {
            x: c.x,
            y: c.y,
            width: label.width,
            height: label.height
          };
          if (boxes.some((o) => overlapping(r, o, 2))) continue;
          let cost = rank * RANK;
          for (const o of occupied) if (overlapping(r, o, 2)) cost += 400;
          for (const [a, b] of allSegments)
            if (rectTouchesSegment(r, a, b, 1)) cost += 120;
          for (const [a, b] of own)
            if (rectTouchesSegment(r, a, b, 1)) cost += 60;
          if (cost < lowest) {
            lowest = cost;
            chosen = c;
          }
        }
        if (!chosen)
          for (let tier = 0; tier < 4 && !chosen; tier++)
            chosen = candidates.find((c) => fits(c, tier)) || null;
        chosen || (chosen = candidates[0] || { x: label.x, y: label.y });
        label.x = round(chosen.x);
        label.y = round(chosen.y);
        occupied.push(label);
      }
    }
}
function placeMissing(scene, target) {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  const neighbours = new Map(scene.nodes.map((n) => [n.id, /* @__PURE__ */ new Set()]));
  const link = (a, b) => {
    if (a === b || !neighbours.has(a) || !neighbours.has(b)) return;
    neighbours.get(a).add(b);
    neighbours.get(b).add(a);
  };
  for (const e of scene.edges) link(e.source, e.target);
  for (const g of scene.generalizationGroups || [])
    for (const id of g.sourceIds) link(id, g.target);
  const boxAt = (id, [x, y]) => ({
    x,
    y,
    width: byId.get(id).width,
    height: byId.get(id).height
  });
  const placed = [...target].map(([id, p]) => boxAt(id, p));
  const free = (b) => !placed.some((o) => overlapping(b, o, PLACE_GAP - 0.01));
  const right = Math.max(
    PADDING - PLACE_GAP,
    ...placed.map((b) => b.x + b.width)
  );
  let columnY = placed.length ? Math.min(...placed.map((b) => b.y)) : PADDING;
  const columnX = right + PLACE_GAP;
  const pending = scene.nodes.filter((n) => !target.has(n.id));
  while (pending.length) {
    let progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const node2 = pending[i];
      const near = [...neighbours.get(node2.id)].filter((id) => target.has(id));
      if (!near.length) continue;
      const centres = near.map((id) => centreOf(boxAt(id, target.get(id))));
      const cx = centres.reduce((s, c) => s + c.x, 0) / centres.length;
      const cy = centres.reduce((s, c) => s + c.y, 0) / centres.length;
      const want = { x: cx - node2.width / 2, y: cy - node2.height / 2 };
      let spot = null;
      for (let r = 0; r < 400 && !spot; r++) {
        let best = Infinity;
        const ring = r ? Array.from({ length: 2 * r + 1 }, (_, k) => k - r).flatMap((k) => [
          [k, -r],
          [k, r],
          [-r, k],
          [r, k]
        ]) : [[0, 0]];
        for (const [i2, j2] of ring) {
          const b = {
            x: want.x + i2 * 20,
            y: want.y + j2 * 20,
            width: node2.width,
            height: node2.height
          };
          const d = Math.hypot(b.x - want.x, b.y - want.y);
          if (d < best && free(b)) {
            best = d;
            spot = [round(b.x), round(b.y)];
          }
        }
      }
      target.set(node2.id, spot || [round(want.x), round(want.y)]);
      placed.push(boxAt(node2.id, target.get(node2.id)));
      pending.splice(i--, 1);
      progressed = true;
    }
    if (progressed) continue;
    const node = pending.shift();
    let y = columnY;
    while (!free({ x: columnX, y, width: node.width, height: node.height }))
      y += 20;
    target.set(node.id, [round(columnX), round(y)]);
    placed.push(boxAt(node.id, target.get(node.id)));
    columnY = y + node.height + PLACE_GAP;
  }
}
function positionsOf(scene) {
  return Object.fromEntries(scene.nodes.map((n) => [n.id, [n.x, n.y]]));
}
function arrangeScene(scene, positions = {}, options = {}) {
  positions = positions || {};
  if (options.place && !Object.keys(positions).length) return scene;
  const target = /* @__PURE__ */ new Map();
  for (const n of scene.nodes) {
    const p = positions[n.id];
    if (p) target.set(n.id, Array.isArray(p) ? p : [p.x, p.y]);
    else if (!options.place) target.set(n.id, [n.x, n.y]);
  }
  if (options.place) placeMissing(scene, target);
  const moved = /* @__PURE__ */ new Set();
  const nodes = scene.nodes.map((n) => {
    const [x, y] = target.get(n.id);
    if (Math.abs(x - n.x) < 5e-3 && Math.abs(y - n.y) < 5e-3) return n;
    moved.add(n.id);
    return { ...n, x: round(x), y: round(y) };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boxes = nodes;
  const everything = regionAround([], boxes, 0);
  const everythingBox = {
    x: everything.x0,
    y: everything.y0,
    width: everything.x1 - everything.x0,
    height: everything.y1 - everything.y0
  };
  const groups = scene.generalizationGroups || [];
  const membership = /* @__PURE__ */ new Map();
  for (const g of groups)
    for (const id of g.memberIds) {
      if (!membership.has(id)) membership.set(id, []);
      membership.get(id).push({ group: g, index: membership.get(id).length });
    }
  const edgesById = new Map(scene.edges.map((e) => [e.id, e]));
  const plain = [];
  for (const edge of scene.edges) {
    if (membership.has(edge.id)) continue;
    const ok = byId.has(edge.source) && byId.has(edge.target);
    const points = edge.paths?.length ? parsePath(edge.paths[0]) : [];
    const reroute = ok && (moved.has(edge.source) || moved.has(edge.target) || points.length < 2 || hits(points, boxes, /* @__PURE__ */ new Set([edge.source, edge.target])));
    plain.push({ edge, points, reroute });
  }
  const trees = groups.map((group) => {
    const members = group.memberIds.map((id) => {
      const edge = edgesById.get(id);
      const index2 = membership.get(id).find((m) => m.group === group).index;
      const d = edge?.branchPaths?.[index2];
      return { id, edge, index: index2, points: d ? parsePath(d) : [] };
    });
    const trunk = group.paths?.length ? parsePath(group.paths[0]) : [];
    const ok = byId.has(group.target) && members.every((m) => m.edge && byId.has(m.edge.source));
    const reroute = ok && (moved.has(group.target) || members.some((m) => moved.has(m.edge.source)) || trunk.length < 2 || hits(trunk, boxes, /* @__PURE__ */ new Set([group.target])) || members.some(
      (m) => m.points.length < 2 || hits(m.points, boxes, /* @__PURE__ */ new Set([m.edge.source]))
    ));
    return { group, members, trunk, reroute };
  });
  const sides = /* @__PURE__ */ new Map();
  const addEnd = (box, side, item) => {
    const key = box.id + "\0" + side;
    if (!sides.has(key)) sides.set(key, { box, side, items: [] });
    sides.get(key).items.push(item);
  };
  const fixEnd = (id, p) => {
    const box = byId.get(id);
    if (!box || !p) return;
    const side = sideOf(box, p);
    if (side >= 0) addEnd(box, side, { pref: alongY(side) ? p.y : p.x });
  };
  for (const r of plain)
    if (!r.reroute && r.points.length) {
      fixEnd(r.edge.source, r.points[0]);
      fixEnd(r.edge.target, r.points[r.points.length - 1]);
    }
  for (const t of trees)
    if (!t.reroute) {
      fixEnd(t.group.target, t.trunk[t.trunk.length - 1]);
      for (const m of t.members) if (m.edge) fixEnd(m.edge.source, m.points[0]);
    }
  const loopCount = /* @__PURE__ */ new Map();
  for (const r of plain)
    if (r.reroute && r.edge.source === r.edge.target) {
      const box = byId.get(r.edge.source);
      const k = loopCount.get(box.id) || 0;
      loopCount.set(box.id, k + 1);
      const loop = selfLoop(box, k, boxes);
      r.route = loop.points;
      fixEnd(box.id, loop.points[0]);
      fixEnd(box.id, loop.points[loop.points.length - 1]);
    }
  const room = (box, side) => {
    const [lo, hi] = sideSpan(box, side);
    const used = sides.get(box.id + "\0" + side)?.items.length || 0;
    return Math.floor((hi - lo) / PORT_GAP) + 1 - used;
  };
  const endOf = (box, primary, other, order = "") => {
    let side = primary;
    if (room(box, primary) <= 0) {
      const o = centreOf(other), c = centreOf(box);
      const second = alongY(primary) ? o.y >= c.y ? 1 : 3 : o.x >= c.x ? 0 : 2;
      if (room(box, second) > 0) side = second;
    }
    const end = { box, side, along: null };
    addEnd(box, side, {
      pref: preferredAlong(box, side, other),
      weight: 1,
      order,
      end
    });
    return end;
  };
  for (const r of plain)
    if (r.reroute && !r.route) {
      const s = byId.get(r.edge.source), t = byId.get(r.edge.target);
      r.ends = [
        endOf(s, facing(s, t), t, r.edge.id),
        endOf(t, facing(t, s), s, r.edge.id)
      ];
    }
  for (const t of trees)
    if (t.reroute) {
      const box = byId.get(t.group.target);
      const sources = t.members.map((m) => centreOf(byId.get(m.edge.source)));
      const centroid = {
        x: sources.reduce((s, c) => s + c.x, 0) / sources.length,
        y: sources.reduce((s, c) => s + c.y, 0) / sources.length
      };
      const side = facing(box, pointBox(centroid));
      const [lo, hi] = sideRange(box, side);
      const middle = (lo + hi) / 2;
      const along = round(
        clamp(
          alongY(side) ? centroid.y : centroid.x,
          middle - (hi - lo) / 6,
          middle + (hi - lo) / 6
        )
      );
      const port = portPoint(box, side, along);
      const junction = {
        x: round(port.x + DX[side] * JUNCTION),
        y: round(port.y + DY[side] * JUNCTION)
      };
      t.side = side;
      t.trunk = [junction, port];
      addEnd(box, side, { pref: along });
      for (const m of t.members) {
        const s = byId.get(m.edge.source);
        m.end = endOf(
          s,
          facing(s, pointBox(junction)),
          pointBox(junction),
          m.id
        );
      }
    }
  for (const { box, side, items } of sides.values()) {
    if (!items.some((item) => item.end)) continue;
    const [lo, hi] = sideSpan(box, side);
    const gap = Math.min(
      PORT_GAP,
      Math.max(0, hi - lo) / Math.max(1, items.length - 1)
    );
    const fixed = items.filter((item) => !item.end).map((item) => item.pref).sort((p, q) => p - q);
    const stretches = [];
    let start = lo;
    for (const f of fixed) {
      stretches.push({
        lo: Math.max(lo, start),
        hi: Math.min(hi, f - gap),
        items: []
      });
      start = f + gap;
    }
    stretches.push({ lo: Math.max(lo, start), hi, items: [] });
    const open = stretches.filter((st) => st.hi >= st.lo - 0.01);
    const fresh = items.filter((item) => item.end).sort(
      (p, q) => p.pref - q.pref || (p.order < q.order ? -1 : p.order > q.order ? 1 : 0)
    );
    const capacity = (st) => Math.max(1, Math.floor((st.hi - st.lo) / Math.max(gap, 1e-6) + 1e-6) + 1);
    const overflow = [];
    for (const item of fresh) {
      const ranked = open.map((st) => ({
        st,
        away: item.pref < st.lo ? st.lo - item.pref : item.pref > st.hi ? item.pref - st.hi : 0
      })).sort((p, q) => p.away - q.away);
      const home = ranked.find(({ st }) => st.items.length < capacity(st))?.st;
      if (home) home.items.push(item);
      else overflow.push(item);
    }
    const taken = [...fixed];
    for (const st of open) {
      if (!st.items.length) continue;
      const at = spread(st.items, st.lo, Math.max(st.lo, st.hi));
      st.items.forEach((item, k) => {
        item.end.along = round(at[k]);
        taken.push(item.end.along);
      });
    }
    for (const item of overflow) {
      item.end.along = round(freePlace(item.pref, taken, lo, hi, gap));
      taken.push(item.end.along);
    }
  }
  const terminal = (end) => {
    const port = portPoint(end.box, end.side, end.along);
    const length = round(stubLength(end.box, end.side, port, boxes));
    const stub = {
      x: round(port.x + DX[end.side] * length),
      y: round(port.y + DY[end.side] * length)
    };
    return { port, stub, length };
  };
  const occupied = occupancy();
  if (options.quick) occupied.wide = true;
  for (const r of plain)
    if (!r.reroute) {
      occupied.add(r.points);
      occupied.labels.push(...r.edge.labels || []);
    }
  for (const t of trees)
    if (!t.reroute) {
      occupied.add(t.trunk);
      for (const m of t.members) occupied.add(m.points);
    }
  const pending = plain.filter((r) => r.reroute && !r.route).map((r) => ({ r, from: terminal(r.ends[0]), to: terminal(r.ends[1]) })).sort(
    (a, b) => Math.abs(a.from.stub.x - a.to.stub.x) + Math.abs(a.from.stub.y - a.to.stub.y) - (Math.abs(b.from.stub.x - b.to.stub.x) + Math.abs(b.from.stub.y - b.to.stub.y)) || (a.r.edge.id < b.r.edge.id ? -1 : 1)
  );
  const routed = [];
  for (const { r, from, to } of pending) {
    r.route = routeBetween(
      { ...from, dir: r.ends[0].side },
      { ...to, arrival: arrivalInto(r.ends[1].side) },
      boxes,
      [r.ends[0].box, r.ends[1].box],
      everythingBox,
      occupied
    );
    occupied.add(r.route);
    routed.push({
      points: r.route,
      movable: true,
      stubs: [from.length, to.length],
      owner: r
    });
  }
  for (const t of trees)
    if (t.reroute) {
      const junction = t.trunk[0];
      const arrival = [0, 0, 0, 0];
      arrival[t.side] = Infinity;
      for (const m of t.members) {
        const from = terminal(m.end);
        m.points = routeBetween(
          { ...from, dir: m.end.side },
          { port: junction, stub: junction, arrival },
          boxes,
          [m.end.box, byId.get(t.group.target)],
          everythingBox,
          occupied
        );
        occupied.add(m.points);
      }
    }
  const everyRoute = [
    ...routed.map((r) => r.points),
    ...plain.filter((r) => !r.reroute).map((r) => r.points),
    ...trees.flatMap((t) => [t.trunk, ...t.members.map((m) => m.points)])
  ];
  for (const route of routed)
    centreJogs(
      route,
      boxes,
      everyRoute.filter((p) => p !== route.points).flatMap(segmentsOf)
    );
  const drawn2 = [
    ...routed,
    ...plain.filter((r) => !r.reroute || !routed.some((x) => x.owner === r)).map((r) => ({ points: r.route || r.points, movable: false })),
    ...trees.flatMap((t) => [
      { points: t.trunk, movable: false },
      ...t.members.map((m) => ({ points: m.points, movable: false }))
    ])
  ];
  nudge(drawn2, boxes);
  for (const route of routed) route.owner.route = route.points;
  const tasks = [];
  const fixedLabels = [];
  const newLabels = /* @__PURE__ */ new Map();
  const relabel = (owner, labels, routes, nameRoutes) => {
    const copies = labels.map((l) => ({ ...l }));
    newLabels.set(owner, copies);
    tasks.push({ labels: copies, routes, nameRoutes });
  };
  for (const r of plain) {
    const labels = r.edge.labels || [];
    if (!labels.length) continue;
    const route = r.route || r.points;
    if (r.route || route.length >= 2 && labels.some((l) => boxes.some((b) => overlapping(l, b, 0))))
      relabel(r.edge, labels, [route], [route]);
    else fixedLabels.push(...labels);
  }
  for (const t of trees) {
    const labels = t.group.labels || [];
    if (!labels.length) continue;
    const routes = [t.trunk, ...t.members.map((m) => m.points)];
    if (t.reroute || t.trunk.length >= 2 && labels.some((l) => boxes.some((b) => overlapping(l, b, 0))))
      relabel(t.group, labels, [t.trunk], routes);
    else fixedLabels.push(...labels);
  }
  const allSegments = drawn2.flatMap((d) => segmentsOf(d.points));
  placeLabels(tasks, boxes, fixedLabels, allSegments);
  const changed = /* @__PURE__ */ new Map();
  for (const r of plain)
    if (r.route || newLabels.has(r.edge))
      changed.set(r.edge.id, {
        ...r.edge,
        ...r.route ? { paths: [pathOf(r.route)] } : {},
        labels: newLabels.get(r.edge) || r.edge.labels
      });
  const newGroups = trees.map((t) => {
    if (!t.reroute && !newLabels.has(t.group)) return t.group;
    if (t.reroute)
      for (const m of t.members) {
        const edge = changed.get(m.id) || m.edge;
        const paths = [...edge.paths];
        const branchPaths = [...edge.branchPaths || []];
        paths[m.index] = pathOf([...m.points, ...t.trunk.slice(1)]);
        branchPaths[m.index] = pathOf(m.points);
        changed.set(m.id, { ...edge, paths, branchPaths });
      }
    return {
      ...t.group,
      ...t.reroute ? { paths: [pathOf(t.trunk)] } : {},
      labels: newLabels.get(t.group) || t.group.labels
    };
  });
  let edges = scene.edges.map((e) => changed.get(e.id) || e);
  let outGroups = newGroups;
  let outNodes = nodes;
  const placedNodes = new Map(nodes.map((n) => [n.id, n]));
  let packages = (scene.packages || []).map((p) => {
    const own = (p.members || []).map((id) => placedNodes.get(id)).filter(Boolean);
    if (!own.length) return p;
    const px0 = Math.min(...own.map((n) => n.x)) - PACKAGE_MARGIN, py0 = Math.min(...own.map((n) => n.y)) - PACKAGE_MARGIN - PACKAGE_HEADER, px1 = Math.max(...own.map((n) => n.x + n.width)) + PACKAGE_MARGIN, py1 = Math.max(...own.map((n) => n.y + n.height)) + PACKAGE_MARGIN;
    return {
      ...p,
      x: round(px0),
      y: round(py0),
      width: round(px1 - px0),
      height: round(py1 - py0)
    };
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x, y, w = 0, h = 0) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x + w);
    y1 = Math.max(y1, y + h);
  };
  for (const n of nodes) take(n.x, n.y, n.width, n.height);
  for (const p of packages) take(p.x, p.y, p.width, p.height);
  for (const item of [...edges, ...outGroups]) {
    for (const d of item.paths || [])
      for (const p of parsePath(d)) take(p.x, p.y);
    for (const l of item.labels || []) take(l.x, l.y, l.width, l.height);
  }
  if (x0 === Infinity) x0 = y0 = x1 = y1 = PADDING;
  const dx = x0 < PADDING ? round(PADDING - x0) : 0;
  const dy = y0 < PADDING ? round(PADDING - y0) : 0;
  if (dx || dy) {
    const movePath = (d) => pathOf(parsePath(d).map((p) => ({ x: p.x + dx, y: p.y + dy })));
    const moveLabel = (l) => ({ ...l, x: round(l.x + dx), y: round(l.y + dy) });
    const moveItem = (item) => ({
      ...item,
      ...item.paths ? { paths: item.paths.map(movePath) } : {},
      ...item.branchPaths ? { branchPaths: item.branchPaths.map(movePath) } : {},
      ...item.labels ? { labels: item.labels.map(moveLabel) } : {}
    });
    outNodes = nodes.map((n) => ({
      ...n,
      x: round(n.x + dx),
      y: round(n.y + dy)
    }));
    edges = edges.map(moveItem);
    outGroups = outGroups.map(moveItem);
    packages = packages.map((p) => ({
      ...p,
      x: round(p.x + dx),
      y: round(p.y + dy)
    }));
  }
  return {
    ...scene,
    nodes: outNodes,
    edges,
    ...scene.generalizationGroups ? { generalizationGroups: outGroups } : {},
    ...scene.packages ? { packages } : {},
    width: round(x1 + dx + PADDING),
    height: round(y1 + dy + PADDING),
    offset: { x: dx, y: dy }
  };
}

// src/viewer/useArrangement.js
var EDGE = 28;
var PACKAGE_MARGIN2 = 16;
var PACKAGE_HEADER2 = 22;
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var tenth = (n) => Math.round(n * 10) / 10;
var rounded = (positions) => Object.fromEntries(
  Object.entries(positions).map(([id, [x, y]]) => [id, [tenth(x), tenth(y)]])
);
function useArrangement(base, arrangement, onArrange) {
  const [positions, setPositions] = useState11(arrangement ?? null);
  const lastSaved = useRef7(arrangement ?? null);
  useEffect5(() => {
    if (same(lastSaved.current, arrangement ?? null)) return;
    lastSaved.current = arrangement ?? null;
    setPositions(arrangement ?? null);
  }, [arrangement]);
  const scene = useMemo8(
    () => positions ? arrangeScene(base, positions, { place: true }) : base,
    [base, positions]
  );
  const dragging = useRef7(null);
  const [drag, setDrag] = useState11(null);
  const shown2 = useMemo8(
    // While it moves, routes keep off each other by cost alone (quick);
    // when it is let go they are routed in full.
    () => drag?.at ? arrangeScene(scene, { [drag.id]: drag.at }, { quick: true }) : scene,
    [scene, drag]
  );
  const latest = useRef7({ scene, positions });
  latest.current = { scene, positions };
  const save = useCallback6(
    (next) => {
      const value = next && rounded(next);
      lastSaved.current = value;
      setPositions(value);
      onArrange?.(value);
    },
    [onArrange]
  );
  const elementDrag = useMemo8(
    () => onArrange ? {
      start(target, point) {
        const id = target?.closest?.("[data-node-id]")?.dataset.nodeId;
        const node = latest.current.scene.nodes.find((n) => n.id === id);
        if (!node) return false;
        const packaged = (latest.current.scene.packages || []).some(
          (p) => p.members?.includes(id)
        );
        dragging.current = {
          id,
          grab: [point.x - node.x, point.y - node.y],
          least: packaged ? [
            EDGE + PACKAGE_MARGIN2,
            EDGE + PACKAGE_MARGIN2 + PACKAGE_HEADER2
          ] : [EDGE, EDGE],
          at: null
        };
        setDrag(dragging.current);
        return true;
      },
      move(point) {
        const current = dragging.current;
        if (!current) return;
        dragging.current = {
          ...current,
          at: [
            Math.max(current.least[0], point.x - current.grab[0]),
            Math.max(current.least[1], point.y - current.grab[1])
          ]
        };
        setDrag(dragging.current);
      },
      end(moved) {
        const current = dragging.current;
        dragging.current = null;
        setDrag(null);
        if (!moved || !current?.at) return;
        const { scene: scene2, positions: positions2 } = latest.current;
        const placed = arrangeScene(scene2, { [current.id]: current.at });
        save({ ...positions2 || {}, ...positionsOf(placed) });
      }
    } : null,
    [onArrange, save]
  );
  const reset = useCallback6(() => save(null), [save]);
  return { diagram: shown2, elementDrag, arranged: !!positions, reset };
}

// src/viewer/DiagramPanel.jsx
import { Fragment as Fragment9, jsx as jsx24, jsxs as jsxs17 } from "react/jsx-runtime";
function overlayClass(sections, density = 0) {
  return `atlas-overlay-top${sections ? " stacked" : ""}${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`;
}
var DiagramPanel = memo4(function DiagramPanel2(props) {
  const { payload, review } = reviewedPayload(props.payload);
  if (!payload.views.length) {
    const theme = props.theme || "dark";
    return /* @__PURE__ */ jsx24(
      Theme,
      {
        theme,
        className: "atlas-panel atlas-empty",
        "data-theme": theme,
        children: /* @__PURE__ */ jsxs17("div", { className: "viewer", children: [
          (props.leading || props.sections) && /* @__PURE__ */ jsxs17("div", { className: overlayClass(props.sections), children: [
            props.sections && /* @__PURE__ */ jsx24("div", { className: "atlas-overlay-sections", children: props.sections }),
            props.leading && /* @__PURE__ */ jsx24(Island, { label: "Diagram navigation", className: "island-start", children: /* @__PURE__ */ jsx24("div", { className: "island-leading", children: props.leading }) })
          ] }),
          /* @__PURE__ */ jsx24(
            EmptyState,
            {
              className: "atlas-empty-message",
              title: payload.model.title,
              description: "No entities in this model."
            }
          )
        ] })
      }
    );
  }
  return /* @__PURE__ */ jsx24(
    DiagramPanelContent,
    {
      ...props,
      payload,
      review,
      identity: props.payload.family || payload.model.id
    }
  );
});
function DiagramPanelContent({
  payload,
  theme = "dark",
  focus = null,
  leading,
  sections,
  layers,
  review = null,
  identity,
  arrangement = null,
  onArrange
}) {
  const { model, views, scenarios = null } = payload;
  const camera = useRef8(null), zoomStore = useMemo9(createZoomStore, []);
  const viewerRef = useRef8(null), topRef = useRef8(null);
  const fitInsets = useOverlayInsets(viewerRef, topRef);
  const state = useViewerState({
    model,
    views,
    scenarios,
    review,
    focus,
    identity,
    cameraRef: camera
  });
  const { view, changes, panel } = state;
  const arranged = useArrangement(view.diagram, arrangement, onArrange);
  const density = useToolbarDensity(
    topRef,
    identity,
    `${views.map((v) => v.key).join()}:${!!review}`
  );
  const showViews = views.length > 1;
  const hasStart = !!leading || showViews || !!changes;
  return /* @__PURE__ */ jsx24(Theme, { theme, className: "atlas-panel", "data-theme": theme, children: /* @__PURE__ */ jsxs17(
    "div",
    {
      ref: viewerRef,
      className: `viewer${panel ? " with-panel" : ""}${changes?.fade ? " fade-unchanged" : ""}`,
      children: [
        /* @__PURE__ */ jsxs17("div", { className: overlayClass(sections, density), ref: topRef, children: [
          sections && /* @__PURE__ */ jsx24("div", { className: "atlas-overlay-sections", children: sections }),
          hasStart && /* @__PURE__ */ jsxs17(Island, { label: "Diagram navigation", className: "island-start", children: [
            leading && /* @__PURE__ */ jsx24("div", { className: "island-leading", children: leading }),
            leading && (showViews || changes) && /* @__PURE__ */ jsx24(IslandDivider, {}),
            showViews && /* @__PURE__ */ jsx24(
              ViewSwitcher,
              {
                items: views,
                compact: density > 0,
                value: view.key,
                onChange: state.changeView
              }
            ),
            showViews && changes && /* @__PURE__ */ jsx24(IslandDivider, {}),
            changes?.controls(
              panel === "changes",
              () => state.togglePanel("changes")
            )
          ] }),
          /* @__PURE__ */ jsxs17(Island, { label: "Diagram tools", className: "island-end", children: [
            /* @__PURE__ */ jsx24(
              CameraControls,
              {
                zoomStore,
                compact: density > 2,
                onZoom: (factor) => camera.current?.zoomBy(factor),
                onReset: () => camera.current?.reset(),
                onFit: () => camera.current?.fit()
              }
            ),
            onArrange && arranged.arranged && /* @__PURE__ */ jsx24(
              ToolButton,
              {
                label: "Reset layout",
                tooltip: "Lay the diagram out again, as Atlas arranges it",
                icon: /* @__PURE__ */ jsx24(IconRestartAlt, {}),
                onClick: arranged.reset
              }
            ),
            scenarios && /* @__PURE__ */ jsxs17(Fragment9, { children: [
              /* @__PURE__ */ jsx24(IslandDivider, {}),
              /* @__PURE__ */ jsx24(
                ToolButton,
                {
                  label: "Understand the model",
                  pressed: panel === "scenarios",
                  "aria-controls": "side-panel",
                  icon: /* @__PURE__ */ jsx24(IconSchool, {}),
                  onClick: () => state.togglePanel("scenarios")
                }
              )
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsx24(
          DiagramCanvas,
          {
            ref: camera,
            diagram: arranged.diagram,
            elementDrag: arranged.elementDrag,
            selected: state.selected,
            hovered: state.hovered,
            focusRequest: state.focusRequest,
            fitInsets,
            onSelect: state.select,
            onZoom: zoomStore.set,
            onHover: state.hover,
            onClearHover: state.clearHover
          }
        ),
        layers && /* @__PURE__ */ jsx24("div", { className: "atlas-overlay-layers", children: layers }),
        /* @__PURE__ */ jsx24(SidePanel, { state, model, scenarios })
      ]
    }
  ) });
}

// src/viewer/ViewerErrorBoundary.jsx
import { Component } from "react";
import { Alert as Alert2, Button as Button5 } from "@envsemble/envui";
import { jsx as jsx25 } from "react/jsx-runtime";
var ViewerErrorBoundary = class extends Component {
  constructor() {
    super(...arguments);
    __publicField(this, "state", { failed: false });
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(previous) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }
  render() {
    if (this.state.failed)
      return /* @__PURE__ */ jsx25("main", { className: "viewer-error", children: /* @__PURE__ */ jsx25(
        Alert2,
        {
          tone: "danger",
          announce: true,
          title: "The model could not be displayed",
          actions: /* @__PURE__ */ jsx25(Button5, { variant: "secondary", onClick: () => location.reload(), children: "Reload" }),
          children: "Rebuild the viewer from the model and check its validation report."
        }
      ) });
    return this.props.children;
  }
};
export {
  AtlasMark,
  DiagramCanvas,
  DiagramPanel,
  DiagramViewer,
  ProvenanceBadge,
  ScenarioPanel,
  UMLDiagram,
  UMLGeneralizationGroup,
  UMLNode,
  UMLRelation,
  ViewerErrorBoundary,
  changeCount,
  describeProvenance,
  formatCaptureDate
};
//# sourceMappingURL=react.mjs.map
