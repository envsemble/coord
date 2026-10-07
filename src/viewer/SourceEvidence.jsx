import { CodeSnippet } from "../ui/CodeSnippet";
import { FileCodeIcon, LinkExternalIcon, MarkGithubIcon } from "../ui/Icons";

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
    <div className="source-excerpt source-file-card">
      <div className="source-path" title={source.file}>
        <FileCodeIcon size={16} />
        <span className="source-filename">{source.file.split("/").pop()}</span>
        <span className="source-language">{snippet.language}</span>
      </div>
      <CodeSnippet
        snippet={snippet}
        label={`${source.title}, lines ${snippet.startLine} to ${snippet.endLine}`}
      />
      {snippet.url && (
        <div className="source-footer">
          <a
            className="source-github"
            href={snippet.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${source.title} on GitHub`}
          >
            {snippet.url.startsWith("https://github.com/") && (
              <MarkGithubIcon size={16} />
            )}
            {snippet.url.startsWith("https://github.com/")
              ? "View on GitHub"
              : "View source"}{" "}
            <LinkExternalIcon size={12} />
          </a>
        </div>
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
