import { useEffect, useState } from "react";

const THEME_VARS = [
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
];
const EMPTY_URLS = { diagramURL: undefined, backgroundURL: undefined };

// Each theme colour as `element` resolves it, its theme's light-dark() choice
// and any color-mix() included, so the image and the downloaded file need no
// stylesheet. Unset colours are left out, for the SVG's own fallbacks.
function resolvedColours(element) {
  const declared = getComputedStyle(element);
  const probe = document.createElement("span");
  probe.hidden = true;
  element.appendChild(probe);
  const colours = new Map();
  for (const name of THEME_VARS) {
    if (!declared.getPropertyValue(name).trim()) continue;
    probe.style.color = `var(${name})`;
    colours.set(name, getComputedStyle(probe).color);
  }
  probe.remove();
  return colours;
}

// Theme colours are read from `scope` (an element inside the viewer's envUI
// Theme), which follows a theme change as soon as React commits it.
export function useSVGExport(svgSource, theme, scope) {
  const [urls, setURLs] = useState(EMPTY_URLS);
  useEffect(() => {
    // Export the normal static rendering, independent of hover/selection.
    const svg = new DOMParser().parseFromString(
      svgSource,
      "image/svg+xml",
    ).documentElement;
    const colours = resolvedColours(scope?.current || document.documentElement);
    for (const [name, colour] of colours) svg.style.setProperty(name, colour);
    svg
      .querySelectorAll(".selected,.dimmed")
      .forEach((n) => n.classList.remove("selected", "dimmed"));
    // A transparent drawing layer lets the world grid show through. The
    // downloadable SVG below has an opaque theme-colored background.
    const backgroundURL = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    const background = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    background.setAttribute("width", svg.viewBox.baseVal.width);
    background.setAttribute("height", svg.viewBox.baseVal.height);
    background.setAttribute("fill", colours.get("--canvas") ?? "#ffffff");
    svg.insertBefore(background, svg.firstChild);
    const diagramURL = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    setURLs({ diagramURL, backgroundURL, source: svgSource, theme });
    return () => {
      URL.revokeObjectURL(diagramURL);
      URL.revokeObjectURL(backgroundURL);
    };
  }, [svgSource, theme]);
  // A newly chosen view/theme must never briefly display the previous image.
  return urls.source === svgSource && urls.theme === theme ? urls : EMPTY_URLS;
}
