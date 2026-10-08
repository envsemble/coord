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

Assembly rejects dirty source or stale committed build output and uses an isolated copy of the actual committed Git tree, excluding ignored files and hidden working-tree edits. Git replacement objects and lazy network fetches are disabled. It produces `atlas-<version>-<commit>.zip` and a manifest with content hashes. The ZIP includes an installable npm tarball, offline R5 and enrollment HTML, schemas, documentation, editable branding, screenshots, notices and an explicit model review pair. Fixed local calendar metadata makes archive hashes consistent across timezones. `check:release` assembles in two timezones, verifies hashes and reopens the report; it never publishes.

Install the included tarball with `npm install ./ontouml-atlas-<version>.tgz`. The package contains the Node/MCP/CLI APIs and precompiled React entry point, schemas, docs and assets. Source examples remain in the repository/release ZIP rather than the core package. React 19.3 is a peer dependency. Use default ESM import (`import atlas from 'ontouml-atlas'`) or CommonJS; the lazy CJS exports do not promise static named ESM import detection.

The Worktrail dashboard pins a tarball by Atlas source commit and SHA-256. Refresh from a clean committed Atlas checkout, then run `npm install` and dashboard checks. Its GitHub CI works without the Atlas source checkout. GitHub Actions assembles artifacts; the default-branch name affects badge status but does not publish an artifact release. Required checks are `CI` and `Betterleaks`.
