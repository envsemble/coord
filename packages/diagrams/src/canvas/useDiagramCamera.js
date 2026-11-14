import { useLayoutEffect, useMemo, useRef } from "react";
import { createCamera } from "./camera";

export function useDiagramCamera({
  canvasRef,
  worldRef,
  diagram,
  focusRequest,
  onZoom,
  onTap,
  onMotion,
  insets,
  elementDrag = null,
}) {
  const callbacks = useRef({ onZoom, onTap, onMotion, insets, elementDrag });
  const controls = useMemo(
    () =>
      createCamera({
        canvasRef,
        worldRef,
        onZoom: (value) => callbacks.current.onZoom(value),
        onTap: (element) => callbacks.current.onTap(element),
        onMotion: () => callbacks.current.onMotion(),
        insets: (canvas) => {
          const value = callbacks.current.insets;
          return typeof value === "function" ? value(canvas) : value;
        },
        elementDrag: {
          start: (target, point) =>
            !!callbacks.current.elementDrag?.start(target, point),
          move: (point) => callbacks.current.elementDrag?.move(point),
          end: (moved) => callbacks.current.elementDrag?.end(moved),
        },
      }),
    // A new camera implementation during Vite refresh needs a new controller.
    [createCamera],
  );
  useLayoutEffect(() => {
    callbacks.current = { onZoom, onTap, onMotion, insets, elementDrag };
  }, [onZoom, onTap, onMotion, insets, elementDrag]);
  // The camera of each view is kept; an element moved within it is not
  // another view.
  useLayoutEffect(() => {
    controls.restoreView(diagram.key, diagram.initialFocus);
  }, [controls, diagram.key, diagram.initialFocus]);
  useLayoutEffect(() => {
    if (focusRequest?.ids)
      controls.focusNodes(focusRequest.ids, focusRequest.rightInset);
    else if (focusRequest)
      controls.focusNode(focusRequest.id, focusRequest.rightInset);
  }, [controls, focusRequest]);
  useLayoutEffect(() => controls.attach(), [controls]);
  return controls;
}
