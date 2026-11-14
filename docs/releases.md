# Local packages and versioned artifacts

Coord is open source under the MIT license. Its packages stay `private` in npm's sense: nothing is published to a registry, and the release ZIP's diagram tarball installs locally.

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

Configure `COORD_TEST_POSTGRES` for the PostgreSQL 17 fixture before the full suite. Without it the PostgreSQL fixture is explicitly skipped; that does not establish the adapter's gate. SQLite uses Node 24's built-in engine. D1 fixtures use the pinned Wrangler development tool. See each adapter's support matrix.

Assembly rejects dirty source or stale committed build output and uses an isolated copy of the actual committed Git tree, excluding ignored files and hidden working-tree edits. Git replacement objects and lazy network fetches are disabled. It produces one `coord-<version>-<commit>.zip` and an `coord/release` manifest with content hashes. The ZIP includes the committed `app/`, `packages/`, `plugin/`, `assets/` and `docs/` trees and the plugin marketplace manifests (`.claude-plugin/`, `.agents/`) with the root documents, `package.json` and lockfile, an installable tarball of the diagram package, and the shop and enrollment examples as offline HTML. Fixed local calendar metadata makes archive hashes consistent across timezones. `check:release` assembles in two timezones, verifies hashes and reads back the examples' embedded diagrams; it never publishes.

Install the included tarball with `npm install ./envsemble-coord-diagrams-<version>.tgz`. The package contains the Node API and the precompiled React entry point (the `coord` command lives in `packages/coord`), the capture configuration schemas and the viewer icon. Source examples remain in the repository/release ZIP rather than the core package. React 19.3 is a peer dependency. Use default ESM import (`import coord from '@envsemble/coord-diagrams'`) or CommonJS; the lazy CJS exports do not promise static named ESM import detection.

The app in `app/` depends on the diagram package through the npm workspace; there is no separately pinned tarball.

The desktop app's installers are not part of the release ZIP. The ZIP is the same bytes in every timezone and on every operating system, while the unsigned NSIS installer and the AppImage are per-platform builds of about 125 MB that electron-builder does not produce byte for byte. `npm run package` builds the installer on Windows and the AppImage on Linux. The ZIP carries the app's source and lockfile, so the installers can be rebuilt from it. CI checks that the release assembles reproducibly and keeps nothing from it.

## GitHub Releases

The release workflow (`.github/workflows/release.yml`) makes Coord's releases on GitHub's own runners, free for a public repository, in two channels. The installed app updates from them ([updates](../app/README.md#updates)), and the [website](../site/README.md) offers their files.

- **Stable:** pushing a version tag on `main` (`git fetch origin && git tag v0.9.0 origin/main && git push origin v0.9.0`) releases that commit, marked as the latest release.
- **Nightly:** every night at 03:00 UTC (04:00 in Central European winter time, 05:00 in summer), the newest commit of `dev` becomes a prerelease `vX.Y.Z-nightly.YYYYMMDD.RUN`, on the patch after the version in `package.json` (`0.8.0` gives `0.8.1-nightly.20261115.42`), unless the newest nightly already built that commit. **Run workflow** on the Release workflow builds one at once, changed or not. The repository variable `PAUSE_NIGHTLY=true` stops the scheduled ones (`gh variable set PAUSE_NIGHTLY --body true`; `gh variable delete PAUSE_NIGHTLY` resumes them). The 14 newest nightlies are kept; older ones are deleted with their tags. Nothing but these two kinds of version tag should be pushed: electron-updater finds the newest nightly in the release feed, which lists the 10 newest tags.

A run:

1. **Prepare.** For a stable tag, it checks that the tagged commit is a commit of `main` itself, not one merged into it, that the tag is the version in `package.json`, and that `CHANGELOG.md` has a section for it, which becomes the release notes. For a nightly, the notes list the commits since the last nightly. Then it creates a draft release (a nightly's tag is made on `dev`'s commit when it is published).
2. **Build.** A Linux job builds the AppImage, and for a stable release assembles the release ZIP; a Windows job builds the installer and tests it by installing it for the runner's user, starting it and uninstalling it. Each packages the version it was given and adds its files to the draft, with the update files electron-updater reads: `latest.yml` and `latest-linux.yml` for stable, `nightly.yml` and `nightly-linux.yml` for nightly, and the installer's blockmap for smaller downloads.
3. **Publish.** The draft is published only when both jobs pass; otherwise it stays an unpublished draft.

To pull a bad nightly, delete its release and tag (`gh release delete <tag> --cleanup-tag`): installs on the nightly channel then find the one before it, and the next night's build replaces it.

When a job fails by chance (a flaky test or runner), **Re-run failed jobs** on the latest run for the tag fills the draft and publishes it. When a failed release needs a fix, merge it into `main` and move the tag to the new commit; the next run replaces the draft:

```sh
git fetch origin && git tag -f v0.8.0 origin/main && git push --force origin v0.8.0
```

A published release is never replaced: a run for its tag stops, and an older run's uploads stop once the tag has moved. Release a fix to a published version as a new version.

The files go straight into the release rather than into workflow artifacts. The Windows jobs are the only Windows runs in Coord's CI.
