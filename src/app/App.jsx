import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiagramCanvas } from "../diagram/DiagramCanvas";
import { useSVGExport } from "../diagram/useSVGExport";
import { sameTarget } from "../diagram/interaction";
import { indexModel, viewForNode } from "../model/domainModel";
import { Panel } from "../ui/Panel";
import { useTheme } from "../ui/useTheme";
import { ViewerToolbar } from "./ViewerToolbar";
import { ConceptDetails, RelationDetails, About } from "./DetailsContent";
import { useInspection, inspectedTarget } from "./useInspection";

export function App({ model, views, exports, snippets }) {
  const index = useMemo(() => indexModel(model), [model]);
  const [viewKey, setViewKey] = useState("runtime"),
    [fields, setFields] = useState(false);
  const [theme, toggleTheme] = useTheme("r5-ontouml-theme");
  const [selected, setSelected] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { hovered, hover, keepHover, clearHover } = useInspection();
  const [focusRequest, setFocusRequest] = useState(null),
    [zoom, setZoom] = useState(100);
  const cameraRef = useRef(null);
  const view = views.find((v) => v.key === viewKey);
  const diagram = fields ? view.diagramFields : view.diagram;
  const diagramURL = useSVGExport(fields ? view.svgFields : view.svg, theme);
  const inspected = inspectedTarget(hovered, selected);
  const element = index.getElement(inspected);
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setAboutOpen(false);
    },
    [clearHover],
  );
  const clear = useCallback(() => {
    setSelected(null);
    setAboutOpen(false);
    clearHover();
  }, [clearHover]);
  useEffect(() => {
    const escape = (e) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
  function choose(name) {
    const node = index.names.get(name);
    const next = viewForNode(views, viewKey, node);
    setViewKey(next.key);
    select({ kind: "node", id: node.id });
    setFocusRequest({ id: node.id });
  }
  return (
    <div className={`viewer${element ? " inspecting" : ""}`}>
      <ViewerToolbar
        {...{ model, views, exports, viewKey, fields, theme, zoom, diagramURL }}
        onView={(key) => {
          if (key === viewKey) return;
          const next = views.find((v) => v.key === key).diagram;
          const elements = selected?.kind === "edge" ? next.edges : next.nodes;
          if (!elements.some((item) => item.id === selected?.id)) clear();
          setFocusRequest(null);
          setViewKey(key);
        }}
        onFields={() => {
          setFocusRequest(null);
          setFields(!fields);
        }}
        onTheme={toggleTheme}
        onChoose={choose}
        onAbout={() => {
          setAboutOpen(true);
        }}
        onZoom={(factor) => cameraRef.current.zoomBy(factor)}
        onReset={() => cameraRef.current.reset()}
        onFit={() => cameraRef.current.fit()}
      />
      <DiagramCanvas
        ref={cameraRef}
        {...{ diagram, selected, hovered, focusRequest }}
        onSelect={select}
        onZoom={setZoom}
        onHover={hover}
        onClearHover={clearHover}
      />
      <Panel
        className="inspector"
        open={!!element}
        onPointerEnter={keepHover}
        onPointerLeave={() => hover(null)}
        onFocusCapture={keepHover}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
        }}
      >
        {element && inspected.kind === "node" && (
          <ConceptDetails
            concept={element}
            sources={model.sources}
            snippets={snippets}
          />
        )}
        {element && inspected.kind === "edge" && (
          <RelationDetails
            relation={element}
            onChoose={choose}
            sources={model.sources}
            snippets={snippets}
          />
        )}
      </Panel>
      <Panel
        id="about-panel"
        className="about-panel"
        label="About and controls"
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
      >
        <About model={model} exports={exports} />
      </Panel>
    </div>
  );
}
