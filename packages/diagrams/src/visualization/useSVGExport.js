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

export function useSVGExport(svgSource, theme) {
  const [urls, setURLs] = useState(EMPTY_URLS);
  useEffect(() => {
    // Export the normal static rendering, independent of hover/selection.
    const svg = new DOMParser().parseFromString(
      svgSource,
      "image/svg+xml",
    ).documentElement;
    const styles = getComputedStyle(document.documentElement);
    for (const name of THEME_VARS)
      svg.style.setProperty(name, styles.getPropertyValue(name).trim());
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
    background.setAttribute("fill", styles.getPropertyValue("--canvas").trim());
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
