import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
 * whether a drag is under way, and the separator for the pane. A drag renders
 * only as it starts and ends: in between it sets the viewer's
 * `--inspector-width` directly, at most once a frame, and the host hears of the
 * width when the drag ends.
 */
export function useInspectorWidth({
  viewerRef,
  panelRef,
  width,
  onChange,
  label = "Resize details",
}) {
  const [own, setOwn] = useState(null);
  // The width a drag started from, while one is under way.
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
  const resizing = dragged !== null;
  // Between renders a drag owns the viewer's width; once it ends the viewer
  // shows the width React rendered again, even when the host kept the old one.
  useLayoutEffect(() => {
    const style = viewerRef.current?.style;
    if (!style || resizing) return;
    if (shown === null) style.removeProperty("--inspector-width");
    else style.setProperty("--inspector-width", `${shown}px`);
  }, [viewerRef, shown, resizing]);
  // An unmount mid-drag leaves no frame pending.
  useEffect(() => () => cancelAnimationFrame(drag.current?.frame), []);
  const follow = (d, clientX) => {
    d.width = clamp(d.startWidth + d.startX - clientX);
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      viewerRef.current?.style.setProperty("--inspector-width", `${d.width}px`);
      d.separator.setAttribute("aria-valuenow", String(d.width));
    });
  };
  const end = (d) => {
    cancelAnimationFrame(d.frame);
    // React last rendered the drag's starting width; it updates the attribute
    // from there.
    d.separator.setAttribute("aria-valuenow", String(clamp(d.startWidth)));
    drag.current = null;
    setDragged(null);
  };
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
        const startWidth = current();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth,
          width: clamp(startWidth),
          frame: 0,
          separator: event.currentTarget,
        };
        setDragged(drag.current.width);
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.pointerId !== event.pointerId) return;
        // The separator is on the pane's left edge: moving left widens it.
        follow(d, event.clientX);
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        if (!d || d.pointerId !== event.pointerId) return;
        end(d);
        commit(d.startWidth + d.startX - event.clientX);
      }}
      onPointerCancel={(event) => {
        const d = drag.current;
        if (d?.pointerId !== event.pointerId) return;
        end(d);
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
    resizing,
    separator,
  };
}
