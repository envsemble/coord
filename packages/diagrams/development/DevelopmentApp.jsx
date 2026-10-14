import { useEffect, useState } from "react";
import initialPayload from "virtual:atlas/model";
import { DiagramViewer } from "../src/viewer/DiagramViewer";
import { ViewerErrorBoundary } from "../src/viewer/ViewerErrorBoundary";

export function DevelopmentApp() {
  const [payload, setPayload] = useState(initialPayload);
  useEffect(() => {
    document.title = `${payload.model.title} | Atlas · Development`;
  }, [payload.model.title]);
  useEffect(() => {
    if (!import.meta.hot) return;
    const update = (next) => setPayload(next);
    import.meta.hot.on("atlas:model-update", update);
    return () => import.meta.hot.off("atlas:model-update", update);
  }, []);
  return (
    <ViewerErrorBoundary>
      <DiagramViewer {...payload} />
    </ViewerErrorBoundary>
  );
}
