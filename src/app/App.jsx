import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiagramCanvas } from "../diagram/DiagramCanvas";
import { useSVGExport } from "../diagram/useSVGExport";
import { sameTarget } from "../diagram/interaction";
import { indexModel, viewForNode } from "../model/domainModel";
import { Panel } from "../ui/Panel";
import { useTheme } from "../ui/useTheme";
import { ViewerToolbar } from "./ViewerToolbar";
import { ConceptDetails, RelationDetails, About } from "./DetailsContent";

export function App({ model, views, exports }) {
  const index = useMemo(() => indexModel(model), [model]);
  const [viewKey, setViewKey] = useState("runtime"),
    [fields, setFields] = useState(false);
  const [theme, toggleTheme] = useTheme("r5-ontouml-theme");
  const [selected, setSelected] = useState(null),
    [panel, setPanel] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null),
    [zoom, setZoom] = useState(100);
  const cameraRef = useRef(null);
  const view = views.find((v) => v.key === viewKey);
  const diagram = fields ? view.diagramFields : view.diagram;
  const diagramURL = useSVGExport(fields ? view.svgFields : view.svg, theme);
  const element = index.getElement(selected);
  const select = useCallback((target) => {
    setSelected((old) => (sameTarget(old, target) ? old : target));
    setPanel(target ? "selection" : null);
  }, []);
  const clear = useCallback(() => {
    setSelected(null);
    setPanel(null);
  }, []);
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
    setFocusRequest({
      id: node.id,
      rightInset: window.matchMedia("(min-width:621px)").matches ? 338 : 0,
    });
  }
  return (
    <>
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
          setPanel("about");
        }}
        onZoom={(factor) => cameraRef.current.zoomBy(factor)}
        onReset={() => cameraRef.current.reset()}
        onFit={() => cameraRef.current.fit()}
      />
      <DiagramCanvas
        ref={cameraRef}
        {...{ diagram, selected, focusRequest }}
        onSelect={select}
        onZoom={setZoom}
      />
      <Panel open={!!panel} onClose={() => setPanel(null)}>
        {panel === "selection" && selected?.kind === "node" && (
          <ConceptDetails concept={element} sources={model.sources} />
        )}
        {panel === "selection" && selected?.kind === "edge" && (
          <RelationDetails relation={element} onChoose={choose} />
        )}
        {panel === "about" && <About model={model} exports={exports} />}
      </Panel>
    </>
  );
}
