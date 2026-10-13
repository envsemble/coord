var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/model/domainModel.js
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

// src/viewer/OntoUMLViewer.jsx
import {
  useCallback as useCallback5,
  useEffect as useEffect9,
  useLayoutEffect as useLayoutEffect10,
  useMemo as useMemo10,
  useRef as useRef10,
  useState as useState12
} from "react";

// src/visualization/DiagramCanvas.jsx
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

// src/visualization/UMLDiagram.jsx
import { memo, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

// src/visualization/interaction.js
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

// src/visualization/UMLNode.jsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var typeColors = {
  kind: "#0550ae",
  role: "#953800",
  relator: "#8250df",
  phase: "#116329",
  event: "#cf222e",
  mode: "#0a3069"
};
var typeBackgrounds = {
  kind: "#ddedff",
  role: "#fff0df",
  relator: "#f0e5ff",
  phase: "#e1f2e4",
  event: "#ffe5e2",
  mode: "#e0f3f5"
};
var colorFamilies = {
  subkind: "kind",
  collective: "kind",
  quantity: "kind",
  category: "kind",
  mixin: "kind",
  roleMixin: "role",
  phaseMixin: "phase",
  quality: "mode"
};
function stereotypeFamily(stereotype) {
  return String(colorFamilies[stereotype] || stereotype || "none").replace(
    /[^\w-]/g,
    "-"
  );
}
var CHANGE_COLORS = {
  added: "var(--change-added,#1a7f37)",
  modified: "var(--change-modified,#9a6700)",
  removed: "var(--change-removed,#cf222e)"
};
var CHANGE_TAGS = { added: "New", modified: "Changed", removed: "Removed" };
var MEMBER_GLYPHS = { added: "+", modified: "~", removed: "\u2212" };
var isChanged = (status) => !!CHANGE_COLORS[status];
function MemberText({ member, x, y, method }) {
  const status = isChanged(member.changeStatus) ? member.changeStatus : null;
  const text = method ? member.type : `${member.name} : ${member.type}${member.multiplicity ? ` [${member.multiplicity}]` : ""}`;
  if (!status)
    return /* @__PURE__ */ jsx("text", { x, y, children: text });
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
    /* @__PURE__ */ jsx(
      "text",
      {
        x,
        y,
        fill: CHANGE_COLORS[status],
        textDecoration: status === "removed" ? "line-through" : void 0,
        children: text
      }
    )
  ] });
}
function UMLNode({ node, focus, selected, handlers, idPrefix = "" }) {
  const target = { kind: "node", id: node.id };
  const methods = node.methods || [];
  const header = node.attributes.length || methods.length ? 66 : node.height;
  const color = stereotypeFamily(node.stereotype);
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
            fill: `var(--node-${color},${typeBackgrounds[color] || "var(--surface,#f6f8fa)"})`,
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
        node.stereotype && /* @__PURE__ */ jsxs(
          "text",
          {
            x: node.width / 2,
            y: header / 2 - 10,
            textAnchor: "middle",
            fill: `var(--type-${color},${typeColors[color] || "var(--diagram-muted,#59636e)"})`,
            fontSize: "11.5",
            children: [
              "\xAB",
              node.stereotype,
              "\xBB"
            ]
          }
        ),
        /* @__PURE__ */ jsx(
          "text",
          {
            x: node.width / 2,
            y: header / 2 + (node.stereotype ? 13 : 5),
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
              d: `M0 66 H${node.width}`,
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
                  y: 85 + i * 20
                },
                attribute.id || i
              ))
            }
          ),
          methods.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(
              "path",
              {
                d: `M0 ${node.attributes.length ? 76 + node.attributes.length * 20 : 66} H${node.width}`,
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
                    y: (node.attributes.length ? 97 + node.attributes.length * 20 : 85) + i * 20
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
var textOf = (value) => typeof value === "string" ? value : value && typeof value === "object" && !Array.isArray(value) ? Object.values(value).find((v) => typeof v === "string") ?? null : null;
var isForeignKey = (item) => Array.isArray(item?.columns) && typeof item.target === "string";
var isPart = (item) => !!item && typeof item === "object" && !Array.isArray(item) && typeof item.$element !== "string" && (isForeignKey(item) || typeof item.name === "string" && !!item.name);
var foreignKeyText = (key) => `${key.columns.join(", ")} \u2192 ${key.target}(${(key.targetColumns || []).join(", ")})`;
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
function partChange(before, after) {
  const was = describePart(before), is = describePart(after);
  if (was !== is) return [was, is];
  const fields = [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => [k, readable(before[k]), readable(after[k])]);
  return [
    `${was}; ${fields.map(([k, b]) => `${k} ${b}`).join("; ")}`,
    `${is}; ${fields.map(([k, , a]) => `${k} ${a}`).join("; ")}`
  ];
}
var partKey = (item) => isPart(item) ? isForeignKey(item) ? `key:${JSON.stringify([item.columns, item.target, item.targetColumns ?? []])}` : `name:${item.name}` : JSON.stringify(item);
function itemChanges(note) {
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
function readable(value, names = /* @__PURE__ */ new Map()) {
  if (typeof value === "string") return names.get(value) ?? value;
  if (value === void 0 || value === null) return "none";
  if (typeof value === "object" && typeof value.$element === "string")
    return names.get(value.$element) || value.$element;
  if (Array.isArray(value))
    return value.length ? value.map((item) => readable(item, names)).join(", ") : "none";
  if (typeof value === "object") {
    if (isPart(value)) return describePart(value);
    const text2 = Object.values(value).find((v) => typeof v === "string");
    if (text2 !== void 0 && Object.keys(value).length <= 3) return text2;
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
function memberSignature(member, method, profile) {
  if (method) return member.type || `${member.name}()`;
  if (!member.type) return member.name;
  return profile === "database" ? `${member.name} ${member.type}` : `${member.name}: ${member.type}`;
}
function decodeIdentity(id) {
  if (typeof id !== "string") return null;
  const parts = id.split(":");
  try {
    if (parts[0] === "code" && parts.length >= 5)
      return {
        source: "code",
        language: parts[1],
        repository: decodeURIComponent(parts[2]),
        file: decodeURIComponent(parts[3]),
        name: decodeURIComponent(parts[4])
      };
    if (parts[0] === "code" && parts.length === 4)
      return {
        source: "code",
        language: parts[1],
        repository: decodeURIComponent(parts[2]),
        file: null,
        name: decodeURIComponent(parts[3])
      };
    if (parts[0] === "db" && parts.length >= 5)
      return {
        source: "database",
        engine: parts[1],
        repository: decodeURIComponent(parts[2]),
        schema: decodeURIComponent(parts[3]),
        name: decodeURIComponent(parts[4])
      };
  } catch {
  }
  return null;
}
function elementFile(element, model) {
  if (element?.location?.file) return element.location.file;
  const identity = decodeIdentity(element?.id);
  if (!identity || identity.source !== "code") return null;
  if (identity.file) return identity.file;
  return identity.language === "java" ? javaFile(identity, model) : null;
}
function javaFile({ name: qualified, repository }, model) {
  const captured = (model?.classes || []).filter((c) => {
    const identity = decodeIdentity(c.id);
    return c.location?.file && identity?.language === "java" && identity.repository === repository;
  });
  const nameOf = (c) => decodeIdentity(c.id).name;
  for (let end = qualified.lastIndexOf("."); end > 0; ) {
    const outer = captured.find((c) => nameOf(c) === qualified.slice(0, end));
    if (outer) return outer.location.file;
    end = qualified.lastIndexOf(".", end - 1);
  }
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
var PLAIN_KINDS = /* @__PURE__ */ new Set(["dependency", "foreign key"]);
function edgeTag(edge) {
  if ("specificId" in edge) return edge.realization ? "implements" : "inherits";
  if (PLAIN_KINDS.has(edge.stereotype)) return "";
  return edge.stereotype ? `\xAB${edge.stereotype}\xBB` : "";
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
    for (const diagram of [view.diagram, view.diagramFields].filter(Boolean)) {
      for (const node of diagram.nodes || []) nodes.add(node.id);
      for (const edge of diagram.edges || []) edges.add(edge.id);
      for (const group of diagram.generalizationGroups || [])
        for (const id of group.memberIds || []) edges.add(id);
    }
  return { nodes, edges };
}
var ONTOUML_MEMBERS = /* @__PURE__ */ new Set(["Property", "Literal"]);
function typeOf(data, names) {
  if (data.type === "Literal") return void 0;
  if (data.type === "Property")
    return data.propertyType ? readable(data.propertyType, names) : "?";
  return typeof data.type === "string" ? data.type : void 0;
}
function memberFromChange(change, names) {
  const data = change.after || change.before || {};
  const type = typeOf(data, names);
  const method = !ONTOUML_MEMBERS.has(data.type) && typeof type === "string" && (/^[^:]*\(/.test(type) || /:method%3A/.test(change.elementId || ""));
  return {
    name: textOf(data.name) ?? readable(change.name, names),
    type,
    method
  };
}
var modelLevelType = (change, ontouml) => {
  if (!change.elementId) return "model";
  const type = (change.after || change.before || {}).type;
  return ontouml && (type === "Project" || type === "Package") ? type.toLowerCase() : null;
};
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
  const ontouml = profile === "ontouml";
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
  const text = (value) => ({ present: true, value });
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
    const level = modelLevelType(change, ontouml);
    if (level) {
      const notes = properties.filter(fromModel).map((p) => note(p, level === "package" ? `package ${p.key}` : p.key));
      if (level === "package" && change.kind !== "modified")
        notes.push({
          key: `${placeName(id)} package`,
          property: "presence",
          status: change.kind
        });
      if (level === "package") {
        for (const { key, joined } of listChanges(change))
          if (key === "contents") {
            for (const item of joined)
              if (moves.has(item))
                notes.push({
                  key: placeName(item),
                  property: "moved",
                  before: text(
                    moves.get(item).from ? placeName(moves.get(item).from) : "none"
                  ),
                  after: text(placeName(id))
                });
          }
      }
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
    if (owner && edges.has(owner)) {
      const edge = edges.get(owner);
      const entry2 = edgeRow(edge, "modified");
      entry2.changes.push(change);
      const data = change.after || change.before || {};
      const [source, target] = edgeEnds(edge);
      const at = readable(data.propertyType, names);
      const end = textOf(data.name) || (source === target && change.end ? `${at} ${change.end} end` : `${at} end`);
      for (const p of properties) entry2.notes.push(note(p, `${end} ${p.key}`));
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
function describeClassChange(rollup, element, profile) {
  const entry = rollup?.rows.find(
    (r) => r.kind === "node" && r.id === element.id
  );
  if (!entry) return null;
  const names = rollup.names;
  const byId = new Map(entry.changes.map((c) => [c.elementId, c]));
  const moved = new Map(
    entry.members.filter((m) => m.moved).map((m) => [m.id, m.moved])
  );
  const members = [
    ...(element.attributes || []).map((m) => ({ member: m, method: false })),
    ...(element.methods || []).map((m) => ({ member: m, method: true }))
  ];
  const seen = /* @__PURE__ */ new Set();
  const changed = [];
  for (const { member, method } of members) {
    const change = byId.get(member.id);
    if (!change && !(member.changeStatus && member.changeStatus !== "unchanged"))
      continue;
    seen.add(member.id);
    changed.push(
      memberChange(
        member,
        method,
        change,
        profile,
        names,
        moved.get(member.id)
      )
    );
  }
  for (const m of entry.members) {
    if (seen.has(m.id) || entry.status !== "modified") continue;
    seen.add(m.id);
    changed.push(
      memberChange(
        {
          id: m.id,
          name: m.member.name,
          type: m.member.type,
          changeStatus: m.status
        },
        m.member.method,
        byId.get(m.id),
        profile,
        names,
        m.moved
      )
    );
  }
  return {
    status: entry.status,
    properties: entry.notes.flatMap((n) => {
      const parts = itemChanges(n);
      if (parts?.length && parts.every((c) => isPart(c.after ?? c.before)))
        return parts.map(({ status, before, after }) => {
          const part = after ?? before;
          const [was, is] = before && after ? partChange(before, after) : [
            before ? describePart(before) : "none",
            after ? describePart(after) : "none"
          ];
          return {
            key: isForeignKey(part) ? "foreign key" : `${SINGULAR[n.property] ?? n.property} ${partName(part)}`,
            status,
            before: was,
            after: is
          };
        });
      return [
        {
          key: n.key,
          status: "modified",
          before: cellText(n.before, names, n.property),
          after: cellText(n.after, names, n.property)
        }
      ];
    }),
    members: entry.status === "modified" ? changed : [],
    // Members of a new or removed type that moved there or away.
    moved: entry.status === "modified" ? [] : entry.members.filter((m) => m.moved),
    entry
  };
}
function previousMember(before, member, names) {
  const conceptual = ONTOUML_MEMBERS.has(before.type);
  return {
    ...member,
    name: textOf(before.name) ?? member.name,
    type: conceptual ? typeOf(before, names) ?? member.type : typeof before.type === "string" ? before.type : member.type
  };
}
function memberChange(member, method, change, profile, names, moved) {
  const status = member.changeStatus && member.changeStatus !== "unchanged" ? member.changeStatus : change?.kind;
  const properties = meaningfulProperties(change).map((p) => ({
    key: p.key,
    before: cellText(p.before, names, p.key),
    after: cellText(p.after, names, p.key)
  }));
  const before = change?.before;
  return {
    id: member.id,
    status,
    method,
    name: member.name,
    signature: memberSignature(member, method, profile),
    // A member that moved in may also have changed on the way.
    previous: (status === "modified" || moved?.from) && before ? memberSignature(
      previousMember(before, member, names),
      method,
      profile
    ) : null,
    properties,
    moved: moved || null,
    location: member.location || before?.location || null
  };
}
function fileExists(model, file) {
  if (!file) return false;
  return model.classes.some(
    (c) => c.changeStatus !== "added" && elementFile(c, model) === file
  );
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

// src/visualization/UMLRelation.jsx
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
              markerEnd: edge.type === "generalization" && !edge.branchPaths ? `url(#${markerId}${markerState})` : edge.stereotype === "dependency" ? `url(#${markerId}-DEPENDENCY${markerState})` : aggregationMarker(edge.targetAggregation)
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
                children: label.text.split("\n").map((line, i, lines) => {
                  const stereotype = i === 0 && (lines.length > 1 || /^«.*»$/.test(line));
                  return /* @__PURE__ */ jsx2(
                    "tspan",
                    {
                      x: label.width / 2,
                      y: 17 + i * 17,
                      fontSize: stereotype ? "11.5" : void 0,
                      fill: stereotype ? "var(--diagram-muted,#59636e)" : void 0,
                      children: line
                    },
                    i
                  );
                })
              }
            )
          ] })
        },
        label.id
      ))
    }
  );
}

// src/visualization/UMLGeneralizationGroup.jsx
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

// src/visualization/highlight.js
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

// src/visualization/UMLDiagram.jsx
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
        interactive && backgroundURL && /* @__PURE__ */ jsx4(
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

// src/visualization/useDiagramCamera.js
import { useLayoutEffect as useLayoutEffect2, useMemo as useMemo2, useRef as useRef2 } from "react";

// src/visualization/camera.js
var WHEEL_ZOOM_SENSITIVITY = 15e-4;
var PINCH_GESTURE_SENSITIVITY = 0.15;
var PAN_EASING_MS = 50;
var DRAG_EASING_MS = 28;
var ZOOM_EASING_MS = 90;
var clampScale = (scale) => Math.max(0.08, Math.min(3.5, scale));
var MAX_FIT_SCALE = 1.5;
var FIT_PADDING = 24;
var NO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
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
  let gridScale = null;
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
      const step = 20 * 2 ** Math.ceil(Math.log2(16 / (20 * camera.scale)));
      const spacing = step * camera.scale;
      const phase = (n) => (n % spacing + spacing) % spacing;
      if (gridScale !== camera.scale) {
        gridScale = camera.scale;
        const fine = Math.max(0, Math.min(1, spacing / 16 - 1));
        grid.style.backgroundImage = [fine, 1 - fine].map(
          (opacity) => `radial-gradient(color-mix(in srgb,var(--grid) ${opacity * 100}%,transparent) 0.7px,transparent 0.7px)`
        ).join(",");
        grid.style.backgroundSize = `${spacing / 2}px ${spacing / 2}px,${spacing}px ${spacing}px`;
        grid.style.backgroundPosition = `${64 - spacing / 4}px ${64 - spacing / 4}px,${64 - spacing / 2}px ${64 - spacing / 2}px`;
      }
      grid.style.transform = `translate3d(${phase(camera.x)}px,${phase(camera.y)}px,0)`;
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
  function restoreView(key, fields, focusIds = []) {
    cancelMotion();
    clearPointers();
    if (activeKey) cameras.set(activeKey, { ...camera });
    initialFocus = focusIds;
    activeKey = `${key}:${fields}`;
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
    gridScale = null;
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
      gridScale = null;
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

// src/visualization/useDiagramCamera.js
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
    controls.restoreView(diagram.key, diagram.fields, diagram.initialFocus);
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

// src/visualization/DiagramCanvas.jsx
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
        "aria-label": "Interactive OntoUML diagram",
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

// src/visualization/useSVGExport.js
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
  "--node-kind",
  "--node-role",
  "--node-relator",
  "--node-phase",
  "--node-event",
  "--node-mode",
  "--type-kind",
  "--type-role",
  "--type-relator",
  "--type-phase",
  "--type-event",
  "--type-mode",
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

// src/viewer/OntoUMLViewer.jsx
import {
  Dialog,
  EmptyState,
  useTheme,
  useThemePreference
} from "@envsemble/envui";

// src/ui/Panel.jsx
import { Surface, Text } from "@envsemble/envui";

// src/ui/Button.jsx
import { IconButton, Tooltip } from "@envsemble/envui";
import { jsx as jsx6 } from "react/jsx-runtime";
function ToolButton({
  label,
  tooltip = label,
  icon,
  pressed,
  variant,
  side = "bottom",
  ...props
}) {
  return /* @__PURE__ */ jsx6(Tooltip, { content: tooltip, side, children: /* @__PURE__ */ jsx6(
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

// src/ui/Icons.jsx
import { AccountTree } from "@envsemble/envui/icons/AccountTree";
import { Add } from "@envsemble/envui/icons/Add";
import { ArrowBack } from "@envsemble/envui/icons/ArrowBack";
import { Category } from "@envsemble/envui/icons/Category";
import { ChevronLeft } from "@envsemble/envui/icons/ChevronLeft";
import { ChevronRight } from "@envsemble/envui/icons/ChevronRight";
import { Close } from "@envsemble/envui/icons/Close";
import { Code } from "@envsemble/envui/icons/Code";
import { Contrast } from "@envsemble/envui/icons/Contrast";
import { Database } from "@envsemble/envui/icons/Database";
import { DataObject } from "@envsemble/envui/icons/DataObject";
import { Description } from "@envsemble/envui/icons/Description";
import { Difference } from "@envsemble/envui/icons/Difference";
import { Download } from "@envsemble/envui/icons/Download";
import { EditNote } from "@envsemble/envui/icons/EditNote";
import { ExpandLess } from "@envsemble/envui/icons/ExpandLess";
import { ExpandMore } from "@envsemble/envui/icons/ExpandMore";
import { FitScreen } from "@envsemble/envui/icons/FitScreen";
import { FolderZip } from "@envsemble/envui/icons/FolderZip";
import { Fullscreen } from "@envsemble/envui/icons/Fullscreen";
import { FullscreenExit } from "@envsemble/envui/icons/FullscreenExit";
import { Image } from "@envsemble/envui/icons/Image";
import { Info } from "@envsemble/envui/icons/Info";
import { OpenInNew } from "@envsemble/envui/icons/OpenInNew";
import { Polyline } from "@envsemble/envui/icons/Polyline";
import { Remove } from "@envsemble/envui/icons/Remove";
import { RightPanelClose } from "@envsemble/envui/icons/RightPanelClose";
import { RightPanelOpen } from "@envsemble/envui/icons/RightPanelOpen";
import { School } from "@envsemble/envui/icons/School";
import { Search } from "@envsemble/envui/icons/Search";
import { TableRows } from "@envsemble/envui/icons/TableRows";
import { Visibility } from "@envsemble/envui/icons/Visibility";
import { Warning } from "@envsemble/envui/icons/Warning";

// src/ui/Panel.jsx
import { jsx as jsx7, jsxs as jsxs5 } from "react/jsx-runtime";
function Panel({
  open,
  onClose,
  label = "Diagram details",
  title = label,
  toolbar = null,
  closeLabel = "Close details",
  children,
  id = "panel",
  className = "",
  ...props
}) {
  const compact = !title && !toolbar;
  return /* @__PURE__ */ jsxs5(
    Surface,
    {
      as: "aside",
      tone: "pane",
      padding: 0,
      id,
      className: `panel${open ? " open" : ""}${className ? ` ${className}` : ""}`,
      "aria-label": label,
      ...props,
      children: [
        /* @__PURE__ */ jsxs5("div", { className: `panel-header${compact ? " compact" : ""}`, children: [
          toolbar,
          !toolbar && title && /* @__PURE__ */ jsx7(Text, { as: "h2", variant: "section-heading", className: "panel-title", children: title }),
          onClose && /* @__PURE__ */ jsx7(
            ToolButton,
            {
              className: "panel-close",
              label: closeLabel,
              icon: /* @__PURE__ */ jsx7(Close, {}),
              onClick: onClose
            }
          )
        ] }),
        /* @__PURE__ */ jsx7("div", { className: "panel-content", children })
      ]
    }
  );
}

// src/viewer/ViewerToolbar.jsx
import { forwardRef as forwardRef2, useMemo as useMemo4 } from "react";
import { Button as Button2, Counter, Text as Text2, ThemeToggle, Tooltip as Tooltip3 } from "@envsemble/envui";

// src/ui/CameraControls.jsx
import { useSyncExternalStore } from "react";
import { Button, ButtonGroup, Kbd, Tooltip as Tooltip2 } from "@envsemble/envui";
import { Fragment as Fragment3, jsx as jsx8, jsxs as jsxs6 } from "react/jsx-runtime";
function ZoomReadout({ zoom, onReset }) {
  return /* @__PURE__ */ jsx8(Tooltip2, { content: "Reset to 100%", side: "bottom", children: /* @__PURE__ */ jsxs6(
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
        icon: /* @__PURE__ */ jsx8(Remove, {}),
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
        icon: /* @__PURE__ */ jsx8(Add, {}),
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
        icon: /* @__PURE__ */ jsx8(FitScreen, {}),
        onClick: onFit
      }
    )
  ] });
}

// src/ui/ConceptSearch.jsx
import {
  memo as memo3,
  useEffect as useEffect4,
  useId as useId2,
  useLayoutEffect as useLayoutEffect5,
  useMemo as useMemo3,
  useRef as useRef5,
  useState as useState4
} from "react";
import { Kbd as Kbd2, SearchField, Surface as Surface2 } from "@envsemble/envui";

// src/ui/usePopupDismiss.js
import { useEffect as useEffect3, useLayoutEffect as useLayoutEffect4, useRef as useRef4 } from "react";
function usePopupDismiss(onClose, ...roots) {
  const latest = useRef4({ onClose, roots });
  useLayoutEffect4(() => {
    latest.current = { onClose, roots };
  });
  useEffect3(() => {
    const outside = (e) => {
      if (!latest.current.roots.some((ref) => ref.current?.contains(e.target)))
        latest.current.onClose();
    };
    const escape = (e) => {
      if (e.key === "Escape") latest.current.onClose();
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("click", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
}

// src/ui/ConceptSearch.jsx
import { Fragment as Fragment4, jsx as jsx9, jsxs as jsxs7 } from "react/jsx-runtime";
var ConceptSearch = memo3(function ConceptSearch2({
  classes,
  onChoose
}) {
  const [query, setQuery] = useState4("");
  const [open, setOpen] = useState4(false);
  const [showHits, setShowHits] = useState4(false);
  const inputRef = useRef5(null);
  const suggestionsRef = useRef5(null);
  const searchRef = useRef5(null);
  const fieldId = useId2(), listId = useId2();
  const q = query.trim().toLowerCase();
  const searchEntries = useMemo3(
    () => classes.map((concept) => ({ concept, text: concept.name.toLowerCase() })),
    [classes]
  );
  const hits = useMemo3(() => {
    if (!q) return [];
    const matches = [];
    for (const entry of searchEntries) {
      if (entry.text.includes(q)) matches.push(entry.concept);
      if (matches.length === 12) break;
    }
    return matches;
  }, [q, searchEntries]);
  const close = () => {
    setShowHits(false);
    setOpen(false);
  };
  useLayoutEffect5(() => {
    if (open) inputRef.current.focus();
  }, [open]);
  usePopupDismiss(close, searchRef);
  useEffect4(() => {
    const shortcut = (e) => {
      if (e.target.closest?.("input,textarea,select,[contenteditable='true']"))
        return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (!searchRef.current?.offsetParent) return;
        const first = [...document.querySelectorAll(".search")].find(
          (el) => el.offsetParent
        );
        if (first && first !== searchRef.current) return;
        e.preventDefault();
        setOpen(true);
        inputRef.current.focus();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  function choose(id) {
    onChoose(id);
    setQuery("");
    close();
    inputRef.current.blur();
  }
  const listOpen = showHits && hits.length > 0;
  return /* @__PURE__ */ jsxs7("div", { ref: searchRef, className: `search${open ? " open" : ""}`, children: [
    /* @__PURE__ */ jsx9(
      ToolButton,
      {
        className: "search-toggle",
        label: "Open concept search",
        tooltip: /* @__PURE__ */ jsxs7(Fragment4, { children: [
          "Find concept ",
          /* @__PURE__ */ jsx9(Kbd2, { children: "/" })
        ] }),
        "aria-expanded": open,
        "aria-controls": fieldId,
        icon: /* @__PURE__ */ jsx9(Search, {}),
        onClick: () => setOpen(!open)
      }
    ),
    /* @__PURE__ */ jsxs7("div", { className: "search-field", id: fieldId, children: [
      /* @__PURE__ */ jsx9(
        SearchField,
        {
          ref: inputRef,
          label: "Find concept",
          placeholder: "Find a concept (/)",
          autoComplete: "off",
          "aria-keyshortcuts": "/",
          role: "combobox",
          "aria-expanded": listOpen,
          "aria-controls": listId,
          "aria-autocomplete": "list",
          value: query,
          onValueChange: (next) => {
            setQuery(next);
            setShowHits(true);
          },
          onKeyDown: (e) => {
            if (e.key === "Enter" && hits.length) {
              choose(hits[0].id);
              e.preventDefault();
            }
            if (e.key === "ArrowDown") {
              suggestionsRef.current.querySelector("button")?.focus();
              e.preventDefault();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              if (listOpen) {
                e.preventDefault();
                setShowHits(false);
              } else if (!query) {
                close();
                inputRef.current.blur();
              }
            }
          }
        }
      ),
      /* @__PURE__ */ jsx9(
        Surface2,
        {
          ref: suggestionsRef,
          id: listId,
          tone: "pane",
          padding: 1,
          corners: "standard",
          className: `suggestions${listOpen ? " open" : ""}`,
          role: "listbox",
          "aria-label": "Concepts",
          onKeyDown: (e) => {
            const items = [
              ...suggestionsRef.current.querySelectorAll("button")
            ];
            const index2 = items.indexOf(document.activeElement);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = index2 + (e.key === "ArrowDown" ? 1 : -1);
              if (next < 0) inputRef.current.focus();
              else items[Math.min(next, items.length - 1)]?.focus();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setShowHits(false);
              inputRef.current.focus();
            }
          },
          children: hits.map((c) => /* @__PURE__ */ jsxs7(
            "button",
            {
              type: "button",
              role: "option",
              "aria-selected": "false",
              className: "suggestion",
              onClick: () => choose(c.id),
              children: [
                /* @__PURE__ */ jsx9("span", { className: "suggestion-name", children: c.name }),
                c.stereotype && /* @__PURE__ */ jsxs7("span", { className: "suggestion-detail", children: [
                  "\xAB",
                  c.stereotype,
                  "\xBB"
                ] })
              ]
            },
            c.id
          ))
        }
      )
    ] })
  ] });
});

// src/ui/ExportMenu.jsx
import { Menu, MenuItem } from "@envsemble/envui";
import { jsx as jsx10 } from "react/jsx-runtime";
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
  return /* @__PURE__ */ jsx10(
    Menu,
    {
      "aria-label": "Export",
      trigger: /* @__PURE__ */ jsx10(
        ToolButton,
        {
          id: "export",
          label: "Export",
          tooltip: "Export the diagram or model",
          icon: /* @__PURE__ */ jsx10(Download, {})
        }
      ),
      children: items.map((item) => /* @__PURE__ */ jsx10(
        MenuItem,
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
import { Surface as Surface3 } from "@envsemble/envui";
import { jsx as jsx11 } from "react/jsx-runtime";
function Island({ label, className = "", children, ...props }) {
  return /* @__PURE__ */ jsx11(
    Surface3,
    {
      tone: "pane",
      corners: "pill",
      padding: 1,
      density: "compact",
      role: "group",
      "aria-label": label,
      className: `atlas-island${className ? ` ${className}` : ""}`,
      ...props,
      children
    }
  );
}
function IslandDivider() {
  return /* @__PURE__ */ jsx11("span", { className: "island-divider", "aria-hidden": "true" });
}

// src/ui/ViewSwitcher.jsx
import { SegmentedControl, Select } from "@envsemble/envui";
import { jsx as jsx12 } from "react/jsx-runtime";
function ViewSwitcher({
  items,
  value,
  onChange,
  label = "Diagram view",
  compact = false
}) {
  const options = items.map((item) => ({ value: item.key, label: item.label }));
  if (compact)
    return /* @__PURE__ */ jsx12(
      Select,
      {
        className: "view-select",
        "aria-label": label,
        options,
        value,
        onValueChange: (next) => next && onChange(next)
      }
    );
  return /* @__PURE__ */ jsx12(
    SegmentedControl,
    {
      className: "view-switcher",
      "aria-label": label,
      size: "compact",
      options,
      value,
      onValueChange: onChange
    }
  );
}

// src/ui/AtlasMark.jsx
import { jsx as jsx13, jsxs as jsxs8 } from "react/jsx-runtime";
function AtlasMark({ size = 28, label = "Atlas" }) {
  return /* @__PURE__ */ jsxs8(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "27 26.5 189 189",
      role: label ? "img" : void 0,
      "aria-label": label || void 0,
      "aria-hidden": label ? void 0 : true,
      children: [
        /* @__PURE__ */ jsx13("rect", { x: "27", y: "27", width: "189", height: "188", rx: "43", fill: "#111820" }),
        /* @__PURE__ */ jsxs8(
          "g",
          {
            fill: "none",
            stroke: "#fff",
            strokeWidth: "12",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            children: [
              /* @__PURE__ */ jsx13("path", { d: "M76 163 L120 77 L164 163" }),
              /* @__PURE__ */ jsx13("path", { d: "M96 132 H144" })
            ]
          }
        ),
        /* @__PURE__ */ jsxs8("g", { fill: "#fff", children: [
          /* @__PURE__ */ jsx13("circle", { cx: "120", cy: "77", r: "18" }),
          /* @__PURE__ */ jsx13("circle", { cx: "76", cy: "163", r: "18" }),
          /* @__PURE__ */ jsx13("circle", { cx: "164", cy: "163", r: "18" })
        ] })
      ]
    }
  );
}

// src/viewer/ViewerToolbar.jsx
import { jsx as jsx14, jsxs as jsxs9 } from "react/jsx-runtime";
function exportChoices({
  exports,
  viewKey,
  fields,
  theme,
  diagramURL,
  conceptual
}) {
  const modelFile = `${exports.slug}-${conceptual ? "ontouml" : "structural"}.json`;
  const plantUML = `${exports.slug}-${viewKey}.puml`;
  return [
    {
      key: "svg-download",
      label: "SVG image",
      description: `This view${fields ? " with attributes" : ""}, ${theme} theme`,
      icon: /* @__PURE__ */ jsx14(Image, {}),
      onSelect: () => diagramURL && downloadURL(
        diagramURL,
        `${exports.slug}-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`
      )
    },
    {
      key: "puml-download",
      label: "PlantUML",
      description: "This view as PlantUML source",
      icon: /* @__PURE__ */ jsx14(Code, {}),
      onSelect: () => downloadData(exports.readText(plantUML), plantUML)
    },
    {
      key: "model-download",
      label: conceptual ? "OntoUML JSON" : "Structural JSON",
      description: "The whole model",
      icon: /* @__PURE__ */ jsx14(DataObject, {}),
      onSelect: () => downloadData(
        exports.readText(modelFile),
        modelFile,
        "application/json"
      )
    },
    {
      key: "bundle-download",
      label: "Models ZIP",
      description: "Every export, with evidence and validation",
      icon: /* @__PURE__ */ jsx14(FolderZip, {}),
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
  fields,
  theme,
  zoomStore,
  diagramURL,
  sidebarHidden,
  sidebarOpen,
  learningOpen,
  aboutOpen,
  reviewControls,
  guided = true,
  density = 0,
  themeToggle = false,
  onSidebar,
  onView,
  onFields,
  onChoose,
  onAbout,
  onLearn,
  onZoom,
  onReset,
  onFit
}, ref) {
  const conceptual = !model.document || model.document.profile === "ontouml";
  const searchClasses = useMemo4(() => {
    const visibleIds = new Set(views.flatMap((view) => view.nodeIds));
    return model.classes.filter((concept) => visibleIds.has(concept.id));
  }, [model.classes, views]);
  const findings = model.validation.counts.error;
  return /* @__PURE__ */ jsxs9(
    "header",
    {
      className: `atlas-overlay-top viewer-toolbar${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`,
      ref,
      children: [
        /* @__PURE__ */ jsxs9(Island, { label: "Diagram navigation", className: "island-start", children: [
          /* @__PURE__ */ jsx14("span", { className: "brand-mark", children: /* @__PURE__ */ jsx14(AtlasMark, { label: "" }) }),
          /* @__PURE__ */ jsx14(
            Text2,
            {
              as: "span",
              variant: "section-heading",
              className: "island-title",
              title: model.title,
              children: model.title
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
          /* @__PURE__ */ jsx14(ConceptSearch, { classes: searchClasses, onChoose }),
          /* @__PURE__ */ jsx14(
            ToolButton,
            {
              id: "fields",
              label: "Fields",
              tooltip: fields ? "Hide attributes" : "Show attributes",
              pressed: fields,
              icon: /* @__PURE__ */ jsx14(TableRows, {}),
              onClick: onFields
            }
          ),
          /* @__PURE__ */ jsx14(
            CameraControls,
            {
              ...{ zoomStore, onZoom, onReset, onFit },
              compact: density > 2
            }
          ),
          /* @__PURE__ */ jsx14(IslandDivider, {}),
          guided && (conceptual && findings > 0 ? /* @__PURE__ */ jsx14(Tooltip3, { content: "Understand the model", side: "bottom", children: /* @__PURE__ */ jsx14(
            Button2,
            {
              id: "learn-toggle",
              variant: learningOpen && sidebarOpen ? "primary" : "secondary",
              className: "learn-toggle",
              "aria-pressed": learningOpen && sidebarOpen,
              "aria-label": `Understand the model; ${findings} ${findings === 1 ? "finding" : "findings"}`,
              startIcon: /* @__PURE__ */ jsx14(School, {}),
              onClick: onLearn,
              children: /* @__PURE__ */ jsx14(
                Counter,
                {
                  value: findings,
                  tone: learningOpen && sidebarOpen ? "accent" : "neutral"
                }
              )
            }
          ) }) : /* @__PURE__ */ jsx14(
            ToolButton,
            {
              id: "learn-toggle",
              label: "Understand the model",
              pressed: learningOpen && sidebarOpen,
              icon: /* @__PURE__ */ jsx14(School, {}),
              onClick: onLearn
            }
          )),
          /* @__PURE__ */ jsx14(
            ToolButton,
            {
              id: "sidebar-toggle",
              label: sidebarHidden ? "Show details" : "Hide details",
              "aria-controls": "inspector",
              "aria-expanded": sidebarOpen,
              icon: sidebarHidden ? /* @__PURE__ */ jsx14(RightPanelOpen, {}) : /* @__PURE__ */ jsx14(RightPanelClose, {}),
              onClick: onSidebar
            }
          ),
          /* @__PURE__ */ jsx14(IslandDivider, {}),
          themeToggle && /* @__PURE__ */ jsx14(ThemeToggle, { id: "theme-toggle" }),
          /* @__PURE__ */ jsx14(
            ExportMenu,
            {
              items: exportChoices({
                exports,
                viewKey,
                fields,
                theme,
                diagramURL,
                conceptual
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
              icon: /* @__PURE__ */ jsx14(Info, {}),
              onClick: onAbout
            }
          )
        ] })
      ]
    }
  );
});

// src/viewer/DetailsContent.jsx
import { memo as memo5 } from "react";
import {
  Badge as Badge3,
  Button as Button7,
  DisclosureNote as DisclosureNote4,
  Kbd as Kbd3,
  Stack as Stack4,
  Text as Text7
} from "@envsemble/envui";

// src/ui/DownloadLink.jsx
import { Button as Button3 } from "@envsemble/envui";

// src/ui/useBlobURL.js
import { useEffect as useEffect5, useState as useState5 } from "react";
function useBlobURL(data, type = "text/plain;charset=utf-8") {
  const [url, setURL] = useState5(void 0);
  useEffect5(() => {
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
    Button3,
    {
      ...props,
      variant: "text",
      startIcon: /* @__PURE__ */ jsx15(Download, {}),
      ...href ? { href, download: filename } : { disabled: true },
      children
    }
  );
}

// src/viewer/SourceEvidence.jsx
import { Button as Button4, Card, DisclosureNote, Stack, Text as Text3 } from "@envsemble/envui";

// src/ui/CodeSnippet.jsx
import { Fragment as Fragment5, memo as memo4 } from "react";
import { jsx as jsx16, jsxs as jsxs10 } from "react/jsx-runtime";
var CodeSnippet = memo4(function CodeSnippet2({ snippet, label }) {
  return /* @__PURE__ */ jsx16("pre", { className: "shiki code-snippet", tabIndex: 0, "aria-label": label, children: /* @__PURE__ */ jsx16("code", { children: snippet.lines.map((tokens, i) => /* @__PURE__ */ jsxs10(Fragment5, { children: [
    /* @__PURE__ */ jsx16("span", { className: "code-line", "data-line": snippet.startLine + i, children: tokens.map((token, j) => /* @__PURE__ */ jsx16("span", { style: token.style, children: token.content }, j)) }),
    i < snippet.lines.length - 1 ? "\n" : null
  ] }, i)) }) });
});

// src/viewer/SourceEvidence.jsx
import { jsx as jsx17, jsxs as jsxs11 } from "react/jsx-runtime";
function SourceExcerpt({ source, snippet }) {
  if (!snippet)
    return /* @__PURE__ */ jsxs11(Stack, { gap: 2, align: "start", className: "source-excerpt", children: [
      /* @__PURE__ */ jsx17(Text3, { children: source.claim }),
      source.url && /* @__PURE__ */ jsx17(
        Button4,
        {
          variant: "text",
          href: source.url,
          target: "_blank",
          rel: "noopener noreferrer",
          endIcon: /* @__PURE__ */ jsx17(OpenInNew, {}),
          children: "View source"
        }
      )
    ] });
  const github = snippet.url?.startsWith("https://github.com/");
  return /* @__PURE__ */ jsx17(
    Card,
    {
      padding: 3,
      className: "source-file-card",
      heading: /* @__PURE__ */ jsx17("span", { title: source.file, children: source.file.split("/").pop() }),
      meta: `${snippet.language} \xB7 lines ${snippet.startLine}\u2013${snippet.endLine}`,
      actions: snippet.url ? /* @__PURE__ */ jsx17(
        Button4,
        {
          variant: "text",
          href: snippet.url,
          target: "_blank",
          rel: "noopener noreferrer",
          "aria-label": `View ${source.title} on ${github ? "GitHub" : "its source"}`,
          endIcon: /* @__PURE__ */ jsx17(OpenInNew, {}),
          children: github ? "View on GitHub" : "View source"
        }
      ) : void 0,
      children: /* @__PURE__ */ jsx17(
        CodeSnippet,
        {
          snippet,
          label: `${source.title}, lines ${snippet.startLine} to ${snippet.endLine}`
        }
      )
    }
  );
}
function SourceEvidence({
  evidence,
  sources,
  snippets,
  primary,
  label = "Source"
}) {
  const records = [...new Set(primary ? [primary, ...evidence] : evidence)].filter((id) => evidence.includes(id)).map((id) => sources.find((s) => s.id === id)).filter(Boolean);
  if (!records.length) return null;
  return /* @__PURE__ */ jsxs11(
    Stack,
    {
      as: "section",
      gap: 2,
      className: "source-evidence detail-section",
      "aria-label": label,
      children: [
        label !== "Source" && /* @__PURE__ */ jsx17(Text3, { as: "h2", variant: "caption", className: "detail-section-title", children: label }),
        records.map(
          (source, i) => i === 0 ? /* @__PURE__ */ jsx17(
            SourceExcerpt,
            {
              source,
              snippet: snippets[source.id]
            },
            source.id
          ) : /* @__PURE__ */ jsx17(
            DisclosureNote,
            {
              title: source.title,
              className: "additional-source",
              children: /* @__PURE__ */ jsx17(SourceExcerpt, { source, snippet: snippets[source.id] })
            },
            source.id
          )
        )
      ]
    }
  );
}

// src/learning/LearningContent.jsx
import { useState as useState6, useMemo as useMemo5 } from "react";
import {
  Badge,
  Button as Button5,
  Counter as Counter2,
  DisclosureNote as DisclosureNote2,
  Notice,
  SearchField as SearchField2,
  Stack as Stack2,
  Tabs,
  Text as Text4
} from "@envsemble/envui";

// src/learning/reference.json
var reference_default = {
  kind: {
    title: "Kind",
    summary: "A type that supplies the principle used to identify its instances. An instance remains a member throughout its existence.",
    question: "What makes this the same individual after its state or relationships change?",
    example: "Person supplies identity; Student borrows that identity.",
    path: "classes/sortals/kind/index.html"
  },
  subkind: {
    title: "Subkind",
    summary: "A permanent specialization that inherits an identity principle from an identity provider.",
    question: "Can an individual stop belonging to this type while remaining the same individual? If yes, reconsider the stereotype.",
    path: "classes/sortals/subkind/index.html"
  },
  role: {
    title: "Role",
    summary: "A temporary classification that inherits identity and depends on a relationship. Leaving the role does not destroy the individual.",
    question: "Which mandatory relationship makes an individual play this role?",
    example: "A Person becomes a Student through an Enrollment and can later stop being a Student.",
    path: "classes/sortals/role/index.html"
  },
  phase: {
    title: "Phase",
    summary: "A temporary classification determined by intrinsic properties. Phases inherit identity and belong to a disjoint, complete partition.",
    question: "Which intrinsic property determines this phase, and do the alternatives cover all instances without overlap?",
    example: "Living and Deceased partition Person. A connection to another person does not determine these phases.",
    path: "classes/sortals/phase/index.html"
  },
  relator: {
    title: "Relator",
    summary: "An individual that grounds a relationship between other individuals and depends on them. Its mediations must require at least two participants in total.",
    question: "What relationship instance has its own identity and lifecycle?",
    example: "Enrollment connects a Student and a School. It can have a start date and its own termination.",
    path: "classes/sortals/relator/index.html"
  },
  mode: {
    title: "Mode",
    summary: "An intrinsic dependent individual without a structured value. It exists in exactly one bearer through characterization.",
    question: "What is its bearer, and why model this as an individual rather than an attribute?",
    example: "A skill or disposition depends on the person who has it.",
    path: "classes/aspects/mode/index.html"
  },
  quality: {
    title: "Quality",
    summary: "An intrinsic dependent individual with a structured value, such as a measurable height or weight. It characterizes exactly one bearer.",
    question: "What value space describes this quality, and which individual bears it?",
    path: "classes/aspects/quality/index.html"
  },
  collective: {
    title: "Collective",
    summary: "An identity provider for a collection whose members contribute uniformly to it.",
    question: "Do the members contribute in the same way, and what preserves the collection's identity when membership changes?",
    path: "classes/sortals/collective/index.html"
  },
  quantity: {
    title: "Quantity",
    summary: "An identity provider for an amount of matter. Its parts are essential to that particular quantity.",
    question: "Is this an amount of matter, rather than a count or numerical value?",
    path: "classes/sortals/quantity/index.html"
  },
  category: {
    title: "Category",
    summary: "A permanent classification shared by individuals with different identity principles. It does not supply their identity.",
    question: "Which different identity providers are grouped by this shared property?",
    path: "classes/nonsortals/category/index.html"
  },
  mixin: {
    title: "Mixin",
    summary: "A classification spanning different identity principles that may be permanent for some instances and contingent for others.",
    question: "Which instances must belong and which can leave while keeping their identity?",
    path: "classes/nonsortals/mixin/index.html"
  },
  roleMixin: {
    title: "Role mixin",
    summary: "A temporary, relationally dependent classification spanning different identity principles.",
    question: "Which different kinds can play this role, and which relationship makes them do so?",
    path: "classes/nonsortals/rolemixin/index.html"
  },
  phaseMixin: {
    title: "Phase mixin",
    summary: "A temporary classification spanning different identity principles and determined by intrinsic properties.",
    question: "Which intrinsic condition is shared across these different identity providers?",
    path: "classes/nonsortals/phasemixin/index.html"
  },
  mediation: {
    title: "Mediation",
    summary: "Connects a relator to an individual on which it depends. Read the count at each end from one instance at the opposite end.",
    question: "Which participants must exist for this relationship instance to exist?",
    example: "For each Enrollment, exactly one Student; for each Student, one or more Enrollments if enrollment is required for that role.",
    path: "relationships/mediation/index.html"
  },
  characterization: {
    title: "Characterization",
    summary: "Connects an intrinsic aspect to its bearer. The aspect depends on exactly one bearer.",
    question: "Can this aspect exist without this bearer?",
    path: "relationships/characterization/index.html"
  },
  material: {
    title: "Material relation",
    summary: "A relationship grounded by a relator and its mediations.",
    question: "Which relator makes the relationship true?",
    example: "A Student studies at a School because an Enrollment connects them.",
    path: "relationships/material/index.html"
  },
  formal: {
    title: "Formal relation",
    summary: "A relationship that holds directly between its participants without requiring a relator to ground it.",
    question: "What properties of the participants are sufficient for this relationship to hold?",
    path: "relationships/formal/index.html"
  },
  componentOf: {
    title: "Component of",
    summary: "A part-whole relation where parts contribute different functions to a functional whole.",
    question: "What function does the part perform for the whole?",
    path: "relationships/aggregations/componentOf/index.html"
  },
  memberOf: {
    title: "Member of",
    summary: "A part-whole relation connecting a member to a collective.",
    question: "Does each member contribute uniformly to the collection?",
    path: "relationships/aggregations/memberOf/index.html"
  },
  generalization: {
    title: "Generalization",
    summary: "Every instance of the specific type is also an instance of the general type. The hollow triangle points to the general type.",
    question: "Is every instance of the specific type necessarily an instance of the general type?",
    path: "theory/identity.html"
  },
  generalizationSet: {
    title: "Generalization set",
    summary: "A named group of inheritances sharing a supertype. Complete means its subtypes cover every instance of that supertype; incomplete permits instances outside them. Disjoint forbids simultaneous membership in different subtypes; overlapping permits it. These two constraints are independent.",
    question: "Do the listed alternatives cover every instance, and may one instance belong to more than one at the same time?",
    example: "Active and Suspended can form a complete, disjoint partition of Enrollment. Joining lines alone does not assert either constraint.",
    url: "https://www.omg.org/spec/UML/2.5.1/PDF"
  },
  association: {
    title: "Association",
    summary: "A link between instances of two types. Its multiplicities constrain the number of instances allowed at each end.",
    question: "Is this relationship intrinsic, grounded by a relator, or a direct relation? Record the reason if its stereotype is unresolved.",
    path: "relationships/index.html"
  }
};

// src/learning/modelHelp.js
var documentationURL = (key) => reference_default[key]?.url || `https://ontouml.readthedocs.io/en/latest/${reference_default[key]?.path || ""}`;
function lessonFor(key) {
  return reference_default[key] || {
    title: key || "Unspecified stereotype",
    summary: "This stereotype is not covered by the bundled lessons. Consult the metamodel and record the classification rationale.",
    question: "What are its identity, rigidity, and dependence commitments?"
  };
}
function countMeaning(value) {
  if (value === "*") return "zero or more";
  const [a, b] = value.split("..");
  if (b === "*") return `${a} or more`;
  return b ? `${a} to ${b}` : `exactly ${a}`;
}
function readMultiplicity(relation) {
  return [
    `For each ${relation.source.name}: ${countMeaning(relation.targetMultiplicity)} ${relation.targetMultiplicity === "1" ? "instance" : "instances"} of ${relation.target.name}.`,
    `For each ${relation.target.name}: ${countMeaning(relation.sourceMultiplicity)} ${relation.sourceMultiplicity === "1" ? "instance" : "instances"} of ${relation.source.name}.`
  ];
}
var identityIndexes = /* @__PURE__ */ new WeakMap();
function identityIndex(model) {
  if (identityIndexes.has(model)) return identityIndexes.get(model);
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  const parents = /* @__PURE__ */ new Map();
  for (const generalization of model.generalizations) {
    const { specificId, generalId } = generalization;
    if (!parents.has(specificId)) parents.set(specificId, []);
    parents.get(specificId).push(generalId);
  }
  const index2 = { classes, parents };
  identityIndexes.set(model, index2);
  return index2;
}
function identityProviders(model, id) {
  const found = /* @__PURE__ */ new Set(), pending = [id];
  const { classes, parents } = identityIndex(model);
  while (pending.length) {
    const next = pending.pop();
    if (found.has(next)) continue;
    found.add(next);
    pending.push(...parents.get(next) || []);
  }
  return [...found].map((key) => classes.get(key)).filter(
    (c) => c && [
      "kind",
      "collective",
      "quantity",
      "relator",
      "mode",
      "quality"
    ].includes(c.stereotype)
  );
}

// src/learning/LearningContent.jsx
import { Fragment as Fragment6, jsx as jsx18, jsxs as jsxs12 } from "react/jsx-runtime";
function ExternalLink({ href, children }) {
  return /* @__PURE__ */ jsx18(
    Button5,
    {
      variant: "text",
      href,
      target: "_blank",
      rel: "noopener noreferrer",
      endIcon: /* @__PURE__ */ jsx18(OpenInNew, {}),
      children
    }
  );
}
function Lesson({ stereotype, children }) {
  const lesson = lessonFor(stereotype);
  return /* @__PURE__ */ jsxs12(Stack2, { gap: 2, align: "start", className: "lesson", children: [
    /* @__PURE__ */ jsx18(Text4, { children: lesson.summary }),
    children,
    /* @__PURE__ */ jsx18(Text4, { className: "learning-question", children: lesson.question }),
    lesson.example && /* @__PURE__ */ jsx18(Text4, { tone: "muted", children: lesson.example }),
    /* @__PURE__ */ jsx18(ExternalLink, { href: documentationURL(stereotype), children: stereotype === "generalizationSet" ? "UML specification" : "OntoUML specification" })
  ] });
}
var SEVERITY_TONES = { error: "error", warning: "warning", info: "info" };
var SEVERITY_TITLES = {
  error: "Error",
  warning: "Warning",
  info: "Coverage note"
};
function ElementLearning({
  element,
  model,
  relation = false,
  parts = "all"
}) {
  const issuesShown = parts !== "lesson";
  const lessonShown = parts !== "issues";
  const whyShown = parts === "all";
  const key = relation ? element.type === "generalizationSet" ? "generalizationSet" : element.type === "generalization" ? "generalization" : element.stereotype || "association" : element.stereotype;
  const providers = relation ? [] : identityProviders(model, element.id);
  const issues = model.validation.issues.filter(
    (i) => i.elementId === element.id
  );
  const shownIssues = issuesShown ? issues.filter((i) => i.severity !== "info") : [];
  if (!lessonShown && !shownIssues.length) return null;
  return /* @__PURE__ */ jsxs12(
    Stack2,
    {
      as: "section",
      gap: 3,
      className: "element-learning",
      "aria-label": lessonShown ? "Model guidance" : "Model checks",
      children: [
        shownIssues.map((issue) => /* @__PURE__ */ jsx18(
          Notice,
          {
            tone: SEVERITY_TONES[issue.severity] || "warning",
            title: `${issue.severity === "error" ? "Needs review" : "Review"} \xB7 ${issue.code.replaceAll("_", " ").toLowerCase()}`,
            action: issue.documentation ? /* @__PURE__ */ jsx18(ExternalLink, { href: issue.documentation, children: "Rule in the specification" }) : void 0,
            children: issue.message
          },
          issue.code
        )),
        lessonShown && /* @__PURE__ */ jsx18(
          DisclosureNote2,
          {
            title: key === "generalizationSet" ? "Understand generalization sets" : `Understand \xAB${key || "unspecified"}\xBB`,
            children: /* @__PURE__ */ jsxs12(Lesson, { stereotype: key, children: [
              providers.length > 0 && /* @__PURE__ */ jsxs12(Text4, { children: [
                "Identity supplied by ",
                providers.map((p) => p.name).join(", "),
                "."
              ] }),
              relation && element.type === "association" && readMultiplicity(element).map((sentence) => /* @__PURE__ */ jsx18(Text4, { children: sentence }, sentence))
            ] })
          }
        ),
        whyShown && element.rationale && element.rationale !== element.description && /* @__PURE__ */ jsx18(DisclosureNote2, { title: "Why this classification?", children: /* @__PURE__ */ jsx18(Text4, { children: element.rationale }) }),
        (whyShown ? element.questions || [] : []).map((question) => /* @__PURE__ */ jsxs12(DisclosureNote2, { title: question.question, children: [
          /* @__PURE__ */ jsx18(Text4, { children: question.why }),
          /* @__PURE__ */ jsx18(Text4, { as: "h3", variant: "section-heading", children: "How to resolve it" }),
          /* @__PURE__ */ jsx18(Text4, { children: question.resolve })
        ] }, question.question))
      ]
    }
  );
}
function ValidationIssue({ issue, name, onInspect }) {
  const show = issue.elementId ? /* @__PURE__ */ jsx18(Button5, { variant: "text", onClick: () => onInspect(issue.elementId), children: name || "Show in model" }) : void 0;
  if (issue.severity === "info")
    return /* @__PURE__ */ jsxs12(Stack2, { gap: 0, align: "start", className: "coverage-note", children: [
      /* @__PURE__ */ jsx18(Text4, { variant: "supporting", children: issue.message }),
      show
    ] });
  return /* @__PURE__ */ jsx18(
    Notice,
    {
      tone: SEVERITY_TONES[issue.severity] || "info",
      title: SEVERITY_TITLES[issue.severity] || issue.severity,
      action: show,
      children: issue.message
    }
  );
}
function LearnTab({ query, setQuery }) {
  const [reveal, setReveal] = useState6(false);
  return /* @__PURE__ */ jsxs12(Stack2, { gap: 3, children: [
    /* @__PURE__ */ jsx18(
      SearchField2,
      {
        label: "Find a stereotype",
        placeholder: "Find a stereotype",
        value: query,
        onValueChange: setQuery
      }
    ),
    /* @__PURE__ */ jsxs12(DisclosureNote2, { title: "How to read counts", children: [
      /* @__PURE__ */ jsx18(Text4, { children: "The count next to a type says how many of its instances can relate to one instance at the opposite end." }),
      /* @__PURE__ */ jsx18(Text4, { children: "1 = exactly one \xB7 0..1 = optional, at most one \xB7 1..* = at least one \xB7 * = zero or more." }),
      /* @__PURE__ */ jsx18(Text4, { className: "learning-question", children: "Person [1] \u2014 [0..*] Enrollment. How many people does each enrollment require?" }),
      /* @__PURE__ */ jsx18("div", { children: /* @__PURE__ */ jsx18(Button5, { variant: "secondary", onClick: () => setReveal(!reveal), children: reveal ? "Hide answer" : "Check your understanding" }) }),
      reveal && /* @__PURE__ */ jsx18(Text4, { children: "Exactly one Person per Enrollment. The 0..* beside Enrollment permits a Person to have no enrollments or many." })
    ] }),
    Object.entries(reference_default).filter(
      ([key, value]) => `${key} ${value.summary}`.toLowerCase().includes(query.toLowerCase())
    ).map(([key, lesson]) => /* @__PURE__ */ jsx18(
      DisclosureNote2,
      {
        title: key === "generalizationSet" ? lesson.title : `${lesson.title} \xB7 \xAB${key}\xBB`,
        children: /* @__PURE__ */ jsx18(Lesson, { stereotype: key })
      },
      key
    ))
  ] });
}
var RECORD_KINDS = {
  plan: "Plan",
  glossary: "Glossary",
  decision: "Decision",
  scenario: "Scenario"
};
function ContextNotes({ ids = [], model }) {
  const records = (model.document?.context?.records || []).filter(
    (r) => ids.includes(r.id)
  );
  if (!records.length) return null;
  return /* @__PURE__ */ jsxs12(Text4, { variant: "supporting", className: "learning-context", children: [
    "From",
    " ",
    records.map(
      (r) => `${RECORD_KINDS[r.kind] || "Note"} \u203A ${r.title || r.section || r.id}`
    ).join(", ")
  ] });
}
function Walkthroughs({ learning, model, views, names, onInspect, onView }) {
  return /* @__PURE__ */ jsx18(Stack2, { gap: 5, children: learning.walkthroughs.map((walkthrough) => /* @__PURE__ */ jsxs12(Stack2, { gap: 3, className: "walkthrough", children: [
    /* @__PURE__ */ jsx18(Text4, { as: "h3", variant: "section-heading", children: walkthrough.title }),
    /* @__PURE__ */ jsx18(ContextNotes, { ids: walkthrough.contextIds, model }),
    /* @__PURE__ */ jsx18("ol", { className: "walkthrough-steps", children: walkthrough.steps.map((step, i) => {
      const view = views?.find((v) => v.key === step.viewKey);
      return /* @__PURE__ */ jsxs12("li", { children: [
        /* @__PURE__ */ jsx18(Text4, { children: step.text }),
        /* @__PURE__ */ jsxs12("div", { className: "step-links", children: [
          view && onView && /* @__PURE__ */ jsxs12(
            Button5,
            {
              variant: "text",
              startIcon: /* @__PURE__ */ jsx18(Visibility, {}),
              onClick: () => onView(view.key),
              children: [
                view.label || view.title || "This",
                " view"
              ]
            }
          ),
          step.elementIds.map((id) => /* @__PURE__ */ jsx18(
            Button5,
            {
              variant: "text",
              onClick: () => onInspect(id),
              children: names.get(id) || id
            },
            id
          ))
        ] })
      ] }, i);
    }) })
  ] }, walkthrough.id)) });
}
function verdict(scenario) {
  const met = scenario.result.expectationMet;
  const expected = scenario.expected === "invalid" ? "Invalid" : "Valid";
  if (met === null)
    return { tone: "neutral", text: `${expected} \xB7 not fully checked` };
  return met ? { tone: "success", text: `${expected} \xB7 as expected` } : { tone: "danger", text: `${expected} expected \xB7 differs` };
}
function Examples({ learning, model, names, onInspect }) {
  const classNames = new Map(model.classes.map((c) => [c.id, c.name]));
  return /* @__PURE__ */ jsxs12(Stack2, { gap: 5, children: [
    learning.scope && /* @__PURE__ */ jsx18(Text4, { tone: "muted", children: learning.scope }),
    learning.scenarios.map((scenario) => {
      const { tone, text } = verdict(scenario);
      const labels = new Map(
        scenario.instances.map((i) => [i.id, i.label || i.id])
      );
      return /* @__PURE__ */ jsxs12(Stack2, { gap: 2, className: "example", children: [
        /* @__PURE__ */ jsxs12("div", { className: "example-head", children: [
          /* @__PURE__ */ jsx18(Text4, { as: "h3", variant: "section-heading", children: scenario.title }),
          /* @__PURE__ */ jsx18(Badge, { tone, children: text })
        ] }),
        scenario.description && /* @__PURE__ */ jsx18(Text4, { children: scenario.description }),
        /* @__PURE__ */ jsx18(ContextNotes, { ids: scenario.contextIds, model }),
        scenario.result.issues.map((issue, i) => /* @__PURE__ */ jsxs12(Notice, { tone: "warning", children: [
          issue.message,
          issue.elementId && names.has(issue.elementId) && /* @__PURE__ */ jsxs12(Fragment6, { children: [
            " ",
            /* @__PURE__ */ jsx18(
              Button5,
              {
                variant: "text",
                onClick: () => onInspect(issue.elementId),
                children: names.get(issue.elementId)
              }
            )
          ] })
        ] }, i)),
        /* @__PURE__ */ jsxs12(
          DisclosureNote2,
          {
            title: `${scenario.instances.length} instances \xB7 ${scenario.links.length} links`,
            children: [
              /* @__PURE__ */ jsx18("ul", { className: "example-list", children: scenario.instances.map((instance) => /* @__PURE__ */ jsxs12("li", { children: [
                /* @__PURE__ */ jsx18("strong", { children: instance.label || instance.id }),
                ": ",
                instance.classIds.map((id) => classNames.get(id) || id).join(", ")
              ] }, instance.id)) }),
              scenario.links.length > 0 && /* @__PURE__ */ jsx18("ul", { className: "example-list", children: scenario.links.map((link, i) => /* @__PURE__ */ jsxs12("li", { children: [
                labels.get(link.sourceId) || link.sourceId,
                " \u2192",
                " ",
                /* @__PURE__ */ jsx18("em", { children: names.get(link.relationId) || link.relationId }),
                " \u2192",
                " ",
                labels.get(link.targetId) || link.targetId
              ] }, i)) }),
              scenario.result.unassessed.map((u, i) => /* @__PURE__ */ jsx18(Text4, { tone: "muted", children: u.message }, i))
            ]
          }
        )
      ] }, scenario.id);
    })
  ] });
}
function LearningLibrary({
  model,
  learning = null,
  views = null,
  conceptual = true,
  onInspect,
  onView,
  tab: chosenTab,
  onTabChange
}) {
  const [localTab, setLocalTab] = useState6(null), [query, setQuery] = useState6("");
  const visibleIssues = model.validation.issues.filter(
    (i) => i.severity !== "info"
  );
  const coverage = model.validation.issues.filter((i) => i.severity === "info");
  const elementNames = useMemo5(
    () => new Map(
      [...model.classes, ...model.relations, ...model.partitions || []].map(
        (e) => [e.originalId || e.id, e.name]
      )
    ),
    [model]
  );
  const renderIssue = (issue, i) => /* @__PURE__ */ jsx18(
    ValidationIssue,
    {
      issue,
      name: elementNames.get(issue.elementId),
      onInspect
    },
    i
  );
  const errors = model.validation.counts.error;
  const items = [];
  const guide = (learning?.walkthroughs?.length > 0 || learning?.scenarios?.length > 0) && /* @__PURE__ */ jsxs12(Stack2, { gap: 6, className: "model-guide", children: [
    learning.walkthroughs?.length > 0 && /* @__PURE__ */ jsx18(
      Walkthroughs,
      {
        learning,
        model,
        views,
        names: elementNames,
        onInspect,
        onView
      }
    ),
    learning.scenarios?.length > 0 && /* @__PURE__ */ jsxs12(Stack2, { as: "section", gap: 3, "aria-label": "Examples", children: [
      /* @__PURE__ */ jsx18(Text4, { as: "h3", variant: "caption", className: "detail-section-title", children: "Examples" }),
      /* @__PURE__ */ jsx18(
        Examples,
        {
          learning,
          model,
          names: elementNames,
          onInspect
        }
      )
    ] })
  ] });
  if (guide && !conceptual) return guide;
  if (guide)
    items.push({
      value: "guide",
      button: /* @__PURE__ */ jsx18(Button5, { children: "Guide" }),
      content: guide
    });
  if (conceptual)
    items.push(
      {
        value: "learn",
        button: /* @__PURE__ */ jsx18(Button5, { children: "Learn" }),
        content: /* @__PURE__ */ jsx18(LearnTab, { query, setQuery })
      },
      {
        value: "checks",
        button: /* @__PURE__ */ jsxs12(
          Button5,
          {
            "aria-label": `Checks, ${errors} ${errors === 1 ? "finding" : "findings"}`,
            children: [
              "Checks ",
              /* @__PURE__ */ jsx18(Counter2, { value: errors })
            ]
          }
        ),
        content: /* @__PURE__ */ jsxs12(Stack2, { gap: 3, children: [
          !errors && /* @__PURE__ */ jsx18(Text4, { children: "The implemented checks pass." }),
          visibleIssues.map(renderIssue),
          /* @__PURE__ */ jsxs12(DisclosureNote2, { title: "Rule coverage", children: [
            /* @__PURE__ */ jsx18(Text4, { tone: "muted", children: "Official JSON schema, reference integrity, and a documented subset of ontology rules. Domain accuracy still needs judgment." }),
            coverage.map(renderIssue),
            model.validation.limitations.map((limit) => /* @__PURE__ */ jsx18(Text4, { tone: "muted", children: limit }, limit))
          ] })
        ] })
      },
      {
        value: "questions",
        button: /* @__PURE__ */ jsx18(Button5, { children: "Questions" }),
        content: /* @__PURE__ */ jsx18(Stack2, { gap: 3, children: model.unknowns.length ? model.unknowns.map((question) => /* @__PURE__ */ jsx18(Text4, { className: "open-question", children: question }, question)) : /* @__PURE__ */ jsx18(Text4, { tone: "muted", children: "No project-wide questions recorded." }) })
      }
    );
  if (!items.length) return null;
  const wanted = chosenTab ?? localTab;
  const tab = items.some((item) => item.value === wanted) ? wanted : items[0].value;
  return /* @__PURE__ */ jsx18(
    Tabs,
    {
      "aria-label": conceptual ? "OntoUML learning library" : "Model guide",
      className: "learning-tabs",
      value: tab,
      onValueChange: (next) => {
        if (!next) return;
        setLocalTab(next);
        onTabChange?.(next);
      },
      items
    }
  );
}

// src/ui/DetailHeader.jsx
import { Badge as Badge2, Text as Text5 } from "@envsemble/envui";

// src/review/ChangeMark.jsx
import { jsx as jsx19 } from "react/jsx-runtime";
function ChangeMark({ status }) {
  if (!CHANGE_LABELS[status]) return null;
  return /* @__PURE__ */ jsx19("span", { className: "change-mark", "data-change": status, "aria-hidden": "true", children: changeGlyph(status) });
}
function ChangeBadge({ status }) {
  if (!CHANGE_LABELS[status]) return null;
  return /* @__PURE__ */ jsx19("span", { className: "change-badge", "data-change": status, children: CHANGE_LABELS[status] });
}

// src/ui/DetailHeader.jsx
import { jsx as jsx20, jsxs as jsxs13 } from "react/jsx-runtime";
var STATUSES = {
  inferred: {
    label: "Inferred",
    tone: "neutral",
    title: "Interpreted from the evidence rather than observed in the source"
  },
  unresolved: {
    label: "Unresolved",
    tone: "warning",
    title: "The evidence leaves this open"
  }
};
var COLOURED = /* @__PURE__ */ new Set(["kind", "role", "relator", "phase", "event", "mode"]);
var colouredFamily = (stereotype) => {
  const family = stereotype && stereotypeFamily(stereotype);
  return COLOURED.has(family) ? family : null;
};
function StereotypeSwatch({ stereotype }) {
  const family = colouredFamily(stereotype);
  if (!family) return null;
  return /* @__PURE__ */ jsx20(
    "span",
    {
      className: "stereotype-swatch",
      "aria-hidden": "true",
      style: {
        background: `var(--node-${family}, var(--color-fill))`,
        borderColor: `var(--type-${family}, var(--color-border-strong))`
      }
    }
  );
}
function DetailHeader({
  title,
  owner,
  tag,
  status,
  change,
  description,
  stereotype,
  icon: Icon = Category
}) {
  const evidence = change !== "added" && STATUSES[status];
  return /* @__PURE__ */ jsxs13("header", { className: "detail-header", children: [
    /* @__PURE__ */ jsxs13("div", { className: "detail-title", children: [
      /* @__PURE__ */ jsx20("span", { className: "detail-icon", "aria-hidden": "true", children: /* @__PURE__ */ jsx20(Icon, {}) }),
      /* @__PURE__ */ jsxs13(Text5, { as: "h1", variant: "page-heading", children: [
        owner && /* @__PURE__ */ jsxs13("span", { className: "detail-owner", children: [
          owner,
          "."
        ] }),
        title
      ] })
    ] }),
    (tag || change || evidence) && /* @__PURE__ */ jsxs13("div", { className: "detail-tags", children: [
      tag && /* @__PURE__ */ jsx20(
        Badge2,
        {
          variant: "outline",
          icon: colouredFamily(stereotype) ? /* @__PURE__ */ jsx20(StereotypeSwatch, { stereotype }) : void 0,
          children: tag
        }
      ),
      /* @__PURE__ */ jsx20(ChangeBadge, { status: change }),
      evidence && /* @__PURE__ */ jsx20(Badge2, { tone: evidence.tone, title: evidence.title, children: evidence.label })
    ] }),
    description && /* @__PURE__ */ jsx20(Text5, { tone: "muted", className: "detail-description", children: description })
  ] });
}

// src/viewer/DetailSections.jsx
import { useEffect as useEffect6, useRef as useRef6, useState as useState7 } from "react";
import { Button as Button6, DisclosureNote as DisclosureNote3, Stack as Stack3, Text as Text6 } from "@envsemble/envui";

// src/model/printable.js
var printable = (value) => typeof value === "string" ? value : JSON.stringify(value ?? "");

// src/viewer/DetailSections.jsx
import { Fragment as Fragment7, jsx as jsx21, jsxs as jsxs14 } from "react/jsx-runtime";
function Section({ title, label = title, className = "", children }) {
  return /* @__PURE__ */ jsxs14(
    Stack3,
    {
      as: "section",
      gap: 2,
      className: `detail-section${className ? ` ${className}` : ""}`,
      "aria-label": label,
      children: [
        /* @__PURE__ */ jsx21(Text6, { as: "h2", variant: "caption", className: "detail-section-title", children: title }),
        children
      ]
    }
  );
}
function InlineText({ text }) {
  const parts = (text === null || text === void 0 ? "" : printable(text)).replace(/\*\*(.+?)\*\*/g, "$1").replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1").split(/(`[^`\n]+`)/);
  return parts.map(
    (part, i) => part.length > 2 && part.startsWith("`") && part.endsWith("`") ? /* @__PURE__ */ jsx21("code", { children: part.slice(1, -1) }, i) : part
  );
}
var RECORD_KINDS2 = {
  plan: "Plan",
  glossary: "Glossary",
  decision: "Decision",
  scenario: "Scenario"
};
var recordLabel = (record) => `${RECORD_KINDS2[record.kind] || "Note"} \u203A ${record.title || record.section || record.id}`;
var excerpt = (text) => text.replace(/^[ \t]*[-*+][ \t]+/gm, "\u2022 ");
function Reference({ record, onReference }) {
  const [open, setOpen] = useState7(false);
  const label = recordLabel(record);
  const text = excerpt(printable(record.text ?? "")).trim();
  const long = text.length > 110 || text.includes("\n");
  return /* @__PURE__ */ jsxs14("li", { className: "reference", children: [
    /* @__PURE__ */ jsxs14("div", { className: "reference-head", children: [
      onReference && typeof record.path === "string" ? /* @__PURE__ */ jsx21(
        Button6,
        {
          variant: "text",
          className: "reference-link",
          "aria-label": `Open ${label}`,
          onClick: () => onReference(record),
          children: label
        }
      ) : /* @__PURE__ */ jsx21(Text6, { as: "span", className: "reference-title", children: label }),
      long && /* @__PURE__ */ jsx21(
        ToolButton,
        {
          className: "reference-toggle",
          variant: "text",
          label: open ? "Show less of the passage" : "Show the whole passage",
          "aria-expanded": open,
          icon: open ? /* @__PURE__ */ jsx21(ExpandLess, {}) : /* @__PURE__ */ jsx21(ExpandMore, {}),
          onClick: () => setOpen((value) => !value)
        }
      )
    ] }),
    text && /* @__PURE__ */ jsx21(
      Text6,
      {
        variant: "supporting",
        className: `reference-excerpt${open ? " expanded" : ""}`,
        children: /* @__PURE__ */ jsx21(InlineText, { text })
      }
    )
  ] });
}
function Question({ question }) {
  return /* @__PURE__ */ jsxs14(
    DisclosureNote3,
    {
      className: "detail-question",
      title: printable(question?.question ?? question),
      children: [
        question?.why && /* @__PURE__ */ jsx21(Text6, { children: printable(question.why) }),
        question?.resolve && /* @__PURE__ */ jsxs14(Text6, { tone: "muted", children: [
          /* @__PURE__ */ jsx21("strong", { children: "To resolve: " }),
          printable(question.resolve)
        ] })
      ]
    }
  );
}
function Why({ rationale, questions = [], records = [], onReference }) {
  const reasons = [].concat(rationale ?? []).filter((r) => r !== null && r !== void 0 && r !== "");
  const asked = [].concat(questions || []).filter(Boolean);
  if (!reasons.length && !asked.length && !records.length) return null;
  return /* @__PURE__ */ jsxs14(Section, { title: "Why", children: [
    reasons.map((reason, i) => /* @__PURE__ */ jsx21(Text6, { className: "detail-rationale", children: /* @__PURE__ */ jsx21(InlineText, { text: reason }) }, i)),
    asked.map((question, i) => /* @__PURE__ */ jsx21(Question, { question }, i)),
    records.length > 0 && /* @__PURE__ */ jsx21("ul", { className: "reference-list", "aria-label": "Planning references", children: records.map((record) => /* @__PURE__ */ jsx21(
      Reference,
      {
        record,
        onReference
      },
      record.id
    )) })
  ] });
}
function linkedRecords(model, ids) {
  const context = model.document?.context;
  if (!context) return [];
  const wanted = new Set(ids.filter(Boolean));
  const linked = new Set(
    context.links.filter((link) => wanted.has(link.elementId)).map((link) => link.recordId)
  );
  return context.records.filter((record) => linked.has(record.id));
}
var KIND_WORDS = { "type alias": "type alias", enum: "enum" };
var countOf = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
function contents(element, profile, except = /* @__PURE__ */ new Set()) {
  const own = (members) => (members || []).filter((m) => !except.has(m.id));
  const fields = own(element.attributes).length, methods = own(element.methods).length;
  const field = profile === "database" ? "column" : element.stereotype === "enum" ? "member" : profile === "code" ? "field" : "attribute";
  return [
    fields ? countOf(fields, field) : "",
    methods ? countOf(methods, "method") : ""
  ].filter(Boolean).join(" and ");
}
var TYPE_KEYS = ["type", "propertyType"];
var SIGNATURE_KEYS = [...TYPE_KEYS, "name"];
var typeChange = (member) => member.properties.some((p) => p.key === "name") ? null : member.properties.find((p) => TYPE_KEYS.includes(p.key)) || null;
function ChangedValue({ before, after }) {
  return /* @__PURE__ */ jsxs14(Fragment7, { children: [
    /* @__PURE__ */ jsx21("del", { className: "change-before", children: before }),
    /* @__PURE__ */ jsx21("span", { className: "change-arrow", "aria-hidden": "true", children: "\u2192" }),
    /* @__PURE__ */ jsx21("span", { className: "visually-hidden", children: " changed to " }),
    /* @__PURE__ */ jsx21("ins", { className: "change-after", children: after })
  ] });
}
function ChangedProperty({ name, before, after }) {
  return /* @__PURE__ */ jsxs14("span", { children: [
    /* @__PURE__ */ jsx21("span", { className: "change-key", children: name }),
    " ",
    /* @__PURE__ */ jsx21(ChangedValue, { before, after })
  ] });
}
function WhatChanges({ change, element, model, profile }) {
  if (!change) return null;
  const kind = KIND_WORDS[element.stereotype] || element.stereotype || (profile === "database" ? "table" : "class");
  const moved = change.moved || [];
  const held = contents(element, profile, new Set(moved.map((m) => m.id)));
  const movedText = moved.length ? `${moved.map(
    (m) => m.moved.to ? `${m.label} moved to ${m.moved.to}` : `${m.label} moved from ${m.moved.from}`
  ).join("; ")}.` : "";
  if (change.status === "added") {
    const file = profile === "code" ? elementFile(element, model) : null;
    const declared = profile === "code" && !file ? decodeIdentity(element.id)?.name : null;
    return /* @__PURE__ */ jsxs14(Section, { title: "What changes", children: [
      /* @__PURE__ */ jsxs14(Text6, { children: [
        "New ",
        kind,
        held ? ` with ${held}` : "",
        "."
      ] }),
      movedText && /* @__PURE__ */ jsx21(Text6, { children: movedText }),
      file ? /* @__PURE__ */ jsxs14(Text6, { className: "proposed-location", children: [
        "Proposed in ",
        /* @__PURE__ */ jsx21("code", { children: file }),
        fileExists(model, file) ? "" : " (a new file)"
      ] }) : declared && declared !== element.name && /* @__PURE__ */ jsxs14(Text6, { className: "proposed-location", children: [
        "Proposed as ",
        /* @__PURE__ */ jsx21("code", { children: declared })
      ] })
    ] });
  }
  if (change.status === "removed")
    return /* @__PURE__ */ jsxs14(Section, { title: "What changes", children: [
      /* @__PURE__ */ jsxs14(Text6, { children: [
        "The ",
        kind,
        " is removed",
        held ? `, with its ${held}` : "",
        "."
      ] }),
      movedText && /* @__PURE__ */ jsx21(Text6, { children: movedText })
    ] });
  if (!change.properties.length && !change.members.length) return null;
  return /* @__PURE__ */ jsx21(Section, { title: "What changes", children: /* @__PURE__ */ jsxs14("ul", { className: "change-list", children: [
    change.properties.map((p, i) => /* @__PURE__ */ jsxs14(
      "li",
      {
        className: "change-line",
        "data-change": p.status,
        children: [
          /* @__PURE__ */ jsx21(ChangeMark, { status: p.status }),
          /* @__PURE__ */ jsx21("span", { className: "change-line-text", children: p.status === "modified" ? /* @__PURE__ */ jsx21(
            ChangedProperty,
            {
              name: p.key,
              before: p.before,
              after: p.after
            }
          ) : (
            // A part of a table that is new or removed, as it reads.
            /* @__PURE__ */ jsxs14("span", { children: [
              /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
                CHANGE_LABELS[p.status],
                ":",
                " "
              ] }),
              /* @__PURE__ */ jsx21("span", { className: "change-key", children: p.key }),
              " ",
              /* @__PURE__ */ jsx21("code", { className: "signature", children: p.status === "added" ? p.after : p.before })
            ] })
          ) })
        ]
      },
      `${p.key}-${i}`
    )),
    change.members.map((m) => /* @__PURE__ */ jsxs14("li", { className: "change-line", "data-change": m.status, children: [
      /* @__PURE__ */ jsx21(ChangeMark, { status: m.status }),
      /* @__PURE__ */ jsxs14("span", { className: "change-line-text", children: [
        /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
          CHANGE_LABELS[m.status],
          ":",
          " "
        ] }),
        m.status === "modified" && !m.method && typeChange(m) ? (
          // A field whose type changed reads as its name and both types.
          /* @__PURE__ */ jsxs14("code", { className: "signature", children: [
            /* @__PURE__ */ jsx21("span", { className: "member-name", children: m.name }),
            profile === "database" ? " " : ": ",
            /* @__PURE__ */ jsx21(
              ChangedValue,
              {
                before: typeChange(m).before,
                after: typeChange(m).after
              }
            )
          ] })
        ) : (m.status === "modified" || m.moved) && m.previous && m.previous !== m.signature ? /* @__PURE__ */ jsx21("code", { className: "signature", children: /* @__PURE__ */ jsx21(ChangedValue, { before: m.previous, after: m.signature }) }) : /* @__PURE__ */ jsx21("code", { className: "signature", children: m.signature }),
        m.properties.filter((p) => !SIGNATURE_KEYS.includes(p.key)).map((p) => /* @__PURE__ */ jsxs14("span", { className: "change-detail", children: [
          p.key,
          ": ",
          /* @__PURE__ */ jsx21(ChangedValue, { before: p.before, after: p.after })
        ] }, p.key)),
        m.moved && /* @__PURE__ */ jsx21("span", { className: "change-detail", children: m.moved.from ? `Moved from ${m.moved.from}` : `Moved to ${m.moved.to}` })
      ] }),
      m.location && /* @__PURE__ */ jsx21(
        "span",
        {
          className: "member-line",
          title: `Line ${m.location.startLine}`,
          children: m.location.startLine
        }
      )
    ] }, m.id))
  ] }) });
}
function sourceOf(element, sources) {
  const ids = [element.primarySource, ...element.evidence || []].filter(
    Boolean
  );
  return ids.map((id) => sources.find((s) => s.id === id)).find(Boolean);
}
function CodeWhere({ element, model, snippets, change }) {
  if (change === "added") return null;
  const file = elementFile(element, model);
  const location2 = element.location;
  const source = sourceOf(element, model.sources || []);
  const snippet = source && snippets?.[source.id];
  if (!file && !snippet) return null;
  const url = snippet?.url || source?.url;
  return /* @__PURE__ */ jsxs14(Section, { title: change === "removed" ? "Where it was" : "Where in code", children: [
    /* @__PURE__ */ jsxs14("div", { className: "code-where", children: [
      /* @__PURE__ */ jsx21("code", { className: "code-path", title: file || void 0, children: file || source.file }),
      location2 && /* @__PURE__ */ jsx21("span", { className: "code-lines", children: location2.startLine === location2.endLine ? `line ${location2.startLine}` : `lines ${location2.startLine}\u2013${location2.endLine}` })
    ] }),
    snippet && /* @__PURE__ */ jsx21(
      CodeSnippet,
      {
        snippet,
        label: `${file || source.title}, lines ${snippet.startLine} to ${snippet.endLine}`
      }
    ),
    url && /* @__PURE__ */ jsx21(
      Button6,
      {
        variant: "text",
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        endIcon: /* @__PURE__ */ jsx21(OpenInNew, {}),
        className: "code-source-link",
        children: url.startsWith("https://github.com/") ? "View on GitHub" : "View source"
      }
    )
  ] });
}
function useReveal(focused) {
  const ref = useRef6(null);
  useEffect6(() => {
    if (focused) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focused]);
  return ref;
}
function FocusableRow({ focused, change, children }) {
  const ref = useReveal(focused);
  return /* @__PURE__ */ jsx21(
    "li",
    {
      ref,
      className: `member${focused ? " focused" : ""}`,
      "data-change": change,
      "aria-current": focused ? "true" : void 0,
      children
    }
  );
}
function MemberRow({ member, method, profile, review, focused }) {
  const status = review ? member.changeStatus : void 0;
  const marked = status && status !== "unchanged";
  const ref = useReveal(focused);
  return /* @__PURE__ */ jsxs14(
    "li",
    {
      ref,
      className: `member${focused ? " focused" : ""}`,
      "data-change": marked ? status : void 0,
      "aria-current": focused ? "true" : void 0,
      children: [
        review && /* @__PURE__ */ jsx21(ChangeMark, { status }),
        marked && /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
          CHANGE_LABELS[status],
          ": "
        ] }),
        /* @__PURE__ */ jsx21("code", { className: "signature", children: method ? member.type || `${member.name}()` : /* @__PURE__ */ jsxs14(Fragment7, { children: [
          /* @__PURE__ */ jsxs14("span", { className: "member-name", children: [
            member.name,
            member.optional ? "?" : ""
          ] }),
          member.type && /* @__PURE__ */ jsxs14("span", { className: "member-type", children: [
            profile === "database" ? " " : ": ",
            member.type,
            member.multiplicity ? ` [${member.multiplicity}]` : ""
          ] })
        ] }) }),
        member.location && /* @__PURE__ */ jsx21(
          "span",
          {
            className: "member-line",
            title: `Line ${member.location.startLine}`,
            children: member.location.startLine
          }
        )
      ]
    }
  );
}
function Members({ element, profile, review, focus = null }) {
  const fields = element.attributes || [], methods = element.methods || [];
  if (!fields.length && !methods.length) return null;
  const marks = review && element.changeStatus === "modified";
  const fieldTitle = element.stereotype === "enum" ? "Members" : profile === "code" ? "Fields" : "Attributes";
  return /* @__PURE__ */ jsxs14(Fragment7, { children: [
    fields.length > 0 && /* @__PURE__ */ jsx21(Section, { title: `${fieldTitle} \xB7 ${fields.length}`, label: fieldTitle, children: /* @__PURE__ */ jsx21("ul", { className: `member-list${marks ? " marked" : ""}`, children: fields.map((member) => /* @__PURE__ */ jsx21(
      MemberRow,
      {
        member,
        profile,
        review: marks,
        focused: member.id === focus
      },
      member.id
    )) }) }),
    methods.length > 0 && /* @__PURE__ */ jsx21(Section, { title: `Methods \xB7 ${methods.length}`, label: "Methods", children: /* @__PURE__ */ jsx21("ul", { className: `member-list${marks ? " marked" : ""}`, children: methods.map((member) => /* @__PURE__ */ jsx21(
      MemberRow,
      {
        member,
        method: true,
        profile,
        review: marks,
        focused: member.id === focus
      },
      member.id
    )) }) })
  ] });
}
function foreignKeys(element, model, rollup) {
  const outgoing = (model.relations || []).filter(
    (r) => r.sourceId === element.id && Array.isArray(r.columns)
  );
  const current = new Set(
    outgoing.filter((r) => r.changeStatus !== "removed").map((r) => r.id)
  );
  return outgoing.filter((r) => !(r.changeStatus === "removed" && current.has(r.originalId))).map((relation) => {
    const status = rollup && relation.changeStatus && relation.changeStatus !== "unchanged" ? relation.changeStatus : void 0;
    const record = status === "modified" ? rowFor(
      rollup,
      { kind: "edge", id: relation.id },
      model
    )?.changes.find((c) => c.elementId === relation.id) : null;
    const before = record?.before;
    const previous = Array.isArray(before?.columns) ? {
      columns: before.columns,
      targetId: before.targetId,
      target: before.target,
      targetColumns: before.targetColumns
    } : null;
    const details = meaningfulProperties(record).filter(
      (p) => !["columns", "targetId", "target", "targetColumns", "name"].includes(
        p.key
      )
    );
    return { relation, previous, status, details, names: rollup?.names };
  });
}
function TableSchema({
  element,
  model,
  review,
  rollup = null,
  focus = null
}) {
  const columns = element.attributes || [];
  const marks = review && element.changeStatus === "modified";
  const outgoing = foreignKeys(element, model, rollup);
  const record = rollup ? rowFor(rollup, { kind: "node", id: element.id })?.changes.find(
    (c) => c.elementId === element.id
  ) : null;
  const keyNote = record?.properties?.find((p) => p.key === "keys");
  const keyChanges = new Map(
    (keyNote ? itemChanges(keyNote) || [] : []).filter((c) => !(c.after ?? c.before)?.primary).map((c) => [(c.after ?? c.before).name, c])
  );
  const tables = new Map(model.classes.map((c) => [c.id, c.name]));
  const keyText = (relation) => `${relation.columns.join(", ")} \u2192 ${tables.get(relation.targetId) || relation.target}(${(relation.targetColumns || []).join(", ")})`;
  const unique = [
    ...(element.keys || []).filter((key) => !key.primary),
    ...[...keyChanges.values()].filter((c) => c.status === "removed").map((c) => c.before)
  ];
  const shownByRelation = (key) => outgoing.some(
    ({ relation }) => relation.changeStatus !== "removed" && JSON.stringify(relation.columns) === JSON.stringify(key.columns) && (relation.target === key.target || tables.get(relation.targetId) === key.target)
  );
  const foreignNote = record?.properties?.find((p) => p.key === "foreignKeys");
  const foreignChanges = new Map(
    (foreignNote ? itemChanges(foreignNote) || [] : []).map((c) => [
      partKey(c.after ?? c.before),
      c
    ])
  );
  const external = [
    ...(element.foreignKeys || []).filter(
      (key) => Array.isArray(key.columns) && typeof key.target === "string" && !shownByRelation(key)
    ),
    ...[...foreignChanges.values()].filter((c) => c.status === "removed").map((c) => c.before)
  ];
  const sql = [
    element.definition,
    ...(element.constraints || []).map((c) => c.definition),
    ...(element.triggers || []).map((t) => t.definition || t.sql)
  ].filter(Boolean);
  return /* @__PURE__ */ jsxs14(Fragment7, { children: [
    columns.length > 0 && /* @__PURE__ */ jsx21(Section, { title: `Columns \xB7 ${columns.length}`, label: "Columns", children: /* @__PURE__ */ jsx21("ul", { className: `member-list columns${marks ? " marked" : ""}`, children: columns.map((column) => {
      const status = marks ? column.changeStatus : void 0;
      const marked = status && status !== "unchanged";
      return /* @__PURE__ */ jsxs14(
        FocusableRow,
        {
          focused: column.id === focus,
          change: marked ? status : void 0,
          children: [
            marks && /* @__PURE__ */ jsx21(ChangeMark, { status }),
            marked && /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
              CHANGE_LABELS[status],
              ":",
              " "
            ] }),
            /* @__PURE__ */ jsxs14("code", { className: "signature", children: [
              /* @__PURE__ */ jsx21("span", { className: "member-name", children: column.name }),
              " ",
              /* @__PURE__ */ jsxs14("span", { className: "member-type", children: [
                column.type,
                column.nullable ? "" : " not null",
                column.default !== null && column.default !== void 0 ? ` default ${column.default}` : ""
              ] })
            ] }),
            (column.primaryKeyOrder || column.generated) && /* @__PURE__ */ jsxs14("span", { className: "column-flags", children: [
              column.primaryKeyOrder ? "PK" : "",
              column.generated ? " generated" : ""
            ] })
          ]
        },
        column.id
      );
    }) }) }),
    (outgoing.length > 0 || unique.length > 0 || external.length > 0) && /* @__PURE__ */ jsx21(Section, { title: "Keys", children: /* @__PURE__ */ jsxs14(
      "ul",
      {
        className: `member-list${outgoing.some((key) => key.status) || keyChanges.size || foreignChanges.size ? " marked" : ""}`,
        children: [
          unique.map((key) => {
            const change = keyChanges.get(key.name);
            return /* @__PURE__ */ jsxs14(
              "li",
              {
                className: "member",
                "data-change": change?.status,
                children: [
                  change && /* @__PURE__ */ jsx21(ChangeMark, { status: change.status }),
                  change && /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
                    CHANGE_LABELS[change.status],
                    ":",
                    " "
                  ] }),
                  /* @__PURE__ */ jsxs14("code", { className: "signature", children: [
                    /* @__PURE__ */ jsx21("span", { className: "member-name", children: "unique" }),
                    " ",
                    /* @__PURE__ */ jsx21("span", { className: "member-type", children: change?.status === "modified" ? /* @__PURE__ */ jsx21(
                      ChangedValue,
                      {
                        before: partChange(change.before, change.after)[0],
                        after: partChange(change.before, change.after)[1]
                      }
                    ) : `(${key.columns.join(", ")})` })
                  ] })
                ]
              },
              key.name
            );
          }),
          outgoing.map(({ relation, previous, status, details, names }) => /* @__PURE__ */ jsxs14(
            "li",
            {
              className: "member",
              "data-change": status && status !== "unchanged" ? status : void 0,
              children: [
                status && /* @__PURE__ */ jsx21(ChangeMark, { status }),
                status && CHANGE_LABELS[status] && /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
                  CHANGE_LABELS[status],
                  ":",
                  " "
                ] }),
                /* @__PURE__ */ jsxs14("span", { className: "change-line-text", children: [
                  /* @__PURE__ */ jsx21("code", { className: "signature", children: previous && keyText(previous) !== keyText(relation) ? /* @__PURE__ */ jsx21(
                    ChangedValue,
                    {
                      before: keyText(previous),
                      after: keyText(relation)
                    }
                  ) : /* @__PURE__ */ jsxs14(Fragment7, { children: [
                    /* @__PURE__ */ jsx21("span", { className: "member-name", children: relation.columns.join(", ") }),
                    " ",
                    /* @__PURE__ */ jsxs14("span", { className: "member-type", children: [
                      "\u2192 ",
                      tables.get(relation.targetId) || relation.target,
                      "(",
                      (relation.targetColumns || []).join(", "),
                      ")"
                    ] })
                  ] }) }),
                  details.map((p) => /* @__PURE__ */ jsxs14("span", { className: "change-detail", children: [
                    p.key,
                    ":",
                    " ",
                    /* @__PURE__ */ jsx21(
                      ChangedValue,
                      {
                        before: cellText(p.before, names, p.key),
                        after: cellText(p.after, names, p.key)
                      }
                    )
                  ] }, p.key))
                ] })
              ]
            },
            relation.id
          )),
          external.map((key) => {
            const change = foreignChanges.get(partKey(key));
            return /* @__PURE__ */ jsxs14(
              "li",
              {
                className: "member",
                "data-change": change?.status,
                children: [
                  change && /* @__PURE__ */ jsx21(ChangeMark, { status: change.status }),
                  change && /* @__PURE__ */ jsxs14("span", { className: "visually-hidden", children: [
                    CHANGE_LABELS[change.status],
                    ":",
                    " "
                  ] }),
                  /* @__PURE__ */ jsx21("code", { className: "signature", children: change?.status === "modified" ? /* @__PURE__ */ jsx21(
                    ChangedValue,
                    {
                      before: partChange(change.before, change.after)[0],
                      after: partChange(change.before, change.after)[1]
                    }
                  ) : /* @__PURE__ */ jsxs14(Fragment7, { children: [
                    /* @__PURE__ */ jsx21("span", { className: "member-name", children: key.columns.join(", ") }),
                    " ",
                    /* @__PURE__ */ jsxs14("span", { className: "member-type", children: [
                      "\u2192 ",
                      key.target,
                      "(",
                      (key.targetColumns || []).join(", "),
                      ")"
                    ] })
                  ] }) })
                ]
              },
              partKey(key)
            );
          })
        ]
      }
    ) }),
    sql.length > 0 && /* @__PURE__ */ jsx21(DisclosureNote3, { title: "Definition", className: "detail-definition", children: sql.map((text, i) => /* @__PURE__ */ jsx21("pre", { className: "source-code", tabIndex: 0, children: /* @__PURE__ */ jsx21("code", { children: text }) }, i)) })
  ] });
}

// src/viewer/DetailsContent.jsx
import { Fragment as Fragment8, jsx as jsx22, jsxs as jsxs15 } from "react/jsx-runtime";
var profileOf = (model) => model.document?.profile || "ontouml";
var changeOf = (review, element) => review && element.changeStatus && element.changeStatus !== "unchanged" ? element.changeStatus : null;
var ConceptDetails = memo5(function ConceptDetails2({
  concept,
  model,
  snippets,
  review = null,
  member = null,
  onReference
}) {
  const profile = profileOf(model);
  const conceptual = profile === "ontouml";
  const change = changeOf(review, concept);
  const described = change ? describeClassChange(review.rollup, concept, profile) : null;
  const records = linkedRecords(model, [
    concept.id,
    ...(concept.attributes || []).map((a) => a.id),
    ...(concept.methods || []).map((m) => m.id)
  ]);
  return /* @__PURE__ */ jsxs15(Fragment8, { children: [
    /* @__PURE__ */ jsx22(
      DetailHeader,
      {
        title: concept.name,
        tag: `\xAB${concept.stereotype || "unspecified"}\xBB`,
        stereotype: concept.stereotype,
        status: concept.status,
        change,
        description: concept.description
      }
    ),
    conceptual && /* @__PURE__ */ jsx22(ElementLearning, { element: concept, model, parts: "issues" }),
    /* @__PURE__ */ jsx22(
      WhatChanges,
      {
        change: described,
        element: concept,
        model,
        profile
      }
    ),
    profile === "code" && /* @__PURE__ */ jsx22(
      CodeWhere,
      {
        element: concept,
        model,
        snippets,
        change
      }
    ),
    /* @__PURE__ */ jsx22(
      Why,
      {
        rationale: concept.rationale,
        questions: concept.questions,
        records,
        onReference
      }
    ),
    profile === "database" ? /* @__PURE__ */ jsx22(
      TableSchema,
      {
        element: concept,
        model,
        review: !!review,
        rollup: review?.rollup,
        focus: member
      }
    ) : /* @__PURE__ */ jsx22(
      Members,
      {
        element: concept,
        profile,
        review: !!review,
        focus: member
      }
    ),
    profile !== "code" && profile !== "database" && /* @__PURE__ */ jsx22(
      SourceEvidence,
      {
        evidence: concept.evidence,
        primary: concept.primarySource,
        sources: model.sources,
        snippets,
        label: "Sources"
      }
    ),
    conceptual && /* @__PURE__ */ jsx22(ElementLearning, { element: concept, model, parts: "lesson" })
  ] });
});
function RelationEnds({ heading, ends, onChoose }) {
  return /* @__PURE__ */ jsxs15(Stack4, { gap: 1, className: "relation-ends", children: [
    heading && /* @__PURE__ */ jsx22(Text7, { as: "h2", variant: "caption", className: "detail-section-title", children: heading }),
    /* @__PURE__ */ jsx22("ul", { className: "relation-end-list", children: ends.map(([node, count, role], i) => /* @__PURE__ */ jsxs15("li", { className: "relation-end", children: [
      role && /* @__PURE__ */ jsx22("span", { className: "relation-role", children: role }),
      /* @__PURE__ */ jsx22(Button7, { variant: "text", onClick: () => onChoose(node.id), children: node.name }),
      knownMultiplicity(count) && /* @__PURE__ */ jsx22(Badge3, { variant: "outline", className: "count-badge", children: count })
    ] }, `${node.id}-${i}`)) })
  ] });
}
var setConstraints = (set) => `{${set.complete ? "complete" : "incomplete"}, ${set.disjoint ? "disjoint" : "overlapping"}}`;
function relationTitle(relation) {
  if (relation.type === "generalization")
    return relation.realization ? "Implementation" : "Inheritance";
  return informativeName(relation) || `${relation.source.name} \u2192 ${relation.target.name}`;
}
function relationTag(relation) {
  if (relation.type === "generalization") return "Generalization";
  return relation.stereotype ? `\xAB${relation.stereotype}\xBB` : "Association";
}
function DeclaredBy({ relation, profile }) {
  const members = dependencyMembers(relation.source, relation.target);
  if (!members.length) return null;
  return /* @__PURE__ */ jsx22(Section, { title: "Declared by", children: /* @__PURE__ */ jsx22("ul", { className: "member-list", children: members.map(({ member, method }) => /* @__PURE__ */ jsxs15(
    "li",
    {
      className: "member",
      "data-change": member.changeStatus && member.changeStatus !== "unchanged" ? member.changeStatus : void 0,
      children: [
        /* @__PURE__ */ jsx22(ChangeMark, { status: member.changeStatus }),
        /* @__PURE__ */ jsx22("code", { className: "signature", children: memberSignature(member, method, profile) }),
        member.location && /* @__PURE__ */ jsx22("span", { className: "member-line", children: member.location.startLine })
      ]
    },
    member.id
  )) }) });
}
function ForeignKey({ relation }) {
  if (!Array.isArray(relation.columns)) return null;
  return /* @__PURE__ */ jsxs15(Section, { title: "Columns", children: [
    /* @__PURE__ */ jsxs15(Text7, { children: [
      /* @__PURE__ */ jsxs15("code", { children: [
        relation.source.name,
        "(",
        relation.columns.join(", "),
        ")"
      ] }),
      " ",
      "\u2192",
      " ",
      /* @__PURE__ */ jsxs15("code", { children: [
        relation.target.name,
        "(",
        (relation.targetColumns || []).join(", "),
        ")"
      ] })
    ] }),
    (relation.onDelete || relation.onUpdate) && /* @__PURE__ */ jsx22(Text7, { tone: "muted", children: [
      relation.onDelete && `On delete ${relation.onDelete.toLowerCase()}`,
      relation.onUpdate && `on update ${relation.onUpdate.toLowerCase()}`
    ].filter(Boolean).join(", ") })
  ] });
}
var RelationDetails = memo5(function RelationDetails2({
  relation,
  onChoose,
  model,
  snippets,
  review = null,
  onReference
}) {
  const profile = profileOf(model);
  const conceptual = profile === "ontouml";
  const generalization = relation.type === "generalization";
  const change = changeOf(review, relation);
  const entry = change ? rowFor(review.rollup, { kind: "edge", id: relation.id }, model) : null;
  const semanticId = relation.originalId || relation.id;
  return /* @__PURE__ */ jsxs15(Fragment8, { children: [
    /* @__PURE__ */ jsx22(
      DetailHeader,
      {
        title: relationTitle(relation),
        icon: generalization ? AccountTree : Polyline,
        tag: relationTag(relation),
        stereotype: relation.stereotype,
        change,
        description: relation.description
      }
    ),
    /* @__PURE__ */ jsx22(
      RelationEnds,
      {
        ends: generalization ? [
          [relation.source, null, "Subtype"],
          [
            relation.target,
            null,
            relation.realization ? "Implements" : "Supertype"
          ]
        ] : [
          [relation.source, relation.sourceMultiplicity, "From"],
          [relation.target, relation.targetMultiplicity, "To"]
        ],
        onChoose
      }
    ),
    entry && entry.notes.length > 0 && /* @__PURE__ */ jsx22(Section, { title: "What changes", children: /* @__PURE__ */ jsx22("ul", { className: "change-list", children: entry.notes.map((note, i) => /* @__PURE__ */ jsxs15(
      "li",
      {
        className: "change-line",
        "data-change": "modified",
        children: [
          /* @__PURE__ */ jsx22(ChangeMark, { status: "modified" }),
          /* @__PURE__ */ jsx22("span", { className: "change-line-text", children: /* @__PURE__ */ jsx22(
            ChangedProperty,
            {
              name: note.key,
              before: cellText(
                note.before,
                review.rollup.names,
                note.property
              ),
              after: cellText(
                note.after,
                review.rollup.names,
                note.property
              )
            }
          ) })
        ]
      },
      `${note.key}-${i}`
    )) }) }),
    profile === "code" && !generalization && /* @__PURE__ */ jsx22(DeclaredBy, { relation, profile }),
    profile === "database" && /* @__PURE__ */ jsx22(ForeignKey, { relation }),
    /* @__PURE__ */ jsx22(
      Why,
      {
        rationale: relation.rationale,
        questions: relation.questions,
        records: linkedRecords(model, [semanticId]),
        onReference
      }
    ),
    conceptual && /* @__PURE__ */ jsx22(
      ElementLearning,
      {
        element: relation,
        model,
        relation: true,
        parts: "all-but-why"
      }
    ),
    generalization && (model.partitions || []).filter((set) => set.generalizations.includes(semanticId)).map((set) => /* @__PURE__ */ jsxs15(Stack4, { gap: 1, className: "generalization-set-summary", children: [
      /* @__PURE__ */ jsx22(Text7, { as: "h2", variant: "section-heading", children: set.name }),
      /* @__PURE__ */ jsx22(Text7, { tone: "muted", children: setConstraints(set) })
    ] }, set.id)),
    conceptual && /* @__PURE__ */ jsx22(
      SourceEvidence,
      {
        evidence: relation.evidence?.length ? relation.evidence : [...relation.source.evidence, ...relation.target.evidence],
        sources: model.sources,
        snippets,
        label: relation.evidence?.length ? "Sources" : "Endpoint evidence"
      }
    )
  ] });
});
var GeneralizationSetDetails = memo5(function GeneralizationSetDetails2({
  group,
  onChoose,
  model,
  snippets,
  onReference
}) {
  const declared = group.type === "generalizationSet";
  return /* @__PURE__ */ jsxs15(Fragment8, { children: [
    /* @__PURE__ */ jsx22(
      DetailHeader,
      {
        title: group.name,
        tag: declared ? "Generalization set" : "Joined inheritance",
        icon: AccountTree,
        description: group.description
      }
    ),
    /* @__PURE__ */ jsx22(
      RelationEnds,
      {
        heading: "Supertype",
        ends: [[group.target]],
        onChoose
      }
    ),
    /* @__PURE__ */ jsx22(
      RelationEnds,
      {
        heading: "Subtypes",
        ends: group.sources.map((node) => [node]),
        onChoose
      }
    ),
    declared ? /* @__PURE__ */ jsxs15(Fragment8, { children: [
      /* @__PURE__ */ jsx22(Text7, { className: "set-constraints", children: setConstraints(group) }),
      /* @__PURE__ */ jsxs15(DisclosureNote4, { title: "Read these constraints", children: [
        /* @__PURE__ */ jsx22(Text7, { children: group.complete ? "Every instance of the supertype belongs to at least one subtype in this set." : "Instances of the supertype may belong to none of the subtypes in this set." }),
        /* @__PURE__ */ jsx22(Text7, { children: group.disjoint ? "An instance cannot belong to two subtypes in this set at the same time." : "An instance may belong to more than one subtype in this set at the same time." })
      ] }),
      group.memberIds.length < group.totalMembers && /* @__PURE__ */ jsxs15(Text7, { tone: "muted", children: [
        group.memberIds.length,
        " of ",
        group.totalMembers,
        " members are shown. These constraints apply to the full set."
      ] }),
      /* @__PURE__ */ jsx22(
        Why,
        {
          records: linkedRecords(model, [group.id]),
          onReference
        }
      ),
      /* @__PURE__ */ jsx22(ElementLearning, { element: group, model, relation: true })
    ] }) : /* @__PURE__ */ jsx22(DisclosureNote4, { title: "Read joined inheritance", children: /* @__PURE__ */ jsx22(Text7, { tone: "muted", children: "These inheritance branches share a supertype. Joining their lines does not assert completeness or disjointness. Declare a generalization set in the model to express those constraints." }) }),
    /* @__PURE__ */ jsx22(
      SourceEvidence,
      {
        evidence: group.evidence,
        primary: group.primarySource,
        sources: model.sources,
        snippets,
        label: "Sources"
      }
    )
  ] });
});
function About({ model, exports }) {
  return /* @__PURE__ */ jsxs15(Stack4, { gap: 4, className: "atlas-portal about-content", children: [
    /* @__PURE__ */ jsx22(Text7, { tone: "muted", children: model.status }),
    /* @__PURE__ */ jsx22("dl", { className: "shortcut-list", children: [
      ["Scroll or pinch", "Zoom"],
      ["Drag", "Pan"],
      [
        /* @__PURE__ */ jsxs15(Fragment8, { children: [
          /* @__PURE__ */ jsx22(Kbd3, { children: "+" }),
          " ",
          /* @__PURE__ */ jsx22(Kbd3, { children: "\u2212" })
        ] }),
        "Zoom in or out"
      ],
      [/* @__PURE__ */ jsx22(Kbd3, { children: "0" }), "Fit the diagram"],
      [/* @__PURE__ */ jsx22(Kbd3, { children: "/" }), "Find a concept"],
      [/* @__PURE__ */ jsx22(Kbd3, { children: "Esc" }), "Clear the selection"]
    ].map(([keys, action], i) => /* @__PURE__ */ jsxs15("div", { className: "shortcut", children: [
      /* @__PURE__ */ jsx22("dt", { children: keys }),
      /* @__PURE__ */ jsx22("dd", { children: action })
    ] }, i)) }),
    /* @__PURE__ */ jsxs15(Stack4, { gap: 1, align: "start", children: [
      /* @__PURE__ */ jsx22(
        DownloadLink,
        {
          data: exports.readText(`${exports.slug}-model-notes.txt`),
          filename: `${exports.slug}-model-notes.txt`,
          children: "Source notes"
        }
      ),
      /* @__PURE__ */ jsx22(
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

// src/viewer/useInspection.js
import {
  useCallback as useCallback2,
  useEffect as useEffect7,
  useLayoutEffect as useLayoutEffect6,
  useMemo as useMemo6,
  useState as useState8
} from "react";
import { flushSync } from "react-dom";

// src/viewer/inspection.js
function createInspectionController({
  onHover,
  onPreview,
  schedule = setTimeout,
  cancel = clearTimeout
}) {
  let hovered = null;
  let preview = null;
  let timer = null;
  let enabled = true;
  let visible = false;
  const cancelPreview = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const setHover = (target) => {
    if (sameTarget(hovered, target)) return;
    hovered = target;
    onHover(target);
  };
  const setPreview = (target) => {
    if (sameTarget(preview, target)) return;
    preview = target;
    onPreview(target);
  };
  const controller = {
    configure({ previewEnabled, previewVisible }) {
      enabled = previewEnabled;
      visible = previewVisible;
      if (!enabled) {
        cancelPreview();
        setPreview(null);
      } else if (visible && hovered) {
        cancelPreview();
        setPreview(hovered);
      }
    },
    hover(target) {
      cancelPreview();
      setHover(target);
      if (!enabled) return;
      if (target) {
        if (visible || preview) setPreview(target);
        else
          timer = schedule(() => {
            timer = null;
            if (sameTarget(hovered, target)) setPreview(target);
          }, 100);
      } else if (preview) {
        timer = schedule(() => {
          timer = null;
          setPreview(null);
        }, 160);
      }
    },
    keepHover() {
      cancelPreview();
      if (preview) setHover(preview);
    },
    clearHover() {
      cancelPreview();
      setHover(null);
      setPreview(null);
    },
    dispose: cancelPreview
  };
  return controller;
}

// src/viewer/useInspection.js
var inspectedTarget = (hovered, selected) => hovered || selected;
function useInspection({
  previewEnabled = true,
  previewVisible = false
} = {}) {
  const [hovered, setHovered] = useState8(null);
  const [preview, setPreview] = useState8(null);
  const controller = useMemo6(
    () => createInspectionController({
      onHover: (target) => setHovered((old) => sameTarget(old, target) ? old : target),
      // An open inspector follows the same input commit as its highlight.
      // Memoized details/code avoid rebuilding unchanged source content.
      onPreview: (target) => setPreview((old) => sameTarget(old, target) ? old : target)
    }),
    [createInspectionController]
  );
  useLayoutEffect6(() => {
    controller.configure({ previewEnabled, previewVisible });
  }, [controller, previewEnabled, previewVisible]);
  useEffect7(() => () => controller.dispose(), [controller]);
  const hover = useCallback2(
    (target) => {
      flushSync(() => controller.hover(target));
    },
    [controller]
  );
  return {
    hovered,
    preview,
    hover,
    keepHover: controller.keepHover,
    clearHover: controller.clearHover
  };
}

// src/viewer/InspectorContent.jsx
import { jsx as jsx23 } from "react/jsx-runtime";
function InspectorContent({
  learning,
  element,
  inspected,
  member = null,
  model,
  views,
  snippets,
  guide,
  conceptual,
  changes,
  showOverview,
  learningTab,
  onLearningTab,
  onChoose,
  onInspectLearning = onChoose,
  onView,
  onReference
}) {
  if (learning)
    return /* @__PURE__ */ jsx23(
      LearningLibrary,
      {
        model,
        learning: guide,
        views,
        conceptual,
        onInspect: onInspectLearning,
        onView,
        tab: learningTab,
        onTabChange: onLearningTab
      }
    );
  const review = changes?.details ?? null;
  if (element && inspected.kind === "node")
    return /* @__PURE__ */ jsx23(
      ConceptDetails,
      {
        concept: element,
        model,
        snippets,
        review,
        member,
        onReference
      }
    );
  if (element && inspected.kind === "edge")
    return /* @__PURE__ */ jsx23(
      RelationDetails,
      {
        relation: element,
        model,
        snippets,
        review,
        onChoose,
        onReference
      }
    );
  if (element && inspected.kind === "group")
    return /* @__PURE__ */ jsx23(
      GeneralizationSetDetails,
      {
        group: element,
        model,
        snippets,
        onChoose,
        onReference
      }
    );
  if (showOverview) return changes.content;
  return null;
}

// src/viewer/useArtifactArchive.js
import { useMemo as useMemo7 } from "react";
import { unzipSync, strFromU8 } from "fflate";
function useArtifactArchive(exportData) {
  return useMemo7(() => {
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

// src/ui/zoomStore.js
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

// src/viewer/ProvenanceBadge.jsx
import { Badge as Badge4, Surface as Surface4, Text as Text8 } from "@envsemble/envui";

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
  return snapshots.find((s) => s.id === document2.baselineId) || (document2.state === "snapshot" ? snapshots[0] : void 0);
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
      tone: "accent"
    };
  } else if (document2.state === "proposal") {
    const date = formatCaptureDate(
      baselineSnapshot(document2)?.capture?.capturedAt
    );
    result = {
      kind: "proposal",
      label: "Agent proposal",
      detail: date ? `Changes to source captured ${date}` : "",
      tone: "done"
    };
  } else if (document2.state === "authored") {
    result = {
      kind: "authored",
      label: "Agent-authored",
      detail: document2.profile === "ontouml" ? "Conceptual model" : "Structural model",
      tone: "success"
    };
  } else return { kind: "unknown", label: "", detail: "", tone: "neutral" };
  if (document2.imported)
    result.detail = result.detail ? `${result.detail} \xB7 Imported` : "Imported";
  return result;
}

// src/viewer/ProvenanceBadge.jsx
import { jsx as jsx24, jsxs as jsxs16 } from "react/jsx-runtime";
function ProvenanceIcon({ provenance, profile }) {
  if (provenance.kind === "proposal") return /* @__PURE__ */ jsx24(Difference, {});
  if (provenance.kind === "authored") return /* @__PURE__ */ jsx24(EditNote, {});
  if (profile === "database") return /* @__PURE__ */ jsx24(Database, {});
  if (profile === "code") return /* @__PURE__ */ jsx24(Code, {});
  return /* @__PURE__ */ jsx24(Description, {});
}
function ProvenanceLabel({ document: document2 }) {
  const provenance = describeProvenance(document2);
  if (provenance.kind === "unknown") return null;
  return /* @__PURE__ */ jsx24(
    Badge4,
    {
      tone: provenance.tone,
      icon: /* @__PURE__ */ jsx24(ProvenanceIcon, { provenance, profile: document2?.profile }),
      children: provenance.label
    }
  );
}
function ProvenanceBadge({ document: document2, className = "" }) {
  const provenance = describeProvenance(document2);
  if (provenance.kind === "unknown") return null;
  return /* @__PURE__ */ jsxs16(
    Surface4,
    {
      tone: "pane",
      corners: "pill",
      padding: 1,
      density: "compact",
      className: `atlas-provenance${className ? ` ${className}` : ""}`,
      title: provenance.detail ? `${provenance.label} \xB7 ${provenance.detail}` : provenance.label,
      children: [
        /* @__PURE__ */ jsx24(ProvenanceLabel, { document: document2 }),
        provenance.detail && /* @__PURE__ */ jsx24(Text8, { as: "span", variant: "supporting", className: "provenance-detail", children: provenance.detail })
      ]
    }
  );
}

// src/viewer/ComparisonViewer.jsx
import { useMemo as useMemo8 } from "react";
function ComparisonViewer({ payload, focus = payload.focus, render }) {
  const comparison = payload.comparison;
  const document2 = payload.model.document;
  const capturedAt = document2?.snapshots?.find(
    (s) => s.id === document2.baselineId
  )?.capture?.capturedAt;
  const review = useMemo8(
    () => ({ comparison, baselineDate: formatCaptureDate(capturedAt) }),
    [comparison, capturedAt]
  );
  const shown2 = useMemo8(
    () => ({
      ...payload,
      ...comparison.changeView || {},
      comparison: void 0
    }),
    [payload, comparison]
  );
  return render(shown2, focus, { review, provenanceDocument: document2 });
}

// src/viewer/useOverlayInsets.js
import { useCallback as useCallback3, useLayoutEffect as useLayoutEffect7 } from "react";
var GAP = 8;
function useOverlayInsets(viewerRef, topRef) {
  useLayoutEffect7(() => {
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
  return useCallback3(
    (canvas) => {
      const viewer = viewerRef.current || canvas?.parentElement;
      if (!viewer) return null;
      const box = viewer.getBoundingClientRect();
      const edge = (selector) => viewer.querySelector(selector)?.getBoundingClientRect();
      const top = edge(":scope > .atlas-overlay-top");
      const badge = edge(":scope > .atlas-provenance");
      const inspector = edge(":scope > .inspector.open");
      return {
        top: top ? Math.max(0, top.bottom - box.top) : 0,
        bottom: badge ? Math.max(0, box.bottom - badge.top) : 0,
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
import { useLayoutEffect as useLayoutEffect8, useRef as useRef7, useState as useState9 } from "react";
var MAX_LEVEL = 3;
var HYSTERESIS = 24;
function useToolbarDensity(topRef, resetKey) {
  const [level, setLevel] = useState9(0);
  const limits = useRef7([]);
  useLayoutEffect8(() => {
    limits.current = [];
    setLevel(0);
  }, [resetKey]);
  useLayoutEffect8(() => {
    const top = topRef.current;
    if (!top || typeof ResizeObserver !== "function") return;
    const check = () => {
      const width = top.clientWidth;
      const islands = [...top.children].filter(
        (child) => child.classList.contains("atlas-island")
      );
      if (!width || !islands.length) return;
      const row = Math.min(...islands.map((island) => island.offsetTop));
      const wrapped = (island) => {
        const controls = Math.max(
          0,
          ...[...island.children].map((child) => child.offsetHeight)
        );
        return island.offsetHeight > controls * 1.5 + 12;
      };
      const crowded = islands.some(
        (island) => island.offsetTop > row + 4 || wrapped(island)
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
  }, [topRef, level, resetKey]);
  return level;
}

// src/review/useChangeReview.jsx
import { useCallback as useCallback4, useMemo as useMemo9, useRef as useRef9, useState as useState11 } from "react";
import { Button as Button9, Counter as Counter4, Tooltip as Tooltip4 } from "@envsemble/envui";

// src/review/ChangesOverview.jsx
import { useEffect as useEffect8, useLayoutEffect as useLayoutEffect9, useRef as useRef8, useState as useState10 } from "react";
import { Button as Button8, Counter as Counter3, DisclosureNote as DisclosureNote5, Stack as Stack5, Text as Text9 } from "@envsemble/envui";
import { Fragment as Fragment9, jsx as jsx25, jsxs as jsxs17 } from "react/jsx-runtime";
function Summary({ row }) {
  const { summary } = row;
  const note = summary.note && /* @__PURE__ */ jsx25("span", { className: "change-row-note", children: summary.note });
  if (summary.tokens.length)
    return /* @__PURE__ */ jsxs17(Fragment9, { children: [
      /* @__PURE__ */ jsxs17("span", { className: "change-row-summary", children: [
        summary.tokens.map((token, i) => /* @__PURE__ */ jsxs17("span", { className: "change-token", "data-change": token.status, children: [
          /* @__PURE__ */ jsx25("span", { className: "change-token-glyph", "aria-hidden": "true", children: changeGlyph(token.status) }),
          /* @__PURE__ */ jsxs17("span", { className: "visually-hidden", children: [
            CHANGE_LABELS[token.status],
            " "
          ] }),
          token.text
        ] }, i)),
        summary.more > 0 && /* @__PURE__ */ jsxs17("span", { className: "change-token more", children: [
          "+",
          summary.more,
          " more"
        ] })
      ] }),
      note
    ] });
  if (!summary.text && !summary.more) return note || null;
  return /* @__PURE__ */ jsxs17(Fragment9, { children: [
    /* @__PURE__ */ jsxs17("span", { className: "change-row-summary", children: [
      summary.text,
      summary.more > 0 && /* @__PURE__ */ jsxs17("span", { className: "change-token more", children: [
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
  const content = /* @__PURE__ */ jsxs17(Fragment9, { children: [
    /* @__PURE__ */ jsx25(ChangeMark, { status: row.status }),
    /* @__PURE__ */ jsxs17("span", { className: "change-row-text", children: [
      /* @__PURE__ */ jsxs17("span", { className: "change-row-title", children: [
        /* @__PURE__ */ jsx25("span", { className: "change-row-name", children: row.name }),
        row.tag && /* @__PURE__ */ jsx25("span", { className: "change-row-tag", children: row.tag })
      ] }),
      /* @__PURE__ */ jsx25(Summary, { row })
    ] })
  ] });
  if (!row.target)
    return /* @__PURE__ */ jsx25("li", { className: "change-row static", "data-change": row.status, children: content });
  return /* @__PURE__ */ jsx25("li", { children: /* @__PURE__ */ jsx25(
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
  return /* @__PURE__ */ jsx25("ul", { className: "change-rows", "aria-label": label, children: rows.map((row) => /* @__PURE__ */ jsx25(
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
function RelationRows({ group, active, returning, onSelect, onHover }) {
  const rows = group.relations;
  const [open, setOpen] = useState10(
    () => rows.some((r) => r.key === active || r.key === returning)
  );
  const list = /* @__PURE__ */ jsx25(
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
    return /* @__PURE__ */ jsxs17(Fragment9, { children: [
      /* @__PURE__ */ jsx25(Text9, { as: "h4", variant: "caption", className: "change-subheading", children: "Relations" }),
      list
    ] });
  return /* @__PURE__ */ jsx25(
    DisclosureNote5,
    {
      className: "change-relations",
      title: `Relations \xB7 ${rows.length}`,
      open,
      onToggle: (event) => setOpen(event.currentTarget.open),
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
function ChangesOverview({
  rollup,
  baselineDate,
  profile,
  active,
  handoff,
  onSelect,
  onHover
}) {
  const list = useRef8(null);
  useEffect8(() => {
    const request = handoff?.current;
    if (request?.to !== "overview") return;
    handoff.current = null;
    const rows = [
      ...list.current?.querySelectorAll("button.change-row") || []
    ];
    (rows.find((row) => row.dataset.key === request.key) || rows[0])?.focus();
  }, [handoff]);
  const source = profile === "code" ? "the code" : profile === "database" ? "the database" : "the model";
  return /* @__PURE__ */ jsxs17(Stack5, { gap: 4, className: "changes-overview", children: [
    /* @__PURE__ */ jsx25(Text9, { variant: "supporting", children: rollup.total ? `Compared with ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.` : `No changes to ${source}${baselineDate ? ` captured ${baselineDate}` : ""}.` }),
    rollup.conflicts.length > 0 && /* @__PURE__ */ jsxs17("section", { className: "change-group", "data-change": "conflict", children: [
      /* @__PURE__ */ jsxs17(
        Text9,
        {
          as: "h3",
          variant: "section-heading",
          className: "change-group-heading",
          children: [
            "Conflicts",
            /* @__PURE__ */ jsx25(Counter3, { value: rollup.conflicts.length })
          ]
        }
      ),
      rollup.conflicts.map((conflict) => /* @__PURE__ */ jsx25(
        DisclosureNote5,
        {
          title: conflict.path.join(" / ") || "References",
          children: /* @__PURE__ */ jsx25(Text9, { tone: "muted", children: conflict.reason })
        },
        conflict.id
      ))
    ] }),
    /* @__PURE__ */ jsx25("div", { ref: list, className: "change-groups", onKeyDown: moveFocus, children: rollup.groups.map((group) => /* @__PURE__ */ jsxs17(
      "section",
      {
        className: "change-group",
        "data-change": group.status,
        "aria-label": `${group.label}, ${group.elements.length + group.relations.length}`,
        children: [
          /* @__PURE__ */ jsxs17(
            Text9,
            {
              as: "h3",
              variant: "section-heading",
              className: "change-group-heading",
              children: [
                /* @__PURE__ */ jsx25(ChangeMark, { status: group.status }),
                group.label,
                /* @__PURE__ */ jsx25(Counter3, { value: group.elements.length + group.relations.length })
              ]
            }
          ),
          group.elements.length > 0 && /* @__PURE__ */ jsx25(
            RowList,
            {
              rows: group.elements,
              label: `${group.label} elements`,
              active,
              onSelect,
              onHover
            }
          ),
          group.relations.length > 0 && /* @__PURE__ */ jsx25(
            RelationRows,
            {
              group,
              active,
              returning: handoff?.current?.key,
              onSelect,
              onHover
            }
          )
        ]
      },
      group.status
    )) })
  ] });
}
function ChangeNavigation({
  position,
  total,
  name,
  handoff,
  onBack,
  onStep
}) {
  const back = useRef8(null);
  useLayoutEffect9(() => {
    if (handoff?.current?.to !== "details") return;
    handoff.current = null;
    back.current?.focus();
  }, [handoff]);
  return /* @__PURE__ */ jsxs17("div", { className: "change-navigation", children: [
    /* @__PURE__ */ jsx25(
      Button8,
      {
        ref: back,
        variant: "text",
        className: "change-back",
        "aria-label": "All changes",
        startIcon: /* @__PURE__ */ jsx25(ArrowBack, {}),
        onClick: onBack,
        children: /* @__PURE__ */ jsx25("span", { className: "change-back-label", children: "All changes" })
      }
    ),
    total > 0 && /* @__PURE__ */ jsxs17("span", { className: "change-stepper", role: "group", "aria-label": "Changes", children: [
      /* @__PURE__ */ jsx25(
        ToolButton,
        {
          label: "Previous change",
          icon: /* @__PURE__ */ jsx25(ChevronLeft, {}),
          "aria-disabled": position === 0 || void 0,
          onClick: () => onStep(-1)
        }
      ),
      /* @__PURE__ */ jsxs17(
        "span",
        {
          className: "change-position",
          "aria-live": "polite",
          "aria-atomic": "true",
          children: [
            position >= 0 ? `${position + 1} of ${total}` : `${total} ${total === 1 ? "change" : "changes"}`,
            position >= 0 && name && /* @__PURE__ */ jsxs17("span", { className: "visually-hidden", children: [
              ": ",
              name
            ] })
          ]
        }
      ),
      /* @__PURE__ */ jsx25(
        ToolButton,
        {
          label: "Next change",
          icon: /* @__PURE__ */ jsx25(ChevronRight, {}),
          "aria-disabled": position === total - 1 || void 0,
          onClick: () => onStep(1)
        }
      )
    ] })
  ] });
}

// src/review/useChangeReview.jsx
import { Fragment as Fragment10, jsx as jsx26, jsxs as jsxs18 } from "react/jsx-runtime";
var ROOMY_WIDTH = 1280;
var overviewByDefault = (review) => !!review && typeof window !== "undefined" && window.innerWidth >= ROOMY_WIDTH;
function useChangeReview({
  review,
  model,
  views,
  selected,
  overview,
  setOverview,
  choose,
  select,
  hover,
  onShowPanel
}) {
  const rollup = useMemo9(
    () => review ? rollupChanges(review.comparison, model, views) : null,
    [review, model, views]
  );
  const details = useMemo9(() => rollup ? { rollup } : null, [rollup]);
  const [fade, setFade] = useState11(true);
  const handoff = useRef9(null);
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
  const back = useCallback4(() => {
    setOverview(true);
    onShowPanel?.();
    select(null);
  }, [select, onShowPanel, setOverview]);
  const openRow = useCallback4(
    (row) => {
      handoff.current = { to: "details" };
      open(row);
    },
    [open]
  );
  const backToOverview = useCallback4(() => {
    handoff.current = { to: "overview", key: current?.key };
    back();
  }, [back, current]);
  if (!rollup) return null;
  return {
    rollup,
    details,
    /** Leaving a change's details by keyboard returns focus to it in the overview. */
    returnFocus: () => {
      if (overview) handoff.current = { to: "overview", key: current?.key };
    },
    fade,
    position,
    total,
    /** Toolbar controls: the changes overview toggle and fading. */
    controls: (showing) => /* @__PURE__ */ jsxs18(Fragment10, { children: [
      /* @__PURE__ */ jsx26(
        Tooltip4,
        {
          content: showing ? "Hide the changes" : "Show every change",
          side: "bottom",
          children: /* @__PURE__ */ jsxs18(
            Button9,
            {
              variant: showing ? "primary" : "secondary",
              className: "changes-toggle",
              "aria-pressed": showing,
              "aria-label": `Changes, ${rollup.count}`,
              startIcon: /* @__PURE__ */ jsx26(Difference, {}),
              onClick: () => {
                if (showing) setOverview(false);
                else back();
              },
              children: [
                /* @__PURE__ */ jsx26("span", { className: "collapsible-label", children: "Changes" }),
                /* @__PURE__ */ jsx26(
                  Counter4,
                  {
                    value: rollup.count,
                    tone: showing ? "accent" : "neutral"
                  }
                )
              ]
            }
          )
        }
      ),
      /* @__PURE__ */ jsx26(
        ToolButton,
        {
          label: "Fade unchanged elements",
          pressed: fade,
          icon: /* @__PURE__ */ jsx26(Contrast, {}),
          onClick: () => setFade((value) => !value)
        }
      )
    ] }),
    /** Above a selected element's details: back to every change, previous and next. */
    navigation: /* @__PURE__ */ jsx26(
      ChangeNavigation,
      {
        position,
        total,
        name: current?.label && current.label !== current.name ? `${current.name}, ${current.label}` : current?.name,
        handoff,
        onBack: backToOverview,
        onStep: step
      }
    ),
    /** The overview list for the inspector. */
    content: /* @__PURE__ */ jsx26(
      ChangesOverview,
      {
        rollup,
        baselineDate: review.baselineDate,
        profile: model.document?.profile,
        active: current?.key,
        handoff,
        onSelect: openRow,
        onHover: hover
      }
    )
  };
}

// src/viewer/OntoUMLViewer.jsx
import { jsx as jsx27, jsxs as jsxs19 } from "react/jsx-runtime";
function OntoUMLViewer(props) {
  if (props.comparison)
    return /* @__PURE__ */ jsx27(
      ComparisonViewer,
      {
        payload: props,
        focus: props.focus,
        render: (payload, focus, extras) => /* @__PURE__ */ jsx27(
          OntoUMLViewer,
          {
            ...payload,
            ...extras,
            focus: focus || props.focus
          }
        )
      }
    );
  if (!props.views.length)
    return /* @__PURE__ */ jsxs19("main", { className: "viewer-error", children: [
      /* @__PURE__ */ jsx27(
        ProvenanceBadge,
        {
          document: props.provenanceDocument || props.model.document,
          className: "inline"
        }
      ),
      /* @__PURE__ */ jsx27(
        EmptyState,
        {
          headingLevel: 1,
          title: props.model.title,
          description: "No entities in this model."
        }
      )
    ] });
  return /* @__PURE__ */ jsx27(ViewerContent, { ...props });
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
  snippets = {},
  learning: guide = null,
  focus = null,
  review = null,
  provenanceDocument
}) {
  const exports = useArtifactArchive(exportData);
  const [viewKey, setViewKey] = useState12(views[0].key), [fields, setFields] = useState12(false);
  const preference = useOptionalThemePreference();
  const ambientTheme = useTheme();
  const theme = preference?.theme || ambientTheme;
  const [selected, setSelected] = useState12(null);
  const [aboutOpen, setAboutOpen] = useState12(false);
  const [learningOpen, setLearningOpen] = useState12(false), [learningTab, setLearningTab] = useState12(null);
  const [sidebarHidden, setSidebarHidden] = useState12(false);
  const [overview, setOverview] = useState12(() => overviewByDefault(review));
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled: !sidebarHidden && !(review && overview && !selected && !learningOpen),
    previewVisible: !!selected || learningOpen
  });
  const [focusRequest, setFocusRequest] = useState12(null);
  const [member, setMember] = useState12(null);
  const zoomStore = useMemo10(createZoomStore, []);
  const cameraRef = useRef10(null);
  const viewerRef = useRef10(null), toolbarRef = useRef10(null);
  const fitInsets = useOverlayInsets(viewerRef, toolbarRef);
  const density = useToolbarDensity(
    toolbarRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`
  );
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index2 = useMemo10(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups]
  );
  const select = useCallback5(
    (target) => {
      clearHover();
      setSelected((old) => sameTarget(old, target) ? old : target);
      setAboutOpen(false);
      setLearningOpen(false);
    },
    [clearHover]
  );
  const clear = useCallback5(() => {
    setSelected(null);
    setAboutOpen(false);
    setLearningOpen(false);
    clearHover();
  }, [clearHover]);
  const choose = useCallback5(
    (id) => {
      const next = inspectionTarget(model, index2, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      setMember(next.memberId || null);
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
    overview,
    setOverview,
    choose,
    select,
    hover,
    onShowPanel: () => {
      setSidebarHidden(false);
      setLearningOpen(false);
    }
  });
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(
      `${exports.slug}-${view.key}${fields ? "-fields" : ""}.svg`
    ),
    theme,
    viewerRef,
    !!changes?.fade
  );
  const inspected = inspectedTarget(preview, selected);
  const element = index2.getElement(inspected);
  const showOverview = !!changes && overview && !element && !learningOpen;
  const sidebarOpen = !sidebarHidden && (!!element || learningOpen || showOverview);
  useEffect9(() => {
    setSelected(null);
    setFocusRequest(null);
    setViewKey(views[0].key);
    clearHover();
  }, [model.id, clearHover]);
  const onHover = useCallback5(
    (target) => {
      if (target) setLearningOpen(false);
      hover(target);
    },
    [hover]
  );
  const latestChanges = useRef10(null);
  latestChanges.current = changes;
  useEffect9(() => {
    const escape = (e) => {
      if (e.key !== "Escape") return;
      if (e.target.closest?.(".inspector"))
        latestChanges.current?.returnFocus();
      clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
  const lastExternalFocus = useRef10(null);
  useEffect9(() => {
    if (focus && focus !== lastExternalFocus.current) {
      lastExternalFocus.current = focus;
      if (focus.kind === "view" && views.some((v) => v.key === focus.id))
        setViewKey(focus.id);
      else choose(focus.id);
    }
  }, [focus, choose, views]);
  useEffect9(() => {
    if (selected && !index2.getElement(selected)) select(null);
  }, [index2, selected, select]);
  const inspector = useRef10(null);
  const showing = learningOpen ? "learning" : selected ? `${selected.kind}:${selected.id}` : showOverview ? "overview" : "";
  useLayoutEffect10(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [showing]);
  useLayoutEffect10(() => {
    if (sidebarOpen && selected?.kind === "node")
      cameraRef.current?.revealNode(selected.id);
  }, [sidebarOpen]);
  const conceptual = !model.document || model.document.profile === "ontouml";
  const inspectLearning = (id) => {
    if (index2.nodes.has(id)) return choose(id);
    const groupView = views.find(
      (v) => v.diagram.generalizationGroups?.some((g) => g.id === id)
    );
    if (groupView) {
      setViewKey(groupView.key);
      select({ kind: "group", id });
      return;
    }
    choose(id);
  };
  return /* @__PURE__ */ jsxs19(
    "div",
    {
      ref: viewerRef,
      className: `viewer${sidebarOpen ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}`,
      children: [
        /* @__PURE__ */ jsx27(
          ViewerToolbar,
          {
            ref: toolbarRef,
            density,
            reviewControls: changes?.controls(sidebarOpen && showOverview),
            guided: conceptual || !!guide,
            ...{
              model,
              views,
              exports,
              viewKey,
              fields,
              theme,
              zoomStore,
              diagramURL
            },
            sidebarHidden,
            sidebarOpen,
            learningOpen,
            aboutOpen,
            onSidebar: () => setSidebarHidden((hidden) => !hidden),
            onView: (key) => {
              if (key === viewKey) return;
              const next = views.find((v) => v.key === key).diagram;
              const elements = selected?.kind === "edge" ? next.edges : selected?.kind === "group" ? next.generalizationGroups || [] : next.nodes;
              if (!elements.some((item) => item.id === selected?.id)) clear();
              setFocusRequest(null);
              setViewKey(key);
            },
            onFields: () => {
              setFocusRequest(null);
              setFields(!fields);
            },
            themeToggle: !!preference,
            onLearn: () => {
              clearHover();
              setSidebarHidden(false);
              setLearningOpen(sidebarHidden || !learningOpen);
            },
            onChoose: choose,
            onAbout: () => {
              setAboutOpen(true);
            },
            onZoom: (factor) => cameraRef.current.zoomBy(factor),
            onReset: () => cameraRef.current.reset(),
            onFit: () => cameraRef.current.fit()
          }
        ),
        /* @__PURE__ */ jsx27(
          DiagramCanvas,
          {
            ref: cameraRef,
            ...{ diagram, selected, hovered, focusRequest, backgroundURL },
            fitInsets,
            onSelect: select,
            onZoom: zoomStore.set,
            onHover,
            onClearHover: clearHover
          }
        ),
        /* @__PURE__ */ jsx27(ProvenanceBadge, { document: provenanceDocument || model.document }),
        /* @__PURE__ */ jsx27(
          Panel,
          {
            ref: inspector,
            id: "inspector",
            className: "inspector",
            open: sidebarOpen,
            label: learningOpen ? "Model guide" : showOverview ? "Changes in this proposal" : "Model details",
            title: learningOpen ? "Understand the model" : showOverview ? "Changes" : null,
            toolbar: !learningOpen && element && changes ? changes.navigation : null,
            closeLabel: "Hide details",
            onClose: () => setSidebarHidden(true),
            onPointerEnter: keepHover,
            onPointerLeave: () => hover(null),
            onFocusCapture: keepHover,
            onBlurCapture: (e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
            },
            children: sidebarOpen && /* @__PURE__ */ jsx27(
              InspectorContent,
              {
                learning: learningOpen,
                element,
                inspected,
                member: sameTarget(inspected, selected) ? member : null,
                model,
                views,
                snippets,
                guide,
                conceptual,
                changes,
                showOverview,
                learningTab,
                onLearningTab: setLearningTab,
                onChoose: choose,
                onInspectLearning: inspectLearning,
                onView: (key) => {
                  setViewKey(key);
                  setFocusRequest(null);
                }
              }
            )
          }
        ),
        /* @__PURE__ */ jsx27(
          Dialog,
          {
            open: aboutOpen,
            onOpenChange: setAboutOpen,
            title: model.title,
            description: "About this diagram and its controls",
            children: /* @__PURE__ */ jsx27(About, { model, exports })
          }
        )
      ]
    }
  );
}

// src/viewer/AtlasPanel.jsx
import {
  useCallback as useCallback6,
  useEffect as useEffect10,
  useId as useId3,
  useLayoutEffect as useLayoutEffect11,
  useMemo as useMemo11,
  useRef as useRef11,
  useState as useState13
} from "react";
import { EmptyState as EmptyState2, Theme } from "@envsemble/envui";
import { jsx as jsx28, jsxs as jsxs20 } from "react/jsx-runtime";
function AtlasPanel(props) {
  if (props.payload.comparison)
    return /* @__PURE__ */ jsx28(
      ComparisonViewer,
      {
        payload: props.payload,
        focus: props.focus,
        render: (payload, focus, extras) => /* @__PURE__ */ jsx28(
          AtlasPanel,
          {
            ...props,
            ...extras,
            payload,
            focus: focus || props.focus
          }
        )
      }
    );
  if (!props.payload.views.length) {
    const theme = props.theme || "dark";
    return /* @__PURE__ */ jsx28(
      Theme,
      {
        theme,
        className: "atlas-panel atlas-empty",
        "data-theme": theme,
        children: /* @__PURE__ */ jsxs20("div", { className: "viewer", children: [
          props.leading && /* @__PURE__ */ jsx28("div", { className: "atlas-overlay-top", children: /* @__PURE__ */ jsx28(Island, { label: "Diagram navigation", className: "island-start", children: /* @__PURE__ */ jsx28("div", { className: "island-leading", children: props.leading }) }) }),
          /* @__PURE__ */ jsx28(
            EmptyState2,
            {
              className: "atlas-empty-message",
              title: props.payload.model.title,
              description: "No entities in this model."
            }
          ),
          /* @__PURE__ */ jsx28(
            ProvenanceBadge,
            {
              document: props.provenanceDocument || props.payload.model.document
            }
          )
        ] })
      }
    );
  }
  return /* @__PURE__ */ jsx28(AtlasPanelContent, { ...props });
}
function AtlasPanelContent({
  payload,
  theme = "dark",
  onReference,
  focus = null,
  leading,
  fullscreen = false,
  onFullscreenChange,
  review = null,
  provenanceDocument
}) {
  const { model, views, snippets, learning: guide = null } = payload;
  const [viewKey, setViewKey] = useState13(views[0].key);
  const [fields, setFields] = useState13(false), [selected, setSelected] = useState13(null);
  const [hidden, setHidden] = useState13(false), [learning, setLearning] = useState13(false), [learningTab, setLearningTab] = useState13(null);
  const [focusRequest, setFocusRequest] = useState13(null);
  const [member, setMember] = useState13(null);
  const camera = useRef11(null), zoomStore = useMemo11(createZoomStore, []);
  const viewerRef = useRef11(null), topRef = useRef11(null);
  const fitInsets = useOverlayInsets(viewerRef, topRef);
  const density = useToolbarDensity(
    topRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`
  );
  const lastFocus = useRef11(null), inspectorId = useId3();
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index2 = useMemo11(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups]
  );
  const [overview, setOverview] = useState13(() => overviewByDefault(review));
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled: !hidden && !(review && overview && !selected && !learning),
    previewVisible: !!selected || learning
  });
  const select = useCallback6(
    (target) => {
      clearHover();
      setSelected((old) => sameTarget(old, target) ? old : target);
      setLearning(false);
    },
    [clearHover]
  );
  const choose = useCallback6(
    (id) => {
      const next = inspectionTarget(model, index2, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      setMember(next.memberId || null);
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
    overview,
    setOverview,
    choose,
    select,
    hover,
    onShowPanel: () => {
      setHidden(false);
      setLearning(false);
    }
  });
  const inspected = inspectedTarget(preview, selected), element = index2.getElement(inspected);
  const showOverview = !!changes && overview && !element && !learning;
  const open = !hidden && (!!element || learning || showOverview);
  useEffect10(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [model.id, select]);
  useEffect10(() => {
    const visible = selected?.kind === "node" ? diagram.nodes : selected?.kind === "edge" ? diagram.edges : diagram.generalizationGroups || [];
    if (selected && (!index2.getElement(selected) || !visible.some((item) => item.id === selected.id) && !(selected.kind === "edge" && diagram.generalizationGroups?.some(
      (g) => g.memberIds.includes(selected.id)
    ))))
      select(null);
  }, [index2, diagram, selected, select]);
  useEffect10(() => {
    if (sameTarget(lastFocus.current, focus)) return;
    lastFocus.current = focus;
    if (!focus) return;
    if (focus.kind === "view" && views.some((v) => v.key === focus.id))
      setViewKey(focus.id);
    else choose(focus.id);
  }, [focus, choose, views]);
  const inspector = useRef11(null);
  const showing = learning ? "learning" : selected ? `${selected.kind}:${selected.id}` : showOverview ? "overview" : "";
  useLayoutEffect11(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [showing]);
  useLayoutEffect11(() => {
    if (open && selected?.kind === "node")
      camera.current?.revealNode(selected.id);
  }, [open]);
  const latestChanges = useRef11(null);
  latestChanges.current = changes;
  useEffect10(() => {
    const escape = (e) => {
      if (e.key !== "Escape" || !e.target.closest?.(".atlas-panel")) return;
      if (e.target.closest(".inspector")) latestChanges.current?.returnFocus();
      select(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [select]);
  const conceptual = !model.document || model.document.profile === "ontouml";
  const guided = conceptual || !!guide;
  const showTabs = views.length > 1;
  const hasStart = !!leading || showTabs || !!changes;
  return /* @__PURE__ */ jsx28(Theme, { theme, className: "atlas-panel", "data-theme": theme, children: /* @__PURE__ */ jsxs20(
    "div",
    {
      ref: viewerRef,
      className: `viewer${open ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}`,
      children: [
        /* @__PURE__ */ jsxs20(
          "div",
          {
            className: `atlas-overlay-top${density > 1 ? " tight" : ""}${density > 2 ? " tighter" : ""}`,
            ref: topRef,
            children: [
              hasStart && /* @__PURE__ */ jsxs20(Island, { label: "Diagram navigation", className: "island-start", children: [
                leading && /* @__PURE__ */ jsx28("div", { className: "island-leading", children: leading }),
                leading && (showTabs || changes) && /* @__PURE__ */ jsx28(IslandDivider, {}),
                showTabs && /* @__PURE__ */ jsx28(
                  ViewSwitcher,
                  {
                    items: views,
                    compact: density > 0,
                    value: view.key,
                    onChange: (key) => {
                      setViewKey(key);
                      setFocusRequest(null);
                      clearHover();
                    }
                  }
                ),
                showTabs && changes && /* @__PURE__ */ jsx28(IslandDivider, {}),
                changes?.controls(open && showOverview)
              ] }),
              /* @__PURE__ */ jsxs20(Island, { label: "Diagram tools", className: "island-end", children: [
                /* @__PURE__ */ jsx28(ConceptSearch, { classes: model.classes, onChoose: choose }),
                /* @__PURE__ */ jsx28(
                  ToolButton,
                  {
                    label: "Fields",
                    tooltip: fields ? "Hide attributes" : "Show attributes",
                    pressed: fields,
                    icon: /* @__PURE__ */ jsx28(TableRows, {}),
                    onClick: () => {
                      setFocusRequest(null);
                      setFields((v) => !v);
                    }
                  }
                ),
                /* @__PURE__ */ jsx28(
                  CameraControls,
                  {
                    zoomStore,
                    compact: density > 2,
                    onZoom: (factor) => camera.current?.zoomBy(factor),
                    onReset: () => camera.current?.reset(),
                    onFit: () => camera.current?.fit()
                  }
                ),
                /* @__PURE__ */ jsx28(IslandDivider, {}),
                guided && /* @__PURE__ */ jsx28(
                  ToolButton,
                  {
                    label: "Understand the model",
                    pressed: learning && open,
                    icon: /* @__PURE__ */ jsx28(School, {}),
                    onClick: () => {
                      clearHover();
                      setHidden(false);
                      setLearning((v) => !(v && open));
                    }
                  }
                ),
                /* @__PURE__ */ jsx28(
                  ToolButton,
                  {
                    label: hidden ? "Show details" : "Hide details",
                    "aria-controls": inspectorId,
                    "aria-expanded": open,
                    icon: hidden ? /* @__PURE__ */ jsx28(RightPanelOpen, {}) : /* @__PURE__ */ jsx28(RightPanelClose, {}),
                    onClick: () => setHidden((v) => !v)
                  }
                ),
                onFullscreenChange && /* @__PURE__ */ jsx28(
                  ToolButton,
                  {
                    label: fullscreen ? "Exit fullscreen" : "Enter fullscreen",
                    variant: "secondary",
                    pressed: fullscreen,
                    icon: fullscreen ? /* @__PURE__ */ jsx28(FullscreenExit, {}) : /* @__PURE__ */ jsx28(Fullscreen, {}),
                    onClick: () => onFullscreenChange(!fullscreen)
                  }
                )
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsx28(
          DiagramCanvas,
          {
            ref: camera,
            diagram,
            selected,
            hovered,
            focusRequest,
            fitInsets,
            onSelect: select,
            onZoom: zoomStore.set,
            onHover: hover,
            onClearHover: clearHover
          }
        ),
        /* @__PURE__ */ jsx28(ProvenanceBadge, { document: provenanceDocument || model.document }),
        /* @__PURE__ */ jsx28(
          Panel,
          {
            ref: inspector,
            id: inspectorId,
            className: "inspector",
            title: learning ? "Understand the model" : showOverview ? "Changes" : null,
            toolbar: !learning && element && changes ? changes.navigation : null,
            label: learning ? "Model guide" : showOverview ? "Changes in this proposal" : "Model details",
            open,
            closeLabel: "Hide details",
            onClose: () => setHidden(true),
            onPointerEnter: keepHover,
            onPointerLeave: () => hover(null),
            children: open && /* @__PURE__ */ jsx28(
              InspectorContent,
              {
                learning,
                element,
                inspected,
                member: sameTarget(inspected, selected) ? member : null,
                model,
                views,
                snippets,
                guide,
                conceptual,
                changes,
                showOverview,
                learningTab,
                onLearningTab: setLearningTab,
                onChoose: choose,
                onView: (key) => {
                  setViewKey(key);
                  setFocusRequest(null);
                },
                onReference
              }
            )
          }
        )
      ]
    }
  ) });
}

// src/viewer/ViewerErrorBoundary.jsx
import { Component } from "react";
import { Button as Button10, EmptyState as EmptyState3 } from "@envsemble/envui";
import { jsx as jsx29 } from "react/jsx-runtime";
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
      return /* @__PURE__ */ jsx29("main", { className: "viewer-error", children: /* @__PURE__ */ jsx29(
        EmptyState3,
        {
          tone: "error",
          headingLevel: 1,
          title: "The model could not be displayed",
          description: "Rebuild the viewer from the model and check its validation report.",
          action: /* @__PURE__ */ jsx29(Button10, { variant: "secondary", onClick: () => location.reload(), children: "Reload" })
        }
      ) });
    return this.props.children;
  }
};
export {
  AtlasMark,
  AtlasPanel,
  DiagramCanvas,
  ElementLearning,
  LearningLibrary,
  Lesson,
  OntoUMLViewer,
  ProvenanceBadge,
  ProvenanceLabel,
  UMLDiagram,
  UMLGeneralizationGroup,
  UMLNode,
  UMLRelation,
  ViewerErrorBoundary,
  describeProvenance,
  formatCaptureDate
};
//# sourceMappingURL=react.mjs.map
