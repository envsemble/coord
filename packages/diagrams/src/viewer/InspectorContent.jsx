import { LearningLibrary } from "../learning/LearningContent";
import {
  ConceptDetails,
  GeneralizationSetDetails,
  RelationDetails,
} from "./DetailsContent";

/**
 * What the inspector shows: the guide to the model, an inspected element's
 * details, or, while reviewing a proposal, the overview of its changes.
 */
export function InspectorContent({
  learning,
  element,
  inspected,
  member = null,
  model,
  snippets,
  guide,
  changes,
  showOverview,
  onChoose,
  onInspectLearning = onChoose,
  onReference,
}) {
  if (learning)
    return (
      <LearningLibrary
        model={model}
        learning={guide}
        onInspect={onInspectLearning}
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
        onReference={onReference}
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
        onReference={onReference}
      />
    );
  if (element && inspected.kind === "group")
    return (
      <GeneralizationSetDetails
        group={element}
        model={model}
        snippets={snippets}
        onChoose={onChoose}
        onReference={onReference}
      />
    );
  if (showOverview) return changes.content;
  return null;
}
