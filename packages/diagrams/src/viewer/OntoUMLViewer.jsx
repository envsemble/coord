import { inspectionTarget } from "../model/inspectionTarget";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DiagramCanvas } from "../visualization/DiagramCanvas";
import { useSVGExport } from "../visualization/useSVGExport";
import { sameTarget } from "../visualization/interaction";
import { indexViewerModel, viewForNode } from "../model/domainModel";
import { Panel } from "../ui/Panel";
import { useTheme } from "../ui/useTheme";
import { ViewerToolbar } from "./ViewerToolbar";
import {
  ConceptDetails,
  RelationDetails,
  GeneralizationSetDetails,
  About,
} from "./DetailsContent";
import { useInspection, inspectedTarget } from "./useInspection";
import { LearningLibrary } from "../learning/LearningContent";
import { useArtifactArchive } from "./useArtifactArchive";
import { createZoomStore } from "../ui/zoomStore";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { ComparisonViewer } from "./ComparisonViewer";
import { ReportViewer } from "./ReportViewer";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";

export function OntoUMLViewer(props) {
  // Report and comparison controls travel as extras into the nested viewer.
  const nested = (payload, focus, extras) => (
    <OntoUMLViewer
      {...payload}
      reportControl={props.reportControl}
      {...extras}
      focus={focus || props.focus}
    />
  );
  if (props.report) return <ReportViewer payload={props} render={nested} />;
  if (props.comparison)
    return (
      <ComparisonViewer payload={props} focus={props.focus} render={nested} />
    );
  if (!props.views.length)
    return (
      <div className="viewer-error">
        <ProvenanceBadge
          document={props.provenanceDocument || props.model.document}
          className="inline"
        />
        <h1>{props.model.title}</h1>
        <p>No entities in this model.</p>
        {props.comparisonControls && (
          <div className="atlas-island inline">{props.comparisonControls}</div>
        )}
      </div>
    );
  return <ViewerContent {...props} />;
}
function ViewerContent({
  model,
  views,
  exports: exportData,
  snippets = {},
  focus = null,
  comparisonControls,
  reportControl,
  provenanceDocument,
}) {
  const exports = useArtifactArchive(exportData);
  const [viewKey, setViewKey] = useState(views[0].key),
    [fields, setFields] = useState(false);
  const [theme, toggleTheme] = useTheme("ontouml-atlas-theme");
  const [selected, setSelected] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [learningOpen, setLearningOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled: !sidebarHidden,
    previewVisible: !!selected || learningOpen,
  });
  const [focusRequest, setFocusRequest] = useState(null);
  const zoomStore = useMemo(createZoomStore, []);
  const cameraRef = useRef(null);
  const viewerRef = useRef(null),
    toolbarRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, toolbarRef);
  const density = useToolbarDensity(
    toolbarRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!comparisonControls}`,
  );
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(
      `${exports.slug}-${view.key}${fields ? "-fields" : ""}.svg`,
    ),
    theme,
  );
  const inspected = inspectedTarget(preview, selected);
  const element = index.getElement(inspected);
  const sidebarOpen = !sidebarHidden && (!!element || learningOpen);
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setAboutOpen(false);
      setLearningOpen(false);
    },
    [clearHover],
  );
  const clear = useCallback(() => {
    setSelected(null);
    setAboutOpen(false);
    setLearningOpen(false);
    clearHover();
  }, [clearHover]);
  useEffect(() => {
    setSelected(null);
    setFocusRequest(null);
    setViewKey(views[0].key);
    clearHover();
  }, [model.id, clearHover]);
  const onHover = useCallback(
    (target) => {
      if (target) setLearningOpen(false);
      hover(target);
    },
    [hover],
  );
  useEffect(() => {
    const escape = (e) => {
      if (e.key === "Escape") clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
  const choose = useCallback(
    (id) => {
      const next = inspectionTarget(model, index, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      if (next.nodeId) setFocusRequest({ id: next.nodeId });
    },
    [index, model, views, viewKey, select],
  );
  const lastExternalFocus = useRef(null);
  useEffect(() => {
    if (focus && focus !== lastExternalFocus.current) {
      lastExternalFocus.current = focus;
      if (focus.kind === "view" && views.some((v) => v.key === focus.id))
        setViewKey(focus.id);
      else choose(focus.id);
    }
  }, [focus, choose, views]);
  useEffect(() => {
    if (selected && !index.getElement(selected)) select(null);
  }, [index, selected, select]);
  // Reopening details must not leave the selected node underneath them.
  useLayoutEffect(() => {
    if (sidebarOpen && selected?.kind === "node")
      cameraRef.current?.revealNode(selected.id);
  }, [sidebarOpen]);
  return (
    <div
      ref={viewerRef}
      className={`viewer${sidebarOpen ? " inspecting" : ""}`}
    >
      <ViewerToolbar
        ref={toolbarRef}
        density={density}
        comparisonControls={comparisonControls}
        reportControl={reportControl}
        {...{
          model,
          views,
          exports,
          viewKey,
          fields,
          theme,
          zoomStore,
          diagramURL,
        }}
        sidebarHidden={sidebarHidden}
        sidebarOpen={sidebarOpen}
        learningOpen={learningOpen}
        aboutOpen={aboutOpen}
        onSidebar={() => setSidebarHidden((hidden) => !hidden)}
        onView={(key) => {
          if (key === viewKey) return;
          const next = views.find((v) => v.key === key).diagram;
          const elements =
            selected?.kind === "edge"
              ? next.edges
              : selected?.kind === "group"
                ? next.generalizationGroups || []
                : next.nodes;
          if (!elements.some((item) => item.id === selected?.id)) clear();
          setFocusRequest(null);
          setViewKey(key);
        }}
        onFields={() => {
          setFocusRequest(null);
          setFields(!fields);
        }}
        onTheme={toggleTheme}
        onLearn={() => {
          clearHover();
          setSidebarHidden(false);
          setLearningOpen(sidebarHidden || !learningOpen);
        }}
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
        {...{ diagram, selected, hovered, focusRequest, backgroundURL }}
        fitInsets={fitInsets}
        onSelect={select}
        onZoom={zoomStore.set}
        onHover={onHover}
        onClearHover={clearHover}
      />
      <ProvenanceBadge document={provenanceDocument || model.document} />
      <Panel
        id="inspector"
        className="inspector"
        open={sidebarOpen}
        label={learningOpen ? "OntoUML learning library" : "Model details"}
        title={null}
        closeLabel="Hide details"
        onClose={() => setSidebarHidden(true)}
        onPointerEnter={keepHover}
        onPointerLeave={() => hover(null)}
        onFocusCapture={keepHover}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
        }}
      >
        {sidebarOpen && learningOpen && (
          <LearningLibrary
            model={model}
            onInspect={(id) => {
              if (index.nodes.has(id)) choose(id);
              else {
                const groupView = views.find((v) =>
                  v.diagram.generalizationGroups?.some((g) => g.id === id),
                );
                if (groupView) {
                  setViewKey(groupView.key);
                  select({ kind: "group", id });
                  return;
                }
                const edge = index.edges.get(id);
                const next = views.find((v) =>
                  v.diagram.edges.some((e) => e.id === id),
                );
                if (edge && next) {
                  setViewKey(next.key);
                  select({ kind: "edge", id });
                }
              }
            }}
          />
        )}
        {sidebarOpen &&
          !learningOpen &&
          element &&
          inspected.kind === "node" && (
            <ConceptDetails
              concept={element}
              model={model}
              snippets={snippets}
            />
          )}
        {sidebarOpen &&
          !learningOpen &&
          element &&
          inspected.kind === "edge" && (
            <RelationDetails
              relation={element}
              onChoose={choose}
              model={model}
              snippets={snippets}
            />
          )}
        {sidebarOpen &&
          !learningOpen &&
          element &&
          inspected.kind === "group" && (
            <GeneralizationSetDetails
              group={element}
              model={model}
              snippets={snippets}
              onChoose={choose}
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
