import { createRoot } from "react-dom/client";
import { DevelopmentApp } from "./DevelopmentApp";
import "../src/ui/styles.css";
import "../src/visualization/styles.css";

createRoot(document.getElementById("root")).render(<DevelopmentApp />);
