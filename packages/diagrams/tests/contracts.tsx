import {
  buildViewer,
  captureFromConfig,
  captureSQLite,
  captureTypeScript,
  checkDiagram,
  describeDiagrams,
  formatDiagram,
  parseDiagram,
  prepareDiagrams,
  type Diagram,
  type DiagramProblem,
  type DiagramSummary,
} from "../lib";
import {
  DiagramViewer,
  UMLDiagram,
  DiagramPanel,
  ProvenanceBadge,
  describeProvenance,
  type Provenance,
} from "../src";
async function smoke() {
  // @ts-expect-error A viewer needs a prepared diagram.
  await buildViewer({});
  // @ts-expect-error A capture needs its source's identity.
  await captureSQLite({ file: "shop.sqlite" });
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
  const captured: string = await captureTypeScript({
    identity: "shop",
    projects: [{ identity: "shop", path: "." }],
  });
  const configured: string = await captureFromConfig("capture.json");
  void captured;
  void configured;
  const { prepared: viewers } = await prepareDiagrams({ files });
  const prepared = viewers.get("order.puml")!;
  const built = await buildViewer({ prepared, file: files[0] });
  const provenance: Provenance = describeProvenance(prepared.model.document);
  const tone: "primary" | "accent" | "success" | "neutral" = provenance.tone;
  void tone;
  describeProvenance(undefined);
  return (
    <>
      <DiagramViewer {...prepared.payload} />
      <DiagramPanel
        payload={prepared.payload}
        theme="dark"
        leading={<select aria-label="Diagram" />}
      />
      <ProvenanceBadge document={prepared.model.document} />
      <UMLDiagram diagram={built.views[0].diagram} />
    </>
  );
}
void smoke;
