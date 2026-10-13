import { useLayoutEffect, useRef, useState } from "react";

const MIN = 288;
const MAX = 1200;
// Wider details would cover most of the diagram; fit treats a pane over 60% of
// the viewer as covering it anyway.
const SHARE = 0.6;
const STEP = 16;
const LARGE_STEP = 48;

/**
 * The details pane's width, which the reader drags from its inner edge or sets
 * with the arrow keys (Home and End for the narrowest and widest), between
 * 18rem and 60% of the viewer, never over 1200px. A chosen width is clamped
 * again as the viewer narrows; without one the stylesheet's default applies.
 * `width` and `onChange` make it controlled, as a host that keeps the choice
 * does. Returns the width shown (null for the default), the viewer's style,
 * whether a drag is under way, and the separator for the pane.
 */
export function useInspectorWidth({
  viewerRef,
  panelRef,
  width,
  onChange,
  label = "Resize details",
}) {
  const [own, setOwn] = useState(null);
  const [dragged, setDragged] = useState(null);
  const [sizes, setSizes] = useState({ viewer: 0, panel: 0 });
  const drag = useRef(null);
  useLayoutEffect(() => {
    const viewer = viewerRef.current,
      panel = panelRef.current;
    if (!viewer || !panel || typeof ResizeObserver !== "function") return;
    const measure = () =>
      setSizes((old) => {
        const next = {
          viewer: viewer.clientWidth,
          panel: Math.round(panel.getBoundingClientRect().width),
        };
        return next.viewer === old.viewer && next.panel === old.panel
          ? old
          : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewer);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [viewerRef, panelRef]);
  const max = Math.max(MIN, Math.min(MAX, Math.floor(sizes.viewer * SHARE)));
  const clamp = (value) => Math.round(Math.min(max, Math.max(MIN, value)));
  const chosen = onChange ? (width ?? null) : own;
  const shown = dragged ?? (chosen === null ? null : clamp(chosen));
  const commit = (next) => {
    const value = clamp(next);
    if (onChange) {
      if (value !== chosen) onChange(value);
    } else setOwn(value);
  };
  const current = () =>
    shown ??
    Math.round(panelRef.current?.getBoundingClientRect().width || sizes.panel);
  const separator = (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={shown ?? sizes.panel}
      aria-valuemin={MIN}
      aria-valuemax={max}
      tabIndex={0}
      className="panel-resize"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // Dragging selects no text and leaves focus where it is.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: current(),
        };
        setDragged(clamp(drag.current.startWidth));
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.pointerId !== event.pointerId) return;
        // The separator is on the pane's left edge: moving left widens it.
        setDragged(clamp(d.startWidth + d.startX - event.clientX));
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        if (!d || d.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragged(null);
        commit(d.startWidth + d.startX - event.clientX);
      }}
      onPointerCancel={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragged(null);
      }}
      onKeyDown={(event) => {
        // Keys held with Alt, Ctrl or ⌘ are the host's, such as going back.
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const step = event.shiftKey ? LARGE_STEP : STEP;
        let next;
        if (event.key === "ArrowLeft") next = current() + step;
        else if (event.key === "ArrowRight") next = current() - step;
        else if (event.key === "Home") next = MIN;
        else if (event.key === "End") next = max;
        else return;
        event.preventDefault();
        commit(next);
      }}
    />
  );
  return {
    width: shown,
    style: shown === null ? undefined : { "--inspector-width": `${shown}px` },
    resizing: dragged !== null,
    separator,
  };
}
