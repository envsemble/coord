import { Button } from "@envsemble/envui";
import { CodeSnippet } from "../../ui/CodeSnippet";
import { ExternalIcon } from "../../ui/icons";
import { elementFile } from "../../review/changes";
import { Section } from "./Section";

function sourceOf(element, sources) {
  const ids = [element.primarySource, ...(element.evidence || [])].filter(
    Boolean,
  );
  return ids.map((id) => sources.find((s) => s.id === id)).find(Boolean);
}

/** Where a captured declaration is: its file and lines, and its source excerpt. */
export function CodeWhere({ element, model, snippets, change }) {
  if (change === "added") return null;
  const file = elementFile(element, model);
  const location = element.location;
  const source = sourceOf(element, model.sources || []);
  const snippet = source && snippets?.[source.id];
  if (!file && !snippet) return null;
  const url = snippet?.url || source?.url;
  return (
    <Section title={change === "removed" ? "Where it was" : "Where in code"}>
      <div className="code-where">
        <code className="code-path" title={file || undefined}>
          {file || source.file}
        </code>
        {location && (
          <span className="code-lines">
            {location.startLine === location.endLine
              ? `line ${location.startLine}`
              : `lines ${location.startLine}–${location.endLine}`}
          </span>
        )}
      </div>
      {snippet && (
        <CodeSnippet
          snippet={snippet}
          label={`${file || source.title}, lines ${snippet.startLine} to ${snippet.endLine}`}
        />
      )}
      {url && (
        <Button
          variant="text"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          endIcon={<ExternalIcon />}
          className="code-source-link"
        >
          {url.startsWith("https://github.com/")
            ? "View on GitHub"
            : "View source"}
        </Button>
      )}
    </Section>
  );
}
