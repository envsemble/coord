import { useEffect, useState } from "react";

const THEME_VARS = [
  "--canvas",
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
];

export function useSVGExport(svgSource, theme) {
  const [url, setURL] = useState(undefined);
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
    const background = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "rect",
    );
    background.setAttribute("width", svg.viewBox.baseVal.width);
    background.setAttribute("height", svg.viewBox.baseVal.height);
    background.setAttribute("fill", styles.getPropertyValue("--canvas").trim());
    svg.insertBefore(background, svg.firstChild);
    const next = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [svgSource, theme]);
  return url;
}
