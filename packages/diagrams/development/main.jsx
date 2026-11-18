import { createRoot } from "react-dom/client";
import { defineTheme, ThemePreferenceProvider } from "@envsemble/envui";
import { DevelopmentApp } from "./DevelopmentApp";
import "../src/viewer/viewer.css";
import "../src/canvas/canvas.css";

const theme = defineTheme({ storageKey: "coord-theme" });

createRoot(document.getElementById("root")).render(
  <ThemePreferenceProvider theme={theme} className="coord-page">
    <DevelopmentApp />
  </ThemePreferenceProvider>,
);
