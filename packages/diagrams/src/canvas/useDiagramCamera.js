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
}) {
  const callbacks = useRef({ onZoom, onTap, onMotion, insets });
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
      }),
    // A new camera implementation during Vite refresh needs a new controller.
    [createCamera],
  );
  useLayoutEffect(() => {
    callbacks.current = { onZoom, onTap, onMotion, insets };
  }, [onZoom, onTap, onMotion, insets]);
  useLayoutEffect(() => {
    controls.restoreView(diagram.key, diagram.initialFocus);
  }, [controls, diagram]);
  useLayoutEffect(() => {
    if (focusRequest?.ids)
      controls.focusNodes(focusRequest.ids, focusRequest.rightInset);
    else if (focusRequest)
      controls.focusNode(focusRequest.id, focusRequest.rightInset);
  }, [controls, focusRequest]);
  useLayoutEffect(() => controls.attach(), [controls]);
  return controls;
}
