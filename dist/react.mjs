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
function inspectionTarget(model, index, views, viewKey, id) {
  const node = index.nodes.get(id) || model.classes.find(
    (c) => [...c.attributes, ...c.methods || []].some((m) => m.id === id)
  );
  if (node) {
    const view2 = viewForNode(views, viewKey, node);
    return view2 ? {
      viewKey: view2.key,
      target: { kind: "node", id: node.id },
      nodeId: node.id
    } : null;
  }
  const view = views.find(
    (v) => v.diagram.edges.some((e) => e.id === id) || v.diagram.generalizationGroups?.some(
      (g) => g.id === id || g.memberIds.includes(id)
    )
  );
  return view ? {
    viewKey: view.key,
    target: { kind: index.edges.has(id) ? "edge" : "group", id }
  } : null;
}

// src/viewer/OntoUMLViewer.jsx
import { useCallback as useCallback3, useEffect as useEffect7, useMemo as useMemo8, useRef as useRef7, useState as useState12 } from "react";

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
  const index = { nodes, edges, incident, groups, groupsByEdge };
  indexes.set(diagram, index);
  return index;
}
function focusedElements(diagram, target) {
  if (!target) return null;
  const nodes = /* @__PURE__ */ new Set();
  const edges = /* @__PURE__ */ new Set();
  const groups = /* @__PURE__ */ new Set();
  const index = interactionIndex(diagram);
  if (target.kind === "node") {
    if (!index.nodes.has(target.id)) return null;
    nodes.add(target.id);
    for (const edge of index.incident.get(target.id) || []) {
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  } else if (target.kind === "group") {
    const group = index.groups.get(target.id);
    if (!group) return null;
    group.memberIds.forEach((id) => edges.add(id));
    group.sourceIds.forEach((id) => nodes.add(id));
    nodes.add(group.target);
  } else {
    const edge = index.edges.get(target.id);
    if (!edge) return null;
    edges.add(edge.id);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  for (const id of edges)
    for (const groupId of index.groupsByEdge.get(id) || []) groups.add(groupId);
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
function UMLNode({ node, focus, selected, handlers, idPrefix = "" }) {
  const target = { kind: "node", id: node.id };
  const methods = node.methods || [];
  const header = node.attributes.length || methods.length ? 66 : node.height;
  const color = colorFamilies[node.stereotype] || node.stereotype;
  return /* @__PURE__ */ jsxs(
    "g",
    {
      id: `${idPrefix}node-${node.id}`,
      className: elementClass("node", node.id, focus, selected),
      "data-name": node.name,
      "data-node-id": node.id,
      "data-element-kind": "node",
      "data-element-id": node.id,
      "data-change": node.changeStatus,
      "aria-label": node.name,
      "aria-pressed": handlers ? sameTarget(target, selected) : void 0,
      transform: `translate(${node.x} ${node.y})`,
      ...interactionProps(target, handlers),
      children: [
        /* @__PURE__ */ jsx(
          "rect",
          {
            className: "node-box",
            width: node.width,
            height: node.height,
            rx: "3",
            fill: `var(--node-${color},${typeBackgrounds[color] || "var(--surface,#f6f8fa)"})`,
            stroke: "var(--diagram-border,#818b98)",
            strokeWidth: "1.25",
            vectorEffect: "non-scaling-stroke"
          }
        ),
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
            children: node.name
          }
        ),
        node.changeStatus && node.changeStatus !== "unchanged" && /* @__PURE__ */ jsx("text", { x: "8", y: "15", fill: "var(--text)", fontSize: "12", children: node.changeStatus === "added" ? "+" : node.changeStatus === "removed" ? "\u2212" : "\u0394" }),
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
              children: node.attributes.map((attribute, i) => /* @__PURE__ */ jsxs("text", { x: "14", y: 85 + i * 20, children: [
                attribute.name,
                " : ",
                attribute.type,
                attribute.multiplicity ? ` [${attribute.multiplicity}]` : ""
              ] }, attribute.id || i))
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
                  "text",
                  {
                    x: "14",
                    y: (node.attributes.length ? 97 + node.attributes.length * 20 : 85) + i * 20,
                    children: method.type
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

// src/visualization/UMLRelation.jsx
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function relationName(edge) {
  return edge.type === "generalization" ? `${edge.sourceName} ${edge.realization ? "implements" : "inherits"} ${edge.targetName}` : `${edge.name}: ${edge.sourceName} (${edge.sourceMultiplicity}), ${edge.targetName} (${edge.targetMultiplicity})`;
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
  const markerState = sameTarget(target, focus?.primary) ? "-primary" : highlighted ? "-active" : "";
  const aggregationMarker = (kind2) => ["SHARED", "COMPOSITE"].includes(kind2) ? `url(#${markerId}-${kind2}${markerState})` : void 0;
  return /* @__PURE__ */ jsxs2(
    "g",
    {
      className: `${elementClass(kind, edge.id, focus, selected)} relation-route${edge.type === "generalization" ? " generalization" : ""}`,
      "data-edge": edge.id,
      "data-element-kind": kind,
      "data-element-id": edge.id,
      "data-source": edge.source,
      "data-target": edge.target,
      "data-change": edge.changeStatus,
      "aria-label": accessibleName || relationName(edge),
      "aria-pressed": handlers ? sameTarget(target, selected) : void 0,
      ...interactionProps(target, handlers),
      children: [
        /* @__PURE__ */ jsx2("title", { children: accessibleName || relationName(edge) }),
        (edge.branchPaths || edge.paths).map((d, i) => /* @__PURE__ */ jsxs2("g", { children: [
          /* @__PURE__ */ jsx2(
            "path",
            {
              className: "edge-path",
              d,
              fill: "none",
              stroke: edge.type === "generalization" ? "var(--diagram-inheritance,#59636e)" : "var(--diagram-edge,#59636e)",
              strokeWidth: "1.4",
              strokeDasharray: edge.realization || edge.stereotype === "dependency" ? "6 4" : void 0,
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
        ] }, i))
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
  return /* @__PURE__ */ jsx2(
    "g",
    {
      className: `${elementClass(kind, edge.id, focus, selected)} relation-labels`,
      "data-edge": edge.id,
      "data-element-kind": kind,
      "data-element-id": edge.id,
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
                children: label.text.split("\n").map((line, i, lines) => /* @__PURE__ */ jsx2(
                  "tspan",
                  {
                    x: label.width / 2,
                    y: 17 + i * 17,
                    fontSize: i === 0 && lines.length > 1 ? "11.5" : void 0,
                    fill: i === 0 && lines.length > 1 ? "var(--diagram-muted,#59636e)" : void 0,
                    children: line
                  },
                  i
                ))
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
    for (const path of element.querySelectorAll(".edge-path")) {
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
var markerColor = (state, normal) => state === "-primary" ? "var(--diagram-selection,#9a6700)" : state === "-active" ? "var(--accent,#0969da)" : normal;
var UMLDiagram = memo(function UMLDiagram2({
  diagram,
  active = null,
  selected = null,
  handlers,
  backgroundURL
}) {
  const markerId = `inheritance-${useId().replaceAll(":", "")}`;
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
        style: {
          fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif"
        },
        children: [
          /* @__PURE__ */ jsxs3("defs", { children: [
            markerStates.map((state) => /* @__PURE__ */ jsx4(
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
              (aggregation) => markerStates.map((state) => /* @__PURE__ */ jsx4(
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
            markerStates.map((state) => /* @__PURE__ */ jsx4(
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
  }, [diagram, initial, stableHandlers, markerId, interactive, bitmap]);
  const overlay = useMemo(() => {
    if (!interactive || !focus) return null;
    const index = interactionIndex(diagram);
    const groups = [...focus.groups].map((id) => index.groups.get(id));
    const edges = [...focus.edges].map((id) => index.edges.get(id));
    const nodes = [...focus.nodes].map((id) => index.nodes.get(id)).filter(Boolean);
    return /* @__PURE__ */ jsxs3(
      "svg",
      {
        className: "diagram-overlay",
        width: diagram.width,
        height: diagram.height,
        viewBox: `0 0 ${diagram.width} ${diagram.height}`,
        "aria-hidden": "true",
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
function createCamera({ canvasRef, worldRef, onZoom, onTap, onMotion }) {
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
  function fit(animate = true) {
    const b = worldRef.current.querySelector("svg").viewBox.baseVal;
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const scale = Math.min(
      Math.max(1, w - 48) / b.width,
      Math.max(1, h - 48) / b.height,
      1.2
    );
    const next = {
      x: (w - b.width * scale) / 2,
      y: (h - b.height * scale) / 2,
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
    snapTo({
      scale: 0.7,
      x: canvasRef.current.clientWidth / 2 - x * 0.7,
      y: canvasRef.current.clientHeight / 2 - y * 0.7,
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
    const canvas = canvasRef.current;
    const freeWidth = Math.max(1, canvas.clientWidth - rightInset);
    const scale = Math.max(camera.scale, 0.85);
    moveTo(
      {
        scale,
        x: freeWidth / 2 - (m.e + Number(r.getAttribute("width")) / 2) * scale,
        y: canvas.clientHeight / 2 - (m.f + Number(r.getAttribute("height")) / 2) * scale,
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
    const canvas = canvasRef.current;
    const left = destination.x + m.e * destination.scale;
    const top = destination.y + m.f * destination.scale;
    const width = Number(r.getAttribute("width")) * destination.scale;
    const height = Number(r.getAttribute("height")) * destination.scale;
    const shift = (start, size, available) => size > available - 48 ? (available - size) / 2 - start : start < 24 ? 24 - start : start + size > available - 24 ? available - 24 - start - size : 0;
    const dx = shift(left, width, canvas.clientWidth);
    const dy = shift(top, height, canvas.clientHeight);
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
  onMotion
}) {
  const callbacks = useRef2({ onZoom, onTap, onMotion });
  const controls = useMemo2(
    () => createCamera({
      canvasRef,
      worldRef,
      onZoom: (value) => callbacks.current.onZoom(value),
      onTap: (element) => callbacks.current.onTap(element),
      onMotion: () => callbacks.current.onMotion()
    }),
    // A new camera implementation during Vite refresh needs a new controller.
    [createCamera]
  );
  useLayoutEffect2(() => {
    callbacks.current = { onZoom, onTap, onMotion };
  }, [onZoom, onTap, onMotion]);
  useLayoutEffect2(() => {
    controls.restoreView(diagram.key, diagram.fields, diagram.initialFocus);
  }, [controls, diagram]);
  useLayoutEffect2(() => {
    if (focusRequest)
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
      onMotion: clearTransient
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
  "--type-mode"
];
var EMPTY_URLS = { diagramURL: void 0, backgroundURL: void 0 };
function useSVGExport(svgSource, theme) {
  const [urls, setURLs] = useState3(EMPTY_URLS);
  useEffect2(() => {
    const svg = new DOMParser().parseFromString(
      svgSource,
      "image/svg+xml"
    ).documentElement;
    const styles = getComputedStyle(document.documentElement);
    for (const name of THEME_VARS)
      svg.style.setProperty(name, styles.getPropertyValue(name).trim());
    svg.querySelectorAll(".selected,.dimmed").forEach((n) => n.classList.remove("selected", "dimmed"));
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
    background.setAttribute("fill", styles.getPropertyValue("--canvas").trim());
    svg.insertBefore(background, svg.firstChild);
    const diagramURL = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml"
      })
    );
    setURLs({ diagramURL, backgroundURL, source: svgSource, theme });
    return () => {
      URL.revokeObjectURL(diagramURL);
      URL.revokeObjectURL(backgroundURL);
    };
  }, [svgSource, theme]);
  return urls.source === svgSource && urls.theme === theme ? urls : EMPTY_URLS;
}

// src/ui/Button.jsx
import { jsx as jsx6 } from "react/jsx-runtime";
function IconButton({
  label,
  title = label,
  className = "",
  children,
  ...props
}) {
  return /* @__PURE__ */ jsx6(
    "button",
    {
      className: `icon ${className}`,
      "aria-label": label,
      title,
      ...props,
      children
    }
  );
}
function ToggleButton({ pressed, className = "", children, ...props }) {
  return /* @__PURE__ */ jsx6("button", { className, "aria-pressed": pressed, ...props, children });
}

// src/ui/Icons.jsx
import {
  BookIcon,
  CodeIcon,
  DashIcon,
  DownloadIcon,
  FileCodeIcon,
  FileMediaIcon,
  GitBranchIcon,
  LinkExternalIcon,
  MarkGithubIcon,
  MoonIcon,
  PlusIcon,
  QuestionIcon,
  RepoIcon,
  ScreenFullIcon,
  SearchIcon,
  SidebarCollapseIcon,
  SidebarExpandIcon,
  SunIcon,
  TableIcon,
  XIcon
} from "@primer/octicons-react";

// src/ui/Panel.jsx
import { jsx as jsx7, jsxs as jsxs5 } from "react/jsx-runtime";
function Panel({
  open,
  onClose,
  label = "Diagram details",
  title = label,
  closeLabel = "Close details",
  children,
  id = "panel",
  className = "",
  ...props
}) {
  return /* @__PURE__ */ jsxs5(
    "aside",
    {
      id,
      className: `panel${open ? " open" : ""}${className ? ` ${className}` : ""}`,
      "aria-label": label,
      ...props,
      children: [
        /* @__PURE__ */ jsxs5("div", { className: `panel-header${title ? "" : " compact"}`, children: [
          title && /* @__PURE__ */ jsx7("span", { className: "panel-title", children: title }),
          onClose && /* @__PURE__ */ jsx7(
            IconButton,
            {
              className: "panel-close",
              label: closeLabel,
              onClick: onClose,
              children: /* @__PURE__ */ jsx7(XIcon, { size: 16 })
            }
          )
        ] }),
        /* @__PURE__ */ jsx7("div", { className: "panel-content", children })
      ]
    }
  );
}

// src/ui/useTheme.js
import { useLayoutEffect as useLayoutEffect4, useState as useState4 } from "react";
function useTheme(storageKey) {
  const [theme, setTheme] = useState4(() => {
    try {
      return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useLayoutEffect4(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
    }
  }, [theme, storageKey]);
  return [theme, () => setTheme((old) => old === "dark" ? "light" : "dark")];
}

// src/ui/Tabs.jsx
import { jsx as jsx8 } from "react/jsx-runtime";
function Tabs({ items, value, onChange, label = "Diagram" }) {
  return /* @__PURE__ */ jsx8("nav", { className: "tabs", "aria-label": label, children: items.map((item) => /* @__PURE__ */ jsx8(
    "button",
    {
      "data-view": item.key,
      "aria-selected": item.key === value,
      onClick: () => onChange(item.key),
      children: item.label
    },
    item.key
  )) });
}

// src/ui/CameraControls.jsx
import { useSyncExternalStore } from "react";
import { jsx as jsx9, jsxs as jsxs6 } from "react/jsx-runtime";
function ZoomReadout({ zoom, onReset }) {
  return /* @__PURE__ */ jsxs6(
    "button",
    {
      id: "zoom-value",
      className: "zoom-readout",
      title: "Reset to 100%",
      onClick: onReset,
      children: [
        zoom,
        "%"
      ]
    }
  );
}
function ObservedZoomReadout({ store, onReset }) {
  const zoom = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  return /* @__PURE__ */ jsx9(ZoomReadout, { zoom, onReset });
}
function CameraControls({ zoom, zoomStore, onZoom, onReset, onFit }) {
  return /* @__PURE__ */ jsxs6("div", { className: "camera-controls", children: [
    /* @__PURE__ */ jsx9(
      IconButton,
      {
        id: "zoom-out",
        label: "Zoom out",
        title: "Zoom out (\u2212)",
        onClick: () => onZoom(1 / 1.25),
        children: /* @__PURE__ */ jsx9(DashIcon, { size: 16 })
      }
    ),
    zoomStore ? /* @__PURE__ */ jsx9(ObservedZoomReadout, { store: zoomStore, onReset }) : /* @__PURE__ */ jsx9(ZoomReadout, { zoom, onReset }),
    /* @__PURE__ */ jsx9(
      IconButton,
      {
        id: "zoom-in",
        label: "Zoom in",
        title: "Zoom in (+)",
        onClick: () => onZoom(1.25),
        children: /* @__PURE__ */ jsx9(PlusIcon, { size: 16 })
      }
    ),
    /* @__PURE__ */ jsx9("button", { id: "fit", "aria-label": "Fit", title: "Fit diagram (0)", onClick: onFit, children: /* @__PURE__ */ jsx9(ScreenFullIcon, { size: 16 }) })
  ] });
}

// src/ui/ConceptSearch.jsx
import {
  memo as memo3,
  useEffect as useEffect4,
  useLayoutEffect as useLayoutEffect6,
  useMemo as useMemo3,
  useRef as useRef5,
  useState as useState5
} from "react";

// src/ui/usePopupDismiss.js
import { useEffect as useEffect3, useLayoutEffect as useLayoutEffect5, useRef as useRef4 } from "react";
function usePopupDismiss(onClose, ...roots) {
  const latest = useRef4({ onClose, roots });
  useLayoutEffect5(() => {
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
import { Fragment as Fragment3, jsx as jsx10, jsxs as jsxs7 } from "react/jsx-runtime";
var ConceptSearch = memo3(function ConceptSearch2({
  classes,
  onChoose
}) {
  const [query, setQuery] = useState5("");
  const [open, setOpen] = useState5(false);
  const [showHits, setShowHits] = useState5(false);
  const inputRef = useRef5(null);
  const suggestionsRef = useRef5(null);
  const searchRef = useRef5(null), toggleRef = useRef5(null);
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
  useLayoutEffect6(() => {
    if (open) inputRef.current.focus();
  }, [open]);
  usePopupDismiss(close, searchRef, toggleRef);
  useEffect4(() => {
    const shortcut = (e) => {
      if (e.target.closest("input,textarea,select,[contenteditable='true']"))
        return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
        inputRef.current.focus();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  function choose(name) {
    onChoose(name);
    setQuery("");
    close();
    inputRef.current.blur();
  }
  return /* @__PURE__ */ jsxs7(Fragment3, { children: [
    /* @__PURE__ */ jsx10(
      "button",
      {
        ref: toggleRef,
        id: "search-toggle",
        className: "icon",
        "aria-label": "Open concept search",
        "aria-expanded": open,
        "aria-controls": "search",
        title: "Find concept",
        onClick: () => setOpen(!open),
        children: /* @__PURE__ */ jsx10(SearchIcon, { size: 16 })
      }
    ),
    /* @__PURE__ */ jsxs7("div", { ref: searchRef, className: `search${open ? " open" : ""}`, children: [
      /* @__PURE__ */ jsx10(SearchIcon, { size: 16, className: "search-icon" }),
      /* @__PURE__ */ jsx10(
        "input",
        {
          ref: inputRef,
          id: "search",
          type: "search",
          placeholder: "Find a concept",
          "aria-label": "Find concept",
          autoComplete: "off",
          "aria-keyshortcuts": "/",
          value: query,
          onChange: (e) => {
            setQuery(e.target.value);
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
              close();
              inputRef.current.blur();
            }
          }
        }
      ),
      /* @__PURE__ */ jsx10("kbd", { className: "search-shortcut", "aria-hidden": "true", children: "/" }),
      /* @__PURE__ */ jsx10(
        "div",
        {
          ref: suggestionsRef,
          id: "suggestions",
          className: `suggestions${showHits && hits.length ? " open" : ""}`,
          role: "listbox",
          "aria-label": "Concepts",
          children: hits.map((c) => /* @__PURE__ */ jsx10("button", { role: "option", onClick: () => choose(c.id), children: c.name }, c.id))
        }
      )
    ] })
  ] });
});

// src/ui/ExportMenu.jsx
import { useRef as useRef6, useState as useState6 } from "react";
import { jsx as jsx11, jsxs as jsxs8 } from "react/jsx-runtime";
function ExportMenu({ children }) {
  const [open, setOpen] = useState6(false);
  const root = useRef6(null);
  usePopupDismiss(() => setOpen(false), root);
  return /* @__PURE__ */ jsxs8("div", { className: "menu-wrap", ref: root, children: [
    /* @__PURE__ */ jsx11(
      IconButton,
      {
        id: "export",
        label: "Export",
        "aria-expanded": open,
        onClick: () => setOpen(!open),
        children: /* @__PURE__ */ jsx11(DownloadIcon, { size: 16 })
      }
    ),
    /* @__PURE__ */ jsx11("div", { id: "export-menu", className: `menu${open ? " open" : ""}`, children })
  ] });
}

// src/ui/useBlobURL.js
import { useEffect as useEffect5, useState as useState7 } from "react";
function useBlobURL(data, type = "text/plain;charset=utf-8") {
  const [url, setURL] = useState7(void 0);
  useEffect5(() => {
    const next = URL.createObjectURL(new Blob([data], { type }));
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [data, type]);
  return url;
}

// src/ui/DownloadLink.jsx
import { jsx as jsx12 } from "react/jsx-runtime";
function DownloadLink({
  data,
  filename,
  type,
  children,
  id,
  className = "source"
}) {
  const href = useBlobURL(data, type);
  return /* @__PURE__ */ jsx12("a", { id, className, href, download: filename, children });
}

// src/viewer/ViewerToolbar.jsx
import { useMemo as useMemo4 } from "react";
import { jsx as jsx13, jsxs as jsxs9 } from "react/jsx-runtime";
function ViewerToolbar({
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
  onSidebar,
  onView,
  onFields,
  onTheme,
  onChoose,
  onAbout,
  onLearn,
  onZoom,
  onReset,
  onFit
}) {
  const themeLabel = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  const sidebarLabel = sidebarHidden ? "Show sidebar" : "Hide sidebar";
  const conceptual = !model.document || model.document.profile === "ontouml";
  const modelFile = `${exports.slug}-${conceptual ? "ontouml" : "structural"}.json`;
  const searchClasses = useMemo4(() => {
    const visibleIds = new Set(views.flatMap((view) => view.nodeIds));
    return model.classes.filter((concept) => visibleIds.has(concept.id));
  }, [model.classes, views]);
  return /* @__PURE__ */ jsxs9("header", { className: "viewer-toolbar", children: [
    /* @__PURE__ */ jsx13("div", { className: "toolbar-identity", title: model.title, children: /* @__PURE__ */ jsx13("span", { className: "brand-mark", children: /* @__PURE__ */ jsx13(RepoIcon, { size: 20 }) }) }),
    /* @__PURE__ */ jsx13("div", { className: "view-navigation", children: /* @__PURE__ */ jsx13(Tabs, { items: views, value: viewKey, onChange: onView }) }),
    /* @__PURE__ */ jsx13("span", { className: "spacer" }),
    /* @__PURE__ */ jsxs9("div", { className: "toolbar-actions", children: [
      /* @__PURE__ */ jsx13(ConceptSearch, { classes: searchClasses, onChoose }),
      /* @__PURE__ */ jsxs9("div", { className: "diagram-actions", children: [
        /* @__PURE__ */ jsx13(
          ToggleButton,
          {
            id: "fields",
            className: "fields",
            pressed: fields,
            "aria-label": "Fields",
            title: "Show attributes in the diagram",
            onClick: onFields,
            children: /* @__PURE__ */ jsx13(TableIcon, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsx13(CameraControls, { ...{ zoomStore, onZoom, onReset, onFit } })
      ] }),
      /* @__PURE__ */ jsx13(IconButton, { id: "theme-toggle", label: themeLabel, onClick: onTheme, children: theme === "dark" ? /* @__PURE__ */ jsx13(SunIcon, { size: 16 }) : /* @__PURE__ */ jsx13(MoonIcon, { size: 16 }) }),
      /* @__PURE__ */ jsxs9(ExportMenu, { children: [
        /* @__PURE__ */ jsxs9(
          "a",
          {
            id: "svg-download",
            href: diagramURL,
            download: `${exports.slug}-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`,
            children: [
              /* @__PURE__ */ jsx13(FileMediaIcon, { size: 16 }),
              "SVG"
            ]
          }
        ),
        /* @__PURE__ */ jsxs9(
          DownloadLink,
          {
            id: "puml-download",
            className: "",
            data: exports.readText(`${exports.slug}-${viewKey}.puml`),
            filename: `${exports.slug}-${viewKey}.puml`,
            children: [
              /* @__PURE__ */ jsx13(FileCodeIcon, { size: 16 }),
              "PlantUML"
            ]
          }
        ),
        /* @__PURE__ */ jsxs9(
          DownloadLink,
          {
            id: "model-download",
            className: "",
            data: exports.readText(modelFile),
            filename: modelFile,
            type: "application/json",
            children: [
              /* @__PURE__ */ jsx13(FileCodeIcon, { size: 16 }),
              conceptual ? "OntoUML JSON" : "Structural JSON"
            ]
          }
        ),
        /* @__PURE__ */ jsxs9(
          DownloadLink,
          {
            id: "bundle-download",
            className: "",
            data: exports.bundle,
            filename: `${exports.slug}-models.zip`,
            type: "application/zip",
            children: [
              /* @__PURE__ */ jsx13(DownloadIcon, { size: 16 }),
              "Models ZIP"
            ]
          }
        )
      ] }),
      conceptual && /* @__PURE__ */ jsxs9(
        "button",
        {
          id: "learn-toggle",
          className: "learn-toggle",
          "aria-pressed": learningOpen && sidebarOpen,
          onClick: onLearn,
          "aria-label": `Learn OntoUML; ${model.validation.counts.error} findings`,
          title: "Learn OntoUML",
          children: [
            /* @__PURE__ */ jsx13(BookIcon, { size: 16 }),
            model.validation.counts.error > 0 && /* @__PURE__ */ jsx13("span", { className: "validation-count", children: model.validation.counts.error })
          ]
        }
      ),
      /* @__PURE__ */ jsx13(
        IconButton,
        {
          id: "sidebar-toggle",
          label: sidebarLabel,
          "aria-controls": "inspector",
          "aria-expanded": sidebarOpen,
          "aria-pressed": !sidebarHidden,
          onClick: onSidebar,
          children: sidebarHidden ? /* @__PURE__ */ jsx13(SidebarExpandIcon, { size: 16 }) : /* @__PURE__ */ jsx13(SidebarCollapseIcon, { size: 16 })
        }
      ),
      /* @__PURE__ */ jsx13(
        IconButton,
        {
          id: "info",
          label: "About and controls",
          onClick: onAbout,
          "aria-controls": "about-panel",
          "aria-expanded": aboutOpen,
          children: /* @__PURE__ */ jsx13(QuestionIcon, { size: 16 })
        }
      )
    ] })
  ] });
}

// src/model/printable.js
var printable = (value) => typeof value === "string" ? value : JSON.stringify(value ?? "");

// src/ui/CodeSnippet.jsx
import { Fragment as Fragment4, memo as memo4 } from "react";
import { jsx as jsx14, jsxs as jsxs10 } from "react/jsx-runtime";
var CodeSnippet = memo4(function CodeSnippet2({ snippet, label }) {
  return /* @__PURE__ */ jsx14("pre", { className: "shiki code-snippet", tabIndex: 0, "aria-label": label, children: /* @__PURE__ */ jsx14("code", { children: snippet.lines.map((tokens, i) => /* @__PURE__ */ jsxs10(Fragment4, { children: [
    /* @__PURE__ */ jsx14("span", { className: "code-line", "data-line": snippet.startLine + i, children: tokens.map((token, j) => /* @__PURE__ */ jsx14("span", { style: token.style, children: token.content }, j)) }),
    i < snippet.lines.length - 1 ? "\n" : null
  ] }, i)) }) });
});

// src/viewer/SourceEvidence.jsx
import { jsx as jsx15, jsxs as jsxs11 } from "react/jsx-runtime";
function SourceExcerpt({ source, snippet }) {
  if (!snippet)
    return /* @__PURE__ */ jsxs11("div", { className: "source-excerpt", children: [
      /* @__PURE__ */ jsx15("p", { children: source.claim }),
      source.url && /* @__PURE__ */ jsx15(
        "a",
        {
          className: "source-github",
          href: source.url,
          target: "_blank",
          rel: "noopener noreferrer",
          children: "View source \u2197"
        }
      )
    ] });
  return /* @__PURE__ */ jsxs11("div", { className: "source-excerpt source-file-card", children: [
    /* @__PURE__ */ jsxs11("div", { className: "source-path", title: source.file, children: [
      /* @__PURE__ */ jsx15(FileCodeIcon, { size: 16 }),
      /* @__PURE__ */ jsx15("span", { className: "source-filename", children: source.file.split("/").pop() }),
      /* @__PURE__ */ jsx15("span", { className: "source-language", children: snippet.language })
    ] }),
    /* @__PURE__ */ jsx15(
      CodeSnippet,
      {
        snippet,
        label: `${source.title}, lines ${snippet.startLine} to ${snippet.endLine}`
      }
    ),
    snippet.url && /* @__PURE__ */ jsx15("div", { className: "source-footer", children: /* @__PURE__ */ jsxs11(
      "a",
      {
        className: "source-github",
        href: snippet.url,
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": `View ${source.title} on GitHub`,
        children: [
          snippet.url.startsWith("https://github.com/") && /* @__PURE__ */ jsx15(MarkGithubIcon, { size: 16 }),
          snippet.url.startsWith("https://github.com/") ? "View on GitHub" : "View source",
          " ",
          /* @__PURE__ */ jsx15(LinkExternalIcon, { size: 12 })
        ]
      }
    ) })
  ] });
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
  return /* @__PURE__ */ jsxs11("section", { className: "source-evidence", "aria-label": label, children: [
    label !== "Source" && /* @__PURE__ */ jsx15("h2", { children: label }),
    records.map(
      (source, i) => i === 0 ? /* @__PURE__ */ jsx15(
        SourceExcerpt,
        {
          source,
          snippet: snippets[source.id]
        },
        source.id
      ) : /* @__PURE__ */ jsxs11("details", { className: "additional-source", children: [
        /* @__PURE__ */ jsx15("summary", { children: source.title }),
        /* @__PURE__ */ jsx15(SourceExcerpt, { source, snippet: snippets[source.id] })
      ] }, source.id)
    )
  ] });
}

// src/learning/LearningContent.jsx
import { useState as useState8, useMemo as useMemo5 } from "react";

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
  const index = { classes, parents };
  identityIndexes.set(model, index);
  return index;
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
import { Fragment as Fragment5, jsx as jsx16, jsxs as jsxs12 } from "react/jsx-runtime";
function Lesson({ stereotype, children }) {
  const lesson = lessonFor(stereotype);
  return /* @__PURE__ */ jsxs12("div", { className: "lesson", children: [
    /* @__PURE__ */ jsx16("p", { children: lesson.summary }),
    children,
    /* @__PURE__ */ jsx16("p", { className: "learning-question", children: lesson.question }),
    lesson.example && /* @__PURE__ */ jsx16("p", { className: "muted", children: lesson.example }),
    /* @__PURE__ */ jsx16(
      "a",
      {
        className: "source",
        href: documentationURL(stereotype),
        target: "_blank",
        rel: "noopener noreferrer",
        children: stereotype === "generalizationSet" ? "UML specification \u2197" : "OntoUML specification \u2197"
      }
    )
  ] });
}
function ElementLearning({ element, model, relation = false }) {
  const key = relation ? element.type === "generalizationSet" ? "generalizationSet" : element.type === "generalization" ? "generalization" : element.stereotype || "association" : element.stereotype;
  const providers = relation ? [] : identityProviders(model, element.id);
  const issues = model.validation.issues.filter(
    (i) => i.elementId === element.id
  );
  return /* @__PURE__ */ jsxs12("section", { className: "element-learning", "aria-label": "Model guidance", children: [
    issues.filter((i) => i.severity !== "info").map((issue) => /* @__PURE__ */ jsxs12("details", { className: "finding", children: [
      /* @__PURE__ */ jsxs12("summary", { children: [
        issue.severity === "error" ? "Needs review" : "Review",
        " \xB7",
        " ",
        issue.code.replaceAll("_", " ").toLowerCase()
      ] }),
      /* @__PURE__ */ jsx16("p", { children: issue.message }),
      issue.documentation && /* @__PURE__ */ jsx16(
        "a",
        {
          className: "source",
          href: issue.documentation,
          target: "_blank",
          rel: "noopener noreferrer",
          children: "Rule in the specification \u2197"
        }
      )
    ] }, issue.code)),
    /* @__PURE__ */ jsxs12("details", { className: "learn-concept", children: [
      /* @__PURE__ */ jsx16("summary", { children: key === "generalizationSet" ? "Understand generalization sets" : `Understand \xAB${key || "unspecified"}\xBB` }),
      /* @__PURE__ */ jsxs12(Lesson, { stereotype: key, children: [
        providers.length > 0 && /* @__PURE__ */ jsxs12("p", { children: [
          "Identity supplied by ",
          providers.map((p) => p.name).join(", "),
          "."
        ] }),
        relation && element.type === "association" && /* @__PURE__ */ jsx16("div", { className: "counts-reading", children: readMultiplicity(element).map((sentence) => /* @__PURE__ */ jsx16("p", { children: sentence }, sentence)) })
      ] })
    ] }),
    element.rationale && element.rationale !== element.description && /* @__PURE__ */ jsxs12("details", { className: "learn-concept", children: [
      /* @__PURE__ */ jsx16("summary", { children: "Why this classification?" }),
      /* @__PURE__ */ jsx16("p", { children: element.rationale })
    ] }),
    (element.questions || []).map((question) => /* @__PURE__ */ jsxs12("details", { className: "learn-concept uncertainty", children: [
      /* @__PURE__ */ jsx16("summary", { children: question.question }),
      /* @__PURE__ */ jsx16("p", { children: question.why }),
      /* @__PURE__ */ jsx16("h2", { children: "How to resolve it" }),
      /* @__PURE__ */ jsx16("p", { children: question.resolve })
    ] }, question.question))
  ] });
}
function LearningLibrary({ model, onInspect }) {
  const [tab, setTab] = useState8("learn"), [query, setQuery] = useState8("");
  const [reveal, setReveal] = useState8(false);
  const visibleIssues = model.validation.issues.filter(
    (i) => i.severity !== "info"
  );
  const coverage = model.validation.issues.filter((i) => i.severity === "info");
  const elementNames = useMemo5(
    () => new Map(
      [...model.classes, ...model.relations, ...model.partitions || []].map(
        (e) => [e.id, e.name]
      )
    ),
    [model]
  );
  const renderIssue = (issue, i) => /* @__PURE__ */ jsxs12("div", { className: `validation-issue ${issue.severity}`, children: [
    /* @__PURE__ */ jsx16("span", { className: "tag", children: issue.severity }),
    /* @__PURE__ */ jsx16("p", { children: issue.message }),
    issue.elementId && /* @__PURE__ */ jsxs12(
      "button",
      {
        className: "issue-link",
        onClick: () => onInspect(issue.elementId),
        children: [
          elementNames.get(issue.elementId) || "Show in model",
          " \u2197"
        ]
      }
    )
  ] }, i);
  return /* @__PURE__ */ jsxs12(Fragment5, { children: [
    /* @__PURE__ */ jsxs12("div", { className: "learning-tabs", children: [
      /* @__PURE__ */ jsx16("button", { "aria-pressed": tab === "learn", onClick: () => setTab("learn"), children: "Learn" }),
      /* @__PURE__ */ jsxs12(
        "button",
        {
          "aria-pressed": tab === "checks",
          onClick: () => setTab("checks"),
          children: [
            "Checks",
            " ",
            /* @__PURE__ */ jsx16("span", { className: "validation-count", children: model.validation.counts.error })
          ]
        }
      ),
      /* @__PURE__ */ jsx16(
        "button",
        {
          "aria-pressed": tab === "questions",
          onClick: () => setTab("questions"),
          children: "Open questions"
        }
      )
    ] }),
    tab === "learn" && /* @__PURE__ */ jsxs12(Fragment5, { children: [
      /* @__PURE__ */ jsx16(
        "input",
        {
          className: "learning-search",
          type: "search",
          "aria-label": "Find a stereotype",
          placeholder: "Find a stereotype\u2026",
          value: query,
          onChange: (e) => setQuery(e.target.value)
        }
      ),
      /* @__PURE__ */ jsxs12("details", { className: "learn-concept", children: [
        /* @__PURE__ */ jsx16("summary", { children: "How to read counts" }),
        /* @__PURE__ */ jsx16("p", { children: "The count next to a type says how many of its instances can relate to one instance at the opposite end." }),
        /* @__PURE__ */ jsx16("p", { children: "1 = exactly one \xB7 0..1 = optional, at most one \xB7 1..* = at least one \xB7 * = zero or more." }),
        /* @__PURE__ */ jsx16("p", { className: "learning-question", children: "Person [1] \u2014 [0..*] Enrollment. How many people does each enrollment require?" }),
        /* @__PURE__ */ jsx16(
          "button",
          {
            className: "answer-button",
            onClick: () => setReveal(!reveal),
            children: reveal ? "Hide answer" : "Check your understanding"
          }
        ),
        reveal && /* @__PURE__ */ jsx16("p", { children: "Exactly one Person per Enrollment. The 0..* beside Enrollment permits a Person to have no enrollments or many." })
      ] }),
      Object.entries(reference_default).filter(
        ([key, value]) => `${key} ${value.summary}`.toLowerCase().includes(query.toLowerCase())
      ).map(([key, lesson]) => /* @__PURE__ */ jsxs12("details", { className: "learn-concept", children: [
        /* @__PURE__ */ jsx16("summary", { children: key === "generalizationSet" ? lesson.title : `${lesson.title} \xB7 \xAB${key}\xBB` }),
        /* @__PURE__ */ jsx16(Lesson, { stereotype: key })
      ] }, key))
    ] }),
    tab === "checks" && /* @__PURE__ */ jsxs12(Fragment5, { children: [
      !model.validation.counts.error && /* @__PURE__ */ jsx16("p", { children: "The implemented checks pass." }),
      visibleIssues.map(renderIssue),
      /* @__PURE__ */ jsxs12("details", { className: "learn-concept", children: [
        /* @__PURE__ */ jsx16("summary", { children: "Rule coverage" }),
        /* @__PURE__ */ jsx16("p", { className: "muted", children: "Official JSON schema, reference integrity, and a documented subset of ontology rules. Domain accuracy still needs judgment." }),
        coverage.map(renderIssue),
        model.validation.limitations.map((limit) => /* @__PURE__ */ jsx16("p", { className: "muted", children: limit }, limit))
      ] })
    ] }),
    tab === "questions" && /* @__PURE__ */ jsx16(Fragment5, { children: model.unknowns.length ? model.unknowns.map((question) => /* @__PURE__ */ jsx16("p", { className: "open-question", children: question }, question)) : /* @__PURE__ */ jsx16("p", { className: "muted", children: "No project-wide questions recorded." }) })
  ] });
}

// src/ui/DetailHeader.jsx
import { jsx as jsx17, jsxs as jsxs13 } from "react/jsx-runtime";
function DetailHeader({
  title,
  tag,
  status,
  description,
  stereotype,
  icon: Icon = FileCodeIcon
}) {
  return /* @__PURE__ */ jsxs13("div", { className: "detail-header", children: [
    /* @__PURE__ */ jsxs13("h1", { children: [
      /* @__PURE__ */ jsx17(Icon, { size: 20 }),
      /* @__PURE__ */ jsx17("span", { children: title })
    ] }),
    /* @__PURE__ */ jsxs13("div", { className: "detail-tags", children: [
      /* @__PURE__ */ jsx17("span", { className: "tag stereotype-tag", "data-stereotype": stereotype, children: tag }),
      status && /* @__PURE__ */ jsx17("span", { className: "tag evidence-status", "data-status": status, children: status })
    ] }),
    description && /* @__PURE__ */ jsxs13("details", { className: "detail-description", children: [
      /* @__PURE__ */ jsx17("summary", { children: "Description" }),
      /* @__PURE__ */ jsx17("p", { children: description })
    ] })
  ] });
}

// src/viewer/DetailsContent.jsx
import { memo as memo5 } from "react";
import { Fragment as Fragment6, jsx as jsx18, jsxs as jsxs14 } from "react/jsx-runtime";
function ChangeDetails({ element, model }) {
  const ids = /* @__PURE__ */ new Set([
    element.id,
    ...(element.attributes || []).map((a) => a.id),
    ...(element.methods || []).map((m) => m.id)
  ]);
  const changes = model.document?.comparison?.changes?.changes.filter(
    (c) => ids.has(c.elementId)
  ) || [];
  const mappings = model.document?.mappings?.filter((m) => ids.has(m.elementId)) || [];
  if (!changes.length && !mappings.length) return null;
  return /* @__PURE__ */ jsxs14(Fragment6, { children: [
    !!changes.length && /* @__PURE__ */ jsxs14("details", { children: [
      /* @__PURE__ */ jsxs14("summary", { children: [
        "Changes \xB7 ",
        changes.length
      ] }),
      changes.map((c) => /* @__PURE__ */ jsxs14("div", { children: [
        /* @__PURE__ */ jsxs14("p", { children: [
          c.kind,
          " \xB7",
          " ",
          typeof c.name === "string" ? c.name : JSON.stringify(c.name)
        ] }),
        c.properties.map((p) => /* @__PURE__ */ jsxs14("p", { children: [
          p.key,
          ":",
          " ",
          p.before.present ? JSON.stringify(p.before.value) : "absent",
          " ",
          "\u2192 ",
          p.after.present ? JSON.stringify(p.after.value) : "absent"
        ] }, p.key)),
        c.rationale.map((r) => /* @__PURE__ */ jsx18("p", { children: r.text }, r.id))
      ] }, c.id))
    ] }),
    !!mappings.length && /* @__PURE__ */ jsxs14("details", { children: [
      /* @__PURE__ */ jsx18("summary", { children: "Mappings" }),
      mappings.map((m) => /* @__PURE__ */ jsxs14("div", { children: [
        /* @__PURE__ */ jsxs14("p", { children: [
          m.targetTitle,
          " \xB7 ",
          m.targetElementId
        ] }),
        /* @__PURE__ */ jsx18("p", { children: m.reason }),
        /* @__PURE__ */ jsxs14("small", { children: [
          "Authored link \xB7 retained ",
          m.targetProfile,
          " snapshot"
        ] })
      ] }, m.id))
    ] })
  ] });
}
var ConceptDetails = memo5(function ConceptDetails2({
  concept,
  model,
  snippets
}) {
  return /* @__PURE__ */ jsxs14(Fragment6, { children: [
    /* @__PURE__ */ jsx18(
      DetailHeader,
      {
        title: concept.name,
        tag: `\xAB${concept.stereotype || "unspecified"}\xBB`,
        stereotype: concept.stereotype,
        status: concept.status,
        description: concept.description
      }
    ),
    /* @__PURE__ */ jsx18(
      SourceEvidence,
      {
        evidence: concept.evidence,
        primary: concept.primarySource,
        sources: model.sources,
        snippets
      }
    ),
    (!model.document || model.document.profile === "ontouml") && /* @__PURE__ */ jsx18(ElementLearning, { element: concept, model }),
    model.document?.profile === "database" && /* @__PURE__ */ jsx18(CapturedSchema, { element: concept }),
    /* @__PURE__ */ jsx18(CaptureDetails, { model }),
    /* @__PURE__ */ jsx18(ChangeDetails, { element: concept, model }),
    model.document?.profile === "code" && /* @__PURE__ */ jsxs14(Fragment6, { children: [
      concept.definition && /* @__PURE__ */ jsxs14("details", { className: "concept-fields", children: [
        /* @__PURE__ */ jsx18("summary", { children: "Definition" }),
        /* @__PURE__ */ jsx18("pre", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }, children: /* @__PURE__ */ jsx18("code", { children: concept.definition }) })
      ] }),
      concept.methods?.length > 0 && /* @__PURE__ */ jsxs14("details", { className: "concept-fields", children: [
        /* @__PURE__ */ jsx18("summary", { children: "Methods" }),
        concept.methods.map((method) => /* @__PURE__ */ jsxs14("p", { children: [
          method.modifiers?.join(" "),
          " ",
          method.type
        ] }, method.id))
      ] })
    ] }),
    concept.attributes.length > 0 && model.document?.profile !== "database" && /* @__PURE__ */ jsxs14("details", { className: "concept-fields", children: [
      /* @__PURE__ */ jsx18("summary", { children: "Fields" }),
      concept.attributes.map(
        ({ name, type, multiplicity: cardinality }, i) => /* @__PURE__ */ jsxs14("div", { className: "field-row", children: [
          /* @__PURE__ */ jsx18("span", { children: name }),
          /* @__PURE__ */ jsxs14("span", { children: [
            type,
            cardinality ? ` [${cardinality}]` : ""
          ] })
        ] }, i)
      )
    ] })
  ] });
});
var RelationDetails = memo5(function RelationDetails2({
  relation,
  onChoose,
  model,
  snippets
}) {
  return /* @__PURE__ */ jsxs14(Fragment6, { children: [
    /* @__PURE__ */ jsx18(
      DetailHeader,
      {
        title: relation.type === "generalization" ? relation.realization ? "Implementation" : "Inheritance" : relation.name,
        icon: GitBranchIcon,
        tag: relation.type === "generalization" ? "Generalization" : relation.stereotype ? `\xAB${relation.stereotype}\xBB` : "Association",
        stereotype: relation.stereotype
      }
    ),
    /* @__PURE__ */ jsx18("div", { className: "relation-ends", children: [
      [relation.source, relation.sourceMultiplicity],
      [relation.target, relation.targetMultiplicity]
    ].map(([node, count], i) => /* @__PURE__ */ jsxs14("div", { className: "relation-end", children: [
      /* @__PURE__ */ jsx18("button", { onClick: () => onChoose(node.id), children: node.name }),
      count && /* @__PURE__ */ jsx18("span", { className: "count-badge", children: count })
    ] }, i)) }),
    /* @__PURE__ */ jsx18(ChangeDetails, { element: relation, model }),
    (!model.document || model.document.profile === "ontouml") && /* @__PURE__ */ jsx18(ElementLearning, { element: relation, model, relation: true }),
    model.document?.profile === "database" && /* @__PURE__ */ jsx18(CapturedSchema, { element: relation }),
    relation.type === "generalization" && (model.partitions || []).filter((set) => set.generalizations.includes(relation.id)).map((set) => /* @__PURE__ */ jsxs14("div", { className: "generalization-set-summary", children: [
      /* @__PURE__ */ jsx18("h2", { children: set.name }),
      /* @__PURE__ */ jsx18("p", { children: `{${set.complete ? "complete" : "incomplete"}, ${set.disjoint ? "disjoint" : "overlapping"}}` })
    ] }, set.id)),
    /* @__PURE__ */ jsx18(
      SourceEvidence,
      {
        evidence: relation.evidence?.length ? relation.evidence : [...relation.source.evidence, ...relation.target.evidence],
        sources: model.sources,
        snippets,
        label: relation.evidence?.length ? "Source" : "Endpoint evidence"
      }
    )
  ] });
});
var GeneralizationSetDetails = memo5(function GeneralizationSetDetails2({
  group,
  onChoose,
  model,
  snippets
}) {
  const declared = group.type === "generalizationSet";
  return /* @__PURE__ */ jsxs14(Fragment6, { children: [
    /* @__PURE__ */ jsx18(
      DetailHeader,
      {
        title: group.name,
        tag: declared ? "Generalization set" : "Joined inheritance",
        icon: GitBranchIcon,
        description: group.description
      }
    ),
    /* @__PURE__ */ jsxs14("div", { className: "relation-ends", children: [
      /* @__PURE__ */ jsx18("h2", { children: "Supertype" }),
      /* @__PURE__ */ jsx18("div", { className: "relation-end", children: /* @__PURE__ */ jsx18("button", { onClick: () => onChoose(group.target.id), children: group.target.name }) }),
      /* @__PURE__ */ jsx18("h2", { children: "Subtypes" }),
      group.sources.map((node) => /* @__PURE__ */ jsx18("div", { className: "relation-end", children: /* @__PURE__ */ jsx18("button", { onClick: () => onChoose(node.id), children: node.name }) }, node.id))
    ] }),
    declared ? /* @__PURE__ */ jsxs14(Fragment6, { children: [
      /* @__PURE__ */ jsx18("p", { className: "set-constraints", children: `{${group.complete ? "complete" : "incomplete"}, ${group.disjoint ? "disjoint" : "overlapping"}}` }),
      /* @__PURE__ */ jsxs14("details", { className: "learn-concept", children: [
        /* @__PURE__ */ jsx18("summary", { children: "Read these constraints" }),
        /* @__PURE__ */ jsx18("p", { children: group.complete ? "Every instance of the supertype belongs to at least one subtype in this set." : "Instances of the supertype may belong to none of the subtypes in this set." }),
        /* @__PURE__ */ jsx18("p", { children: group.disjoint ? "An instance cannot belong to two subtypes in this set at the same time." : "An instance may belong to more than one subtype in this set at the same time." })
      ] }),
      group.memberIds.length < group.totalMembers && /* @__PURE__ */ jsxs14("p", { className: "muted", children: [
        group.memberIds.length,
        " of ",
        group.totalMembers,
        " members are shown. These constraints apply to the full set."
      ] }),
      /* @__PURE__ */ jsx18(ElementLearning, { element: group, model, relation: true })
    ] }) : /* @__PURE__ */ jsxs14("details", { className: "learn-concept", children: [
      /* @__PURE__ */ jsx18("summary", { children: "Read joined inheritance" }),
      /* @__PURE__ */ jsx18("p", { className: "muted", children: "These inheritance branches share a supertype. Joining their lines does not assert completeness or disjointness. Declare a generalization set in the model to express those constraints." })
    ] }),
    /* @__PURE__ */ jsx18(
      SourceEvidence,
      {
        evidence: group.evidence,
        primary: group.primarySource,
        sources: model.sources,
        snippets
      }
    )
  ] });
});
function CaptureDetails({ model }) {
  const document2 = model.document;
  const snapshot = document2?.snapshots.find(
    (s) => s.id === document2.baselineId
  );
  if (!snapshot) return null;
  const capture = snapshot.capture;
  return /* @__PURE__ */ jsxs14("details", { className: "concept-fields", children: [
    /* @__PURE__ */ jsxs14("summary", { children: [
      "Capture \xB7 ",
      capture.coverage.status,
      document2.imported ? " \xB7 imported claims" : ""
    ] }),
    /* @__PURE__ */ jsx18("p", { children: capture.capturedAt }),
    /* @__PURE__ */ jsxs14("p", { children: [
      capture.source.kind,
      " \xB7 ",
      capture.source.identity
    ] }),
    /* @__PURE__ */ jsx18("p", { children: printable(capture.consistency?.kind) }),
    (capture.coverage.diagnostics || []).map((d, i) => /* @__PURE__ */ jsx18("p", { children: printable(d.message ?? d) }, i)),
    [].concat(capture.limitations || []).map((text, i) => /* @__PURE__ */ jsx18("p", { className: "muted", children: printable(text) }, i))
  ] });
}
function CapturedSchema({ element }) {
  return /* @__PURE__ */ jsxs14(Fragment6, { children: [
    element.attributes?.length > 0 && /* @__PURE__ */ jsxs14("details", { className: "concept-fields", open: true, children: [
      /* @__PURE__ */ jsx18("summary", { children: "Columns" }),
      element.attributes.map((column) => /* @__PURE__ */ jsxs14("div", { className: "field-row", children: [
        /* @__PURE__ */ jsxs14("span", { children: [
          column.name,
          /* @__PURE__ */ jsxs14("small", { children: [
            column.primaryKeyOrder ? ` \xB7 PK ${column.primaryKeyOrder}` : "",
            column.generated ? " \xB7 generated" : ""
          ] })
        ] }),
        /* @__PURE__ */ jsxs14("span", { children: [
          column.type,
          " \xB7 ",
          column.nullable ? "nullable" : "required",
          column.default !== null && column.default !== void 0 ? ` \xB7 default ${column.default}` : ""
        ] })
      ] }, column.id))
    ] }),
    element.keys?.length > 0 && /* @__PURE__ */ jsxs14("details", { className: "concept-fields", children: [
      /* @__PURE__ */ jsx18("summary", { children: "Keys" }),
      element.keys.map((key) => /* @__PURE__ */ jsxs14("p", { children: [
        key.primary ? "Primary" : "Unique",
        " \xB7 ",
        key.columns.join(", ")
      ] }, key.name))
    ] }),
    [
      element.definition,
      ...(element.constraints || []).map((c) => c.definition),
      ...(element.indexes || []).map((i) => i.definition),
      ...(element.triggers || []).map((t) => t.definition || t.sql)
    ].filter(Boolean).length > 0 && /* @__PURE__ */ jsxs14("details", { className: "concept-fields", children: [
      /* @__PURE__ */ jsx18("summary", { children: "Captured SQL" }),
      [
        element.definition,
        ...(element.constraints || []).map((c) => c.definition),
        ...(element.indexes || []).map((i) => i.definition),
        ...(element.triggers || []).map((t) => t.definition || t.sql)
      ].filter(Boolean).map((sql, i) => /* @__PURE__ */ jsx18(
        "pre",
        {
          style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
          children: /* @__PURE__ */ jsx18("code", { children: sql })
        },
        i
      ))
    ] })
  ] });
}
function About({ model, exports }) {
  return /* @__PURE__ */ jsxs14(Fragment6, { children: [
    /* @__PURE__ */ jsx18("h1", { children: model.title }),
    /* @__PURE__ */ jsx18("p", { children: "Scroll or pinch to zoom \xB7 Drag to pan" }),
    /* @__PURE__ */ jsxs14("p", { children: [
      /* @__PURE__ */ jsx18("kbd", { children: "+" }),
      " / ",
      /* @__PURE__ */ jsx18("kbd", { children: "\u2212" }),
      " zoom \xB7 ",
      /* @__PURE__ */ jsx18("kbd", { children: "0" }),
      " fit \xB7 ",
      /* @__PURE__ */ jsx18("kbd", { children: "Esc" }),
      " ",
      "clear"
    ] }),
    /* @__PURE__ */ jsx18("p", { className: "muted", children: model.status }),
    /* @__PURE__ */ jsx18(
      DownloadLink,
      {
        data: exports.readText(`${exports.slug}-model-notes.txt`),
        filename: `${exports.slug}-model-notes.txt`,
        children: "Source notes \u2193"
      }
    ),
    /* @__PURE__ */ jsx18(
      DownloadLink,
      {
        data: exports.readText(`${exports.slug}-validation.json`),
        filename: `${exports.slug}-validation.json`,
        type: "application/json",
        children: "Validation report \u2193"
      }
    )
  ] });
}

// src/viewer/useInspection.js
import {
  useCallback as useCallback2,
  useEffect as useEffect6,
  useLayoutEffect as useLayoutEffect7,
  useMemo as useMemo6,
  useState as useState9
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
  const [hovered, setHovered] = useState9(null);
  const [preview, setPreview] = useState9(null);
  const controller = useMemo6(
    () => createInspectionController({
      onHover: (target) => setHovered((old) => sameTarget(old, target) ? old : target),
      // An open inspector follows the same input commit as its highlight.
      // Memoized details/code avoid rebuilding unchanged source content.
      onPreview: (target) => setPreview((old) => sameTarget(old, target) ? old : target)
    }),
    [createInspectionController]
  );
  useLayoutEffect7(() => {
    controller.configure({ previewEnabled, previewVisible });
  }, [controller, previewEnabled, previewVisible]);
  useEffect6(() => () => controller.dispose(), [controller]);
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

// src/viewer/CaptureStamp.jsx
import { jsxs as jsxs15 } from "react/jsx-runtime";
function CaptureStamp({ model }) {
  const meta = model.document;
  if (!meta) return null;
  const snapshot = meta.snapshots.find((s) => s.id === meta.baselineId);
  return /* @__PURE__ */ jsxs15(
    "span",
    {
      className: "atlas-capture",
      title: snapshot ? `${snapshot.capture.source.kind}: ${snapshot.capture.source.identity}
${snapshot.capture.coverage.status} coverage; ${meta.imported ? "imported claims" : "retained capture"}` : `Revision ${meta.revision.id}`,
      children: [
        meta.profile,
        " \xB7 ",
        meta.state,
        " \xB7",
        " ",
        snapshot ? snapshot.capture.capturedAt : meta.revision.createdAt,
        snapshot ? ` \xB7 ${snapshot.capture.coverage.status}` : "",
        meta.imported ? " \xB7 imported" : ""
      ]
    }
  );
}

// src/viewer/ComparisonViewer.jsx
import { useState as useState10 } from "react";
import { jsx as jsx19, jsxs as jsxs16 } from "react/jsx-runtime";
var modes = [
  { key: "baseline", label: "Baseline" },
  { key: "proposed", label: "Proposed" },
  { key: "changes", label: "Changes" }
];
var readable = (value) => typeof value === "string" ? value : JSON.stringify(value);
function ComparisonViewer({ payload, theme = "dark", render }) {
  const [mode, setMode] = useState10("proposed"), [focus, setFocus] = useState10(null);
  const comparison = payload.comparison;
  const active = mode === "baseline" ? comparison.baseline : mode === "changes" ? comparison.changeView : payload;
  const selected = { ...payload, ...active, comparison: void 0 };
  const inspectTarget = (change) => {
    const model = comparison.changeView?.model || payload.model;
    const node = model.classes.find(
      (n) => n.id === change.elementId || n.id === change.ownerId
    );
    if (node) return { kind: "node", id: node.id };
    if ([...model.relations, ...model.generalizations].some(
      (e) => e.id === change.elementId
    ))
      return { kind: "edge", id: change.elementId };
    return null;
  };
  return /* @__PURE__ */ jsxs16("div", { className: "atlas-panel atlas-comparison", "data-theme": theme, children: [
    /* @__PURE__ */ jsxs16("header", { className: "comparison-bar", children: [
      /* @__PURE__ */ jsx19(Tabs, { items: modes, value: mode, onChange: setMode }),
      /* @__PURE__ */ jsx19("span", { className: "spacer" }),
      /* @__PURE__ */ jsxs16("details", { className: "comparison-summary", children: [
        /* @__PURE__ */ jsxs16("summary", { "aria-label": "Inspect changes", children: [
          "+",
          comparison.changes.counts.added,
          " \u2212",
          comparison.changes.counts.removed,
          " \u0394",
          comparison.changes.counts.modified,
          comparison.conflicts.length ? ` \xB7 ${comparison.conflicts.length} conflicts` : ""
        ] }),
        /* @__PURE__ */ jsxs16("div", { className: "comparison-list", "aria-label": "Semantic changes", children: [
          comparison.conflicts.map((c) => /* @__PURE__ */ jsxs16("details", { children: [
            /* @__PURE__ */ jsxs16("summary", { children: [
              "Conflict \xB7 ",
              c.path.join(" / ") || "references"
            ] }),
            /* @__PURE__ */ jsx19("p", { children: c.reason }),
            ["base", "left", "right"].map((side) => /* @__PURE__ */ jsxs16("details", { children: [
              /* @__PURE__ */ jsx19("summary", { children: side }),
              /* @__PURE__ */ jsx19("pre", { children: c[side].present ? JSON.stringify(c[side].value, null, 2) : "Deleted" })
            ] }, side))
          ] }, c.id)),
          comparison.changes.changes.map((c) => /* @__PURE__ */ jsxs16("details", { children: [
            /* @__PURE__ */ jsxs16("summary", { children: [
              c.kind,
              " \xB7 ",
              readable(c.name)
            ] }),
            inspectTarget(c) && /* @__PURE__ */ jsx19(
              "button",
              {
                onClick: () => {
                  setMode("changes");
                  setFocus(inspectTarget(c));
                },
                children: "Inspect"
              }
            ),
            c.properties.map((p) => /* @__PURE__ */ jsxs16("div", { children: [
              /* @__PURE__ */ jsx19("strong", { children: p.key }),
              /* @__PURE__ */ jsxs16("pre", { children: [
                p.before.present ? readable(p.before.value) : "Absent",
                " \u2192",
                " ",
                p.after.present ? readable(p.after.value) : "Absent"
              ] })
            ] }, p.key)),
            c.rationale.length ? c.rationale.map((r) => /* @__PURE__ */ jsx19("p", { children: r.text }, r.id)) : /* @__PURE__ */ jsx19("p", { className: "muted", children: "No linked planning rationale." })
          ] }, c.id)),
          !comparison.changes.changes.length && /* @__PURE__ */ jsx19("p", { children: "No semantic changes." })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx19("div", { className: "comparison-content", children: render(selected, focus) })
  ] });
}

// src/viewer/ReportViewer.jsx
import { useState as useState11 } from "react";

// src/learning/ModelReport.jsx
import { jsx as jsx20, jsxs as jsxs17 } from "react/jsx-runtime";
var inspectKind = (model, id) => model.classes.some((n) => n.id === id) ? "node" : model.partitions.some((s) => s.id === id) ? "group" : "edge";
function ModelReport({
  report,
  model,
  snippets,
  onInspect,
  onReference
}) {
  const names = new Map(
    [
      ...model.classes,
      ...model.relations,
      ...model.generalizations,
      ...model.partitions
    ].map((e) => [e.id, e.name || "Inheritance"])
  );
  const show = (id) => /* @__PURE__ */ jsx20(
    "button",
    {
      className: "report-reference",
      onClick: () => onInspect({ kind: inspectKind(model, id), id }),
      children: names.get(id) || id
    }
  );
  const context = (ids = []) => report.context.records.filter((r) => ids.includes(r.id)).map((r) => /* @__PURE__ */ jsxs17("blockquote", { children: [
    /* @__PURE__ */ jsx20("strong", { children: r.title || r.kind }),
    /* @__PURE__ */ jsx20("p", { children: r.text }),
    onReference && r.path && /* @__PURE__ */ jsx20("button", { onClick: () => onReference(r), children: "Open planning passage" })
  ] }, r.id));
  return /* @__PURE__ */ jsxs17("article", { className: "model-report", "aria-label": "Model report", children: [
    /* @__PURE__ */ jsxs17("header", { children: [
      /* @__PURE__ */ jsxs17("p", { className: "muted", children: [
        "Atlas \xB7 ",
        report.profile,
        " \xB7 ",
        report.state
      ] }),
      /* @__PURE__ */ jsx20("h1", { children: report.title }),
      /* @__PURE__ */ jsx20("p", { children: report.scope }),
      report.author && /* @__PURE__ */ jsx20("p", { children: report.author }),
      report.revision && /* @__PURE__ */ jsxs17("p", { className: "report-revision", children: [
        "Revision ",
        report.revision.id,
        /* @__PURE__ */ jsx20("br", {}),
        report.revision.createdAt
      ] }),
      /* @__PURE__ */ jsx20("button", { className: "report-print", onClick: () => window.print(), children: "Print / save PDF" })
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Source and scope" }),
      report.imported && /* @__PURE__ */ jsx20("p", { children: "Imported capture claims are preserved; the source has not been reverified." }),
      report.snapshots.length ? report.snapshots.map((s) => /* @__PURE__ */ jsxs17("details", { open: true, children: [
        /* @__PURE__ */ jsxs17("summary", { children: [
          s.id === report.baselineId ? "Baseline" : "Retained capture",
          " \xB7",
          " ",
          s.capture.source.identity
        ] }),
        /* @__PURE__ */ jsxs17("p", { children: [
          s.capture.capturedAt,
          " \xB7 ",
          s.capture.adapter.id,
          " ",
          s.capture.adapter.version,
          " \xB7 ",
          s.capture.coverage.status
        ] }),
        /* @__PURE__ */ jsx20("p", { children: s.capture.source.scope.join(", ") }),
        /* @__PURE__ */ jsx20("pre", { children: printable(s.capture.source.revision || s.integrity) }),
        /* @__PURE__ */ jsx20("p", { children: printable(s.capture.consistency?.kind) }),
        s.capture.coverage.diagnostics.map((d, i) => /* @__PURE__ */ jsx20("p", { children: printable(d.message ?? d) }, i)),
        [].concat(s.capture.limitations || []).map((t, i) => /* @__PURE__ */ jsx20("p", { children: printable(t) }, i))
      ] }, s.id)) : /* @__PURE__ */ jsx20("p", { children: "Authored model. Evidence supports interpretations within its stated limits." })
    ] }),
    report.walkthroughs.length > 0 && /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Walkthroughs" }),
      report.walkthroughs.map((w) => /* @__PURE__ */ jsxs17("div", { children: [
        /* @__PURE__ */ jsx20("h3", { children: w.title }),
        context(w.contextIds),
        /* @__PURE__ */ jsx20("ol", { children: w.steps.map((step, i) => /* @__PURE__ */ jsxs17("li", { children: [
          /* @__PURE__ */ jsx20("p", { children: step.text }),
          step.viewKey && /* @__PURE__ */ jsx20(
            "button",
            {
              onClick: () => onInspect({ kind: "view", id: step.viewKey }),
              children: "Open view"
            }
          ),
          /* @__PURE__ */ jsx20("div", { children: step.elementIds.map((id) => /* @__PURE__ */ jsxs17("span", { children: [
            show(id),
            " "
          ] }, id)) })
        ] }, i)) })
      ] }, w.id))
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Guided views" }),
      report.diagrams.map((d) => /* @__PURE__ */ jsxs17("figure", { children: [
        /* @__PURE__ */ jsx20("figcaption", { children: d.title }),
        /* @__PURE__ */ jsx20(
          "img",
          {
            src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`,
            alt: `${d.title}: UML diagram with members and relation counts`
          }
        ),
        /* @__PURE__ */ jsx20(
          "a",
          {
            href: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}`,
            download: `${d.key}.svg`,
            children: "SVG"
          }
        )
      ] }, d.key))
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Reading the model" }),
      report.explanations.map((e, i) => /* @__PURE__ */ jsxs17("p", { children: [
        show(e.elementId),
        " \xB7 ",
        e.text,
        !e.assessed && " Unestablished participation."
      ] }, i))
    ] }),
    report.scenarios.length > 0 && /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Instances and counterexamples" }),
      report.scenarios.map((s) => /* @__PURE__ */ jsxs17("div", { className: "report-scenario", children: [
        /* @__PURE__ */ jsx20("h3", { children: s.title }),
        /* @__PURE__ */ jsx20("p", { children: s.description }),
        /* @__PURE__ */ jsxs17("p", { children: [
          "Expected ",
          s.expected,
          " \xB7 assessed ",
          s.result.outcome,
          s.result.expectationMet === null ? " \xB7 incomplete coverage" : s.result.expectationMet ? " \xB7 expectation met" : " \xB7 expectation differs"
        ] }),
        context(s.contextIds),
        /* @__PURE__ */ jsxs17("table", { children: [
          /* @__PURE__ */ jsx20("thead", { children: /* @__PURE__ */ jsxs17("tr", { children: [
            /* @__PURE__ */ jsx20("th", { children: "Instance" }),
            /* @__PURE__ */ jsx20("th", { children: "Memberships" })
          ] }) }),
          /* @__PURE__ */ jsx20("tbody", { children: s.instances.map((i) => /* @__PURE__ */ jsxs17("tr", { children: [
            /* @__PURE__ */ jsx20("td", { children: i.label || i.id }),
            /* @__PURE__ */ jsx20("td", { children: i.classIds.map((id) => /* @__PURE__ */ jsxs17("span", { children: [
              show(id),
              " "
            ] }, id)) })
          ] }, i.id)) })
        ] }),
        s.links.map((l, i) => /* @__PURE__ */ jsxs17("p", { children: [
          l.sourceId,
          " \u2192 ",
          show(l.relationId),
          " \u2192 ",
          l.targetId
        ] }, i)),
        s.result.issues.map((finding, i) => /* @__PURE__ */ jsxs17("p", { children: [
          show(finding.elementId),
          " \xB7 ",
          finding.message
        ] }, i)),
        s.result.unassessed.map((u, i) => /* @__PURE__ */ jsx20("p", { className: "muted", children: u.message }, i))
      ] }, s.id))
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Glossary and selected planning context" }),
      report.context.records.map((r) => /* @__PURE__ */ jsxs17("div", { children: [
        /* @__PURE__ */ jsxs17("h3", { children: [
          r.title || r.id,
          " \xB7 ",
          r.kind
        ] }),
        /* @__PURE__ */ jsx20("p", { children: r.text }),
        onReference && r.path && /* @__PURE__ */ jsx20("button", { onClick: () => onReference(r), children: "Open planning passage" })
      ] }, r.id))
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Classification and open questions" }),
      [...model.classes, ...model.relations].filter((e) => e.rationale || e.questions?.length).map((e) => /* @__PURE__ */ jsxs17("div", { children: [
        /* @__PURE__ */ jsx20("h3", { children: show(e.id) }),
        /* @__PURE__ */ jsx20("p", { children: printable(e.rationale) }),
        [].concat(e.questions || []).map((q, i) => /* @__PURE__ */ jsxs17("div", { children: [
          /* @__PURE__ */ jsx20("strong", { children: printable(q?.question ?? q) }),
          /* @__PURE__ */ jsx20("p", { children: printable(q?.why) }),
          /* @__PURE__ */ jsx20("p", { children: printable(q?.resolve) })
        ] }, i))
      ] }, e.id))
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Validation and coverage" }),
      /* @__PURE__ */ jsxs17("p", { children: [
        model.validation.counts.error,
        " errors \xB7",
        " ",
        model.validation.counts.warning,
        " warnings \xB7",
        " ",
        model.validation.counts.info,
        " coverage notes"
      ] }),
      model.validation.issues.map((issue, i) => /* @__PURE__ */ jsxs17("p", { children: [
        issue.severity,
        " \xB7 ",
        issue.code,
        " \xB7 ",
        issue.message
      ] }, i)),
      report.limitations.map((l, i) => /* @__PURE__ */ jsx20("p", { children: l }, i))
    ] }),
    /* @__PURE__ */ jsxs17("section", { children: [
      /* @__PURE__ */ jsx20("h2", { children: "Evidence and references" }),
      /* @__PURE__ */ jsx20(
        SourceEvidence,
        {
          evidence: model.sources.map((s) => s.id),
          sources: model.sources,
          snippets
        }
      ),
      /* @__PURE__ */ jsx20("p", { children: /* @__PURE__ */ jsx20(
        "a",
        {
          href: "https://ontouml.readthedocs.io/en/latest/",
          target: "_blank",
          rel: "noopener noreferrer",
          children: "OntoUML specification"
        }
      ) })
    ] })
  ] });
}

// src/viewer/ReportViewer.jsx
import { jsx as jsx21, jsxs as jsxs18 } from "react/jsx-runtime";
function ReportViewer({ payload, theme = "dark", onReference, render }) {
  const [open, setOpen] = useState11(false), [focus, setFocus] = useState11(null);
  return /* @__PURE__ */ jsxs18(
    "div",
    {
      className: `atlas-panel atlas-report-host${open ? " report-open" : ""}`,
      "data-theme": theme,
      children: [
        /* @__PURE__ */ jsx21("div", { className: "report-diagram", hidden: open, children: render({ ...payload, report: void 0 }, focus) }),
        open && /* @__PURE__ */ jsx21(
          ModelReport,
          {
            report: payload.report,
            model: payload.model,
            snippets: payload.snippets,
            onReference,
            onInspect: (target) => {
              setFocus({ ...target });
              setOpen(false);
            }
          }
        ),
        /* @__PURE__ */ jsx21(
          "button",
          {
            className: "report-toggle",
            "aria-label": open ? "Return to diagram" : "Open model report",
            onClick: () => setOpen((v) => !v),
            children: open ? "Diagram" : "Report"
          }
        )
      ]
    }
  );
}

// src/viewer/OntoUMLViewer.jsx
import { jsx as jsx22, jsxs as jsxs19 } from "react/jsx-runtime";
function OntoUMLViewer(props) {
  if (props.report)
    return /* @__PURE__ */ jsx22(
      ReportViewer,
      {
        payload: props,
        render: (payload, focus) => /* @__PURE__ */ jsx22(OntoUMLViewer, { ...payload, focus })
      }
    );
  if (props.comparison)
    return /* @__PURE__ */ jsx22(
      ComparisonViewer,
      {
        payload: props,
        render: (payload, focus) => /* @__PURE__ */ jsx22(OntoUMLViewer, { ...payload, focus })
      }
    );
  if (!props.views.length)
    return /* @__PURE__ */ jsxs19("div", { className: "viewer-error", children: [
      /* @__PURE__ */ jsx22("h1", { children: props.model.title }),
      /* @__PURE__ */ jsx22("p", { children: "No entities in this model." })
    ] });
  return /* @__PURE__ */ jsx22(ViewerContent, { ...props });
}
function ViewerContent({
  model,
  views,
  exports: exportData,
  snippets = {},
  focus = null
}) {
  const exports = useArtifactArchive(exportData);
  const [viewKey, setViewKey] = useState12(views[0].key), [fields, setFields] = useState12(false);
  const [theme, toggleTheme] = useTheme("ontouml-atlas-theme");
  const [selected, setSelected] = useState12(null);
  const [aboutOpen, setAboutOpen] = useState12(false);
  const [learningOpen, setLearningOpen] = useState12(false);
  const [sidebarHidden, setSidebarHidden] = useState12(false);
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled: !sidebarHidden,
    previewVisible: !!selected || learningOpen
  });
  const [focusRequest, setFocusRequest] = useState12(null);
  const zoomStore = useMemo8(createZoomStore, []);
  const cameraRef = useRef7(null);
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo8(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups]
  );
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(
      `${exports.slug}-${view.key}${fields ? "-fields" : ""}.svg`
    ),
    theme
  );
  const inspected = inspectedTarget(preview, selected);
  const element = index.getElement(inspected);
  const sidebarOpen = !sidebarHidden && (!!element || learningOpen);
  const select = useCallback3(
    (target) => {
      clearHover();
      setSelected((old) => sameTarget(old, target) ? old : target);
      setAboutOpen(false);
      setLearningOpen(false);
    },
    [clearHover]
  );
  const clear = useCallback3(() => {
    setSelected(null);
    setAboutOpen(false);
    setLearningOpen(false);
    clearHover();
  }, [clearHover]);
  useEffect7(() => {
    setSelected(null);
    setFocusRequest(null);
    setViewKey(views[0].key);
    clearHover();
  }, [model.id, clearHover]);
  const onHover = useCallback3(
    (target) => {
      if (target) setLearningOpen(false);
      hover(target);
    },
    [hover]
  );
  useEffect7(() => {
    const escape = (e) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
  const choose = useCallback3(
    (id) => {
      const next = inspectionTarget(model, index, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      if (next.nodeId) setFocusRequest({ id: next.nodeId });
    },
    [index, model, views, viewKey, select]
  );
  const lastExternalFocus = useRef7(null);
  useEffect7(() => {
    if (focus && focus !== lastExternalFocus.current) {
      lastExternalFocus.current = focus;
      if (focus.kind === "view" && views.some((v) => v.key === focus.id))
        setViewKey(focus.id);
      else choose(focus.id);
    }
  }, [focus, choose, views]);
  useEffect7(() => {
    if (selected && !index.getElement(selected)) select(null);
  }, [index, selected, select]);
  return /* @__PURE__ */ jsxs19("div", { className: `viewer${sidebarOpen ? " inspecting" : ""}`, children: [
    /* @__PURE__ */ jsx22(
      ViewerToolbar,
      {
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
        onTheme: toggleTheme,
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
    /* @__PURE__ */ jsx22(
      DiagramCanvas,
      {
        ref: cameraRef,
        ...{ diagram, selected, hovered, focusRequest, backgroundURL },
        onSelect: select,
        onZoom: zoomStore.set,
        onHover,
        onClearHover: clearHover
      }
    ),
    /* @__PURE__ */ jsx22(CaptureStamp, { model }),
    /* @__PURE__ */ jsxs19(
      Panel,
      {
        id: "inspector",
        className: "inspector",
        open: sidebarOpen,
        label: learningOpen ? "OntoUML learning library" : "Model details",
        title: null,
        closeLabel: "Hide sidebar",
        onClose: () => setSidebarHidden(true),
        onPointerEnter: keepHover,
        onPointerLeave: () => hover(null),
        onFocusCapture: keepHover,
        onBlurCapture: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
        },
        children: [
          sidebarOpen && learningOpen && /* @__PURE__ */ jsx22(
            LearningLibrary,
            {
              model,
              onInspect: (id) => {
                if (index.nodes.has(id)) choose(id);
                else {
                  const groupView = views.find(
                    (v) => v.diagram.generalizationGroups?.some((g) => g.id === id)
                  );
                  if (groupView) {
                    setViewKey(groupView.key);
                    select({ kind: "group", id });
                    return;
                  }
                  const edge = index.edges.get(id);
                  const next = views.find(
                    (v) => v.diagram.edges.some((e) => e.id === id)
                  );
                  if (edge && next) {
                    setViewKey(next.key);
                    select({ kind: "edge", id });
                  }
                }
              }
            }
          ),
          sidebarOpen && !learningOpen && element && inspected.kind === "node" && /* @__PURE__ */ jsx22(
            ConceptDetails,
            {
              concept: element,
              model,
              snippets
            }
          ),
          sidebarOpen && !learningOpen && element && inspected.kind === "edge" && /* @__PURE__ */ jsx22(
            RelationDetails,
            {
              relation: element,
              onChoose: choose,
              model,
              snippets
            }
          ),
          sidebarOpen && !learningOpen && element && inspected.kind === "group" && /* @__PURE__ */ jsx22(
            GeneralizationSetDetails,
            {
              group: element,
              model,
              snippets,
              onChoose: choose
            }
          )
        ]
      }
    ),
    /* @__PURE__ */ jsx22(
      Panel,
      {
        id: "about-panel",
        className: "about-panel",
        label: "About and controls",
        open: aboutOpen,
        onClose: () => setAboutOpen(false),
        children: /* @__PURE__ */ jsx22(About, { model, exports })
      }
    )
  ] });
}

// src/viewer/AtlasPanel.jsx
import {
  useCallback as useCallback4,
  useEffect as useEffect8,
  useId as useId2,
  useMemo as useMemo9,
  useRef as useRef8,
  useState as useState13
} from "react";
import { jsx as jsx23, jsxs as jsxs20 } from "react/jsx-runtime";
function AtlasPanel(props) {
  if (props.payload.report)
    return /* @__PURE__ */ jsx23(
      ReportViewer,
      {
        payload: props.payload,
        theme: props.theme,
        onReference: props.onReference,
        render: (payload, focus) => /* @__PURE__ */ jsx23(
          AtlasPanel,
          {
            ...props,
            payload,
            focus: focus || props.focus
          }
        )
      }
    );
  if (props.payload.comparison)
    return /* @__PURE__ */ jsx23(
      ComparisonViewer,
      {
        payload: props.payload,
        theme: props.theme,
        render: (payload, focus) => /* @__PURE__ */ jsx23(
          AtlasPanel,
          {
            ...props,
            payload,
            focus: focus || props.focus
          }
        )
      }
    );
  if (!props.payload.views.length)
    return /* @__PURE__ */ jsxs20(
      "div",
      {
        className: "atlas-panel atlas-empty",
        "data-theme": props.theme || "dark",
        children: [
          /* @__PURE__ */ jsx23("h3", { children: props.payload.model.title }),
          /* @__PURE__ */ jsx23("p", { children: "No entities in this model." })
        ]
      }
    );
  return /* @__PURE__ */ jsx23(AtlasPanelContent, { ...props });
}
function AtlasPanelContent({
  payload,
  theme = "dark",
  onReference,
  focus = null
}) {
  const { model, views, snippets } = payload;
  const [viewKey, setViewKey] = useState13(views[0].key);
  const [fields, setFields] = useState13(false), [selected, setSelected] = useState13(null);
  const [hidden, setHidden] = useState13(false), [learning, setLearning] = useState13(false);
  const [focusRequest, setFocusRequest] = useState13(null);
  const camera = useRef8(null), zoomStore = useMemo9(createZoomStore, []);
  const lastFocus = useRef8(null), inspectorId = useId2();
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled: !hidden,
    previewVisible: !!selected || learning
  });
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo9(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups]
  );
  const inspected = inspectedTarget(preview, selected), element = index.getElement(inspected);
  const open = !hidden && (!!element || learning);
  const select = useCallback4(
    (target) => {
      clearHover();
      setSelected((old) => sameTarget(old, target) ? old : target);
      setLearning(false);
    },
    [clearHover]
  );
  const choose = useCallback4(
    (id) => {
      const next = inspectionTarget(model, index, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      if (next.nodeId) setFocusRequest({ id: next.nodeId });
    },
    [index, model, views, viewKey, select]
  );
  useEffect8(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [model.id, select]);
  useEffect8(() => {
    const visible = selected?.kind === "node" ? diagram.nodes : selected?.kind === "edge" ? diagram.edges : diagram.generalizationGroups || [];
    if (selected && (!index.getElement(selected) || !visible.some((item) => item.id === selected.id) && !(selected.kind === "edge" && diagram.generalizationGroups?.some(
      (g) => g.memberIds.includes(selected.id)
    ))))
      select(null);
  }, [index, diagram, selected, select]);
  useEffect8(() => {
    if (sameTarget(lastFocus.current, focus)) return;
    lastFocus.current = focus;
    if (!focus) return;
    if (focus.kind === "view" && views.some((v) => v.key === focus.id))
      setViewKey(focus.id);
    else choose(focus.id);
  }, [focus, choose, views]);
  useEffect8(() => {
    const escape = (e) => {
      if (e.key === "Escape" && e.target.closest?.(".atlas-panel"))
        select(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [select]);
  const meta = model.document;
  const context = meta?.context || { records: [], links: [] };
  const contextIds = /* @__PURE__ */ new Set([
    inspected?.id,
    ...inspected?.kind === "node" ? element?.attributes.map((a) => a.id) || [] : []
  ]);
  const linked = context.records.filter(
    (r) => context.links.some(
      (l) => contextIds.has(l.elementId) && l.recordId === r.id
    )
  );
  return /* @__PURE__ */ jsx23("div", { className: "atlas-panel", "data-theme": theme, children: /* @__PURE__ */ jsxs20("div", { className: `viewer${open ? " inspecting" : ""}`, children: [
    /* @__PURE__ */ jsxs20("header", { className: "viewer-toolbar", children: [
      /* @__PURE__ */ jsx23(
        Tabs,
        {
          items: views,
          value: view.key,
          onChange: (key) => {
            setViewKey(key);
            setFocusRequest(null);
            clearHover();
          }
        }
      ),
      /* @__PURE__ */ jsx23("span", { className: "spacer" }),
      /* @__PURE__ */ jsxs20("div", { className: "toolbar-actions", children: [
        /* @__PURE__ */ jsx23(ConceptSearch, { classes: model.classes, onChoose: choose }),
        /* @__PURE__ */ jsx23(
          ToggleButton,
          {
            pressed: fields,
            "aria-label": "Fields",
            title: "Show attributes",
            onClick: () => setFields((v) => !v),
            children: /* @__PURE__ */ jsx23(TableIcon, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsx23(
          CameraControls,
          {
            zoomStore,
            onZoom: (factor) => camera.current?.zoomBy(factor),
            onReset: () => camera.current?.reset(),
            onFit: () => camera.current?.fit()
          }
        ),
        (!meta || meta.profile === "ontouml") && /* @__PURE__ */ jsx23(
          ToggleButton,
          {
            pressed: learning && open,
            "aria-label": "Understand model",
            onClick: () => {
              clearHover();
              setHidden(false);
              setLearning((v) => !v);
            },
            children: /* @__PURE__ */ jsx23(BookIcon, { size: 16 })
          }
        ),
        /* @__PURE__ */ jsx23(
          IconButton,
          {
            label: hidden ? "Show sidebar" : "Hide sidebar",
            "aria-controls": inspectorId,
            "aria-expanded": open,
            onClick: () => setHidden((v) => !v),
            children: hidden ? /* @__PURE__ */ jsx23(SidebarExpandIcon, { size: 16 }) : /* @__PURE__ */ jsx23(SidebarCollapseIcon, { size: 16 })
          }
        )
      ] })
    ] }),
    /* @__PURE__ */ jsx23(
      DiagramCanvas,
      {
        ref: camera,
        diagram,
        selected,
        hovered,
        focusRequest,
        onSelect: select,
        onZoom: zoomStore.set,
        onHover: hover,
        onClearHover: clearHover
      }
    ),
    /* @__PURE__ */ jsx23(CaptureStamp, { model }),
    /* @__PURE__ */ jsxs20(
      Panel,
      {
        id: inspectorId,
        className: "inspector",
        title: null,
        label: "Model details",
        open,
        closeLabel: "Hide sidebar",
        onClose: () => setHidden(true),
        onPointerEnter: keepHover,
        onPointerLeave: () => hover(null),
        children: [
          open && learning && /* @__PURE__ */ jsx23(LearningLibrary, { model, onInspect: choose }),
          open && !learning && element && inspected.kind === "node" && /* @__PURE__ */ jsx23(
            ConceptDetails,
            {
              concept: element,
              model,
              snippets
            }
          ),
          open && !learning && element && inspected.kind === "edge" && /* @__PURE__ */ jsx23(
            RelationDetails,
            {
              relation: element,
              model,
              snippets,
              onChoose: choose
            }
          ),
          open && !learning && element && inspected.kind === "group" && /* @__PURE__ */ jsx23(
            GeneralizationSetDetails,
            {
              group: element,
              model,
              snippets,
              onChoose: choose
            }
          ),
          open && !learning && linked.length > 0 && /* @__PURE__ */ jsx23("section", { className: "atlas-context", "aria-label": "Planning references", children: linked.map((record) => /* @__PURE__ */ jsxs20("details", { children: [
            /* @__PURE__ */ jsx23("summary", { children: record.title || record.kind }),
            /* @__PURE__ */ jsx23("p", { children: record.text }),
            onReference && typeof record.path === "string" && /* @__PURE__ */ jsxs20("button", { onClick: () => onReference(record), children: [
              "Open ",
              record.kind
            ] })
          ] }, record.id)) })
        ]
      }
    )
  ] }) });
}

// src/viewer/ViewerErrorBoundary.jsx
import { Component } from "react";
import { jsx as jsx24, jsxs as jsxs21 } from "react/jsx-runtime";
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
      return /* @__PURE__ */ jsxs21("main", { className: "viewer-error", role: "alert", children: [
        /* @__PURE__ */ jsx24("h1", { children: "The model could not be displayed" }),
        /* @__PURE__ */ jsx24("p", { children: "Rebuild the viewer from the model and check its validation report." }),
        /* @__PURE__ */ jsx24("button", { onClick: () => location.reload(), children: "Reload" })
      ] });
    return this.props.children;
  }
};
export {
  AtlasPanel,
  DiagramCanvas,
  ElementLearning,
  LearningLibrary,
  Lesson,
  OntoUMLViewer,
  UMLDiagram,
  UMLGeneralizationGroup,
  UMLNode,
  UMLRelation,
  ViewerErrorBoundary
};
//# sourceMappingURL=react.mjs.map
