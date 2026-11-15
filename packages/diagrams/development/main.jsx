import { createRoot } from "react-dom/client";
import { ThemePreferenceProvider } from "@envsemble/envui";
import { DevelopmentApp } from "./DevelopmentApp";
import "../src/viewer/viewer.css";
import "../src/canvas/canvas.css";

createRoot(document.getElementById("root")).render(
  <ThemePreferenceProvider storageKey="coord-theme" className="coord-page">
    <DevelopmentApp />
  </ThemePreferenceProvider>,
);
