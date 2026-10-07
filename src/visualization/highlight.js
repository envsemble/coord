import { focusedElements, sameTarget } from "./interaction";

const keyFor = (target) => target && `${target.kind}:${target.id}`;
const focusKeys = (focus) =>
  new Set(
    focus
      ? [
          ...[...focus.nodes].map((id) => `node:${id}`),
          ...[...focus.edges].map((id) => `edge:${id}`),
          ...[...focus.groups].map((id) => `group:${id}`),
        ]
      : [],
  );

// Own only interaction classes, aria-pressed and active marker references.
// React owns the immutable SVG geometry. Subsequent updates touch the union
// of the old/new neighborhoods rather than traversing or reconciling the SVG.
export function createHighlightController(svg, diagram) {
  const records = new Map();
  let previousKeys = new Set();
  let previousPrimary = null;
  let previousSelection = new Set();
  for (const element of svg.querySelectorAll("[data-element-kind]")) {
    const key = keyFor({
      kind: element.dataset.elementKind,
      id: element.dataset.elementId,
    });
    if (!records.has(key)) records.set(key, []);
    element.classList.remove("dimmed");
    const markers = [];
    for (const path of element.querySelectorAll(".edge-path")) {
      for (const name of ["marker-start", "marker-end"]) {
        const value = path.getAttribute(name);
        if (value)
          markers.push({ path, name, value: value.replace(/-active\)$/, ")") });
      }
    }
    records.get(key).push({
      element,
      markers,
      highlighted: element.classList.contains("highlighted"),
      primary: element.classList.contains("primary"),
      selected: element.classList.contains("selected"),
      accessible: element.getAttribute("role") === "button",
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
      if (
        initialized &&
        sameTarget(active, previousActive) &&
        sameTarget(selected, previousSelected)
      )
        return;
      const focus = focusedElements(diagram, active);
      const nextKeys = focusKeys(focus);
      const primary = keyFor(focus?.primary);
      const selectedKey = keyFor(selected);
      svg.classList.toggle("has-focus", !!focus);
      const changed = new Set([
        ...previousKeys,
        ...nextKeys,
        previousPrimary,
        primary,
        ...previousSelection,
        selectedKey,
      ]);
      for (const key of changed) {
        for (const record of records.get(key) || []) {
          for (const [name, enabled] of [
            ["highlighted", nextKeys.has(key)],
            ["primary", key === primary],
            ["selected", key === selectedKey],
          ]) {
            if (record[name] === enabled) continue;
            record[name] = enabled;
            record.element.classList.toggle(name, enabled);
            if (name === "selected" && record.accessible)
              record.element.setAttribute("aria-pressed", String(enabled));
            if (name === "highlighted")
              for (const { path, name: attribute, value } of record.markers)
                path.setAttribute(
                  attribute,
                  enabled ? value.replace(/\)$/, "-active)") : value,
                );
          }
        }
      }
      previousKeys = nextKeys;
      previousPrimary = primary;
      previousActive = active;
      previousSelected = selected;
      previousSelection = new Set(selectedKey ? [selectedKey] : []);
      initialized = true;
    },
  };
}
