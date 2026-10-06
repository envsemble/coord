const squirrel = {
  name: "squirrel",
  scopeName: "source.squirrel",
  patterns: [
    {
      match: "\\b(function|entity|var|thread|foreach|local|in)\\b",
      name: "keyword.control.squirrel",
    },
    { include: "source.cpp" },
  ],
};

// Only the precomputed token data reaches the client. The highlighter, grammars,
// and source repositories are never runtime dependencies of the offline HTML.
async function highlightSnippets(sources, excerpts) {
  const { createHighlighter } = await import("shiki");
  const highlighter = await createHighlighter({
    themes: ["github-dark-default", "github-light-default"],
    langs: [
      "cpp",
      "markdown",
      "javascript",
      "typescript",
      "python",
      "java",
      "json",
      "csharp",
      "go",
      "rust",
      squirrel,
    ],
  });
  try {
    return Object.fromEntries(
      sources.map((source) => {
        const excerpt = excerpts[source.id];
        if (
          !excerpt ||
          excerpt.repo !== source.repo ||
          excerpt.commit !== source.commit ||
          excerpt.file !== source.file
        )
          throw new Error(`Stale or missing source excerpt: ${source.id}`);
        const lines = excerpt.code.split("\n");
        if (
          !Number.isInteger(excerpt.startLine) ||
          excerpt.startLine < 1 ||
          !excerpt.code ||
          lines.length > 12
        )
          throw new Error(`Invalid source excerpt: ${source.id}`);
        const language =
          {
            "C++": "cpp",
            Squirrel: "squirrel",
            Markdown: "markdown",
            JavaScript: "javascript",
            TypeScript: "typescript",
            Python: "python",
            Java: "java",
            JSON: "json",
            "C#": "csharp",
            Go: "go",
            Rust: "rust",
            Text: "text",
          }[excerpt.language] ||
          (highlighter.getLoadedLanguages().includes(excerpt.language)
            ? excerpt.language
            : null);
        if (!language)
          throw new Error(`Unsupported snippet language: ${source.id}`);
        const { tokens } = highlighter.codeToTokens(excerpt.code, {
          lang: language,
          themes: {
            dark: "github-dark-default",
            light: "github-light-default",
          },
          defaultColor: false,
        });
        const endLine = excerpt.startLine + lines.length - 1;
        return [
          source.id,
          {
            language: excerpt.language,
            startLine: excerpt.startLine,
            endLine,
            code: excerpt.code,
            url: source.url
              ? `${source.url.split("#")[0]}#L${excerpt.startLine}-L${endLine}`
              : null,
            lines: tokens.map((line) =>
              line.map(({ content, htmlStyle }) => ({
                content,
                style: htmlStyle,
              })),
            ),
          },
        ];
      }),
    );
  } finally {
    highlighter.dispose();
  }
}

module.exports = { highlightSnippets };
