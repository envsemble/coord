# Pages

A page is a view an agent makes in a work item for its user: a choice between visual options, data worth seeing, a before and after. It is React code on Atlas's own stack, and Atlas builds it and shows it in place, beside the work item's files, so nothing is run by hand. The agent's guide is [the page guide](../plugin/skills/atlas/references/pages.md) in the atlas skill; this page says how Atlas runs pages.

## In a work item

A page is a folder of the work item's `pages/` folder, `pages/<name>/`, which holds:

- `page.tsx` (or `page.jsx`, `page.ts`, `page.js`), whose default export is the page's component, and what it imports: components, CSS, JSON, text and images;
- the data it reads as it runs, and `choices.json`, the user's choices;
- `page.json`, where its agent says what it needs of the user: `{ "attention": "Pick a card layout" }`.

In Files, a page's folder opens the page, with the page icon, and its chevron lists its files. A plan links a page as it links a diagram (`[the card layouts](pages/card-layout)`): the link shows with the page icon and opens the page. Search finds a page by its folder's name.

While a page's `page.json` has an `attention`, the page needs its user: the host reads it with the folder (it is in the snapshot's `attention`, by the page's folder), and the window marks the page with an amber dot in Files, on its plan links and on its folded folders, and lists it under the plan's title with what it waits on. `atlas check` reports a `page.json` that is not an object with a text `attention`.

## Building and running

The Atlas host of the page's computer builds the page with esbuild, from its folder, into one module. Imports of Atlas's stack stay as they are, for the window to supply: React and React DOM, envUI (`@envsemble/envui`, its `code`, `markdown`, `diff` and `messages` entries, and its icons), the diagram viewer (`@envsemble/atlas-diagrams/react`) and `@envsemble/atlas-page`. Any other import is refused, and the page does not build.

The window runs the build in a frame of its own: `atlas://page/page-frame.html`, an origin apart from the window's, which loads the stack's modules the build imports (each envUI icon is a module of its own), evaluates the build and renders its component inside envUI's theme. The frame reaches Atlas only through a message port its window gives it, and the window answers its requests through the host:

- reading a file of the planning folder, and writing one (`project.write`, made with its folders, replaced whole);
- the Atlas tools agents use, run in the project's planning folder (`project.tool`);
- a diagram of the work item, as Atlas draws it.

When a file the page is built from changes, the window builds it again and the frame shows the new build; a change to any other file is passed to the page, whose `useFile`, `useJSON` and `useChoice` read again. A page that does not build shows its problems in its place; one that throws shows its error in its frame. Neither affects the rest of the window.

`atlas check`, and the hook after each edit, builds the page a checked file belongs to and reports why it does not build.

## Choices

`useChoice` and `useChoices` save the user's choices in the page's `choices.json`. As the user sends a message, the plugin's `PageChoices` hook tells the agent the choices still open on the pages of the session's projects that changed since the session last heard, and to close each once it is settled (`"closed": true`, with an optional `"note"`), and reminds it of the page's `attention`, which it clears once nothing waits on the user. What a session has heard is kept in the home's `cache/page-choices`.

## No guards

A page is code the user's agents wrote for them, so Atlas does not limit what it reaches:

- its frame may query any address (a dev server, an API, the internet) and load images and fonts from anywhere; it runs no other code than its build, and only an Atlas window may frame it;
- it reads and writes any file of the planning folder, as Atlas's readers reach them (no hidden or build folders), and runs the Atlas tools.

On a paired computer the same holds: the page is built by the host of the computer the project is on, its files and tools are that computer's, and the addresses it queries are reached from the computer that shows it. A planning folder that came from someone else can hold pages that run with this reach when opened.
