import { renderToStaticMarkup } from "react-dom/server";
import { UMLDiagram } from "./UMLDiagram";

export const renderSVG = (diagram) =>
  renderToStaticMarkup(<UMLDiagram diagram={diagram} />);
