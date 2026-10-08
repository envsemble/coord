# Third-party sources

The unmodified OntoUML exchange schema v1.0.2 comes from [OntoUML/ontouml-schema](https://github.com/OntoUML/ontouml-schema/tree/v1.0.2). Its Apache 2.0 license is preserved in schemas/LICENSE. The application evidence schema is separate.

The [ontouml-js](https://github.com/OntoUML/ontouml-js) dependency supplies standard model builders and serialization. Its Apache 2.0 license is also preserved in licenses/ontouml-js-LICENSE. ELK supplies build-time routing under its upstream EPL 2.0 license, distributed with the npm dependency.

React and React DOM 19.3.0 are bundled into offline HTML under their MIT licenses. Full license text remains embedded in the HTML, with copies in licenses/. The reusable React module uses peer dependencies instead of bundling another React runtime.

GitHub's [Octicons](https://github.com/primer/octicons) React package 19.40.0 supplies the interface icons. The MIT license is preserved in licenses/octicons-LICENSE and embedded in offline HTML. The reusable viewer imports the local package dependency; the offline build bundles its used icons. No icon service or CDN is required.

Vite 8.3.3 and its React plugin 6.1.2 provide the development server and Fast Refresh under their upstream MIT licenses, distributed with the npm dependencies. They are not bundled into offline HTML or required by the library at runtime.

fflate 0.8.3 supplies the compressed export archive and offline decompression. Its MIT license is in licenses/fflate-LICENSE and retained in bundled code notices. Shiki 4.5.0 highlights snippets at build time; its MIT license is in licenses/shiki-LICENSE. Shiki's runtime, WebAssembly and grammars are not shipped as browser runtime dependencies.

Learning guidance paraphrases the community [OntoUML specification](https://ontouml.readthedocs.io/en/latest/) and links to individual pages. The upstream documentation repository [OntoUML/OntoUML](https://github.com/OntoUML/OntoUML) is CC0-1.0. No documentation images or diagrams were copied.

The R5 SDK and Flowstate repositories are evidence for the separate example at pinned commits. Short, unmodified excerpts remain in examples/r5/source-snippets.json and its generated HTML with repository, commit, file and line attribution. Copyright in those excerpts remains with their upstream authors. The core library package excludes the example and its excerpts. Complete repositories and game binaries are not bundled.

PostgreSQL capture uses node-postgres (`pg`) under its MIT license, retained in its npm distribution. Local D1 fixtures use Wrangler (MIT/Apache 2.0) and workerd (Apache 2.0); these development tools are not bundled in exported HTML.

Dependencies are pinned in package-lock.json and retain their upstream licenses in their npm distributions. This repository is private and does not currently grant a public source-code license.

Atlas logos, icons and banners in `assets/` are original editable SVG artwork created for this repository; application screenshots show the actual local viewer and planning integration. They follow the repository's current private/UNLICENSED status. The symbol uses a shared inheritance trunk and colored entities. No upstream documentation imagery or third-party logo was copied into it. GitHub-style interface tokens and Octicons retain the notices above; Atlas branding does not imply affiliation.

TypeScript 6.0.3 is distributed as the `typescript-compiler` npm alias under Apache-2.0, including its upstream license. Atlas uses its classic compiler API for source inspection. TypeScript 7.0.2 remains a development type checker. The Java inspector is Atlas source using standard JDK 21 compiler APIs; the JDK is an external prerequisite. prettier-plugin-java 2.11.0 is a development formatter under its upstream Apache-2.0 license.
