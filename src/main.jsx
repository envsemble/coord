import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")).render(
  <App model={MODEL} views={VIEWS} exports={EXPORTS} />,
);
