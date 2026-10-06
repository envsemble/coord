# Third-party sources

`schemas/ontouml-schema.json` is the OntoUML JSON schema v1.0.2, distributed by [OntoUML/ontouml-schema](https://github.com/OntoUML/ontouml-schema/tree/v1.0.2). It is unmodified and its Apache 2.0 license is preserved in `schemas/LICENSE`.

React and React DOM 19.3.0 are bundled into `index.html`. Their MIT licenses are preserved in `licenses/react-LICENSE` and `licenses/react-dom-LICENSE`; the full license text is also embedded in the standalone HTML. React DOM's bundled Scheduler is covered by the same Meta MIT license.

Build dependency versions are pinned in `package-lock.json`; their license files are supplied by their npm packages. Other dependencies, including esbuild, are used during generation and are not shipped as browser runtime libraries.

Shiki 4.5.0 supplies build-time syntax highlighting with the GitHub default themes. Its MIT license is preserved in `licenses/shiki-LICENSE`; its runtime, WebAssembly, and grammar libraries are not included in the viewer.

The R5 SDK and Flowstate repositories are referenced as evidence at pinned commits. Short, unmodified source excerpts are included in `model/source-snippets.json` and the HTML previews, with repository, commit, file, and line attribution. Copyright in those excerpts remains with their respective upstream authors. The complete repositories and game binaries are not bundled. The source manifest records links and analytical claims from static inspection.
