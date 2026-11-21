import { createRoot } from "react-dom/client";
import { defineTheme, ThemePreferenceProvider } from "@envsemble/envui";
import { useStoredThemePreference } from "@envsemble/envui/theme-storage";
import { DevelopmentApp } from "./DevelopmentApp";
import "../src/viewer/viewer.css";
import "../src/canvas/canvas.css";

const theme = defineTheme({ selection: "accent" });
const themeStorage = { storageKey: "coord-theme" };

function Themed({ children }) {
  const storedTheme = useStoredThemePreference(themeStorage);
  return (
    <ThemePreferenceProvider theme={theme} {...storedTheme} className="coord-page">
      {children}
    </ThemePreferenceProvider>
  );
}

createRoot(document.getElementById("root")).render(
  <Themed>
    <DevelopmentApp />
  </Themed>,
);
