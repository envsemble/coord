import { useEffect, useState } from "react";
import initialPayload from "virtual:coord/model";
import { DiagramViewer } from "../src/viewer/DiagramViewer";
import { ViewerErrorBoundary } from "../src/viewer/ViewerErrorBoundary";

export function DevelopmentApp() {
  const [payload, setPayload] = useState(initialPayload);
  useEffect(() => {
    document.title = `${payload.model.title} | Coord · Development`;
  }, [payload.model.title]);
  useEffect(() => {
    if (!import.meta.hot) return;
    const update = (next) => setPayload(next);
    import.meta.hot.on("coord:model-update", update);
    return () => import.meta.hot.off("coord:model-update", update);
  }, []);
  return (
    <ViewerErrorBoundary>
      <DiagramViewer {...payload} />
    </ViewerErrorBoundary>
  );
}
