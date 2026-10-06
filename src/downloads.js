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

export function useBlobURL(data, type = "text/plain;charset=utf-8") {
  const [url, setURL] = useState(undefined);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([data], { type }));
    setURL(next);
    return () => URL.revokeObjectURL(next);
  }, [data, type]);
  return url;
}

export function useDiagramURL(worldRef, svgSource, theme) {
  const [url, setURL] = useState(undefined);
  useEffect(() => {
    const svg = worldRef.current.querySelector("svg").cloneNode(true);
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
  }, [worldRef, svgSource, theme]);
  return url;
}
