import { inspectionTarget } from "../model/inspectionTarget";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DiagramCanvas } from "../canvas/DiagramCanvas";
import { useSVGExport } from "../canvas/useSVGExport";
import { sameTarget } from "../canvas/interaction";
import { indexViewerModel } from "../model/viewerModelIndex";
import { Dialog, useTheme, useThemePreference } from "@envsemble/envui";
import { EmptyState } from "../ui/EmptyState";
import { Panel } from "../ui/Panel";
import { ViewerToolbar } from "./ViewerToolbar";
import { About } from "./About";
import { useInspection, inspectedTarget } from "./useInspection";
import { Inspector } from "../details/Inspector";
import { useArtifactArchive } from "./useArtifactArchive";
import { createZoomStore } from "./zoomStore";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { reviewedPayload } from "./reviewedPayload";
import { useInspectorWidth } from "./useInspectorWidth";
import { useOverlayInsets } from "./useOverlayInsets";
import { useToolbarDensity } from "./useToolbarDensity";
import { overviewByDefault, useChangeReview } from "../review/useChangeReview";

// A proposal shows its change view, its review data travelling as an extra
// prop, and the provenance of the proposal itself.
export function DiagramViewer(props) {
  const { payload, review, provenanceDocument } = reviewedPayload(props);
  if (!payload.views.length)
    return (
      <main className="viewer-error">
        <ProvenanceBadge document={provenanceDocument} className="inline" />
        <EmptyState
          headingLevel={1}
          title={payload.model.title}
          description="No entities in this model."
        />
      </main>
    );
  return (
    <ViewerContent
      {...payload}
      focus={props.focus}
      review={review}
      provenanceDocument={provenanceDocument}
    />
  );
}
// The offline file keeps the reader's details width in its browser's storage,
// when it may.
const WIDTH_KEY = "atlas-inspector-width";
function useStoredWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(WIDTH_KEY));
      return stored > 0 ? stored : null;
    } catch {
      return null;
    }
  });
  const change = useCallback((next) => {
    setWidth(next);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Storage is unavailable (a file opened with storage blocked).
    }
  }, []);
  return [width, change];
}
// The offline file supplies envUI's ThemePreferenceProvider; without one the
// viewer follows the surrounding Theme and offers no theme toggle.
function useOptionalThemePreference() {
  try {
    return useThemePreference();
  } catch {
    return null;
  }
}
function ViewerContent({
  model,
  views,
  exports: exportData,
  snippets = {},
  scenarios = null,
  focus = null,
  review = null,
  provenanceDocument,
}) {
  const exports = useArtifactArchive(exportData);
  const [viewKey, setViewKey] = useState(views[0].key),
    [fields, setFields] = useState(false);
  const preference = useOptionalThemePreference();
  const ambientTheme = useTheme();
  const theme = preference?.theme || ambientTheme;
  const [selected, setSelected] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [detailsHidden, setDetailsHidden] = useState(false);
  const [overview, setOverview] = useState(overviewByDefault);
  const { hovered, preview, hover, keepHover, clearHover } = useInspection({
    previewEnabled:
      !detailsHidden && !(review && overview && !selected && !scenariosOpen),
    previewVisible: !!selected || scenariosOpen,
  });
  const [focusRequest, setFocusRequest] = useState(null);
  // A member asked for by a focus (such as a plan's link) is shown in its
  // owner's details.
  const [member, setMember] = useState(null);
  const zoomStore = useMemo(createZoomStore, []);
  const cameraRef = useRef(null);
  const viewerRef = useRef(null),
    toolbarRef = useRef(null);
  const fitInsets = useOverlayInsets(viewerRef, toolbarRef);
  const density = useToolbarDensity(
    toolbarRef,
    `${model.id}:${views.map((v) => v.key).join()}:${!!review}`,
  );
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = fields ? view.diagramFields : view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
      setAboutOpen(false);
      setScenariosOpen(false);
    },
    [clearHover],
  );
  const clear = useCallback(() => {
    setSelected(null);
    setAboutOpen(false);
    setScenariosOpen(false);
    clearHover();
  }, [clearHover]);
  const choose = useCallback(
    (id) => {
      const next = inspectionTarget(model, index, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
      setMember(next.memberId || null);
      if (next.nodeId) setFocusRequest({ id: next.nodeId });
      else if (next.nodeIds) setFocusRequest({ ids: next.nodeIds });
    },
    [index, model, views, viewKey, select],
  );
  const changes = useChangeReview({
    review,
    model,
    views,
    selected,
    overview,
    setOverview,
    choose,
    select,
    hover,
    onShowPanel: () => {
      setDetailsHidden(false);
      setScenariosOpen(false);
    },
  });
  const { diagramURL, backgroundURL } = useSVGExport(
    exports.readText(
      `${exports.slug}-${view.key}${fields ? "-fields" : ""}.svg`,
    ),
    theme,
    viewerRef,
    !!changes?.fade,
  );
  const inspected = inspectedTarget(preview, selected);
  const element = index.getElement(inspected);
  const showOverview = !!changes && overview && !element && !scenariosOpen;
  const detailsOpen =
    !detailsHidden && (!!element || scenariosOpen || showOverview);
  useEffect(() => {
    setSelected(null);
    setFocusRequest(null);
    setViewKey(views[0].key);
    clearHover();
  }, [model.id, clearHover]);
  const onHover = useCallback(
    (target) => {
      if (target) setScenariosOpen(false);
      hover(target);
    },
    [hover],
  );
  const latestChanges = useRef(null);
  latestChanges.current = changes;
  useEffect(() => {
    const escape = (e) => {
      if (e.key !== "Escape") return;
      if (e.target.closest?.(".inspector"))
        latestChanges.current?.returnFocus();
      clear();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [clear]);
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
  // New content in the inspector starts at its top.
  const inspector = useRef(null);
  const showing = scenariosOpen
    ? "scenarios"
    : selected
      ? `${selected.kind}:${selected.id}`
      : showOverview
        ? "overview"
        : "";
  useLayoutEffect(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [showing]);
  const [storedWidth, setStoredWidth] = useStoredWidth();
  const resize = useInspectorWidth({
    viewerRef,
    panelRef: inspector,
    width: storedWidth,
    onChange: setStoredWidth,
  });
  const settledWidth = resize.resizing ? null : resize.width;
  // Reopening or widening details must not leave the selected node
  // underneath them.
  useLayoutEffect(() => {
    if (detailsOpen && selected?.kind === "node")
      cameraRef.current?.revealNode(selected.id);
  }, [detailsOpen, settledWidth]);
  // Scenario findings can point at relations and sets as well as classes.
  const inspectScenarioFinding = (id) => {
    if (index.nodes.has(id)) return choose(id);
    const groupView = views.find((v) =>
      v.diagram.generalizationGroups?.some((g) => g.id === id),
    );
    if (groupView) {
      setViewKey(groupView.key);
      select({ kind: "group", id });
      return;
    }
    choose(id);
  };
  return (
    <div
      ref={viewerRef}
      className={`viewer${detailsOpen ? " inspecting" : ""}${changes?.fade ? " fade-unchanged" : ""}${resize.resizing ? " resizing" : ""}`}
      style={resize.style}
    >
      <ViewerToolbar
        ref={toolbarRef}
        density={density}
        reviewControls={changes?.controls(detailsOpen && showOverview)}
        provenance={provenanceDocument}
        hasScenarios={!!scenarios}
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
        detailsHidden={detailsHidden}
        detailsOpen={detailsOpen}
        scenariosOpen={scenariosOpen}
        aboutOpen={aboutOpen}
        onDetails={() => setDetailsHidden((hidden) => !hidden)}
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
        themeToggle={!!preference}
        onScenarios={() => {
          clearHover();
          setDetailsHidden(false);
          setScenariosOpen(detailsHidden || !scenariosOpen);
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
      <Panel
        ref={inspector}
        id="inspector"
        className="inspector"
        open={detailsOpen}
        label={
          scenariosOpen
            ? "Model guide"
            : showOverview
              ? "Changes in this proposal"
              : "Model details"
        }
        title={
          scenariosOpen
            ? "Understand the model"
            : showOverview
              ? "Changes"
              : null
        }
        toolbar={
          !scenariosOpen && element && changes ? changes.navigation : null
        }
        closeLabel="Hide details"
        onClose={() => setDetailsHidden(true)}
        resizer={resize.separator}
        onPointerEnter={keepHover}
        onPointerLeave={() => hover(null)}
        onFocusCapture={keepHover}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) hover(null);
        }}
      >
        {detailsOpen && (
          <Inspector
            showScenarios={scenariosOpen}
            element={element}
            inspected={inspected}
            member={sameTarget(inspected, selected) ? member : null}
            model={model}
            snippets={snippets}
            scenarios={scenarios}
            changes={changes}
            showOverview={showOverview}
            onChoose={choose}
            onInspectScenario={inspectScenarioFinding}
          />
        )}
      </Panel>
      <Dialog
        open={aboutOpen}
        onOpenChange={setAboutOpen}
        title={model.title}
        description="About this diagram and its controls"
      >
        <About
          model={model}
          exports={exports}
          provenance={provenanceDocument}
        />
      </Dialog>
    </div>
  );
}
