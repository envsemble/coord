# Third-party sources

`schemas/ontouml-schema.json` is the OntoUML JSON schema v1.0.2, distributed by [OntoUML/ontouml-schema](https://github.com/OntoUML/ontouml-schema/tree/v1.0.2). It is unmodified and its Apache 2.0 license is preserved in `schemas/LICENSE`.

React and React DOM 19.3.0 are bundled into `index.html`. Their MIT licenses are preserved in `licenses/react-LICENSE` and `licenses/react-dom-LICENSE`; the full license text is also embedded in the standalone HTML. React DOM's bundled Scheduler is covered by the same Meta MIT license.

Build dependency versions are pinned in `package-lock.json`; their license files are supplied by their npm packages. Other dependencies, including esbuild, are used during generation and are not shipped as browser runtime libraries.

The R5 SDK and Flowstate repositories are referenced as evidence at pinned commits. Their source code and game binaries are not bundled here. The source manifest records links and analytical claims from static inspection.
