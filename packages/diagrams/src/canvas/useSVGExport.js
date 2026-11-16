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
  "--change-added",
  "--change-modified",
  "--change-removed",
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
// Theme), which follows a theme change as soon as React commits it. `fade`
// fades what a proposal leaves unchanged in the canvas backdrop, as the live
// canvas does; the downloadable image stays complete.
export function useSVGExport(svgSource, theme, scope, fade = false) {
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
    // As on screen (canvas.css): what is unchanged fades, its shapes and lines
    // most, its text less.
    const unchanged = '[data-change="unchanged"]';
    const faded = fade
      ? [
          ...svg.querySelectorAll(
            `${unchanged} :is(rect,path,line,polyline,polygon)`,
          ),
        ].map((element) => [element, "0.4"])
      : [];
    if (fade)
      for (const text of svg.querySelectorAll(`${unchanged} text`))
        faded.push([text, "0.72"]);
    for (const [element, opacity] of faded)
      element.setAttribute("opacity", opacity);
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
    for (const [element] of faded) element.removeAttribute("opacity");
    const diagramURL = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    setURLs({ diagramURL, backgroundURL, source: svgSource, theme, fade });
    return () => {
      URL.revokeObjectURL(diagramURL);
      URL.revokeObjectURL(backgroundURL);
    };
  }, [svgSource, theme, fade]);
  // A newly chosen view/theme must never briefly display the previous image.
  return urls.source === svgSource && urls.theme === theme && urls.fade === fade
    ? urls
    : EMPTY_URLS;
}
