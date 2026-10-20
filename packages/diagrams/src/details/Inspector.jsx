import { ScenarioPanel } from "../scenarios/ScenarioPanel";
import {
  ConceptDetails,
  GeneralizationSetDetails,
  RelationDetails,
} from "./ElementDetails";

/**
 * What the details show: the scenarios that exemplify the diagram, an
 * inspected element's details, or, while reviewing a proposal, the overview
 * of its changes.
 */
export function Inspector({
  showScenarios,
  element,
  inspected,
  member = null,
  model,
  snippets,
  scenarios,
  changes,
  showOverview,
  onChoose,
  onInspectScenario = onChoose,
}) {
  if (showScenarios)
    return (
      <ScenarioPanel
        model={model}
        scenarios={scenarios}
        onInspect={onInspectScenario}
      />
    );
  const review = changes?.details ?? null;
  if (element && inspected.kind === "node")
    return (
      <ConceptDetails
        concept={element}
        model={model}
        snippets={snippets}
        review={review}
        member={member}
      />
    );
  if (element && inspected.kind === "edge")
    return (
      <RelationDetails
        relation={element}
        model={model}
        snippets={snippets}
        review={review}
        onChoose={onChoose}
      />
    );
  if (element && inspected.kind === "group")
    return (
      <GeneralizationSetDetails
        group={element}
        model={model}
        snippets={snippets}
        onChoose={onChoose}
      />
    );
  if (showOverview) return changes.content;
  return null;
}
