import { CodeSnippet } from "../ui/CodeSnippet";

function SourceExcerpt({ source, snippet }) {
  if (!snippet)
    return (
      <div className="source-excerpt">
        <p>{source.claim}</p>
        {source.url && (
          <a
            className="source-github"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            View source ↗
          </a>
        )}
      </div>
    );
  return (
    <div className="source-excerpt">
      <div className="source-path" title={source.file}>
        {source.file.split("/").pop()} · {snippet.language}
      </div>
      <CodeSnippet
        snippet={snippet}
        label={`${source.title}, lines ${snippet.startLine} to ${snippet.endLine}`}
      />
      {snippet.url && (
        <a
          className="source-github"
          href={snippet.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View ${source.title} on GitHub`}
        >
          {snippet.url.startsWith("https://github.com/")
            ? "View on GitHub"
            : "View source"}{" "}
          ↗
        </a>
      )}
    </div>
  );
}

export function SourceEvidence({
  evidence,
  sources,
  snippets,
  primary,
  label = "Source",
}) {
  const records = [...new Set(primary ? [primary, ...evidence] : evidence)]
    .filter((id) => evidence.includes(id))
    .map((id) => sources.find((s) => s.id === id))
    .filter(Boolean);
  if (!records.length) return null;
  return (
    <section className="source-evidence" aria-label={label}>
      <h2>{label}</h2>
      {records.map((source, i) =>
        i === 0 ? (
          <SourceExcerpt
            key={source.id}
            source={source}
            snippet={snippets[source.id]}
          />
        ) : (
          <details className="additional-source" key={source.id}>
            <summary>{source.title}</summary>
            <SourceExcerpt source={source} snippet={snippets[source.id]} />
          </details>
        ),
      )}
    </section>
  );
}
