# Third-party sources

Atlas's grammar for its subset of PlantUML (`packages/diagrams/lib/plantuml/plantuml.peggy`) is derived from the PlantUML grammar of [plantuml-parser](https://github.com/Enteee/plantuml-parser) 0.4.0 by Ente and its contributors, under the Apache License 2.0; the grammar keeps its notice, and the license text is in packages/diagrams/licenses/plantuml-parser-LICENSE. [Peggy](https://github.com/peggyjs/peggy) 5.1.0 (MIT) generates the committed parser from it during development and is not needed at runtime. PlantUML itself is neither bundled nor required; an optional test checks diagrams with a PlantUML jar the developer supplies. ELK supplies build-time routing under its upstream EPL 2.0 license, distributed with the npm dependency.

React and React DOM 19.3.0 are bundled into offline HTML under their MIT licenses. Full license text remains embedded in the HTML, with copies in packages/diagrams/licenses/. The reusable React module uses peer dependencies instead of bundling another React runtime.

The plan export viewer (`packages/atlas/dist/plan-viewer.html`) bundles React and React DOM, react-markdown and remark-gfm with their unified, micromark, mdast and hast dependencies, github-slugger, envUI with Base UI and Floating UI, the Material Symbols icons it uses, the Inter font, and fflate, each under its MIT, ISC, Apache 2.0 or SIL Open Font License. The build lists every bundled package with its version and license and embeds the license texts in the viewer script.

The interface is built on envUI (`@envsemble/envui`), Envsemble's own private component library. It brings [Base UI](https://github.com/mui/base-ui) and Floating UI (MIT), Google's [Material Symbols](https://github.com/google/material-design-icons) (Apache 2.0) and the [Inter](https://github.com/rsms/inter) font (SIL Open Font License 1.1); their notices ship in envUI's package, and the offline diagram and plan files embed them.

The `atlas` skill's interview and domain-modeling methods are adapted from Matt Pocock's work and keep their [attribution](plugin/skills/atlas/references/ATTRIBUTION.md) and [MIT license](plugin/skills/atlas/references/LICENSE).

The interface icons are envUI's Material Symbols. The reusable viewer imports them from envUI; the offline build bundles the icons it uses. No icon or font service or CDN is required.

The AI providers' marks beside model names in the app's statistics (Claude's spark for Anthropic, the OpenAI blossom, the Gemini sparkle, Mistral AI's M and the DeepSeek whale) are SVG paths from [Simple Icons](https://github.com/simple-icons/simple-icons) under CC0 1.0: release 16.35.0, and 15.22.0 for OpenAI's, the last release that included it. Only the path data is copied, in `app/src/ui/AiModel.tsx`. The marks are trademarks of their owners and only identify their models; showing them implies no endorsement or affiliation.

The editors' marks in the app's Open in button (Visual Studio Code's, also for VS Code Insiders, Cursor's, Windsurf's and Zed's) are SVG paths from [Simple Icons](https://github.com/simple-icons/simple-icons) under CC0 1.0: release 16.35.0, and 12.4.0 for Visual Studio Code's, the last release that included it. Only the path data is copied, in `app/src/ui/EditorMark.tsx`. The marks are trademarks of their owners and only identify their editors; showing them implies no endorsement or affiliation.

Vite 8.3.3 and its React plugin 6.1.2 provide the development server and Fast Refresh under their upstream MIT licenses, distributed with the npm dependencies. They are not bundled into offline HTML or required by the library at runtime.

fflate 0.8.3 supplies the compressed export archive and offline decompression. Its MIT license is in packages/diagrams/licenses/fflate-LICENSE and retained in bundled code notices. Shiki 4.5.0 highlights snippets at build time; its MIT license is in packages/diagrams/licenses/shiki-LICENSE. Shiki's runtime, WebAssembly and grammars are not shipped as browser runtime dependencies.

PostgreSQL capture uses node-postgres (`pg`) under its MIT license, retained in its npm distribution. Local D1 fixtures use Wrangler (MIT/Apache 2.0) and workerd (Apache 2.0); these development tools are not bundled in exported HTML.

The Atlas host (`packages/atlas/src/host`), which the desktop app runs and `atlas serve` starts, serves planning folders with [Hono](https://github.com/honojs/hono) 4.13.13 and @hono/node-server 2.1.4, and its WebSocket connections with [ws](https://github.com/websockets/ws) 8.22.0, each under its MIT license. Pairing links are drawn as QR codes with [node-qrcode](https://github.com/soldair/node-qrcode) 1.5.4 and its dijkstrajs 1.0.3 and pngjs 5.0.0 dependencies, under their MIT licenses. The desktop app bundles them into its main and host processes; their license texts remain in their npm distributions.

Dependencies are pinned in package-lock.json and retain their upstream licenses in their npm distributions. This repository is private and does not currently grant a public source-code license.

Atlas logos, icons and banners in `assets/` derive from the Atlas lockup in the Envsemble brand assets: the connected A mark is original artwork, and the wordmark and the banner tagline are set in Jost (Owen Earl, indestructible type\*, under the SIL Open Font License 1.1) and outlined into paths, so no font software is distributed. Application screenshots show the actual local viewer and planning integration. They follow the repository's current private/UNLICENSED status. No upstream documentation imagery or third-party logo was copied into them. Interface components, icons and the font retain the notices above; Atlas branding does not imply affiliation.

TypeScript 6.0.3 is distributed as the `typescript-compiler` npm alias under Apache-2.0, including its upstream license. Atlas uses its classic compiler API for source inspection. TypeScript 7.0.2 remains a development type checker. The Java inspector is Atlas source using standard JDK 21 compiler APIs; the JDK is an external prerequisite. prettier-plugin-java 2.11.0 is a development formatter under its upstream Apache-2.0 license.
