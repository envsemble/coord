import { useMemo } from "react";
import {
  Alert,
  Badge,
  Button,
  Column,
  Disclosure,
  Text,
} from "@envsemble/envui";

function verdict(scenario) {
  const met = scenario.result.expectationMet;
  const expected = scenario.expected === "invalid" ? "Invalid" : "Valid";
  if (met === null)
    return { tone: "neutral", text: `${expected} · not fully checked` };
  return met
    ? { tone: "success", text: `${expected} · as expected` }
    : { tone: "danger", text: `${expected} expected · differs` };
}

/** Example instances, with what the checks found about each. */
function Examples({ examples, model, names, onInspect }) {
  const classNames = new Map(model.classes.map((c) => [c.id, c.name]));
  return (
    <Column gap={5}>
      {examples.map((scenario) => {
        const { tone, text } = verdict(scenario);
        const labels = new Map(
          scenario.instances.map((i) => [i.id, i.label || i.id]),
        );
        return (
          <Column gap={2} key={scenario.id} className="example">
            <div className="example-head">
              <Text
                render={<h3 />}
                variant="title"
                className="atlas-section-heading"
              >
                {scenario.title}
              </Text>
              <Badge tone={tone}>{text}</Badge>
            </div>
            {scenario.description && <Text>{scenario.description}</Text>}
            {scenario.result.issues.map((issue, i) => (
              <Alert key={i} tone="warning">
                {issue.message}
                {issue.elementId && names.has(issue.elementId) && (
                  <>
                    {" "}
                    <Button
                      variant="text"
                      className="inline-action"
                      onClick={() => onInspect(issue.elementId)}
                    >
                      {names.get(issue.elementId)}
                    </Button>
                  </>
                )}
              </Alert>
            ))}
            <Disclosure
              title={`${scenario.instances.length} instances · ${scenario.links.length} links`}
            >
              <ul className="example-list">
                {scenario.instances.map((instance) => (
                  <li key={instance.id}>
                    <strong>{instance.label || instance.id}</strong>
                    {": "}
                    {instance.classIds
                      .map((id) => classNames.get(id) || id)
                      .join(", ")}
                  </li>
                ))}
              </ul>
              {scenario.links.length > 0 && (
                <ul className="example-list">
                  {scenario.links.map((link, i) => (
                    <li key={i}>
                      {labels.get(link.sourceId) || link.sourceId} →{" "}
                      <em>{names.get(link.relationId) || link.relationId}</em> →{" "}
                      {labels.get(link.targetId) || link.targetId}
                    </li>
                  ))}
                </ul>
              )}
              {scenario.result.unassessed.map((u, i) => (
                <Text emphasis="muted" key={i}>
                  {u.message}
                </Text>
              ))}
            </Disclosure>
          </Column>
        );
      })}
    </Column>
  );
}

/**
 * Understanding a model through its examples: the scenarios (object diagrams)
 * that exemplify it, each assessed against it. Null without any.
 */
export function ScenarioPanel({ model, scenarios = null, onInspect }) {
  const elementNames = useMemo(
    () =>
      new Map(
        [...model.classes, ...model.relations, ...(model.partitions || [])].map(
          (e) => [e.originalId || e.id, e.name],
        ),
      ),
    [model],
  );
  const examples = scenarios?.scenarios || [];
  if (!examples.length) return null;
  return (
    <Column gap={6} className="scenario-panel">
      <Column render={<section />} gap={3} aria-label="Examples">
        <Text
          render={<h3 />}
          variant="body-sm"
          className="detail-section-title"
        >
          Examples
        </Text>
        <Examples
          examples={examples}
          model={model}
          names={elementNames}
          onInspect={onInspect}
        />
      </Column>
    </Column>
  );
}
