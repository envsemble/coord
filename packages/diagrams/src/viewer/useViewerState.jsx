import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { inspectionTarget } from "../model/inspectionTarget";
import { indexViewerModel } from "../model/viewerModelIndex";
import { sameTarget } from "../canvas/interaction";
import { useHover } from "./useHover";
import { overviewByDefault, useChangeReview } from "../review/useChangeReview";

/**
 * What both viewers keep about the reader's look at a diagram: the view, the
 * selected and hovered elements, a request to frame some, a proposal's
 * review, and the side panel (a proposal's changes, or the scenarios that
 * exemplify the model), which opens only from its own button.
 *
 * `identity` changes when another model is shown; another layer of the same
 * family keeps the view, the selection and the panel. `focus` is the host's
 * request to show an element or a view, such as a plan's link names.
 */
export function useViewerState({
  model,
  views,
  scenarios,
  review,
  focus,
  identity,
  cameraRef,
}) {
  const [viewKey, setViewKey] = useState(views[0].key);
  const [selected, setSelected] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const [side, setSide] = useState(() =>
    overviewByDefault() ? "changes" : null,
  );
  const { hovered, hover, clearHover } = useHover();
  const view = views.find((v) => v.key === viewKey) || views[0];
  const diagram = view.diagram;
  const index = useMemo(
    () => indexViewerModel(model, diagram.generalizationGroups),
    [model, diagram.generalizationGroups],
  );
  const select = useCallback(
    (target) => {
      clearHover();
      setSelected((old) => (sameTarget(old, target) ? old : target));
    },
    [clearHover],
  );
  // An element chosen by id (a link, a search hit, a change) is selected in a
  // view that shows it and framed; a member's owner is.
  const choose = useCallback(
    (id) => {
      const next = inspectionTarget(model, index, views, viewKey, id);
      if (!next) return;
      setViewKey(next.viewKey);
      select(next.target);
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
    choose,
    hover,
  });
  // The panel asked for shows while the layer shown has it.
  const panel =
    side === "changes" && changes
      ? "changes"
      : side === "scenarios" && scenarios
        ? "scenarios"
        : null;
  const togglePanel = useCallback(
    (kind) => setSide(panel === kind ? null : kind),
    [panel],
  );
  const closePanel = useCallback(() => setSide(null), []);
  const changeView = useCallback(
    (key) => {
      setViewKey(key);
      setFocusRequest(null);
      clearHover();
    },
    [clearHover],
  );
  // Another model starts afresh.
  const lastFocus = useRef(null);
  useEffect(() => {
    select(null);
    setViewKey(views[0].key);
    setFocusRequest(null);
    lastFocus.current = null;
  }, [identity, select]);
  // A selection the view no longer shows (another layer, another view) is
  // dropped.
  useEffect(() => {
    if (!selected) return;
    const shown =
      selected.kind === "node"
        ? diagram.nodes.some((n) => n.id === selected.id)
        : selected.kind === "edge"
          ? diagram.edges.some((e) => e.id === selected.id) ||
            diagram.generalizationGroups?.some((g) =>
              g.memberIds.includes(selected.id),
            )
          : diagram.generalizationGroups?.some((g) => g.id === selected.id);
    if (!index.getElement(selected) || !shown) select(null);
  }, [index, diagram, selected, select]);
  useEffect(() => {
    if (sameTarget(lastFocus.current, focus)) return;
    lastFocus.current = focus;
    if (!focus) return;
    if (focus.kind === "view" && views.some((v) => v.key === focus.id))
      setViewKey(focus.id);
    else choose(focus.id);
  }, [focus, choose, views]);
  // Escape in the viewer clears the selection.
  useEffect(() => {
    const escape = (e) => {
      if (e.key === "Escape" && e.target.closest?.(".viewer")) select(null);
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [select]);
  // A panel opening must not leave the selected element underneath it.
  useLayoutEffect(() => {
    if (panel && selected?.kind === "node")
      cameraRef.current?.revealNode(selected.id);
  }, [panel]);
  // Scenario findings point at relations and sets as well as classes.
  const inspectScenario = useCallback(
    (id) => {
      if (index.nodes.has(id)) return choose(id);
      const groupView = views.find((v) =>
        v.diagram.generalizationGroups?.some((g) => g.id === id),
      );
      if (!groupView) return choose(id);
      setViewKey(groupView.key);
      select({ kind: "group", id });
    },
    [index, views, choose, select],
  );
  return {
    view,
    diagram,
    selected,
    select,
    hovered,
    hover,
    clearHover,
    focusRequest,
    choose,
    changes,
    panel,
    togglePanel,
    closePanel,
    changeView,
    inspectScenario,
  };
}
