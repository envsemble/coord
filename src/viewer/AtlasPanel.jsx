import { inspectionTarget } from "../model/inspectionTarget";
import { CaptureStamp } from "./CaptureStamp";
import { ComparisonViewer } from "./ComparisonViewer";
import { ReportViewer } from "./ReportViewer";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { DiagramCanvas } from "../visualization/DiagramCanvas";
import { indexViewerModel, viewForNode } from "../model/domainModel";
import { sameTarget } from "../visualization/interaction";
import { Tabs } from "../ui/Tabs";
import { IconButton, ToggleButton } from "../ui/Button";
import { CameraControls } from "../ui/CameraControls";
import { ConceptSearch } from "../ui/ConceptSearch";
import { Panel } from "../ui/Panel";
import {
  SidebarCollapseIcon,
  SidebarExpandIcon,
  TableIcon,
  BookIcon,
} from "../ui/Icons";
import { createZoomStore } from "../ui/zoomStore";
import { useInspection, inspectedTarget } from "./useInspection";
import {
  ConceptDetails,
  RelationDetails,
  GeneralizationSetDetails,
} from "./DetailsContent";
import { LearningLibrary } from "../learning/LearningContent";

export function AtlasPanel(props) {
  if (props.payload.report)
    return (
      <ReportViewer
        payload={props.payload}
        theme={props.theme}
        onReference={props.onReference}
        render={(payload, focus) => (
          <AtlasPanel
            {...props}
            payload={payload}
            focus={focus || props.focus}
          />
        )}
      />
    );
  if (props.payload.comparison)
    return (
      <ComparisonViewer
        payload={props.payload}
        theme={props.theme}
        render={(payload, focus) => (
          <AtlasPanel
            {...props}
            payload={payload}
            focus={focus || props.focus}
          />
        )}
      />
    );
  if (!props.payload.views.length)
    return (
      <div
        className="atlas-panel atlas-empty"
        data-theme={props.theme || "dark"}
      >
        <h3>{props.payload.model.title}</h3>
        <p>No entities in this model.</p>
      </div>
    );
  return <AtlasPanelContent {...props} />;
}
function AtlasPanelContent({
  payload,
  theme = "dark",
  onReference,
  focus = null,
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
  return (
    <div className="atlas-panel" data-theme={theme}>
      <div className={`viewer${open ? " inspecting" : ""}`}>
        <header className="viewer-toolbar">
          <Tabs
            items={views}
            value={view.key}
            onChange={(key) => {
              setViewKey(key);
              setFocusRequest(null);
              clearHover();
            }}
          />
          <span className="spacer" />
          <div className="toolbar-actions">
            <ConceptSearch classes={model.classes} onChoose={choose} />
            <ToggleButton
              pressed={fields}
              aria-label="Fields"
              title="Show attributes"
              onClick={() => setFields((v) => !v)}
            >
              <TableIcon size={16} />
            </ToggleButton>
            <CameraControls
              zoomStore={zoomStore}
              onZoom={(factor) => camera.current?.zoomBy(factor)}
              onReset={() => camera.current?.reset()}
              onFit={() => camera.current?.fit()}
            />
            {(!meta || meta.profile === "ontouml") && (
              <ToggleButton
                pressed={learning && open}
                aria-label="Understand model"
                onClick={() => {
                  clearHover();
                  setHidden(false);
                  setLearning((v) => !v);
                }}
              >
                <BookIcon size={16} />
              </ToggleButton>
            )}
            <IconButton
              label={hidden ? "Show sidebar" : "Hide sidebar"}
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
          </div>
        </header>
        <DiagramCanvas
          ref={camera}
          diagram={diagram}
          selected={selected}
          hovered={hovered}
          focusRequest={focusRequest}
          onSelect={select}
          onZoom={zoomStore.set}
          onHover={hover}
          onClearHover={clearHover}
        />
        <CaptureStamp model={model} />
        <Panel
          id={inspectorId}
          className="inspector"
          title={null}
          label="Model details"
          open={open}
          closeLabel="Hide sidebar"
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
              {linked.map((record) => (
                <details key={record.id}>
                  <summary>{record.title || record.kind}</summary>
                  <p>{record.text}</p>
                  {onReference && typeof record.path === "string" && (
                    <button onClick={() => onReference(record)}>
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
