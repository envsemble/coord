import { inspectionTarget } from "../model/inspectionTarget";
import { ComparisonViewer } from "./ComparisonViewer";
import { ReportViewer } from "./ReportViewer";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { useOverlayInsets } from "./useOverlayInsets";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { DiagramCanvas } from "../visualization/DiagramCanvas";
import { indexViewerModel } from "../model/domainModel";
import { sameTarget } from "../visualization/interaction";
import { Tabs } from "../ui/Tabs";
import { IconButton, ToggleButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { Island, IslandDivider } from "../ui/Island";
import { Panel } from "../ui/Panel";
import {
  SidebarCollapseIcon,
  SidebarExpandIcon,
  TableIcon,
  BookIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
} from "../ui/Icons";
import { createZoomStore } from "../ui/zoomStore";
import { useInspection, inspectedTarget } from "./useInspection";
import {
  ConceptDetails,
  RelationDetails,
  GeneralizationSetDetails,
} from "./DetailsContent";
import { LearningLibrary } from "../learning/LearningContent";

// Report and comparison wrappers render the same panel again. Their controls
// travel as extras so every control lives in the panel's floating toolbars.
export function AtlasPanel(props) {
  const nested = (payload, focus, extras) => (
    <AtlasPanel
      {...props}
      {...extras}
      payload={payload}
      focus={focus || props.focus}
    />
  );
  if (props.payload.report)
    return (
      <ReportViewer
        payload={props.payload}
        theme={props.theme}
        leading={props.leading}
        onReference={props.onReference}
        render={nested}
      />
    );
  if (props.payload.comparison)
    return (
      <ComparisonViewer
        payload={props.payload}
        focus={props.focus}
        render={nested}
      />
    );
  if (!props.payload.views.length) {
    const tools = [props.leading, props.comparisonControls].filter(Boolean);
    return (
      <div
        className="atlas-panel atlas-empty"
        data-theme={props.theme || "dark"}
      >
        <div className="viewer">
          {(tools.length > 0 || props.reportControl) && (
            <div className="atlas-overlay-top">
              {tools.length > 0 && (
                <Island label="Diagram navigation" className="island-start">
                  {props.leading && (
                    <div className="island-leading">{props.leading}</div>
                  )}
                  {props.leading && props.comparisonControls && (
                    <IslandDivider />
                  )}
                  {props.comparisonControls}
                </Island>
              )}
              {props.reportControl && (
                <Island label="Diagram tools" className="island-end">
                  {props.reportControl}
                </Island>
              )}
            </div>
          )}
          <div className="atlas-empty-message">
            <h3>{props.payload.model.title}</h3>
            <p>No entities in this model.</p>
          </div>
          <ProvenanceBadge
            document={props.provenanceDocument || props.payload.model.document}
          />
        </div>
      </div>
    );
  }
  return <AtlasPanelContent {...props} />;
}
function AtlasPanelContent({
  payload,
  theme = "dark",
  onReference,
  focus = null,
  leading,
  fullscreen = false,
  onFullscreenChange,
  comparisonControls,
  reportControl,
  provenanceDocument,
}) {
  const { model, views, snippets } = payload;
  const [viewKey, setViewKey] = useState(views[0].key);
  const [fields, setFields] = useState(false),
    [selected, setSelected] = useState(null);
  const [hidden, setHidden] = useState(false),
    [learning, setLearning] = useState(false);
  const [focusRequest, setFocusRequest] = useState(null);
  const camera = useRef(null),
    zoomStore = useMemo(createZoomStore, []);
  const viewerRef = useRef(null),
    topRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, topRef);
  const lastFocus = useRef(null),
    inspectorId = useId();
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled: !hidden,
    previewVisible: !!selected || learning,
  });
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  const inspected = inspectedTarget(preview, selected),
    element = index.getElement(inspected);
  const open = !hidden && (!!element || learning);
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setLearning(false);
    },
    [clearHover],
  );
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
  useEffect(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [model.id, select]);
  useEffect(() => {
    const visible =
      selected?.kind === "node"
        ? diagram.nodes
        : selected?.kind === "edge"
          ? diagram.edges
          : diagram.generalizationGroups || [];
    if (
      selected &&
      (!index.getElement(selected) ||
        (!visible.some((item) => item.id === selected.id) &&
          !(
            selected.kind === "edge" &&
            diagram.generalizationGroups?.some((g) =>
              g.memberIds.includes(selected.id),
            )
          )))
    )
      select(null);
  }, [index, diagram, selected, select]);
  useEffect(() => {
    if (sameTarget(lastFocus.current, focus)) return;
    lastFocus.current = focus;
    if (!focus) return;
    if (focus.kind === "view" && views.some((v) => v.key === focus.id))
      setViewKey(focus.id);
    else choose(focus.id);
  }, [focus, choose, views]);
  useEffect(() => {
    const escape = (e) => {
      if (e.key === "Escape" && e.target.closest?.(".atlas-panel"))
        select(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [select]);
  const meta = model.document;
  const context = meta?.context || { records: [], links: [] };
  const contextIds = new Set([
    inspected?.id,
    ...(inspected?.kind === "node"
      ? element?.attributes.map((a) => a.id) || []
      : []),
  ]);
  const linked = context.records.filter((r) =>
    context.links.some(
      (l) => contextIds.has(l.elementId) && l.recordId === r.id,
    ),
  );
  const showTabs = views.length > 1;
  const hasStart = !!leading || showTabs || !!comparisonControls;
  return (
    <div className="atlas-panel" data-theme={theme}>
      <div ref={viewerRef} className={`viewer${open ? " inspecting" : ""}`}>
        <div className="atlas-overlay-top" ref={topRef}>
          {hasStart && (
            <Island label="Diagram navigation" className="island-start">
              {leading && <div className="island-leading">{leading}</div>}
              {leading && (showTabs || comparisonControls) && <IslandDivider />}
              {showTabs && (
                <Tabs
                  items={views}
                  value={view.key}
                  onChange={(key) => {
                    setViewKey(key);
                    setFocusRequest(null);
                    clearHover();
                  }}
                />
              )}
              {showTabs && comparisonControls && <IslandDivider />}
              {comparisonControls}
            </Island>
          )}
          <Island label="Diagram tools" className="island-end">
            <ConceptSearch classes={model.classes} onChoose={choose} />
            <IslandDivider />
            <ToggleButton
              className="icon"
              pressed={fields}
              aria-label="Fields"
              title="Show attributes"
              onClick={() => {
                setFocusRequest(null);
                setFields((v) => !v);
              }}
            >
              <TableIcon size={16} />
            </ToggleButton>
            <CameraControls
              zoomStore={zoomStore}
              onZoom={(factor) => camera.current?.zoomBy(factor)}
              onReset={() => camera.current?.reset()}
              onFit={() => camera.current?.fit()}
            />
            <IslandDivider />
            {(!meta || meta.profile === "ontouml") && (
              <ToggleButton
                className="icon"
                pressed={learning && open}
                aria-label="Understand model"
                title="Understand model"
                onClick={() => {
                  clearHover();
                  setHidden(false);
                  setLearning((v) => !v);
                }}
              >
                <BookIcon size={16} />
              </ToggleButton>
            )}
            {reportControl}
            <IconButton
              label={hidden ? "Show details" : "Hide details"}
              aria-controls={inspectorId}
              aria-expanded={open}
              onClick={() => setHidden((v) => !v)}
            >
              {hidden ? (
                <SidebarExpandIcon size={16} />
              ) : (
                <SidebarCollapseIcon size={16} />
              )}
            </IconButton>
            {onFullscreenChange && (
              <IconButton
                label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                aria-pressed={fullscreen}
                onClick={() => onFullscreenChange(!fullscreen)}
              >
                {fullscreen ? (
                  <ScreenNormalIcon size={16} />
                ) : (
                  <ScreenFullIcon size={16} />
                )}
              </IconButton>
            )}
          </Island>
        </div>
        <DiagramCanvas
          ref={camera}
          diagram={diagram}
          selected={selected}
          hovered={hovered}
          focusRequest={focusRequest}
          fitInsets={fitInsets}
          onSelect={select}
          onZoom={zoomStore.set}
          onHover={hover}
          onClearHover={clearHover}
        />
        <ProvenanceBadge document={provenanceDocument || meta} />
        <Panel
          id={inspectorId}
          className="inspector"
          title={null}
          label="Model details"
          open={open}
          closeLabel="Hide details"
          onClose={() => setHidden(true)}
          onPointerEnter={keepHover}
          onPointerLeave={() => hover(null)}
        >
          {open && learning && (
            <LearningLibrary model={model} onInspect={choose} />
          )}
          {open && !learning && element && inspected.kind === "node" && (
            <ConceptDetails
              concept={element}
              model={model}
              snippets={snippets}
            />
          )}
          {open && !learning && element && inspected.kind === "edge" && (
            <RelationDetails
              relation={element}
              model={model}
              snippets={snippets}
              onChoose={choose}
            />
          )}
          {open && !learning && element && inspected.kind === "group" && (
            <GeneralizationSetDetails
              group={element}
              model={model}
              snippets={snippets}
              onChoose={choose}
            />
          )}
          {open && !learning && linked.length > 0 && (
            <section className="atlas-context" aria-label="Planning references">
              <h2>Planning references</h2>
              {linked.map((record) => (
                <details key={record.id}>
                  <summary>{record.title || record.kind}</summary>
                  <p>{record.text}</p>
                  {onReference && typeof record.path === "string" && (
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => onReference(record)}
                    >
                      Open {record.kind}
                    </button>
                  )}
                </details>
              ))}
            </section>
          )}
        </Panel>
      </div>
    </div>
  );
}
