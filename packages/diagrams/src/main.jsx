import { createRoot } from "react-dom/client";
import { defineTheme, ThemePreferenceProvider } from "@envsemble/envui";
import { DiagramViewer } from "./viewer/DiagramViewer";
import { ViewerErrorBoundary } from "./viewer/ViewerErrorBoundary";

// The offline file has no host, so envUI owns its theme: the stored choice
// (key shared with the startup script in buildViewer) or the system theme.
const theme = defineTheme({ storageKey: "coord-theme", selection: "accent" });

createRoot(document.getElementById("root")).render(
  <ThemePreferenceProvider theme={theme} className="coord-page">
    <ViewerErrorBoundary>
      <DiagramViewer
        model={MODEL}
        views={VIEWS}
        exports={EXPORTS}
        comparison={typeof COMPARISON === "undefined" ? undefined : COMPARISON}
        scenarios={typeof SCENARIOS === "undefined" ? undefined : SCENARIOS}
      />
    </ViewerErrorBoundary>
  </ThemePreferenceProvider>,
);
