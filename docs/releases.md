# Local packages and versioned artifacts

Atlas remains `private` and `UNLICENSED`. Install the tarball locally; no public registry release is enabled. Any source-license or hosting decision is separate.

From a clean committed checkout, with Node 24, npm, Git and Java 21:

```sh
npm ci
npm run check:types
npm test
npm run build
npm run check
npm run check:package
npm run check:performance
npm run check:release
npm run release:assemble -- artifacts/release
```

Configure `ATLAS_TEST_POSTGRES` for the PostgreSQL 17 fixture before the full suite. Without it the PostgreSQL fixture is explicitly skipped; that does not establish the adapter's gate. SQLite uses Node 24's built-in engine. D1 fixtures use the pinned Wrangler development tool. See each adapter's support matrix.

Assembly rejects dirty source or stale committed build output and uses an isolated copy of the actual committed Git tree, excluding ignored files and hidden working-tree edits. Git replacement objects and lazy network fetches are disabled. It produces one `atlas-<version>-<commit>.zip` and an `atlas/release` manifest with content hashes. The ZIP includes the committed `app/`, `packages/`, `plugin/`, `extras/`, `assets/` and `docs/` trees and the plugin marketplace manifests with the root documents and lockfile, an installable tarball of the diagram package, and the shop and enrollment examples as offline HTML. Committed `.atlas/` model data is never included. Fixed local calendar metadata makes archive hashes consistent across timezones. `check:release` assembles in two timezones, verifies hashes and reads back the examples' embedded diagrams; it never publishes.

Install the included tarball with `npm install ./envsemble-atlas-diagrams-<version>.tgz`. The package contains the Node and MCP APIs and precompiled React entry point (the `atlas` command lives in `packages/cli`), schemas, agent guidance and the viewer icon. Source examples remain in the repository/release ZIP rather than the core package. React 19.3 is a peer dependency. Use default ESM import (`import atlas from '@envsemble/atlas-diagrams'`) or CommonJS; the lazy CJS exports do not promise static named ESM import detection.

The app in `app/` depends on the diagram package through the npm workspace; there is no separately pinned tarball.

The desktop app's installers are not part of the release ZIP. The ZIP is the same bytes in every timezone and on every operating system, while the unsigned NSIS installer and the AppImage are per-platform builds of about 125 MB that electron-builder does not produce byte for byte. `npm run package` builds the installer on Windows and the AppImage on Linux. The ZIP carries the app's source and lockfile, so the installers can be rebuilt from it. CI checks that the release assembles reproducibly and keeps nothing from it.

## GitHub Releases

Pushing a version tag on `main` (`v0.7.2`) runs the release workflow (`.github/workflows/release.yml`):

1. It checks that the tagged commit is on `main`, that the tag is the version in `package.json`, and that `CHANGELOG.md` has a section for it, which becomes the release notes. Then it creates a draft release.
2. A Linux job assembles the release ZIP and builds the AppImage; a Windows job builds the installer and tests it by installing it for the runner's user, starting it and uninstalling it. Each adds its files to the draft.
3. The draft is published only when both jobs pass; otherwise it is deleted. Fix the problem and push the tag again.

The files go straight into the release rather than into workflow artifacts. The Windows job is the only Windows run in Atlas's CI.
