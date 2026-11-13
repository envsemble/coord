# Working on Atlas

This is where Atlas's development lives: set-up, the repository's layout, conventions, tests, the checks CI runs and releases. The [app guide](app/README.md) and the [documentation](docs/README.md) describe Atlas itself.

## Principles

- Plans, lifecycle decisions and reported outcomes live in a planning folder, never in this repository. The plugin's tools and skills assist that workflow; the desktop app writes to a planning folder only on an explicit action (creating or renaming a project, changing its folders).
- Diagram documents stay separate from capture adapters, validation, layout and React rendering. The viewer inspects diagrams; agents and library calls author them.
- Captures stay frozen and visibly scoped. What a capture cannot establish is reported as coverage, never guessed.

## Set up and run

Use Node 24, npm and Git, and Java 21 for the Java capture tests. The interface comes from envUI (`@envsemble/envui`, from npm), whose documentation ships in `node_modules/@envsemble/envui/docs/` ([AGENTS.md](AGENTS.md) says how to use it). Run `npm ci`, then:

- `npm run dev` starts the desktop app with electron-vite: the window reloads React changes in place, and the app restarts when main-process or preload code changes. There is no browser mode. Give it a home of its own with `ATLAS_HOME` (`ATLAS_HOME=~/.atlas-dev npm run dev`): it then keeps all its files there, Electron's included, and runs beside your installed Atlas. Without it, a development run uses your Atlas home and shares the installed app's single-instance lock.
- `npm run dev:home` starts it on a home of its own in `artifacts/dev-home`, seeded with a demo project and agent reports, with this checkout's `atlas` command first on the `PATH` (shims in `artifacts/dev-bin`), so the plugin's hooks and MCP server run this version too.
- `npm run dev:envui` does the same against a local envUI checkout beside this one (`../envUI`, or `ENVUI_PATH`), with live reload for envUI's components too; it links that checkout into the app and the diagram viewer without changing `package.json` or the lockfile. `npm run envui:unlink` returns to the published version, and `node scripts/dev-envui.mjs --link` links again after an `npm install` replaced the link.
- `npm run dev:diagrams` starts the diagram viewer alone at `http://127.0.0.1:5173/`, showing the shop example, with live updates.
- `npm run build` builds every workspace: the app and the diagram package's `index.html`, `downloads/` and reusable React module. The HTML opens directly from disk (or with `npm run preview` at port 4173) and needs no network or model service.
- `npm run package` builds the app's installer on Windows or AppImage on Linux into `app/release/`.

To use this checkout's `atlas` command, run `npm link --workspace @envsemble/atlas`, then `atlas setup`.

The examples in `packages/diagrams/examples` are work folders of diagram files: `shop`, a TypeScript capture with a proposal of saved payment methods, shown by [index.html](packages/diagrams/index.html), and `enrollment`, a class diagram with four scenarios. `npm run check` checks them and the committed showcase.

## Layout

| Path                | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/`              | The Electron desktop app ([app guide](app/README.md)): the main process in `main/`, the bridge in `preload/`, the message contract and its validator in `shared/`, the React window in `src/`, and the Playwright suite in `e2e/`. electron-vite builds it and electron-builder packages it.                                                                                                                                                              |
| `packages/atlas`    | The `atlas` command (`src/cli`, [command reference](docs/command.md)); the Atlas host (`src/host`), which reads and watches planning folders for the app and serves them to paired computers ([remote access](docs/remote-access.md)); the planning reader and work tools they share (`src/planning`); the Atlas home and its database (`src/home`); processes, Git and paths (`src/platform`); and the planning folder templates (`templates/planning`). |
| `packages/diagrams` | The diagram package: the Node library in `lib/` (`plantuml`, `capture`, `layout`, `payload`, `render`, `scenarios`), the React viewer in `src/` (`canvas`, `details`, `model`, `review`, `scenarios`, `ui`, `viewer`), the development page in `development/`, the example diagrams in `examples/`, and its build and check scripts in `scripts/`.                                                                                                        |
| `plugin/`           | The Atlas plugin for Claude Code and Codex: its manifests, MCP server configuration, hooks and the `atlas`, `atlas-grill` and `atlas-implement` skills, with their packaging test in `plugin/tests` ([agent interface](docs/agent-interface.md)). The marketplace manifests that name it are `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`.                                                                                    |
| `extras/`           | Skills that are not part of the plugin, installed separately: `babysit-pr`.                                                                                                                                                                                                                                                                                                                                                                               |
| `scripts/`          | The development home and envUI link (`dev-home.mjs`, `dev-envui.mjs`), the test tiers (`test-tier.mjs`, `test-home.mjs`), and release assembly and its check (`release.cjs`, `check-release.cjs`).                                                                                                                                                                                                                                                        |
| `docs/`             | The documentation ([index](docs/README.md)), with the [repository history maps](docs/history/README.md).                                                                                                                                                                                                                                                                                                                                                  |
| `assets/`           | Editable branding (SVG) and the screenshots the documents show.                                                                                                                                                                                                                                                                                                                                                                                           |

In the app, `main/` holds the windows (`main/windows/`: each window in `window.ts`, the open windows in `windowManager.ts`, with the menu, the `atlas:` protocol and the message handlers), the app's state in the home database (`main/appState.ts`), the switches it refuses at start (`main/startupRefusal.ts`) and the computers whose projects it shows (`main/computers/`); `main/host/` starts this computer's Atlas host in a utility process. `src/App.tsx` starts a window; its folders are `window/` (the place shown, its history and scroll positions), `titleBar/`, `navigation/` (places, history and search), `hub/`, `projects/`, `plan/`, `diagrams/`, `reader/` (documents, links and references), `files/` (the Files card), `statistics/`, `computers/` (pairing and remote access) and `ui/` (what they share). `src/atlas.css` lays out Atlas's own regions with envUI tokens only.

The [architecture](docs/architecture.md), [agent](docs/agent-interface.md) and adapter guides own their contracts.

## Conventions

- `packages/atlas` is TypeScript that Node 24 runs directly without a build step, so it uses only erasable syntax (no enums, namespaces or parameter properties; `erasableSyntaxOnly` enforces it) and `.ts` import extensions.
- The interface uses envUI's components, tokens and icons; `npm run lint` runs envUI's ESLint rules on the app's window and the diagram viewer and its Stylelint rules on their style sheets. Where a raw element or a literal colour is needed, disable the rule on that line and say why.
- Code is not formatted with Prettier. Prettier covers `docs/*.md`, `scripts/`, the root `README.md`, `CONTEXT.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md` and `package.json`, and the diagram package's own list; `npm run format` fixes them and `npm run format:check` checks them.
- Commit generated output with its source: `index.html`, `downloads/` and `dist/` in `packages/diagrams`. CI fails when they are stale.
- Screenshots show the actual application and have alternative text that says what they show. Keep private source excerpts scoped and attributed.

## Tests

The tests come in tiers, from quick to slow ([AGENTS.md](AGENTS.md) gives agents the same rules); run the quickest one that can catch the mistake:

1. **Quick, while working:** `npm run test:quick` (in a package, or at the root for all of them), `npm run check:types` and `npm run lint`. In-process tests, in seconds.
2. **Full, before a PR:** `npm test`, which adds each package's `*.slow.test.*` files (tests that start processes, browsers or toolchains), and `npm run test:skills` when the plugin changed.
3. **End-to-end, at milestones and before a release:** the packaged app's suite, with the remaining checks:

```sh
npm run format:check
npm run lint
npm run build
npm run check
npm run check:package
npm run check:performance
npm run check:release
npm run package
npm run test:e2e
```

A new test covers behaviour no existing test covers, at the cheapest tier that can catch the mistake, with one or two representative cases rather than every combination, and waits for conditions rather than fixed times. A test that starts processes, browsers or toolchains, or takes more than about a second, goes in a `*.slow.test.*` file next to its quick one. End-to-end tests are for what only the real app shows: windows, menus, IPC, persistence across restarts, security and packaging.

The end-to-end suite copies `app/e2e/fixtures/planning` into a temporary Git repository and uses a temporary Atlas home, so it never touches your own data. `npm run package` builds twice from the same output: the release (the installer or AppImage, and the unpacked app in `release/win-unpacked` or `release/linux-unpacked`), with the inspector fuse off, and an otherwise identical unpacked copy in `release/e2e` with it on, because Playwright drives Electron through the inspector. The suite drives `release/e2e`; `e2e/release.spec.ts` starts the release build itself to check that it opens a project, has the inspector fuse off, and refuses debugging switches and `--no-sandbox`. `ATLAS_E2E_UNPACKAGED=1` runs the suite against `app/out/` without packaging, and `ATLAS_E2E_INSTALLER=1` also installs and uninstalls the Windows installer. Packaging drops the diagram package's dependencies that only its command-line features use (`app/scripts/after-pack.cjs`), and adds the `atlas` command with the official Node.js it runs on, downloaded from nodejs.org once, checked against the release's `SHASUMS256.txt` and kept in `artifacts/node-runtime` (`app/scripts/agent-payload.cjs`).

Full database capture verification needs `ATLAS_TEST_POSTGRES` pointing at a disposable PostgreSQL 17 fixture; credentials belong in the environment, never in diagrams. Windows-specific and POSIX-specific tests say when they skip.

## Pull requests and CI

A PR description says what behaviour changes, its scope, and how it was validated. Link consequential decisions to their plan, and for design changes the diagrams that show them.

CI is one Linux job, `CI` (`.github/workflows/ci.yml`), for pull requests into `dev` and `main` once they are ready for review; drafts run nothing, and a new push cancels the run for the older head. It runs formatting, types, the unit tests, the plugin suite, the builds and the diagram, package, performance and release checks (the versioned [release ZIP](docs/releases.md) must assemble reproducibly), checks that committed build output is current, and scans the Git history with Betterleaks (version- and hash-pinned). A pull request that changes only documentation (Markdown files and `docs/`, but not the plugin's skills, `extras/` or the end-to-end fixtures) runs only Betterleaks.

Pull requests into `main`, the releases, also run the `End-to-end` workflow (`e2e.yml`) against the packaged AppImage; a pull request retargeted to `main` runs it after its next push, or after closing and reopening it. Run the end-to-end suite yourself when a change into `dev` affects the app. `CI` and, into `main`, `End-to-end` are required checks. CI keeps nothing from a passing run; a failed end-to-end run keeps its report for the organization's artifact retention. Jobs run on the runners the organization variables `CI_LINUX_RUNNER` and `CI_WINDOWS_RUNNER` name.

## Releases

Merge the release into `main`, then tag `main` with the version: `git fetch origin && git tag v0.8.0 origin/main && git push origin v0.8.0`. The release workflow (`release.yml`) makes a GitHub Release with the release ZIP, the AppImage and the Windows installer; nothing is deployed or published to a registry. [Releases](docs/releases.md) describes the ZIP, the workflow and how to recover from a failed run. Record each version in the [changelog](CHANGELOG.md).

## Branding, history and source status

- Editable branding lives in `assets/` (SVG banners and logos); the app and viewer icon is `packages/diagrams/assets/atlas-icon.svg`.
- The app and the skills arrived from earlier repositories with rewritten history; the [repository history maps](docs/history/README.md) translate their old commit IDs.
- Source is currently private and `UNLICENSED`: a source-use status, not an open-source license. Do not introduce a public license without the owner's decision. Dependency licenses and attributed example excerpts remain preserved; [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists them.
