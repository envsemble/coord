import { Fragment, memo } from "react";

// Pre-highlighted excerpt with its source line numbers. envUI's CodeBlock
// highlights at run time and has no line numbers, so the viewer keeps this
// markup (styled with envUI's code tokens) for the tokens prepared at build.
export const CodeSnippet = memo(function CodeSnippet({ snippet, label }) {
  return (
    <pre className="shiki code-snippet" tabIndex={0} aria-label={label}>
      <code>
        {snippet.lines.map((tokens, i) => (
          <Fragment key={i}>
            <span className="code-line" data-line={snippet.startLine + i}>
              {tokens.map((token, j) => (
                <span key={j} style={token.style}>
                  {token.content}
                </span>
              ))}
            </span>
            {i < snippet.lines.length - 1 ? "\n" : null}
          </Fragment>
        ))}
      </code>
    </pre>
  );
});
