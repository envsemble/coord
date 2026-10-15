import { createRoot } from "react-dom/client";
import { ThemePreferenceProvider } from "@envsemble/envui";
import { DevelopmentApp } from "./DevelopmentApp";
import "@envsemble/envui/styles.css";
import "../src/ui/styles.css";
import "../src/visualization/styles.css";

createRoot(document.getElementById("root")).render(
  <ThemePreferenceProvider storageKey="atlas-theme" className="atlas-page">
    <DevelopmentApp />
  </ThemePreferenceProvider>,
);
