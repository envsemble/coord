import { useCallback, useLayoutEffect } from "react";

const GAP = 8;

// Floating toolbars cover parts of the full-bleed canvas. This hook keeps a
// CSS variable for panels placed under the top toolbar row and reports the
// covered edges so camera fit and reveal use the visible area.
export function useOverlayInsets(viewerRef, topRef) {
  useLayoutEffect(() => {
    const viewer = viewerRef.current,
      top = topRef.current;
    if (!viewer || !top || typeof ResizeObserver !== "function") return;
    const update = () =>
      viewer.style.setProperty(
        "--atlas-top-inset",
        `${Math.round(top.offsetTop + top.offsetHeight + GAP)}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(top);
    return () => observer.disconnect();
  }, [viewerRef, topRef]);
  // The camera fits during its own layout effect, before this component's ref
  // is attached, so it passes the canvas whose parent is the viewer.
  return useCallback(
    (canvas) => {
      const viewer = viewerRef.current || canvas?.parentElement;
      if (!viewer) return null;
      const box = viewer.getBoundingClientRect();
      const edge = (selector) =>
        viewer.querySelector(selector)?.getBoundingClientRect();
      const top = edge(":scope > .atlas-overlay-top");
      const badge = edge(":scope > .atlas-provenance");
      const inspector = edge(":scope > .inspector.open");
      return {
        top: top ? Math.max(0, top.bottom - box.top) : 0,
        bottom: badge ? Math.max(0, box.bottom - badge.top) : 0,
        left: 0,
        // A full-width inspector on narrow panels covers the diagram anyway.
        right:
          inspector && inspector.width < box.width * 0.6
            ? Math.max(0, box.right - inspector.left)
            : 0,
        // Panels that may cover a selected node, in canvas coordinates.
        obstacles:
          inspector && inspector.width < box.width * 0.6
            ? [
                {
                  left: inspector.left - box.left,
                  top: inspector.top - box.top,
                  right: inspector.right - box.left,
                  bottom: inspector.bottom - box.top,
                },
              ]
            : [],
      };
    },
    [viewerRef],
  );
}
