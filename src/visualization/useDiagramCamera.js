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
}) {
  const callbacks = useRef({ onZoom, onTap, onMotion });
  const controls = useMemo(
    () =>
      createCamera({
        canvasRef,
        worldRef,
        onZoom: (value) => callbacks.current.onZoom(value),
        onTap: (element) => callbacks.current.onTap(element),
        onMotion: () => callbacks.current.onMotion(),
      }),
    // A new camera implementation during Vite refresh needs a new controller.
    [createCamera],
  );
  useLayoutEffect(() => {
    callbacks.current = { onZoom, onTap, onMotion };
  }, [onZoom, onTap, onMotion]);
  useLayoutEffect(() => {
    controls.restoreView(diagram.key, diagram.fields, diagram.initialFocus);
  }, [controls, diagram]);
  useLayoutEffect(() => {
    if (focusRequest)
      controls.focusNode(focusRequest.id, focusRequest.rightInset);
  }, [controls, focusRequest]);
  useLayoutEffect(() => controls.attach(), [controls]);
  return controls;
}
