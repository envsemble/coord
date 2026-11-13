import { Button, Card, Disclosure, Column, Text } from "@envsemble/envui";
import { CodeSnippet } from "../ui/CodeSnippet";
import { ExternalIcon } from "../ui/icons";

function SourceExcerpt({ source, snippet }) {
  if (!snippet)
    return (
      <Column gap={2} align="start" className="source-excerpt">
        <Text>{source.claim}</Text>
        {source.url && (
          <Button
            variant="text"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<ExternalIcon />}
          >
            View source
          </Button>
        )}
      </Column>
    );
  const github = snippet.url?.startsWith("https://github.com/");
  return (
    <Card
      padding={3}
      className="source-file-card"
      title={<span title={source.file}>{source.file.split("/").pop()}</span>}
      meta={`${snippet.language} · lines ${snippet.startLine}–${snippet.endLine}`}
      actions={
        snippet.url ? (
          <Button
            variant="text"
            href={snippet.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${source.title} on ${github ? "GitHub" : "its source"}`}
            endIcon={<ExternalIcon />}
          >
            {github ? "View on GitHub" : "View source"}
          </Button>
        ) : undefined
      }
    >
      <CodeSnippet
        snippet={snippet}
        label={`${source.title}, lines ${snippet.startLine} to ${snippet.endLine}`}
      />
    </Card>
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
    <Column
      render={<section />}
      gap={2}
      className="source-evidence detail-section"
      aria-label={label}
    >
      {label !== "Source" && (
        <Text
          render={<h2 />}
          variant="body-sm"
          className="detail-section-title"
        >
          {label}
        </Text>
      )}
      {records.map((source, i) =>
        i === 0 ? (
          <SourceExcerpt
            key={source.id}
            source={source}
            snippet={snippets[source.id]}
          />
        ) : (
          <Disclosure
            key={source.id}
            title={source.title}
            className="additional-source"
          >
            <SourceExcerpt source={source} snippet={snippets[source.id]} />
          </Disclosure>
        ),
      )}
    </Column>
  );
}
