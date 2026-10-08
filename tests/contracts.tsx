import {
  Project,
  buildViewer,
  prepareViewer,
  validateProject,
  createDocument,
  createWorkspace,
  reviseDocument,
  validateDocument,
  type ExchangeProject,
} from "../lib";
import { OntoUMLViewer, UMLDiagram, AtlasPanel } from "../src";
async function smoke() {
  const project = JSON.parse(JSON.stringify(new Project())) as ExchangeProject;
  validateProject(project);
  const document = createDocument({ project, profile: "ontouml" });
  validateDocument(reviseDocument(document, { title: "Planning revision" }));
  await createWorkspace("workspace").execute("atlas_create", {
    input: { project },
  });
  await prepareViewer({ document, includeArtifacts: false });
  createDocument({
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [{ id: "table", name: "Table", attributes: [] }],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  const built = await buildViewer({ project });
  const prepared = await prepareViewer({ project });
  return (
    <>
      <OntoUMLViewer {...prepared.payload} />
      <AtlasPanel payload={prepared.payload} theme="dark" />
      <UMLDiagram diagram={built.views[0].diagram} />
    </>
  );
}
void smoke;
