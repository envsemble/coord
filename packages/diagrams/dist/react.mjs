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
  insets = () => NO_INSETS
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
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    drag = null;
    canvas.classList.remove("dragging");
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
      drag = {
        startX: p.x,
        startY: p.y,
        lastX: p.x,
        lastY: p.y,
        moved: false,
        target: e.target,
        gesture: gesture()
      };
      canvas.classList.add("dragging");
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
      else {
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
        if (e.type === "pointerup" && drag && !drag.moved && drag.target)
          onTap?.(drag.target);
        drag = null;
        canvas.classList.remove("dragging");
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
  insets
}) {
  const callbacks = useRef2({ onZoom, onTap, onMotion, insets });
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
      }
    }),
    // A new camera implementation during Vite refresh needs a new controller.
    [createCamera]
  );
  useLayoutEffect2(() => {
    callbacks.current = { onZoom, onTap, onMotion, insets };
  }, [onZoom, onTap, onMotion, insets]);
  useLayoutEffect2(() => {
    controls.restoreView(diagram.key, diagram.initialFocus);
  }, [controls, diagram]);
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
    onClearHover
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
      insets: fitInsets
    });
    useImperativeHandle(ref, () => controls, [controls]);
    useLayoutEffect3(() => {
      if (selected?.kind === "node") controls.revealNode(selected.id);
    }, [controls, diagram, selected]);
    useLayoutEffect3(clearTransient, [clearTransient, diagram]);
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
      return {
        top: top ? Math.max(0, top.bottom - box.top) : 0,
        bottom: 0,
        left: 0,
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
  const showsChanges = panel === "changes";
  return /* @__PURE__ */ jsxs15(
    Panel,
    {
      id: "side-panel",
      className: "side-panel",
      open: !!panel,
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
import { memo as memo4, useMemo as useMemo8, useRef as useRef7 } from "react";
import { Theme } from "@envsemble/envui";
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
  review = null,
  identity
}) {
  const { model, views, scenarios = null } = payload;
  const camera = useRef7(null), zoomStore = useMemo8(createZoomStore, []);
  const viewerRef = useRef7(null), topRef = useRef7(null);
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
  const { view, diagram, changes, panel } = state;
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
            diagram,
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
