import {
  Project,
  buildViewer,
  validateProject,
  type ExchangeProject,
} from "../lib";
import { OntoUMLViewer, UMLDiagram } from "../src";
async function smoke() {
  const project = JSON.parse(JSON.stringify(new Project())) as ExchangeProject;
  validateProject(project);
  const built = await buildViewer({ project });
  return (
    <>
      <OntoUMLViewer {...built.payload} />
      <UMLDiagram diagram={built.views[0].diagram} />
    </>
  );
}
void smoke;
