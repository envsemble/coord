# Pages

A page is a view you make in a work item for the user to look at or decide with: a choice between visual options, data worth seeing, a before and after. Atlas builds it and shows it in place, beside the work item's files, so the user runs nothing. Most work needs none.

## When to make one

Make a page when it clearly helps, without asking first, and say it is there:

- the user is deciding something visual (layouts, palettes, wording, which of several options);
- there is data the user should see rather than read about (measurements, a comparison across runs, a before and after);
- you need answers you will act on: a page can collect them as choices.

A plan, a table or a diagram does the job more often. Make no page for something one sentence says.

## Where it goes

A page is a folder in the work item's `pages/` folder, named for what it shows (`pages/card-layout`). It holds:

- `page.tsx`, which exports the page's React component as its default (`page.jsx`, `page.ts` or `page.js` do too);
- whatever else it imports: other components, styles (`.css`), data (`.json`, `.csv`, `.md`, images);
- data it reads as it runs, and `choices.json`, where it saves the user's choices.

Keep the data in files apart from the code, so you can update it without touching the page, and the page shows the same thing when opened again later. Link the page from the plan where it matters, as a diagram is linked: `[the card layouts](pages/card-layout)`. Atlas shows the link as a page and opens it in place.

Atlas builds the page after each edit, as it checks diagrams, and tells you what is wrong. An open page updates as you change it; a file it only reads, it reads again.

## The stack

A page imports only Atlas's stack, which Atlas supplies, and its own files:

- `react` and `react-dom`;
- envUI, the design system Atlas is built with: `@envsemble/envui`, its `code`, `markdown`, `diff` (before and after for text and code) and `messages` entries, and its icons (`import { IconAdd } from '@envsemble/envui/icons/Add'`);
- `@envsemble/atlas-diagrams/react`, the diagram viewer, though `Diagram` below is simpler;
- `@envsemble/atlas-page`, below.

Use envUI's components, tokens and icons for everything, as Atlas does: the page then looks like Atlas, in its light and dark themes. Its documentation is in `references/envui/` beside this guide when Atlas installed the plugin (in a checkout of Atlas, `node_modules/@envsemble/envui/docs/`): start at `index.md`, and copy from `examples/`. The page is already inside envUI's theme. Style its layout with envUI's tokens (`var(--env-space-4)`), not literal colours.

## @envsemble/atlas-page

Paths are relative to the page's folder, or to the planning folder when they start with `/`.

- `page`: the page's `name`, `folder`, `work` (`id`, `title`, `path`) and `project`.
- `read(path)`, `readJSON(path)`, `write(path, text)`, `writeJSON(path, value)`: files anywhere in the planning folder.
- `url(path)`: an address for a file of the planning folder, for an image to load as it is (`<img src={url('../../references/shot.webp')} />`); importing it bundles it into the page instead.
- `useFile(path)`, `useJSON(path)`: a file as `{ value, error, loading }`, read again when it changes.
- `tool(name, input)`: the Atlas tools you use (`work_status`, `step`, `work_search` and the rest), with the same input; a refusal throws.
- `Diagram`: a diagram of the work item, as Atlas draws it: `<Diagram path="../../diagrams/orders.puml" height="32rem" />`.
- `useChoice(key)`: `{ value, closed, note, choose(value) }`, one choice the user makes; `useChoices()` gives them all.
- `open(path)`: open a file, diagram or page of the planning folder in Atlas.

A page may also query anything else, such as a dev server or an API, with `fetch`. Prefer data in its files: it opens the same on every computer and later.

## Choices

`choose` saves a choice in the page's `choices.json`, keyed by what was asked:

```json
{ "layout": { "value": "tiles", "chosenAt": "2026-11-13T10:00:00Z" } }
```

Atlas tells you of new choices with the user's next message. Act on them as the work needs. Once a choice is settled, close it: add `"closed": true` to it, with a short `"note"` when the page should say why, so the page reads as decided and the choice can't change. Show a closed choice as settled on the page (`closed` from `useChoice`). Record what was decided in the plan as you would any decision; the page is not the record.

## A page that fails

A page that does not build shows why in its place, and one that throws shows its error; the rest of Atlas carries on. When Atlas's envUI changes, `atlas check` flags a page that no longer builds: bring it up to date when it is next needed.
