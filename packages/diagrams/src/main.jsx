import { createRoot } from "react-dom/client";
import { ThemePreferenceProvider } from "@envsemble/envui";
import { OntoUMLViewer } from "./viewer/OntoUMLViewer";
import { ViewerErrorBoundary } from "./viewer/ViewerErrorBoundary";

// The offline file has no host, so envUI owns its theme: the stored choice
// (key shared with the startup script in buildViewer) or the system theme.
createRoot(document.getElementById("root")).render(
  <ThemePreferenceProvider storageKey="atlas-theme" className="atlas-page">
    <ViewerErrorBoundary>
      <OntoUMLViewer
        model={MODEL}
        views={VIEWS}
        exports={EXPORTS}
        snippets={SNIPPETS}
        comparison={typeof COMPARISON === "undefined" ? undefined : COMPARISON}
        report={typeof REPORT === "undefined" ? undefined : REPORT}
      />
    </ViewerErrorBoundary>
  </ThemePreferenceProvider>,
);
