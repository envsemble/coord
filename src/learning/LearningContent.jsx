import { useState, useMemo } from "react";
import {
  documentationURL,
  lessonFor,
  reference,
  identityProviders,
  readMultiplicity,
} from "./modelHelp";

export function Lesson({ stereotype, children }) {
  const lesson = lessonFor(stereotype);
  return (
    <div className="lesson">
      <p>{lesson.summary}</p>
      {children}
      <p className="learning-question">{lesson.question}</p>
      {lesson.example && <p className="muted">{lesson.example}</p>}
      <a
        className="source"
        href={documentationURL(stereotype)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {stereotype === "generalizationSet"
          ? "UML specification ↗"
          : "OntoUML specification ↗"}
      </a>
    </div>
  );
}
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
    <section className="element-learning" aria-label="Model guidance">
      {issues
        .filter((i) => i.severity !== "info")
        .map((issue) => (
          <details className="finding" key={issue.code}>
            <summary>
              {issue.severity === "error" ? "Needs review" : "Review"} ·{" "}
              {issue.code.replaceAll("_", " ").toLowerCase()}
            </summary>
            <p>{issue.message}</p>
            {issue.documentation && (
              <a
                className="source"
                href={issue.documentation}
                target="_blank"
                rel="noopener noreferrer"
              >
                Rule in the specification ↗
              </a>
            )}
          </details>
        ))}
      <details className="learn-concept">
        <summary>
          {key === "generalizationSet"
            ? "Understand generalization sets"
            : `Understand «${key || "unspecified"}»`}
        </summary>
        <Lesson stereotype={key}>
          {providers.length > 0 && (
            <p>
              Identity supplied by {providers.map((p) => p.name).join(", ")}.
            </p>
          )}
          {relation && element.type === "association" && (
            <div className="counts-reading">
              {readMultiplicity(element).map((sentence) => (
                <p key={sentence}>{sentence}</p>
              ))}
            </div>
          )}
        </Lesson>
      </details>
      {element.rationale && element.rationale !== element.description && (
        <details className="learn-concept">
          <summary>Why this classification?</summary>
          <p>{element.rationale}</p>
        </details>
      )}
      {(element.questions || []).map((question) => (
        <details className="learn-concept uncertainty" key={question.question}>
          <summary>{question.question}</summary>
          <p>{question.why}</p>
          <h2>How to resolve it</h2>
          <p>{question.resolve}</p>
        </details>
      ))}
    </section>
  );
}
export function LearningLibrary({ model, onInspect }) {
  const [tab, setTab] = useState("learn"),
    [query, setQuery] = useState("");
  const [reveal, setReveal] = useState(false);
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
    <div className={`validation-issue ${issue.severity}`} key={i}>
      <span className="tag">{issue.severity}</span>
      <p>{issue.message}</p>
      {issue.elementId && (
        <button
          className="issue-link"
          onClick={() => onInspect(issue.elementId)}
        >
          {elementNames.get(issue.elementId) || "Show in model"} ↗
        </button>
      )}
    </div>
  );
  return (
    <>
      <span className="tag">OntoUML Atlas</span>
      <h1>Understand the model</h1>
      <div className="learning-tabs">
        <button aria-pressed={tab === "learn"} onClick={() => setTab("learn")}>
          Learn
        </button>
        <button
          aria-pressed={tab === "checks"}
          onClick={() => setTab("checks")}
        >
          Checks{" "}
          <span className="validation-count">
            {model.validation.counts.error}
          </span>
        </button>
        <button
          aria-pressed={tab === "questions"}
          onClick={() => setTab("questions")}
        >
          Open questions
        </button>
      </div>
      {tab === "learn" && (
        <>
          <input
            className="learning-search"
            type="search"
            aria-label="Find a stereotype"
            placeholder="Find a stereotype…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <details className="learn-concept">
            <summary>How to read counts</summary>
            <p>
              The count next to a type says how many of its instances can relate
              to one instance at the opposite end.
            </p>
            <p>
              1 = exactly one · 0..1 = optional, at most one · 1..* = at least
              one · * = zero or more.
            </p>
            <p className="learning-question">
              Person [1] — [0..*] Enrollment. How many people does each
              enrollment require?
            </p>
            <button
              className="answer-button"
              onClick={() => setReveal(!reveal)}
            >
              {reveal ? "Hide answer" : "Check your understanding"}
            </button>
            {reveal && (
              <p>
                Exactly one Person per Enrollment. The 0..* beside Enrollment
                permits a Person to have no enrollments or many.
              </p>
            )}
          </details>
          {Object.entries(reference)
            .filter(([key, value]) =>
              `${key} ${value.summary}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map(([key, lesson]) => (
              <details className="learn-concept" key={key}>
                <summary>
                  {key === "generalizationSet"
                    ? lesson.title
                    : `${lesson.title} · «${key}»`}
                </summary>
                <Lesson stereotype={key} />
              </details>
            ))}
        </>
      )}
      {tab === "checks" && (
        <>
          <p>
            {model.validation.counts.error
              ? `${model.validation.counts.error} findings need review.`
              : "The implemented checks pass."}
          </p>
          <p className="muted">
            Official JSON schema, reference integrity, and a documented subset
            of ontology rules. Domain accuracy still needs judgment.
          </p>
          {visibleIssues.map(renderIssue)}
          {coverage.length > 0 && (
            <details className="learn-concept">
              <summary>Rule coverage · {coverage.length} notices</summary>
              {coverage.map(renderIssue)}
            </details>
          )}
          {model.validation.limitations.map((limit) => (
            <p className="muted" key={limit}>
              {limit}
            </p>
          ))}
        </>
      )}
      {tab === "questions" && (
        <>
          {model.unknowns.length ? (
            model.unknowns.map((question) => (
              <p className="open-question" key={question}>
                {question}
              </p>
            ))
          ) : (
            <p className="muted">
              No project-wide questions recorded. Individual concepts may have
              their own questions.
            </p>
          )}
          <p className="muted">
            Inspect a concept for its evidence, classification rationale, and
            ways to resolve uncertainty.
          </p>
        </>
      )}
    </>
  );
}
