# Third-party sources

The unmodified OntoUML exchange schema v1.0.2 comes from [OntoUML/ontouml-schema](https://github.com/OntoUML/ontouml-schema/tree/v1.0.2). Its Apache 2.0 license is preserved in schemas/LICENSE. The application evidence schema is separate.

The [ontouml-js](https://github.com/OntoUML/ontouml-js) dependency supplies standard model builders and serialization. Its Apache 2.0 license is also preserved in licenses/ontouml-js-LICENSE. ELK supplies build-time routing under its upstream EPL 2.0 license, distributed with the npm dependency.

React and React DOM 19.3.0 are bundled into offline HTML under their MIT licenses. Full license text remains embedded in the HTML, with copies in licenses/. The reusable React module uses peer dependencies instead of bundling another React runtime.

fflate 0.8.3 supplies the compressed export archive and offline decompression. Its MIT license is in licenses/fflate-LICENSE and retained in bundled code notices. Shiki 4.5.0 highlights snippets at build time; its MIT license is in licenses/shiki-LICENSE. Shiki's runtime, WebAssembly and grammars are not shipped as browser runtime dependencies.

Learning guidance paraphrases the community [OntoUML specification](https://ontouml.readthedocs.io/en/latest/) and links to individual pages. The upstream documentation repository [OntoUML/OntoUML](https://github.com/OntoUML/OntoUML) is CC0-1.0. No documentation images or diagrams were copied.

The R5 SDK and Flowstate repositories are evidence for the separate example at pinned commits. Short, unmodified excerpts remain in examples/r5/source-snippets.json and its generated HTML with repository, commit, file and line attribution. Copyright in those excerpts remains with their upstream authors. The core library package excludes the example and its excerpts. Complete repositories and game binaries are not bundled.

Dependencies are pinned in package-lock.json and retain their upstream licenses in their npm distributions. This repository is private and does not currently grant a public source-code license.
