import { createRoot } from "react-dom/client";
import { defineTheme, ThemePreferenceProvider } from "@envsemble/envui";
import { useStoredThemePreference } from "@envsemble/envui/theme-storage";
import { DiagramViewer } from "./viewer/DiagramViewer";
import { ViewerErrorBoundary } from "./viewer/ViewerErrorBoundary";

// The offline file has no host, so it keeps its own theme: the stored choice
// (key shared with the startup script in buildViewer) or the system theme.
const theme = defineTheme({ selection: "accent" });
const themeStorage = { storageKey: "coord-theme" };

function Themed({ children }) {
  const storedTheme = useStoredThemePreference(themeStorage);
  return (
    <ThemePreferenceProvider
      theme={theme}
      {...storedTheme}
      className="coord-page"
    >
      {children}
    </ThemePreferenceProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <Themed>
    <ViewerErrorBoundary>
      <DiagramViewer
        model={MODEL}
        views={VIEWS}
        exports={EXPORTS}
        comparison={typeof COMPARISON === "undefined" ? undefined : COMPARISON}
        scenarios={typeof SCENARIOS === "undefined" ? undefined : SCENARIOS}
      />
    </ViewerErrorBoundary>
  </Themed>,
);
