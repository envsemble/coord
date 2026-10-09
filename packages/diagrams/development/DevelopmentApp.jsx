import { useEffect, useState } from "react";
import initialPayload from "virtual:ontouml-atlas/model";
import { OntoUMLViewer } from "../src/viewer/OntoUMLViewer";
import { ViewerErrorBoundary } from "../src/viewer/ViewerErrorBoundary";

export function DevelopmentApp() {
  const [payload, setPayload] = useState(initialPayload);
  useEffect(() => {
    document.title = `${payload.model.title} | OntoUML Atlas · Development`;
  }, [payload.model.title]);
  useEffect(() => {
    if (!import.meta.hot) return;
    const update = (next) => setPayload(next);
    import.meta.hot.on("ontouml:model-update", update);
    return () => import.meta.hot.off("ontouml:model-update", update);
  }, []);
  return (
    <ViewerErrorBoundary>
      <OntoUMLViewer {...payload} />
    </ViewerErrorBoundary>
  );
}
