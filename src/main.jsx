import { createRoot } from "react-dom/client";
import { OntoUMLViewer } from "./viewer/OntoUMLViewer";
import { ViewerErrorBoundary } from "./viewer/ViewerErrorBoundary";

createRoot(document.getElementById("root")).render(
  <ViewerErrorBoundary>
    <OntoUMLViewer
      model={MODEL}
      views={VIEWS}
      exports={EXPORTS}
      snippets={SNIPPETS}
    />
  </ViewerErrorBoundary>,
);
