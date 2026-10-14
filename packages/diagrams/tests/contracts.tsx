import {
  buildViewer,
  checkDiagram,
  createDocument,
  createWorkspace,
  describeDiagrams,
  formatDiagram,
  parseDiagram,
  prepareDiagrams,
  prepareViewer,
  reviseDocument,
  validateDocument,
  type Diagram,
  type DiagramProblem,
  type DiagramSummary,
} from "../lib";
import {
  DiagramViewer,
  UMLDiagram,
  AtlasPanel,
  ProvenanceBadge,
  describeProvenance,
  type Provenance,
} from "../src";
async function smoke() {
  // @ts-expect-error A document requires a structural model.
  createDocument({});
  // @ts-expect-error Metadata alone does not supply a model.
  createDocument({ title: "Missing model" });
  // @ts-expect-error A viewer needs a prepared diagram or a document.
  await buildViewer({});
  // @ts-expect-error Options alone do not identify model input.
  await prepareViewer({ includeArtifacts: false });
  const text = "@startuml\nclass Order\n@enduml\n";
  const { diagram, problems } = parseDiagram(text, { path: "order.puml" });
  const first: DiagramProblem | undefined = problems[0];
  void first;
  if (diagram) {
    const written: string = formatDiagram(diagram satisfies Diagram);
    void written;
  }
  checkDiagram(text, { path: "order.puml", read: () => null });
  const files = [{ path: "order.puml", text }];
  const summaries: DiagramSummary[] = describeDiagrams(files);
  const role: "diagram" | "capture" | "proposal" | "scenario" =
    summaries[0].role;
  void role;
  const { prepared: viewers } = await prepareDiagrams({ files });
  const prepared = viewers.get("order.puml")!;
  const built = await buildViewer({ prepared, file: files[0] });
  const document = createDocument({
    profile: "database",
    model: {
      type: "StructuralModel",
      nodes: [{ id: "table", name: "Table", attributes: [] }],
      relations: [],
      generalizations: [],
      generalizationSets: [],
    },
  });
  validateDocument(reviseDocument(document, { title: "Planning revision" }));
  await createWorkspace("workspace").execute("atlas_validate", {
    handle: "m-000000000000000000000000",
  });
  await prepareViewer({ document, includeArtifacts: false });
  const provenance: Provenance = describeProvenance(document);
  const tone: "accent" | "done" | "success" | "neutral" = provenance.tone;
  void tone;
  describeProvenance(prepared.model.document);
  describeProvenance(undefined);
  return (
    <>
      <DiagramViewer {...prepared.payload} />
      <AtlasPanel
        payload={prepared.payload}
        theme="dark"
        leading={<select aria-label="Model" />}
        fullscreen={false}
        onFullscreenChange={(next: boolean) => void next}
      />
      <ProvenanceBadge document={document} />
      <UMLDiagram diagram={built.views[0].diagram} />
    </>
  );
}
void smoke;
