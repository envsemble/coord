import { useState, useMemo } from "react";
import {
  Badge,
  Button,
  Counter,
  DisclosureNote,
  Notice,
  SearchField,
  Stack,
  Tabs,
  Text,
} from "@envsemble/envui";
import { ExternalIcon, ViewIcon } from "../ui/Icons";
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
/**
 * Model guidance for an element: its checks, the lesson for its stereotype and
 * (with `parts="all"`) its classification rationale and open questions.
 * The inspector shows rationale and questions in its own Why section, so it
 * asks for `issues` and `lesson` (or `all-but-why`) separately.
 */
export function ElementLearning({
  element,
  model,
  relation = false,
  parts = "all",
}) {
  const issuesShown = parts !== "lesson";
  const lessonShown = parts !== "issues";
  const whyShown = parts === "all";
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
  const shownIssues = issuesShown
    ? issues.filter((i) => i.severity !== "info")
    : [];
  if (!lessonShown && !shownIssues.length) return null;
  return (
    <Stack
      as="section"
      gap={3}
      className="element-learning"
      aria-label={lessonShown ? "Model guidance" : "Model checks"}
    >
      {shownIssues.map((issue) => (
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
      {lessonShown && (
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
      )}
      {whyShown &&
        element.rationale &&
        element.rationale !== element.description && (
          <DisclosureNote title="Why this classification?">
            <Text>{element.rationale}</Text>
          </DisclosureNote>
        )}
      {(whyShown ? element.questions || [] : []).map((question) => (
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

const RECORD_KINDS = {
  plan: "Plan",
  glossary: "Glossary",
  decision: "Decision",
  scenario: "Scenario",
};

function ContextNotes({ ids = [], model }) {
  const records = (model.document?.context?.records || []).filter((r) =>
    ids.includes(r.id),
  );
  if (!records.length) return null;
  return (
    <Text variant="supporting" className="learning-context">
      From{" "}
      {records
        .map(
          (r) =>
            `${RECORD_KINDS[r.kind] || "Note"} › ${r.title || r.section || r.id}`,
        )
        .join(", ")}
    </Text>
  );
}

/** Guided tours through the model: each step names a view and its elements. */
function Walkthroughs({ learning, model, views, names, onInspect, onView }) {
  return (
    <Stack gap={5}>
      {learning.walkthroughs.map((walkthrough) => (
        <Stack gap={3} key={walkthrough.id} className="walkthrough">
          <Text as="h3" variant="section-heading">
            {walkthrough.title}
          </Text>
          <ContextNotes ids={walkthrough.contextIds} model={model} />
          <ol className="walkthrough-steps">
            {walkthrough.steps.map((step, i) => {
              const view = views?.find((v) => v.key === step.viewKey);
              return (
                <li key={i}>
                  <Text>{step.text}</Text>
                  <div className="step-links">
                    {view && onView && (
                      <Button
                        variant="text"
                        startIcon={<ViewIcon />}
                        onClick={() => onView(view.key)}
                      >
                        {view.label || view.title || "This"} view
                      </Button>
                    )}
                    {step.elementIds.map((id) => (
                      <Button
                        key={id}
                        variant="text"
                        onClick={() => onInspect(id)}
                      >
                        {names.get(id) || id}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        </Stack>
      ))}
    </Stack>
  );
}

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
function Examples({ learning, model, names, onInspect }) {
  const classNames = new Map(model.classes.map((c) => [c.id, c.name]));
  return (
    <Stack gap={5}>
      {learning.scope && <Text tone="muted">{learning.scope}</Text>}
      {learning.scenarios.map((scenario) => {
        const { tone, text } = verdict(scenario);
        const labels = new Map(
          scenario.instances.map((i) => [i.id, i.label || i.id]),
        );
        return (
          <Stack gap={2} key={scenario.id} className="example">
            <div className="example-head">
              <Text as="h3" variant="section-heading">
                {scenario.title}
              </Text>
              <Badge tone={tone}>{text}</Badge>
            </div>
            {scenario.description && <Text>{scenario.description}</Text>}
            <ContextNotes ids={scenario.contextIds} model={model} />
            {scenario.result.issues.map((issue, i) => (
              <Notice key={i} tone="warning">
                {issue.message}
                {issue.elementId && names.has(issue.elementId) && (
                  <>
                    {" "}
                    <Button
                      variant="text"
                      onClick={() => onInspect(issue.elementId)}
                    >
                      {names.get(issue.elementId)}
                    </Button>
                  </>
                )}
              </Notice>
            ))}
            <DisclosureNote
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
                <Text tone="muted" key={i}>
                  {u.message}
                </Text>
              ))}
            </DisclosureNote>
          </Stack>
        );
      })}
    </Stack>
  );
}

/**
 * Understanding a model: its walkthroughs and examples when the document has
 * them, and for conceptual models the OntoUML lessons, checks and open
 * questions.
 */
export function LearningLibrary({
  model,
  learning = null,
  views = null,
  conceptual = true,
  onInspect,
  onView,
  tab: chosenTab,
  onTabChange,
}) {
  const [localTab, setLocalTab] = useState(null),
    [query, setQuery] = useState("");
  const visibleIssues = model.validation.issues.filter(
    (i) => i.severity !== "info",
  );
  const coverage = model.validation.issues.filter((i) => i.severity === "info");
  const elementNames = useMemo(
    () =>
      new Map(
        [...model.classes, ...model.relations, ...(model.partitions || [])].map(
          (e) => [e.originalId || e.id, e.name],
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
  const items = [];
  // The document's own guide: its walkthroughs, then its examples.
  const guide = (learning?.walkthroughs?.length > 0 ||
    learning?.scenarios?.length > 0) && (
    <Stack gap={6} className="model-guide">
      {learning.walkthroughs?.length > 0 && (
        <Walkthroughs
          learning={learning}
          model={model}
          views={views}
          names={elementNames}
          onInspect={onInspect}
          onView={onView}
        />
      )}
      {learning.scenarios?.length > 0 && (
        <Stack as="section" gap={3} aria-label="Examples">
          <Text as="h3" variant="caption" className="detail-section-title">
            Examples
          </Text>
          <Examples
            learning={learning}
            model={model}
            names={elementNames}
            onInspect={onInspect}
          />
        </Stack>
      )}
    </Stack>
  );
  if (guide && !conceptual) return guide;
  if (guide)
    items.push({
      value: "guide",
      button: <Button>Guide</Button>,
      content: guide,
    });
  if (conceptual)
    items.push(
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
            Checks <Counter value={errors} />
          </Button>
        ),
        content: (
          <Stack gap={3}>
            {!errors && <Text>The implemented checks pass.</Text>}
            {visibleIssues.map(renderIssue)}
            <DisclosureNote title="Rule coverage">
              <Text tone="muted">
                Official JSON schema, reference integrity, and a documented
                subset of ontology rules. Domain accuracy still needs judgment.
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
        button: <Button>Questions</Button>,
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
    );
  if (!items.length) return null;
  const wanted = chosenTab ?? localTab;
  const tab = items.some((item) => item.value === wanted)
    ? wanted
    : items[0].value;
  return (
    <Tabs
      aria-label={conceptual ? "OntoUML learning library" : "Model guide"}
      className="learning-tabs"
      value={tab}
      onValueChange={(next) => {
        if (!next) return;
        setLocalTab(next);
        onTabChange?.(next);
      }}
      items={items}
    />
  );
}
