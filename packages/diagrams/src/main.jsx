import { createRoot } from "react-dom/client";
import { ThemePreferenceProvider } from "@envsemble/envui";
import { DiagramViewer } from "./viewer/DiagramViewer";
import { ViewerErrorBoundary } from "./viewer/ViewerErrorBoundary";

// The offline file has no host, so envUI owns its theme: the stored choice
// (key shared with the startup script in buildViewer) or the system theme, at
// envUI's comfortable scale (also the startup script's).
createRoot(document.getElementById("root")).render(
  <ThemePreferenceProvider
    storageKey="atlas-theme"
    scale="comfortable"
    className="atlas-page"
  >
    <ViewerErrorBoundary>
      <DiagramViewer
        model={MODEL}
        views={VIEWS}
        exports={EXPORTS}
        snippets={SNIPPETS}
        comparison={typeof COMPARISON === "undefined" ? undefined : COMPARISON}
        scenarios={typeof SCENARIOS === "undefined" ? undefined : SCENARIOS}
      />
    </ViewerErrorBoundary>
  </ThemePreferenceProvider>,
);
