import { useLayoutEffect, useRef, useState } from "react";
import { createCamera } from "./camera";

export function useDiagramCamera({
  canvasRef,
  worldRef,
  viewKey,
  fields,
  focusRequest,
  onInspect,
}) {
  const inspectRef = useRef(onInspect);
  const [zoom, setZoom] = useState(100);
  const [controls] = useState(() =>
    createCamera({
      canvasRef,
      worldRef,
      onZoom: setZoom,
      onInspect: (name) => inspectRef.current(name),
    }),
  );
  useLayoutEffect(() => {
    inspectRef.current = onInspect;
  }, [onInspect]);
  useLayoutEffect(() => {
    controls.restoreView(viewKey, fields);
  }, [controls, viewKey, fields]);
  useLayoutEffect(() => {
    if (focusRequest) controls.focusConcept(focusRequest.name);
  }, [controls, focusRequest]);
  useLayoutEffect(() => controls.attach(), [controls]);
  return { ...controls, zoom };
}
