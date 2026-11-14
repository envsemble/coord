# Agent guide

[CONTRIBUTING.md](CONTRIBUTING.md) describes the layout, the conventions and the checks; read it before changing code.

## Tests

Keep the tests quick and few. They come in tiers, from quick to slow:

1. **Quick:** `npm run test:quick`, in the package you change or at the root, with `npm run check:types`. In-process tests that finish in seconds; run them while working.
2. **Full:** `npm test` adds the `*.slow.test.*` files, which start processes, browsers or toolchains. Run it before handing off, with `npm run test:skills` when the plugin changed.
3. **End-to-end:** the packaged app's suite (`npm run package`, then `npm run test:e2e`), with the release checks. Run it only at important milestones and before a release.

When you add or change tests:

- Add a test only for behaviour no existing test covers; extend the existing test of that behaviour rather than adding a parallel one, and remove tests that no longer cover anything.
- Write it at the cheapest tier that can catch the mistake: an in-process test before one that starts processes, and either before an end-to-end test. End-to-end tests are for what only the real app shows: windows, menus, IPC between processes, persistence across restarts, security boundaries and packaging.
- Use one or two representative cases, not every combination. Don't test wording, constants or pixel positions.
- Wait for a condition, never for a fixed time, and share expensive setup within a file.
- A test that starts processes, browsers or toolchains, or takes more than about a second, goes in a `*.slow.test.*` file next to its quick one.
- Don't restructure the suite unless the work asks for it.

<!-- BEGIN envui -->
## envUI

The interface (the app's window in `app/src` and the diagram viewer in `packages/diagrams`) is built with envUI (`@envsemble/envui`). Use envUI's components, tokens and icons for every UI element. Its documentation ships with the package, in `node_modules/@envsemble/envui/docs/`: start at `docs/index.md`, which says what each page is for, and copy from `docs/examples/`. Take the API from those pages and the type declarations, not from memory. If envUI lacks something, propose an addition to envUI rather than writing a local copy. `npm run lint` runs envUI's ESLint and Stylelint rules.
<!-- END envui -->
