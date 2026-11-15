import { Profiler, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DiagramCanvas } from "../src/canvas/DiagramCanvas";
import { useInspection } from "../src/viewer/useInspection";
import { UMLDiagram } from "../src/canvas/UMLDiagram";
import { renderToStaticMarkup } from "react-dom/server";
import { useSVGExport } from "../src/canvas/useSVGExport";
import { Button, Theme } from "@envsemble/envui";
import "../src/viewer/viewer.css";
import "../src/canvas/canvas.css";

// Deliberately independent of any source project or layout algorithm. Keep
// all elements mounted to measure the renderer, not fixture generation.
function fixture(count) {
  const columns = 25;
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `node-${i}`,
    name: `Concept${i}`,
    stereotype: i % 3 ? "kind" : "role",
    x: (i % columns) * 300 + 20,
    y: Math.floor(i / columns) * 330 + 20,
    width: 220,
    height: 230,
    attributes: Array.from({ length: 8 }, (_, j) => ({
      name: `attribute${j}`,
      type: "String",
      multiplicity: "0..1",
    })),
  }));
  const edges = nodes.slice(1).flatMap((node, i) =>
    [1, 3]
      .filter((offset) => i + 1 >= offset)
      .map((offset) => {
        const source = nodes[i + 1 - offset];
        return {
          id: `edge-${i}-${offset}`,
          type: "association",
          name: "related to",
          source: source.id,
          target: node.id,
          sourceName: source.name,
          targetName: node.name,
          sourceMultiplicity: "1",
          targetMultiplicity: "0..*",
          paths: [
            `M${source.x + 220} ${source.y + 30} H${node.x} V${node.y + 30}`,
          ],
          labels: [
            {
              id: `label-${i}-${offset}`,
              kind: "target",
              nodeId: node.id,
              text: "0..*",
              x: node.x - 48,
              y: node.y,
              width: 42,
              height: 24,
            },
          ],
        };
      }),
  );
  return {
    key: `stress-${count}`,
    title: `${count} classes with attributes`,
    initialFocus: [],
    width: columns * 300,
    height: Math.ceil(count / columns) * 330,
    nodes,
    edges,
    generalizationGroups: [],
  };
}

const frame = () => new Promise(requestAnimationFrame);
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

function Benchmark() {
  const count =
    Number(new URLSearchParams(location.search).get("nodes")) || 1000;
  const diagram = useMemo(() => fixture(count), [count]);
  const svgSource = useMemo(
    () => renderToStaticMarkup(<UMLDiagram diagram={diagram} />),
    [diagram],
  );
  const { backgroundURL } = useSVGExport(svgSource, "dark");
  const { hovered, hover, clearHover } = useInspection();
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(100);
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const renderCosts = useRef(null);
  const camera = useRef(null);

  async function run() {
    setRunning(true);
    clearHover();
    setSelected(null);
    await frame();
    await frame();
    const costs = [];
    const highlight = [];
    const visible = [];
    renderCosts.current = costs;
    for (let i = 0; i < 24; i++) {
      const id = `node-${(i * 37) % count}`;
      const node = document.getElementById(`node-${id}`);
      const start = performance.now();
      hover({ kind: "node", id });
      const primary = () =>
        document.querySelector(
          `.diagram-overlay .node.primary[data-element-id="${id}"]`,
        ) || (node.classList.contains("primary") ? node : null);
      while (!primary()) {
        await frame();
        if (performance.now() - start > 3000)
          throw new Error("Hover timed out");
      }
      highlight.push(performance.now() - start);
      const drawingLayer = () =>
        primary().closest(".diagram-overlay") || primary();
      while (Number(getComputedStyle(drawingLayer()).opacity) < 0.999)
        await frame();
      visible.push(performance.now() - start);
      await frame();
    }
    renderCosts.current = null;
    setResult({
      nodes: diagram.nodes.length,
      relations: diagram.edges.length,
      samples: highlight.length,
      highlightMedianMs: percentile(highlight, 0.5),
      highlightP95Ms: percentile(highlight, 0.95),
      fullyVisibleP95Ms: percentile(visible, 0.95),
      renderMedianMs: percentile(costs, 0.5),
      renderP95Ms: percentile(costs, 0.95),
      commits: costs.length,
    });
    setRunning(false);
  }

  return (
    <>
      <header className="coord-overlay-top">
        <div className="coord-island">
          <span>
            {count} classes · {diagram.edges.length} relations
          </span>
          <Button variant="secondary" onClick={run} disabled={running}>
            {running ? "Measuring…" : "Run hover benchmark"}
          </Button>
          <Button variant="secondary" onClick={() => camera.current.fit()}>
            Fit
          </Button>
          <span>{zoom}%</span>
          <output aria-label="Benchmark results">
            {result && JSON.stringify(result)}
          </output>
        </div>
      </header>
      <Profiler
        id="diagram"
        onRender={(_, phase, duration) => {
          if (phase !== "mount") renderCosts.current?.push(duration);
        }}
      >
        <DiagramCanvas
          ref={camera}
          diagram={diagram}
          backgroundURL={backgroundURL}
          selected={selected}
          hovered={hovered}
          onSelect={setSelected}
          onHover={hover}
          onClearHover={clearHover}
          onZoom={setZoom}
        />
      </Profiler>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <Theme theme="dark">
    <Benchmark />
  </Theme>,
);
