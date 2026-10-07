var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/viewer/OntoUMLViewer.jsx
import { useCallback as useCallback3, useEffect as useEffect6, useMemo as useMemo4, useRef as useRef7, useState as useState10 } from "react";

// src/visualization/DiagramCanvas.jsx
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect as useLayoutEffect2,
  useRef as useRef2,
  useState as useState2
} from "react";

// src/visualization/UMLDiagram.jsx
import { useId, useMemo } from "react";

// src/visualization/interaction.js
var sameTarget = (a, b) => a === b || !!a && !!b && a.kind === b.kind && a.id === b.id;
function readTarget(element) {
  const item = element?.closest?.("[data-element-kind]");
  return item ? { kind: item.dataset.elementKind, id: item.dataset.elementId } : null;
}
function focusedElements(diagram, target) {
  if (!target) return null;
  const nodes = /* @__PURE__ */ new Set();
  const edges = /* @__PURE__ */ new Set();
  const groups = /* @__PURE__ */ new Set();
  if (target.kind === "node") {
    if (!diagram.nodes.some((n) => n.id === target.id)) return null;
    nodes.add(target.id);
    for (const edge of diagram.edges) {
      if (edge.source !== target.id && edge.target !== target.id) continue;
      edges.add(edge.id);
      nodes.add(edge.source);
      nodes.add(edge.target);
    }
  } else if (target.kind === "group") {
    const group = (diagram.generalizationGroups || []).find(
      (g) => g.id === target.id
    );
    if (!group) return null;
    group.memberIds.forEach((id) => edges.add(id));
    group.sourceIds.forEach((id) => nodes.add(id));
    nodes.add(group.target);
  } else {
    const edge = diagram.edges.find((e) => e.id === target.id);
    if (!edge) return null;
    edges.add(edge.id);
    nodes.add(edge.source);
    nodes.add(edge.target);
  }
  for (const group of diagram.generalizationGroups || [])
    if (group.memberIds.some((id) => edges.has(id))) groups.add(group.id);
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
    onPointerLeave: () => handlers.onHover(null),
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
function UMLNode({ node, focus, selected, handlers }) {
  const target = { kind: "node", id: node.id };
  const header = node.attributes.length ? 66 : node.height;
  return /* @__PURE__ */ jsxs(
    "g",
    {
      id: `node-${node.id}`,
      className: elementClass("node", node.id, focus, selected),
      "data-name": node.name,
      "data-node-id": node.id,
      "data-element-kind": "node",
      "data-element-id": node.id,
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
            fill: `var(--node-${node.stereotype},var(--surface,#f6f8fa))`,
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
            fill: `var(--type-${node.stereotype},${typeColors[node.stereotype] || "var(--diagram-muted,#59636e)"})`,
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
        node.attributes.length > 0 && /* @__PURE__ */ jsxs(Fragment, { children: [
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
          )
        ] })
      ]
    }
  );
}

// src/visualization/UMLRelation.jsx
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function relationName(edge) {
  return edge.type === "generalization" ? `${edge.sourceName} inherits ${edge.targetName}` : `${edge.name}: ${edge.sourceName} (${edge.sourceMultiplicity}), ${edge.targetName} (${edge.targetMultiplicity})`;
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
  const aggregationMarker = (kind2) => ["SHARED", "COMPOSITE"].includes(kind2) ? `url(#${markerId}-${kind2}${focus?.edges.has(edge.id) ? "-active" : ""})` : void 0;
  return /* @__PURE__ */ jsxs2(
    "g",
    {
      className: `${elementClass(kind, edge.id, focus, selected)} relation-route${edge.type === "generalization" ? " generalization" : ""}`,
      "data-edge": edge.id,
      "data-element-kind": kind,
      "data-element-id": edge.id,
      "data-source": edge.source,
      "data-target": edge.target,
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
              markerStart: edge.type === "association" ? aggregationMarker(edge.sourceAggregation) : void 0,
              markerEnd: edge.type === "generalization" && !edge.branchPaths ? `url(#${markerId}${highlighted ? "-active" : ""})` : aggregationMarker(edge.targetAggregation)
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
  return `${group.name}: ${group.sourceNames.join(", ")} inherit ${group.targetName}${constraints}`;
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

// src/visualization/UMLDiagram.jsx
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
function UMLDiagram({
  diagram,
  active = null,
  selected = null,
  handlers
}) {
  const markerId = `inheritance-${useId().replaceAll(":", "")}`;
  const focus = useMemo(
    () => focusedElements(diagram, active),
    [diagram, active]
  );
  return /* @__PURE__ */ jsxs3(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: diagram.width,
      height: diagram.height,
      viewBox: `0 0 ${diagram.width} ${diagram.height}`,
      role: handlers ? "group" : "img",
      "aria-label": diagram.title,
      style: {
        fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans,Helvetica,Arial,sans-serif"
      },
      children: [
        /* @__PURE__ */ jsxs3("defs", { children: [
          ["SHARED", "COMPOSITE"].flatMap(
            (aggregation) => [false, true].map((active2) => /* @__PURE__ */ jsx4(
              "marker",
              {
                id: `${markerId}-${aggregation}${active2 ? "-active" : ""}`,
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
                    fill: aggregation === "COMPOSITE" ? active2 ? "var(--accent,#0969da)" : "var(--diagram-edge,#59636e)" : "var(--canvas,#ffffff)",
                    stroke: active2 ? "var(--accent,#0969da)" : "var(--diagram-edge,#59636e)",
                    strokeWidth: "1.4"
                  }
                )
              },
              `${aggregation}-${active2}`
            ))
          ),
          /* @__PURE__ */ jsx4(
            "marker",
            {
              id: markerId,
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
                  stroke: "var(--diagram-inheritance,#59636e)",
                  strokeWidth: "1.4"
                }
              )
            }
          ),
          /* @__PURE__ */ jsx4(
            "marker",
            {
              id: `${markerId}-active`,
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
                  stroke: "var(--accent,#0969da)",
                  strokeWidth: "1.4"
                }
              )
            }
          )
        ] }),
        /* @__PURE__ */ jsxs3("g", { className: "relation-routes", children: [
          (diagram.generalizationGroups || []).map((group) => /* @__PURE__ */ jsx4(
            UMLGeneralizationGroup,
            {
              ...{ group, focus, selected, handlers, markerId }
            },
            group.id
          )),
          diagram.edges.map((edge) => /* @__PURE__ */ jsx4(
            UMLRelation,
            {
              ...{ edge, focus, selected, handlers, markerId }
            },
            edge.id
          ))
        ] }),
        /* @__PURE__ */ jsxs3("g", { className: "relation-label-layer", children: [
          (diagram.generalizationGroups || []).map((group) => /* @__PURE__ */ jsx4(
            UMLGeneralizationGroup,
            {
              labels: true,
              ...{ group, focus, selected, handlers }
            },
            group.id
          )),
          diagram.edges.map((edge) => /* @__PURE__ */ jsx4(
            UMLRelationLabels,
            {
              ...{ edge, focus, selected, handlers }
            },
            edge.id
          ))
        ] }),
        /* @__PURE__ */ jsx4("g", { className: "node-layer", children: diagram.nodes.map((node) => /* @__PURE__ */ jsx4(UMLNode, { ...{ node, focus, selected, handlers } }, node.id)) })
      ]
    }
  );
}

// src/visualization/useDiagramCamera.js
import { useLayoutEffect, useRef, useState } from "react";

// src/visualization/camera.js
var PINCH_WHEEL_SENSITIVITY = 15e-4;
var PINCH_GESTURE_SENSITIVITY = 0.15;
var PINCH_EASING_MS = 80;
var clampScale = (scale) => Math.max(0.08, Math.min(3.5, scale));
function createCamera({ canvasRef, worldRef, onZoom, onTap, onMotion }) {
  let camera = { x: 0, y: 0, scale: 1, fitted: true };
  let activeKey = null;
  let pinchZoom = null;
  let pinchFrame = null;
  let drag = null;
  let moved = false;
  let initialFocus = [];
  const cameras = /* @__PURE__ */ new Map();
  const pointers = /* @__PURE__ */ new Map();
  function cancelPinchZoom() {
    if (pinchFrame !== null) cancelAnimationFrame(pinchFrame);
    pinchFrame = null;
    pinchZoom = null;
  }
  function paint() {
    worldRef.current.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    canvasRef.current.style.backgroundPosition = `${camera.x}px ${camera.y}px`;
    onZoom(Math.round(camera.scale * 100));
  }
  function fit() {
    cancelPinchZoom();
    const b = worldRef.current.querySelector("svg").viewBox.baseVal;
    const w = canvasRef.current.clientWidth;
    const h = canvasRef.current.clientHeight;
    const scale = Math.min((w - 48) / b.width, (h - 48) / b.height, 1.2);
    camera = {
      x: (w - b.width * scale) / 2,
      y: (h - b.height * scale) / 2,
      scale,
      fitted: true
    };
    paint();
  }
  function initialCamera() {
    fit();
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
    camera = {
      scale: 0.7,
      x: canvasRef.current.clientWidth / 2 - x * 0.7,
      y: canvasRef.current.clientHeight / 2 - y * 0.7,
      fitted: false
    };
    paint();
  }
  function applyZoom(scale, x, y) {
    scale = clampScale(scale);
    const ratio = scale / camera.scale;
    camera.x = x - (x - camera.x) * ratio;
    camera.y = y - (y - camera.y) * ratio;
    camera.scale = scale;
    camera.fitted = false;
    paint();
  }
  function zoomTo(scale, x = canvasRef.current.clientWidth / 2, y = canvasRef.current.clientHeight / 2) {
    cancelPinchZoom();
    applyZoom(scale, x, y);
  }
  function animatePinchZoom(time) {
    const zoom = pinchZoom;
    const elapsed = Math.max(0, Math.min(time - zoom.time, 64));
    const gap = Math.log(zoom.scale / camera.scale);
    const finished = Math.abs(gap) < 1e-4;
    zoom.time = time;
    applyZoom(
      finished ? zoom.scale : camera.scale * Math.exp(gap * (1 - Math.exp(-elapsed / PINCH_EASING_MS))),
      zoom.x,
      zoom.y
    );
    if (finished) {
      pinchZoom = null;
      pinchFrame = null;
    } else pinchFrame = requestAnimationFrame(animatePinchZoom);
  }
  function pinchZoomBy(delta, x, y) {
    if (!pinchZoom)
      pinchZoom = { scale: camera.scale, x, y, time: performance.now() };
    pinchZoom.scale = clampScale(pinchZoom.scale * Math.exp(delta));
    pinchZoom.x = x;
    pinchZoom.y = y;
    camera.fitted = false;
    if (pinchFrame === null)
      pinchFrame = requestAnimationFrame(animatePinchZoom);
  }
  function pan(dx, dy) {
    cancelPinchZoom();
    camera.x += dx;
    camera.y += dy;
    camera.fitted = false;
    paint();
  }
  function clearPointers(canvas = canvasRef.current) {
    for (const id of pointers.keys())
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    pointers.clear();
    drag = null;
    canvas.classList.remove("dragging");
  }
  function restoreView(key, fields, focusIds = []) {
    cancelPinchZoom();
    clearPointers();
    if (activeKey) cameras.set(activeKey, { ...camera });
    initialFocus = focusIds;
    activeKey = `${key}:${fields}`;
    if (cameras.has(activeKey)) {
      camera = { ...cameras.get(activeKey) };
      paint();
    } else initialCamera();
  }
  function focusNode(id, rightInset = 0) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    cancelPinchZoom();
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const canvas = canvasRef.current;
    const freeWidth = Math.max(1, canvas.clientWidth - rightInset);
    camera.scale = Math.max(camera.scale, 0.85);
    camera.x = freeWidth / 2 - (m.e + Number(r.getAttribute("width")) / 2) * camera.scale;
    camera.y = canvas.clientHeight / 2 - (m.f + Number(r.getAttribute("height")) / 2) * camera.scale;
    camera.fitted = false;
    paint();
  }
  function revealNode(id) {
    const node = worldRef.current.querySelector(`.node[data-node-id="${id}"]`);
    if (!node) return;
    const m = node.transform.baseVal.consolidate().matrix;
    const r = node.querySelector("rect");
    const canvas = canvasRef.current;
    const left = camera.x + m.e * camera.scale;
    const top = camera.y + m.f * camera.scale;
    const width = Number(r.getAttribute("width")) * camera.scale;
    const height = Number(r.getAttribute("height")) * camera.scale;
    const shift = (start, size, available) => size > available - 48 ? (available - size) / 2 - start : start < 24 ? 24 - start : start + size > available - 24 ? available - 24 - start - size : 0;
    const dx = shift(left, width, canvas.clientWidth);
    const dy = shift(top, height, canvas.clientHeight);
    if (dx || dy) pan(dx, dy);
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
    const cleanup = [];
    const listen = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      cleanup.push(() => target.removeEventListener(type, handler, options));
    };
    const position = (e) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    listen(
      canvas,
      "wheel",
      (e) => {
        e.preventDefault();
        onMotion?.();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1;
        const p = position(e);
        if (e.ctrlKey || e.metaKey)
          pinchZoomBy(-e.deltaY * unit * PINCH_WHEEL_SENSITIVITY, p.x, p.y);
        else pan(-e.deltaX * unit, -e.deltaY * unit);
      },
      { passive: false }
    );
    listen(canvas, "pointerdown", (e) => {
      if (e.button !== 0) return;
      cancelPinchZoom();
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
        pan(g.x - old.x, g.y - old.y);
        if (old.d > 0) zoomTo(camera.scale * g.d / old.d, g.x, g.y);
        drag.moved = true;
        if (!moved) onMotion?.();
        moved = true;
        drag.gesture = g;
      } else if (g) drag.gesture = g;
      else {
        if (Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4)
          drag.moved = true;
        if (drag.moved && !moved) onMotion?.();
        if (drag.moved) moved = true;
        if (drag.moved) pan(p.x - drag.lastX, p.y - drag.lastY);
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
        zoomTo(camera.scale * 1.25);
        e.preventDefault();
      }
      if (e.key === "-") {
        zoomTo(camera.scale / 1.25);
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
        cancelPinchZoom();
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
        paint();
      } else if (camera.fitted) fit();
      else pan((w - width) / 2, (h - height) / 2);
      width = w;
      height = h;
    });
    observer.observe(canvas);
    return () => {
      cleanup.forEach((remove) => remove());
      observer.disconnect();
      cancelPinchZoom();
      clearPointers(canvas);
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
    zoomBy: (factor) => zoomTo(camera.scale * factor)
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
  const callbacks = useRef({ onZoom, onTap, onMotion });
  const [controls] = useState(
    () => createCamera({
      canvasRef,
      worldRef,
      onZoom: (value) => callbacks.current.onZoom(value),
      onTap: (element) => callbacks.current.onTap(element),
      onMotion: () => callbacks.current.onMotion()
    })
  );
  useLayoutEffect(() => {
    callbacks.current = { onZoom, onTap, onMotion };
  }, [onZoom, onTap, onMotion]);
  useLayoutEffect(() => {
    controls.restoreView(diagram.key, diagram.fields, diagram.initialFocus);
  }, [controls, diagram]);
  useLayoutEffect(() => {
    if (focusRequest)
      controls.focusNode(focusRequest.id, focusRequest.rightInset);
  }, [controls, focusRequest]);
  useLayoutEffect(() => controls.attach(), [controls]);
  return controls;
}

// src/visualization/DiagramCanvas.jsx
import { jsx as jsx5 } from "react/jsx-runtime";
var DiagramCanvas = memo(
  forwardRef(function DiagramCanvas2({
    diagram,
    selected,
    hovered,
    focusRequest,
    onSelect,
    onZoom,
    onHover,
    onClearHover
  }, ref) {
    const canvasRef = useRef2(null), worldRef = useRef2(null);
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
      onTap: (element) => {
        const target = readTarget(element);
        if (target) onSelect(target);
      },
      onMotion: clearTransient
    });
    useImperativeHandle(ref, () => controls, [controls]);
    useLayoutEffect2(() => {
      if (selected?.kind === "node") controls.revealNode(selected.id);
    }, [controls, diagram, selected]);
    useLayoutEffect2(clearTransient, [clearTransient, diagram]);
    useLayoutEffect2(clearTransient, [clearTransient, selected]);
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
    return /* @__PURE__ */ jsx5(
      "main",
      {
        ref: canvasRef,
        id: "canvas",
        "aria-label": "Interactive OntoUML diagram",
        onPointerLeave: () => onHover(null),
        children: /* @__PURE__ */ jsx5("div", { ref: worldRef, id: "world", children: /* @__PURE__ */ jsx5(
          UMLDiagram,
          {
            diagram,
            active: hovered || focused || selected,
            selected,
            handlers
          }
        ) })
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
function useSVGExport(svgSource, theme) {
  const [url, setURL] = useState3(void 0);
  useEffect2(() => {
    const svg = new DOMParser().parseFromString(
      svgSource,
      "image/svg+xml"
    ).documentElement;
    const styles = getComputedStyle(document.documentElement);
    for (const name of THEME_VARS)
      svg.style.setProperty(name, styles.getPropertyValue(name).trim());
    svg.querySelectorAll(".selected,.dimmed").forEach((n) => n.classList.remove("selected", "dimmed"));
    const background = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect"
    );
    background.setAttribute("width", svg.viewBox.baseVal.width);
    background.setAttribute("height", svg.viewBox.baseVal.height);
    background.setAttribute("fill", styles.getPropertyValue("--canvas").trim());
    svg.insertBefore(background, svg.firstChild);
    const next = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml"
      })
    );
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [svgSource, theme]);
  return url;
}

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

// src/ui/Panel.jsx
import { jsx as jsx7, jsxs as jsxs4 } from "react/jsx-runtime";
function Panel({
  open,
  onClose,
  label = "Diagram details",
  children,
  id = "panel",
  className = "",
  ...props
}) {
  return /* @__PURE__ */ jsxs4(
    "aside",
    {
      id,
      className: `panel${open ? " open" : ""}${className ? ` ${className}` : ""}`,
      "aria-label": label,
      ...props,
      children: [
        onClose && /* @__PURE__ */ jsx7(
          IconButton,
          {
            className: "panel-close",
            label: "Close details",
            onClick: onClose,
            children: "\xD7"
          }
        ),
        /* @__PURE__ */ jsx7("div", { className: "panel-content", children })
      ]
    }
  );
}

// src/ui/useTheme.js
import { useLayoutEffect as useLayoutEffect3, useState as useState4 } from "react";
function useTheme(storageKey) {
  const [theme, setTheme] = useState4(() => {
    try {
      return localStorage.getItem(storageKey) === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  useLayoutEffect3(() => {
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
import { jsx as jsx9, jsxs as jsxs5 } from "react/jsx-runtime";
function CameraControls({ zoom, onZoom, onReset, onFit }) {
  return /* @__PURE__ */ jsxs5("div", { className: "camera-controls", children: [
    /* @__PURE__ */ jsx9(
      IconButton,
      {
        id: "zoom-out",
        label: "Zoom out",
        title: "Zoom out (\u2212)",
        onClick: () => onZoom(1 / 1.25),
        children: "\u2212"
      }
    ),
    /* @__PURE__ */ jsxs5(
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
    ),
    /* @__PURE__ */ jsx9(
      IconButton,
      {
        id: "zoom-in",
        label: "Zoom in",
        title: "Zoom in (+)",
        onClick: () => onZoom(1.25),
        children: "+"
      }
    ),
    /* @__PURE__ */ jsx9("button", { id: "fit", title: "Fit diagram (0)", onClick: onFit, children: "Fit" })
  ] });
}

// src/ui/ConceptSearch.jsx
import { useLayoutEffect as useLayoutEffect5, useRef as useRef4, useState as useState5 } from "react";

// src/ui/usePopupDismiss.js
import { useEffect as useEffect3, useLayoutEffect as useLayoutEffect4, useRef as useRef3 } from "react";
function usePopupDismiss(onClose, ...roots) {
  const latest = useRef3({ onClose, roots });
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
import { Fragment as Fragment3, jsx as jsx10, jsxs as jsxs6 } from "react/jsx-runtime";
function ConceptSearch({ classes, onChoose }) {
  const [query, setQuery] = useState5("");
  const [open, setOpen] = useState5(false);
  const [showHits, setShowHits] = useState5(false);
  const inputRef = useRef4(null);
  const suggestionsRef = useRef4(null);
  const searchRef = useRef4(null), toggleRef = useRef4(null);
  const q = query.trim().toLowerCase();
  const hits = q ? classes.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12) : [];
  const close = () => {
    setShowHits(false);
    setOpen(false);
  };
  useLayoutEffect5(() => {
    if (open) inputRef.current.focus();
  }, [open]);
  usePopupDismiss(close, searchRef, toggleRef);
  function choose(name) {
    onChoose(name);
    setQuery("");
    close();
    inputRef.current.blur();
  }
  return /* @__PURE__ */ jsxs6(Fragment3, { children: [
    /* @__PURE__ */ jsx10(
      "button",
      {
        ref: toggleRef,
        id: "search-toggle",
        className: "icon",
        "aria-label": "Open concept search",
        title: "Find concept",
        onClick: () => setOpen(!open),
        children: "\u2315"
      }
    ),
    /* @__PURE__ */ jsxs6("div", { ref: searchRef, className: `search${open ? " open" : ""}`, children: [
      /* @__PURE__ */ jsx10(
        "input",
        {
          ref: inputRef,
          id: "search",
          type: "search",
          placeholder: "Find concept\u2026",
          "aria-label": "Find concept",
          autoComplete: "off",
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
}

// src/ui/ExportMenu.jsx
import { useRef as useRef5, useState as useState6 } from "react";
import { jsx as jsx11, jsxs as jsxs7 } from "react/jsx-runtime";
function ExportMenu({ children }) {
  const [open, setOpen] = useState6(false);
  const root = useRef5(null);
  usePopupDismiss(() => setOpen(false), root);
  return /* @__PURE__ */ jsxs7("div", { className: "menu-wrap", ref: root, children: [
    /* @__PURE__ */ jsx11(
      IconButton,
      {
        id: "export",
        label: "Export",
        "aria-expanded": open,
        onClick: () => setOpen(!open),
        children: "\u2193"
      }
    ),
    /* @__PURE__ */ jsx11("div", { id: "export-menu", className: `menu${open ? " open" : ""}`, children })
  ] });
}

// src/ui/useBlobURL.js
import { useEffect as useEffect4, useState as useState7 } from "react";
function useBlobURL(data, type = "text/plain;charset=utf-8") {
  const [url, setURL] = useState7(void 0);
  useEffect4(() => {
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
import { jsx as jsx13, jsxs as jsxs8 } from "react/jsx-runtime";
function ViewerToolbar({
  model,
  views,
  exports,
  viewKey,
  fields,
  theme,
  zoom,
  diagramURL,
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
  return /* @__PURE__ */ jsxs8("header", { children: [
    /* @__PURE__ */ jsx13("span", { className: "brand", title: model.title, children: "OntoUML" }),
    /* @__PURE__ */ jsx13(Tabs, { items: views, value: viewKey, onChange: onView }),
    /* @__PURE__ */ jsx13("span", { className: "spacer" }),
    /* @__PURE__ */ jsx13(
      ConceptSearch,
      {
        classes: model.classes.filter(
          (c) => views.some((v) => v.nodeIds.includes(c.id))
        ),
        onChoose
      }
    ),
    /* @__PURE__ */ jsx13(
      ToggleButton,
      {
        id: "fields",
        className: "fields",
        pressed: fields,
        title: "Show attributes in the diagram",
        onClick: onFields,
        children: "Fields"
      }
    ),
    /* @__PURE__ */ jsx13(CameraControls, { ...{ zoom, onZoom, onReset, onFit } }),
    /* @__PURE__ */ jsx13("span", { className: "divider" }),
    /* @__PURE__ */ jsx13(IconButton, { id: "theme-toggle", label: themeLabel, onClick: onTheme, children: theme === "dark" ? "\u2600" : "\u263E" }),
    /* @__PURE__ */ jsxs8(ExportMenu, { children: [
      /* @__PURE__ */ jsx13(
        "a",
        {
          id: "svg-download",
          href: diagramURL,
          download: `${exports.slug}-${viewKey}${fields ? "-fields" : ""}-${theme}.svg`,
          children: "Diagram \xB7 SVG"
        }
      ),
      /* @__PURE__ */ jsx13(
        DownloadLink,
        {
          id: "puml-download",
          className: "",
          data: exports.readText(`${exports.slug}-${viewKey}.puml`),
          filename: `${exports.slug}-${viewKey}.puml`,
          children: "Diagram \xB7 PlantUML"
        }
      ),
      /* @__PURE__ */ jsx13(
        DownloadLink,
        {
          id: "model-download",
          className: "",
          data: exports.readText(`${exports.slug}-ontouml.json`),
          filename: `${exports.slug}-ontouml.json`,
          type: "application/json",
          children: "Model \xB7 OntoUML JSON"
        }
      ),
      /* @__PURE__ */ jsx13(
        DownloadLink,
        {
          id: "bundle-download",
          className: "",
          data: exports.bundle,
          filename: `${exports.slug}-models.zip`,
          type: "application/zip",
          children: "Models \xB7 ZIP"
        }
      )
    ] }),
    /* @__PURE__ */ jsxs8(
      "button",
      {
        id: "learn-toggle",
        className: "learn-toggle",
        onClick: onLearn,
        "aria-label": `Learn OntoUML; ${model.validation.counts.error} findings`,
        children: [
          "Learn",
          model.validation.counts.error > 0 && /* @__PURE__ */ jsx13("span", { className: "validation-count", children: model.validation.counts.error })
        ]
      }
    ),
    /* @__PURE__ */ jsx13(IconButton, { id: "info", label: "About and controls", onClick: onAbout, children: "\u24D8" })
  ] });
}

// src/ui/CodeSnippet.jsx
import { Fragment as Fragment4 } from "react";
import { jsx as jsx14, jsxs as jsxs9 } from "react/jsx-runtime";
function CodeSnippet({ snippet, label }) {
  return /* @__PURE__ */ jsx14("pre", { className: "shiki code-snippet", tabIndex: 0, "aria-label": label, children: /* @__PURE__ */ jsx14("code", { children: snippet.lines.map((tokens, i) => /* @__PURE__ */ jsxs9(Fragment4, { children: [
    /* @__PURE__ */ jsx14("span", { className: "code-line", "data-line": snippet.startLine + i, children: tokens.map((token, j) => /* @__PURE__ */ jsx14("span", { style: token.style, children: token.content }, j)) }),
    i < snippet.lines.length - 1 ? "\n" : null
  ] }, i)) }) });
}

// src/viewer/SourceEvidence.jsx
import { jsx as jsx15, jsxs as jsxs10 } from "react/jsx-runtime";
function SourceExcerpt({ source, snippet }) {
  if (!snippet)
    return /* @__PURE__ */ jsxs10("div", { className: "source-excerpt", children: [
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
  return /* @__PURE__ */ jsxs10("div", { className: "source-excerpt", children: [
    /* @__PURE__ */ jsxs10("div", { className: "source-path", title: source.file, children: [
      source.file.split("/").pop(),
      " \xB7 ",
      snippet.language
    ] }),
    /* @__PURE__ */ jsx15(
      CodeSnippet,
      {
        snippet,
        label: `${source.title}, lines ${snippet.startLine} to ${snippet.endLine}`
      }
    ),
    snippet.url && /* @__PURE__ */ jsxs10(
      "a",
      {
        className: "source-github",
        href: snippet.url,
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": `View ${source.title} on GitHub`,
        children: [
          snippet.url.startsWith("https://github.com/") ? "View on GitHub" : "View source",
          " ",
          "\u2197"
        ]
      }
    )
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
  return /* @__PURE__ */ jsxs10("section", { className: "source-evidence", "aria-label": label, children: [
    /* @__PURE__ */ jsx15("h2", { children: label }),
    records.map(
      (source, i) => i === 0 ? /* @__PURE__ */ jsx15(
        SourceExcerpt,
        {
          source,
          snippet: snippets[source.id]
        },
        source.id
      ) : /* @__PURE__ */ jsxs10("details", { className: "additional-source", children: [
        /* @__PURE__ */ jsx15("summary", { children: source.title }),
        /* @__PURE__ */ jsx15(SourceExcerpt, { source, snippet: snippets[source.id] })
      ] }, source.id)
    )
  ] });
}

// src/learning/LearningContent.jsx
import { useState as useState8, useMemo as useMemo2 } from "react";

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
function identityProviders(model, id) {
  const found = /* @__PURE__ */ new Set(), pending = [id];
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  while (pending.length) {
    const next = pending.pop();
    if (found.has(next)) continue;
    found.add(next);
    pending.push(
      ...model.generalizations.filter((g) => g.specificId === next).map((g) => g.generalId)
    );
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
import { Fragment as Fragment5, jsx as jsx16, jsxs as jsxs11 } from "react/jsx-runtime";
function Lesson({ stereotype, children }) {
  const lesson = lessonFor(stereotype);
  return /* @__PURE__ */ jsxs11("div", { className: "lesson", children: [
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
  return /* @__PURE__ */ jsxs11("section", { className: "element-learning", "aria-label": "Model guidance", children: [
    issues.filter((i) => i.severity !== "info").map((issue) => /* @__PURE__ */ jsxs11("details", { className: "finding", children: [
      /* @__PURE__ */ jsxs11("summary", { children: [
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
    /* @__PURE__ */ jsxs11("details", { className: "learn-concept", children: [
      /* @__PURE__ */ jsx16("summary", { children: key === "generalizationSet" ? "Understand generalization sets" : `Understand \xAB${key || "unspecified"}\xBB` }),
      /* @__PURE__ */ jsxs11(Lesson, { stereotype: key, children: [
        providers.length > 0 && /* @__PURE__ */ jsxs11("p", { children: [
          "Identity supplied by ",
          providers.map((p) => p.name).join(", "),
          "."
        ] }),
        relation && element.type === "association" && /* @__PURE__ */ jsx16("div", { className: "counts-reading", children: readMultiplicity(element).map((sentence) => /* @__PURE__ */ jsx16("p", { children: sentence }, sentence)) })
      ] })
    ] }),
    element.rationale && element.rationale !== element.description && /* @__PURE__ */ jsxs11("details", { className: "learn-concept", children: [
      /* @__PURE__ */ jsx16("summary", { children: "Why this classification?" }),
      /* @__PURE__ */ jsx16("p", { children: element.rationale })
    ] }),
    (element.questions || []).map((question) => /* @__PURE__ */ jsxs11("details", { className: "learn-concept uncertainty", children: [
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
  const elementNames = useMemo2(
    () => new Map(
      [...model.classes, ...model.relations, ...model.partitions || []].map(
        (e) => [e.id, e.name]
      )
    ),
    [model]
  );
  const renderIssue = (issue, i) => /* @__PURE__ */ jsxs11("div", { className: `validation-issue ${issue.severity}`, children: [
    /* @__PURE__ */ jsx16("span", { className: "tag", children: issue.severity }),
    /* @__PURE__ */ jsx16("p", { children: issue.message }),
    issue.elementId && /* @__PURE__ */ jsxs11(
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
  return /* @__PURE__ */ jsxs11(Fragment5, { children: [
    /* @__PURE__ */ jsx16("span", { className: "tag", children: "OntoUML Atlas" }),
    /* @__PURE__ */ jsx16("h1", { children: "Understand the model" }),
    /* @__PURE__ */ jsxs11("div", { className: "learning-tabs", children: [
      /* @__PURE__ */ jsx16("button", { "aria-pressed": tab === "learn", onClick: () => setTab("learn"), children: "Learn" }),
      /* @__PURE__ */ jsxs11(
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
    tab === "learn" && /* @__PURE__ */ jsxs11(Fragment5, { children: [
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
      /* @__PURE__ */ jsxs11("details", { className: "learn-concept", children: [
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
      ).map(([key, lesson]) => /* @__PURE__ */ jsxs11("details", { className: "learn-concept", children: [
        /* @__PURE__ */ jsx16("summary", { children: key === "generalizationSet" ? lesson.title : `${lesson.title} \xB7 \xAB${key}\xBB` }),
        /* @__PURE__ */ jsx16(Lesson, { stereotype: key })
      ] }, key))
    ] }),
    tab === "checks" && /* @__PURE__ */ jsxs11(Fragment5, { children: [
      /* @__PURE__ */ jsx16("p", { children: model.validation.counts.error ? `${model.validation.counts.error} findings need review.` : "The implemented checks pass." }),
      /* @__PURE__ */ jsx16("p", { className: "muted", children: "Official JSON schema, reference integrity, and a documented subset of ontology rules. Domain accuracy still needs judgment." }),
      visibleIssues.map(renderIssue),
      coverage.length > 0 && /* @__PURE__ */ jsxs11("details", { className: "learn-concept", children: [
        /* @__PURE__ */ jsxs11("summary", { children: [
          "Rule coverage \xB7 ",
          coverage.length,
          " notices"
        ] }),
        coverage.map(renderIssue)
      ] }),
      model.validation.limitations.map((limit) => /* @__PURE__ */ jsx16("p", { className: "muted", children: limit }, limit))
    ] }),
    tab === "questions" && /* @__PURE__ */ jsxs11(Fragment5, { children: [
      model.unknowns.length ? model.unknowns.map((question) => /* @__PURE__ */ jsx16("p", { className: "open-question", children: question }, question)) : /* @__PURE__ */ jsx16("p", { className: "muted", children: "No project-wide questions recorded. Individual concepts may have their own questions." }),
      /* @__PURE__ */ jsx16("p", { className: "muted", children: "Inspect a concept for its evidence, classification rationale, and ways to resolve uncertainty." })
    ] })
  ] });
}

// src/viewer/DetailsContent.jsx
import { Fragment as Fragment6, jsx as jsx17, jsxs as jsxs12 } from "react/jsx-runtime";
function ConceptDetails({ concept, model, snippets }) {
  return /* @__PURE__ */ jsxs12(Fragment6, { children: [
    /* @__PURE__ */ jsxs12("span", { className: "tag", children: [
      "\xAB",
      concept.stereotype || "unspecified",
      "\xBB"
    ] }),
    concept.status && /* @__PURE__ */ jsx17("span", { className: "tag evidence-status", children: concept.status }),
    /* @__PURE__ */ jsx17("h1", { children: concept.name }),
    concept.description && /* @__PURE__ */ jsx17("p", { children: concept.description }),
    /* @__PURE__ */ jsx17(
      SourceEvidence,
      {
        evidence: concept.evidence,
        primary: concept.primarySource,
        sources: model.sources,
        snippets
      }
    ),
    /* @__PURE__ */ jsx17(ElementLearning, { element: concept, model }),
    concept.attributes.length > 0 && /* @__PURE__ */ jsxs12("details", { className: "concept-fields", children: [
      /* @__PURE__ */ jsx17("summary", { children: "Fields" }),
      concept.attributes.map(
        ({ name, type, multiplicity: cardinality }, i) => /* @__PURE__ */ jsxs12("div", { className: "field-row", children: [
          /* @__PURE__ */ jsx17("span", { children: name }),
          /* @__PURE__ */ jsxs12("span", { children: [
            type,
            cardinality ? ` [${cardinality}]` : ""
          ] })
        ] }, i)
      )
    ] })
  ] });
}
function RelationDetails({ relation, onChoose, model, snippets }) {
  return /* @__PURE__ */ jsxs12(Fragment6, { children: [
    /* @__PURE__ */ jsx17("span", { className: "tag", children: relation.type === "generalization" ? "Generalization" : relation.stereotype ? `\xAB${relation.stereotype}\xBB` : "Association" }),
    /* @__PURE__ */ jsx17("h1", { children: relation.type === "generalization" ? "Inheritance" : relation.name }),
    /* @__PURE__ */ jsx17("div", { className: "relation-ends", children: [
      [relation.source, relation.sourceMultiplicity],
      [relation.target, relation.targetMultiplicity]
    ].map(([node, count], i) => /* @__PURE__ */ jsxs12("div", { className: "relation-end", children: [
      /* @__PURE__ */ jsx17("button", { onClick: () => onChoose(node.id), children: node.name }),
      count && /* @__PURE__ */ jsx17("span", { className: "count-badge", children: count })
    ] }, i)) }),
    /* @__PURE__ */ jsx17(ElementLearning, { element: relation, model, relation: true }),
    relation.type === "generalization" && (model.partitions || []).filter((set) => set.generalizations.includes(relation.id)).map((set) => /* @__PURE__ */ jsxs12("div", { className: "generalization-set-summary", children: [
      /* @__PURE__ */ jsx17("h2", { children: set.name }),
      /* @__PURE__ */ jsx17("p", { children: `{${set.complete ? "complete" : "incomplete"}, ${set.disjoint ? "disjoint" : "overlapping"}}` })
    ] }, set.id)),
    /* @__PURE__ */ jsx17(
      SourceEvidence,
      {
        evidence: relation.evidence?.length ? relation.evidence : [...relation.source.evidence, ...relation.target.evidence],
        sources: model.sources,
        snippets,
        label: relation.evidence?.length ? "Source" : "Endpoint evidence"
      }
    )
  ] });
}
function GeneralizationSetDetails({ group, onChoose, model, snippets }) {
  const declared = group.type === "generalizationSet";
  return /* @__PURE__ */ jsxs12(Fragment6, { children: [
    /* @__PURE__ */ jsx17("span", { className: "tag", children: declared ? "Generalization set" : "Joined inheritance" }),
    /* @__PURE__ */ jsx17("h1", { children: group.name }),
    group.description && /* @__PURE__ */ jsx17("p", { children: group.description }),
    /* @__PURE__ */ jsxs12("div", { className: "relation-ends", children: [
      /* @__PURE__ */ jsx17("h2", { children: "Supertype" }),
      /* @__PURE__ */ jsx17("div", { className: "relation-end", children: /* @__PURE__ */ jsx17("button", { onClick: () => onChoose(group.target.id), children: group.target.name }) }),
      /* @__PURE__ */ jsx17("h2", { children: "Subtypes" }),
      group.sources.map((node) => /* @__PURE__ */ jsx17("div", { className: "relation-end", children: /* @__PURE__ */ jsx17("button", { onClick: () => onChoose(node.id), children: node.name }) }, node.id))
    ] }),
    declared ? /* @__PURE__ */ jsxs12(Fragment6, { children: [
      /* @__PURE__ */ jsx17("p", { className: "set-constraints", children: `{${group.complete ? "complete" : "incomplete"}, ${group.disjoint ? "disjoint" : "overlapping"}}` }),
      /* @__PURE__ */ jsx17("p", { children: group.complete ? "Every instance of the supertype belongs to at least one subtype in this set." : "Instances of the supertype may belong to none of the subtypes in this set." }),
      /* @__PURE__ */ jsx17("p", { children: group.disjoint ? "An instance cannot belong to two subtypes in this set at the same time." : "An instance may belong to more than one subtype in this set at the same time." }),
      group.memberIds.length < group.totalMembers && /* @__PURE__ */ jsxs12("p", { className: "muted", children: [
        group.memberIds.length,
        " of ",
        group.totalMembers,
        " members are shown. These constraints apply to the full set."
      ] }),
      /* @__PURE__ */ jsx17(ElementLearning, { element: group, model, relation: true })
    ] }) : /* @__PURE__ */ jsx17("p", { className: "muted", children: "These inheritance branches share a supertype. Joining their lines does not assert completeness or disjointness. Declare a generalization set in the model to express those constraints." }),
    /* @__PURE__ */ jsx17(
      SourceEvidence,
      {
        evidence: group.evidence,
        primary: group.primarySource,
        sources: model.sources,
        snippets
      }
    )
  ] });
}
function About({ model, exports }) {
  return /* @__PURE__ */ jsxs12(Fragment6, { children: [
    /* @__PURE__ */ jsx17("span", { className: "tag", children: "OntoUML Atlas" }),
    /* @__PURE__ */ jsx17("h1", { children: model.title }),
    /* @__PURE__ */ jsx17("p", { children: "Two fingers to pan. Pinch to zoom. Select a concept or relation for evidence and learning help." }),
    /* @__PURE__ */ jsxs12("p", { children: [
      /* @__PURE__ */ jsx17("kbd", { children: "+" }),
      " / ",
      /* @__PURE__ */ jsx17("kbd", { children: "\u2212" }),
      " zoom \xB7 ",
      /* @__PURE__ */ jsx17("kbd", { children: "0" }),
      " fit \xB7 ",
      /* @__PURE__ */ jsx17("kbd", { children: "Esc" }),
      " ",
      "clear"
    ] }),
    /* @__PURE__ */ jsx17("p", { className: "muted", children: model.status }),
    /* @__PURE__ */ jsx17(
      DownloadLink,
      {
        data: exports.readText(`${exports.slug}-model-notes.txt`),
        filename: `${exports.slug}-model-notes.txt`,
        children: "Source notes \u2193"
      }
    ),
    /* @__PURE__ */ jsx17(
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
import { useCallback as useCallback2, useEffect as useEffect5, useRef as useRef6, useState as useState9 } from "react";
var inspectedTarget = (hovered, selected) => hovered || selected;
function useInspection() {
  const [hovered, setHovered] = useState9(null);
  const hoverTimer = useRef6(null);
  const keepHover = useCallback2(() => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  }, []);
  const clearHover = useCallback2(() => {
    keepHover();
    setHovered(null);
  }, [keepHover]);
  const hover = useCallback2(
    (target) => {
      keepHover();
      if (target)
        hoverTimer.current = setTimeout(
          () => setHovered((old) => sameTarget(old, target) ? old : target),
          120
        );
      else hoverTimer.current = setTimeout(clearHover, 200);
    },
    [keepHover, clearHover]
  );
  useEffect5(() => keepHover, [keepHover]);
  return { hovered, hover, keepHover, clearHover };
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

// src/viewer/OntoUMLViewer.jsx
import { jsx as jsx18, jsxs as jsxs13 } from "react/jsx-runtime";
function OntoUMLViewer({
  model,
  views,
  exports: exportData,
  snippets = {}
}) {
  const exports = useArtifactArchive(exportData);
  const [viewKey, setViewKey] = useState10(views[0].key), [fields, setFields] = useState10(false);
  const [theme, toggleTheme] = useTheme("ontouml-atlas-theme");
  const [selected, setSelected] = useState10(null);
  const [aboutOpen, setAboutOpen] = useState10(false);
  const [learningOpen, setLearningOpen] = useState10(false);
  const { hovered, hover, keepHover, clearHover } = useInspection();
  const [focusRequest, setFocusRequest] = useState10(null), [zoom, setZoom] = useState10(100);
  const cameraRef = useRef7(null);
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo4(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups]
  );
  const diagramURL = useSVGExport(
    exports.readText(
      `${exports.slug}-${view.key}${fields ? "-fields" : ""}.svg`
    ),
    theme
  );
  const inspected = inspectedTarget(hovered, selected);
  const element = index.getElement(inspected);
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
  useEffect6(() => {
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
  useEffect6(() => {
    const escape = (e) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
  function choose(id) {
    const node = index.nodes.get(id);
    if (!node) return;
    const next = viewForNode(views, viewKey, node);
    if (!next) return;
    setViewKey(next.key);
    select({ kind: "node", id: node.id });
    setFocusRequest({ id: node.id });
  }
  return /* @__PURE__ */ jsxs13("div", { className: `viewer${element || learningOpen ? " inspecting" : ""}`, children: [
    /* @__PURE__ */ jsx18(
      ViewerToolbar,
      {
        ...{ model, views, exports, viewKey, fields, theme, zoom, diagramURL },
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
          setLearningOpen(!learningOpen);
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
    /* @__PURE__ */ jsx18(
      DiagramCanvas,
      {
        ref: cameraRef,
        ...{ diagram, selected, hovered, focusRequest },
        onSelect: select,
        onZoom: setZoom,
        onHover,
        onClearHover: clearHover
      }
    ),
    /* @__PURE__ */ jsxs13(
      Panel,
      {
        className: "inspector",
        open: !!element || learningOpen,
        label: learningOpen ? "OntoUML learning library" : "Model details",
        onClose: learningOpen ? () => setLearningOpen(false) : void 0,
        onPointerEnter: keepHover,
        onPointerLeave: () => hover(null),
        onFocusCapture: keepHover,
        onBlurCapture: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
        },
        children: [
          learningOpen && /* @__PURE__ */ jsx18(
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
          !learningOpen && element && inspected.kind === "node" && /* @__PURE__ */ jsx18(ConceptDetails, { concept: element, model, snippets }),
          !learningOpen && element && inspected.kind === "edge" && /* @__PURE__ */ jsx18(
            RelationDetails,
            {
              relation: element,
              onChoose: choose,
              model,
              snippets
            }
          ),
          !learningOpen && element && inspected.kind === "group" && /* @__PURE__ */ jsx18(
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
    /* @__PURE__ */ jsx18(
      Panel,
      {
        id: "about-panel",
        className: "about-panel",
        label: "About and controls",
        open: aboutOpen,
        onClose: () => setAboutOpen(false),
        children: /* @__PURE__ */ jsx18(About, { model, exports })
      }
    )
  ] });
}

// src/viewer/ViewerErrorBoundary.jsx
import { Component } from "react";
import { jsx as jsx19, jsxs as jsxs14 } from "react/jsx-runtime";
var ViewerErrorBoundary = class extends Component {
  constructor() {
    super(...arguments);
    __publicField(this, "state", { failed: false });
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return /* @__PURE__ */ jsxs14("main", { className: "viewer-error", role: "alert", children: [
        /* @__PURE__ */ jsx19("h1", { children: "The model could not be displayed" }),
        /* @__PURE__ */ jsx19("p", { children: "Rebuild the viewer from the model and check its validation report." }),
        /* @__PURE__ */ jsx19("button", { onClick: () => location.reload(), children: "Reload" })
      ] });
    return this.props.children;
  }
};
export {
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
