import { useState, useMemo } from "react";
import {
  Button,
  Counter,
  DisclosureNote,
  Notice,
  SearchField,
  Stack,
  Tabs,
  Text,
} from "@envsemble/envui";
import { ExternalIcon } from "../ui/Icons";
import {
  documentationURL,
  lessonFor,
  reference,
  identityProviders,
  readMultiplicity,
} from "./modelHelp";

function ExternalLink({ href, children }) {
  return (
    <Button
      variant="text"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      endIcon={<ExternalIcon />}
    >
      {children}
    </Button>
  );
}

export function Lesson({ stereotype, children }) {
  const lesson = lessonFor(stereotype);
  return (
    <Stack gap={2} align="start" className="lesson">
      <Text>{lesson.summary}</Text>
      {children}
      <Text className="learning-question">{lesson.question}</Text>
      {lesson.example && <Text tone="muted">{lesson.example}</Text>}
      <ExternalLink href={documentationURL(stereotype)}>
        {stereotype === "generalizationSet"
          ? "UML specification"
          : "OntoUML specification"}
      </ExternalLink>
    </Stack>
  );
}
const SEVERITY_TONES = { error: "error", warning: "warning", info: "info" };
const SEVERITY_TITLES = {
  error: "Error",
  warning: "Warning",
  info: "Coverage note",
};
export function ElementLearning({ element, model, relation = false }) {
  const key = relation
    ? element.type === "generalizationSet"
      ? "generalizationSet"
      : element.type === "generalization"
        ? "generalization"
        : element.stereotype || "association"
    : element.stereotype;
  const providers = relation ? [] : identityProviders(model, element.id);
  const issues = model.validation.issues.filter(
    (i) => i.elementId === element.id,
  );
  return (
    <Stack
      as="section"
      gap={3}
      className="element-learning"
      aria-label="Model guidance"
    >
      {issues
        .filter((i) => i.severity !== "info")
        .map((issue) => (
          <Notice
            key={issue.code}
            tone={SEVERITY_TONES[issue.severity] || "warning"}
            title={`${issue.severity === "error" ? "Needs review" : "Review"} · ${issue.code.replaceAll("_", " ").toLowerCase()}`}
            action={
              issue.documentation ? (
                <ExternalLink href={issue.documentation}>
                  Rule in the specification
                </ExternalLink>
              ) : undefined
            }
          >
            {issue.message}
          </Notice>
        ))}
      <DisclosureNote
        title={
          key === "generalizationSet"
            ? "Understand generalization sets"
            : `Understand «${key || "unspecified"}»`
        }
      >
        <Lesson stereotype={key}>
          {providers.length > 0 && (
            <Text>
              Identity supplied by {providers.map((p) => p.name).join(", ")}.
            </Text>
          )}
          {relation &&
            element.type === "association" &&
            readMultiplicity(element).map((sentence) => (
              <Text key={sentence}>{sentence}</Text>
            ))}
        </Lesson>
      </DisclosureNote>
      {element.rationale && element.rationale !== element.description && (
        <DisclosureNote title="Why this classification?">
          <Text>{element.rationale}</Text>
        </DisclosureNote>
      )}
      {(element.questions || []).map((question) => (
        <DisclosureNote key={question.question} title={question.question}>
          <Text>{question.why}</Text>
          <Text as="h3" variant="section-heading">
            How to resolve it
          </Text>
          <Text>{question.resolve}</Text>
        </DisclosureNote>
      ))}
    </Stack>
  );
}

function ValidationIssue({ issue, name, onInspect }) {
  const show = issue.elementId ? (
    <Button variant="text" onClick={() => onInspect(issue.elementId)}>
      {name || "Show in model"}
    </Button>
  ) : undefined;
  // Coverage notes are background detail, not messages that need attention.
  if (issue.severity === "info")
    return (
      <Stack gap={0} align="start" className="coverage-note">
        <Text variant="supporting">{issue.message}</Text>
        {show}
      </Stack>
    );
  return (
    <Notice
      tone={SEVERITY_TONES[issue.severity] || "info"}
      title={SEVERITY_TITLES[issue.severity] || issue.severity}
      action={show}
    >
      {issue.message}
    </Notice>
  );
}

function LearnTab({ query, setQuery }) {
  const [reveal, setReveal] = useState(false);
  return (
    <Stack gap={3}>
      <SearchField
        label="Find a stereotype"
        placeholder="Find a stereotype"
        value={query}
        onValueChange={setQuery}
      />
      <DisclosureNote title="How to read counts">
        <Text>
          The count next to a type says how many of its instances can relate to
          one instance at the opposite end.
        </Text>
        <Text>
          1 = exactly one · 0..1 = optional, at most one · 1..* = at least one ·
          * = zero or more.
        </Text>
        <Text className="learning-question">
          Person [1] — [0..*] Enrollment. How many people does each enrollment
          require?
        </Text>
        <div>
          <Button variant="secondary" onClick={() => setReveal(!reveal)}>
            {reveal ? "Hide answer" : "Check your understanding"}
          </Button>
        </div>
        {reveal && (
          <Text>
            Exactly one Person per Enrollment. The 0..* beside Enrollment
            permits a Person to have no enrollments or many.
          </Text>
        )}
      </DisclosureNote>
      {Object.entries(reference)
        .filter(([key, value]) =>
          `${key} ${value.summary}`.toLowerCase().includes(query.toLowerCase()),
        )
        .map(([key, lesson]) => (
          <DisclosureNote
            key={key}
            title={
              key === "generalizationSet"
                ? lesson.title
                : `${lesson.title} · «${key}»`
            }
          >
            <Lesson stereotype={key} />
          </DisclosureNote>
        ))}
    </Stack>
  );
}

export function LearningLibrary({ model, onInspect }) {
  const [tab, setTab] = useState("learn"),
    [query, setQuery] = useState("");
  const visibleIssues = model.validation.issues.filter(
    (i) => i.severity !== "info",
  );
  const coverage = model.validation.issues.filter((i) => i.severity === "info");
  const elementNames = useMemo(
    () =>
      new Map(
        [...model.classes, ...model.relations, ...(model.partitions || [])].map(
          (e) => [e.id, e.name],
        ),
      ),
    [model],
  );
  const renderIssue = (issue, i) => (
    <ValidationIssue
      key={i}
      issue={issue}
      name={elementNames.get(issue.elementId)}
      onInspect={onInspect}
    />
  );
  const errors = model.validation.counts.error;
  return (
    <Tabs
      aria-label="OntoUML learning library"
      className="learning-tabs"
      value={tab}
      onValueChange={(next) => next && setTab(next)}
      items={[
        {
          value: "learn",
          button: <Button>Learn</Button>,
          content: <LearnTab query={query} setQuery={setQuery} />,
        },
        {
          value: "checks",
          button: (
            <Button
              aria-label={`Checks, ${errors} ${errors === 1 ? "finding" : "findings"}`}
            >
              Checks{" "}
              <Counter
                value={errors}
                tone={tab === "checks" ? "accent" : "neutral"}
              />
            </Button>
          ),
          content: (
            <Stack gap={3}>
              {!errors && <Text>The implemented checks pass.</Text>}
              {visibleIssues.map(renderIssue)}
              <DisclosureNote title="Rule coverage">
                <Text tone="muted">
                  Official JSON schema, reference integrity, and a documented
                  subset of ontology rules. Domain accuracy still needs
                  judgment.
                </Text>
                {coverage.map(renderIssue)}
                {model.validation.limitations.map((limit) => (
                  <Text tone="muted" key={limit}>
                    {limit}
                  </Text>
                ))}
              </DisclosureNote>
            </Stack>
          ),
        },
        {
          value: "questions",
          button: <Button>Open questions</Button>,
          content: (
            <Stack gap={3}>
              {model.unknowns.length ? (
                model.unknowns.map((question) => (
                  <Text className="open-question" key={question}>
                    {question}
                  </Text>
                ))
              ) : (
                <Text tone="muted">No project-wide questions recorded.</Text>
              )}
            </Stack>
          ),
        },
      ]}
    />
  );
}
