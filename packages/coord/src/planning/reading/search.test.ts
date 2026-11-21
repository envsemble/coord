import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareHits, fold, PlanningSearch, readMarkdown, scanMarkdown, searchFileLimit, searchQuery, snippetOf, type RankedHit } from './search.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'coord-search-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }

/** A planning folder with a plan in progress (its ledger, glossary, decision and diagram) and a closed one, notes, and files the search leaves out. */
function planningFolder(root: string) {
  write(path.join(root, 'planning.json'), JSON.stringify({
    schema_version: 3, name: 'Shop', folders: [],
    work_items: [{ id: 'work-0012', path: 'active/0012-saved-cards', current_plan: 'active/0012-saved-cards/plan.md' }, { id: 'work-0007', path: 'archive/0007-coupons', current_plan: 'archive/0007-coupons/plan.md' }],
  }));
  write(path.join(root, 'active/0012-saved-cards/plan.md'), '---\nkind: plan\ntitle: Saved cards\nsummary: "Customers reuse a card at the café checkout."\n---\n\n# Saved cards\n\n## Outcome\n\nReturning customers pay with a **stored** token.\n\n## Outcome\n\nAgain, with `code`.\n');
  write(path.join(root, 'active/0012-saved-cards/ledger.md'), '---\nkind: ledger\nsteps:\n  - title: "Store the vault token"\n    status: done\n  - title: "Show cards on the account page"\n    status: todo\n---\n\n# Saved cards: ledger\n\n- 2026-10-01: Started.\n');
  write(path.join(root, 'active/0012-saved-cards/CONTEXT.md'), '# Saved cards\n\n## Language\n\n**Payment token**:\nWhat the acquirer gives back for a card.\n_Avoid_: card number\n\n### Risk\n\n**Step-up:**\nAn extra challenge.\n');
  write(path.join(root, 'active/0012-saved-cards/docs/adr/0001-tokens.md'), '# Keep acquirer tokens only\n\nWe never store card numbers.\n');
  write(path.join(root, 'active/0012-saved-cards/diagrams/checkout.puml'), '@startuml\ntitle Checkout model\nclass "Saved Card" as SavedCard\nclass Order\nSavedCard --> Order\n@enduml\n');
  write(path.join(root, 'archive/0007-coupons/plan.md'), '---\nkind: plan\ntitle: Coupons\ntags: ["0.8.0", "discounts"]\n---\n\n# Coupons\n\nDiscount codes at checkout.\n');
  write(path.join(root, 'notes/payments.md'), '# Payments constraints\n\nTokens belong to one acquirer; a saved card cannot move between them.\n');
  write(path.join(root, 'active/0012-saved-cards/evidence/run.md'), '# Evidence of zebra\n');
  write(path.join(root, '.git/notes.md'), '# zebra\n');
  write(path.join(root, 'node_modules/x/readme.md'), '# zebra\n');
  write(path.join(root, 'active/0012-saved-cards/notes.txt'), 'zebra\n');
}
const titles = (hits: RankedHit[]) => hits.sort(compareHits).map(hit => [hit.kind, hit.title]);

test('the search finds plans, steps, documents, headings, terms, diagrams, elements and the project', async t => {
  const root = temporary(t);
  planningFolder(root);
  const index = new PlanningSearch(root);
  const search = async (text: string) => (await index.search(searchQuery(text)!, 'Shop')).sort(compareHits);
  const plan = 'active/0012-saved-cards/plan.md';
  const { changed: _changed, ...found } = (await search('saved cards'))[0];
  assert.deepEqual(found, { kind: 'plan', title: 'Saved cards', snippet: null, work: 'work-0012', path: plan, anchor: null, element: null, tier: 0, order: 0 });
  for (const number of ['0012', '#0012', 'work-0012', '#12']) assert.deepEqual((await search(number)).slice(0, 1).map(hit => [hit.kind, hit.work]), [['plan', 'work-0012']], number);
  assert.deepEqual((await search('café'))[0], (await search('CAFE'))[0], 'case and accents are ignored');
  const summary = (await search('cafe'))[0];
  assert.deepEqual([summary.kind, summary.snippet], ['plan', 'Customers reuse a card at the café checkout.'], 'a summary matches, with the summary as the snippet');
  const step = (await search('account page')).find(hit => hit.kind === 'step')!;
  assert.deepEqual([step.title, step.work, step.path], ['Show cards on the account page', 'work-0012', plan], 'a step opens its plan');
  const headings = (await search('outcome')).filter(hit => hit.kind === 'heading');
  assert.deepEqual(headings.map(hit => [hit.path, hit.anchor]), [[plan, 'outcome'], [plan, 'outcome-1']], 'headings with the anchors the readers give them');
  const terms = (await search('step-up')).filter(hit => hit.kind === 'term');
  assert.deepEqual(terms.map(hit => [hit.title, hit.path, hit.anchor]), [['Step-up', 'active/0012-saved-cards/CONTEXT.md', 'risk']], 'a term opens at its heading');
  assert.deepEqual((await search('payment token')).filter(hit => hit.kind === 'term').map(hit => hit.anchor), ['language']);
  const diagram = (await search('checkout model'))[0];
  assert.deepEqual([diagram.kind, diagram.title, diagram.path, diagram.work], ['diagram', 'Checkout model', 'active/0012-saved-cards/diagrams/checkout.puml', 'work-0012'], 'a diagram by its title');
  assert.equal((await search('checkout'))[0].kind, 'diagram', 'and by its file name');
  // A page by its folder's name, words apart; it opens as its folder.
  mkdirSync(path.join(root, 'active', '0012-saved-cards', 'pages', 'card-layout'), { recursive: true });
  writeFileSync(path.join(root, 'active', '0012-saved-cards', 'pages', 'card-layout', 'page.tsx'), 'export default function Page() { return null; }\n');
  index.invalidate();
  const page = (await search('card layout')).find(hit => hit.kind === 'page')!;
  assert.deepEqual([page.title, page.path, page.work], ['card-layout', 'active/0012-saved-cards/pages/card-layout', 'work-0012']);
  const element = (await search('saved card')).find(hit => hit.kind === 'element')!;
  assert.deepEqual([element.title, element.element], ['Saved Card', 'SavedCard'], 'an element by its name, opened by its identity');
  assert.deepEqual((await search('savedcard')).map(hit => hit.kind), ['element'], 'or by its identity');
  const text = (await search('numbers')).find(hit => hit.kind === 'document')!;
  assert.deepEqual([text.title, text.path, text.snippet], ['Keep acquirer tokens only', 'active/0012-saved-cards/docs/adr/0001-tokens.md', 'We never store card numbers.'], 'text, with a snippet around the match');
  const project = (await search('shop'))[0];
  assert.deepEqual([project.kind, project.title, project.path], ['project', 'Shop', null]);
  assert.deepEqual(await search('zebra'), [], 'evidence, Git, dependencies and other files are left out');
  assert.deepEqual(await search('saved zzz'), [], 'every word must match');
  assert.deepEqual(titles(await search('stored token')), [['document', 'Saved cards']], 'a plan\'s text is found as a document, in any order of the words');
  assert.ok(!(await search('saved cards')).some(hit => hit.kind === 'document' && hit.path === plan), 'a plan found by its title is not found again as its file');
  // tag: keeps the plans with that tag, exactly; tags alone list them; a plan's tags match as words.
  assert.deepEqual((await search('tag:0.8.0')).map(hit => [hit.kind, hit.title, hit.tags]), [['plan', 'Coupons', ['0.8.0', 'discounts']]]);
  assert.deepEqual(titles(await search('Tag:0.8.0 coupons')), [['plan', 'Coupons']]);
  assert.deepEqual(await search('tag:0.8.0 saved'), []);
  assert.deepEqual(await search('tag:0.8'), []);
  assert.deepEqual(titles(await search('discounts')), [['plan', 'Coupons']]);
});

test('exact and prefix titles first, then titles with every word, then other fields, then text; plans and projects first, then the latest changed', async t => {
  const root = temporary(t);
  planningFolder(root);
  const at = (file: string, date: string) => utimesSync(path.join(root, file), new Date(date), new Date(date));
  at('active/0012-saved-cards/ledger.md', '2026-10-03');
  at('active/0012-saved-cards/CONTEXT.md', '2026-10-02');
  at('active/0012-saved-cards/diagrams/checkout.puml', '2026-10-01');
  const index = new PlanningSearch(root);
  const search = async (text: string, name = 'Shop') => titles(await index.search(searchQuery(text)!, name));
  assert.deepEqual(await search('saved'), [
    ['plan', 'Saved cards'], ['document', 'Saved cards: ledger'], ['document', 'Saved cards'], ['element', 'Saved Card'],
    ['document', 'Keep acquirer tokens only'], ['document', 'Payments constraints'],
  ], 'title prefixes, the plan first and the rest latest changed first, then a path, then text');
  assert.deepEqual(await search('saved cards'), [['plan', 'Saved cards'], ['document', 'Saved cards'], ['document', 'Saved cards: ledger'], ['document', 'Keep acquirer tokens only']], 'an exact title before a prefix, then a path');
  assert.deepEqual((await search('coupons', 'Coupons')).sort(), [['plan', 'Coupons'], ['project', 'Coupons']], 'plans and projects first, the latest changed first');
  assert.deepEqual(await search('token acquirer'), [['document', 'Keep acquirer tokens only'], ['document', 'Payments constraints'], ['document', 'Saved cards']], 'every word in a title, then text, the latest changed first');
  assert.deepEqual(await search('cards checkout'), [['plan', 'Saved cards']], 'a title with the rest of the words in its summary');
});

test('the index reads again only what changed once told, and knows large files by their name', async t => {
  const root = temporary(t);
  planningFolder(root);
  const index = new PlanningSearch(root);
  const find = async (text: string) => (await index.search(searchQuery(text)!, 'Shop')).map(hit => hit.title);
  assert.deepEqual(await find('flamingo'), []);
  write(path.join(root, 'notes/birds.md'), '# Birds\n\nA flamingo.\n');
  assert.deepEqual(await find('flamingo'), [], 'until told, the index stands');
  index.invalidate();
  assert.deepEqual(await find('flamingo'), ['Birds']);
  rmSync(path.join(root, 'notes/birds.md'));
  index.invalidate();
  assert.deepEqual(await find('flamingo'), [], 'a removed file is gone');
  write(path.join(root, 'notes/huge.md'), '# Huge\n\n' + 'flamingo '.repeat(searchFileLimit / 9 + 10));
  index.invalidate();
  assert.deepEqual(await find('flamingo'), [], 'a large file is not read');
  assert.deepEqual(await find('huge.md'), ['huge.md'], 'but found by its name');
});

test('matching folds case and accents in place, and snippets are short passages on one line', () => {
  assert.equal(fold('Café ÉLAN Straße'), 'cafe elan straße');
  assert.equal(fold('İstanbul').length, 'İstanbul'.length);
  assert.deepEqual(searchQuery('  #0023  Hub '), { text: '0023 hub', words: ['0023', 'hub'], number: null, tags: [] });
  assert.deepEqual(searchQuery('#0023'), { text: '0023', words: ['0023'], number: 23, tags: [] });
  assert.equal(searchQuery(' # '), null);
  const long = 'Lorem ipsum dolor sit amet. '.repeat(10) + 'The flamingo stands on one leg.\n\nAnother line. ' + 'Consectetur adipiscing elit. '.repeat(10);
  const snippet = snippetOf({ text: long, folded: fold(long), minimum: 1 }, ['flamingo'])!;
  assert.match(snippet, /^….*flamingo stands.*…$/);
  assert.ok(snippet.length <= 125 && !snippet.includes('\n'), snippet);
});

/** Documents whose headings a line-by-line reading could get wrong. */
const synthetic: Record<string, string> = {
  'tricky.md': [
    '# Title', '', '## The `code` and *emphasis*', '', '## A [link](https://example.test) and [a reference][ref]', '',
    '```md', '# Not a heading', '```', '', 'Setext heading', '==============', '', 'A paragraph', 'over two lines', '---', '',
    '- a list item', '---', '', '> ## In a quote', '', '## Closed ##', '', '## Outcome', '', '## Outcome', '', '#NoSpace', '',
    '    # Indented code', '', '## ![image](x.png) Picture', '', '[ref]: https://example.test',
  ].join('\n'),
  'comment.md': '<!--\n## Steps\n-->\n\n## Steps\n\n<!-- ## Inline --> text\n\n## Steps\n',
  'html.md': '<div>\n\n## Inside a block\n\n</div>\n\n<details>\n## Not a heading\nA paragraph\n---\n</details>\n\n## After\n',
  'quoted-fence.md': '> ```\n> # Not a heading\n> ```\n\n# Heading\n\n> ~~~\n> ## Also code\n\n## Out of the quote\n',
  'setext.md': '- Item heading\n  ---\n\n> Quoted heading\n> ===\n\n1. Numbered\n   heading\n   ---\n\n- Lazy\n---\n',
  'footnotes.md': 'Text[^b].\n\n## A[^a]\n\n## B[^b] and A[^a] again\n\n## Unknown[^z]\n\n[^a]: First.\n[^b]: Second.\n',
  // A lazy line continues the quote's or item's paragraph, and a line under it is a thematic break, not an underline.
  'lazy.md': '> Quote\nlazy\n---\n\n- Item\nlazy\n---\n\n## After\n',
};

test('documents up to the size limit have exactly the readers\' heading anchors', async () => {
  const { documentAnchors, markdownBody, parseMarkdown } = await import('./headings.ts');
  for (const [name, source] of Object.entries(synthetic)) {
    const expected = [...documentAnchors(parseMarkdown(markdownBody(source))).values()];
    assert.deepEqual(readMarkdown(name, source, null).headings!.map(heading => heading.anchor), expected, name);
  }
});

test('larger documents read line by line have the readers\' anchors in these cases too', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { documentAnchors, markdownBody, parseMarkdown } = await import('./headings.ts');
  const fixture = path.resolve(import.meta.dirname, '../../../../../app/e2e/fixtures/planning');
  const files = (function walk(folder: string): string[] {
    return readdirSync(folder).flatMap(name => { const full = path.join(folder, name); return statSync(full).isDirectory() ? walk(full) : /\.md$/.test(name) ? [full] : []; });
  })(fixture);
  const documents = [...Object.entries(synthetic), ...files.map(file => [path.relative(fixture, file), readFileSync(file, 'utf8')])];
  for (const [name, source] of documents) {
    const expected = [...documentAnchors(parseMarkdown(markdownBody(source))).values()];
    assert.deepEqual(scanMarkdown(name, markdownBody(source), null).headings!.map(heading => heading.anchor), expected, name);
  }
  // A document over the limit is read line by line, to its end.
  const large = synthetic['comment.md'] + 'Filler text.\n'.repeat(30_000) + '## Late\n';
  assert.deepEqual(readMarkdown('large.md', large, null).headings!.map(heading => heading.anchor), ['steps', 'steps-1', 'late']);
});

test('indexing takes time linear in a file\'s size and gives the thread back between files', async t => {
  const root = temporary(t);
  planningFolder(root);
  // Files that take a Markdown parser minutes: a large table, quotes nested deep, unclosed links.
  write(path.join(root, 'notes/table.md'), '# Table\n\n| a | b |\n|---|---|\n' + '| cell | `x` |\n'.repeat(130_000));
  write(path.join(root, 'notes/quotes.md'), '# Quotes\n\n' + Array.from({ length: 1000 }, (_, depth) => '>'.repeat(depth) + ' line').join('\n') + '\n');
  write(path.join(root, 'notes/links.md'), '# Links\n\n' + '[a]('.repeat(250_000) + '\n');
  write(path.join(root, 'notes/tags.md'), '# Tags\n\n' + '<a'.repeat(400_000) + '\n');
  // Small, but nested deep: the parser would take seconds and run out of stack.
  write(path.join(root, 'notes/deep.md'), '# Deep\n\n' + '>'.repeat(30_000) + ' x\n');
  // Small, but dense with emphasis or nested deep by indentation: the parser's time grows with the square of either.
  write(path.join(root, 'notes/emphasis.md'), '# Emphasis\n\n' + '*a'.repeat(30_000) + '\n');
  write(path.join(root, 'notes/indented.md'), '# Indented\n\n' + Array.from({ length: 200 }, (_, depth) => '  '.repeat(depth) + '- item').join('\n') + '\n');
  let gap = 0, last = Date.now();
  const timer = setInterval(() => { gap = Math.max(gap, Date.now() - last); last = Date.now(); }, 10);
  const started = Date.now();
  try {
    const hits = await new PlanningSearch(root).search(searchQuery('quotes')!, 'Shop');
    assert.ok(hits.some(hit => hit.title === 'Quotes'));
  } finally { clearInterval(timer); }
  assert.ok(Date.now() - started < 5000, `indexed in ${Date.now() - started} ms`);
  assert.ok(gap < 1000, `the thread was held for ${gap} ms at most`);
});

test('across kinds, exact and prefix titles rank together: a plan before headings named exactly so', async t => {
  const root = temporary(t);
  write(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 3, name: 'Shop', folders: [], work_items: [{ id: 'work-0003', path: 'active/0003-design', current_plan: 'active/0003-design/plan.md' }] }));
  write(path.join(root, 'active/0003-design/plan.md'), '---\nkind: plan\ntitle: Design system tokens\n---\n\n# Design system tokens\n');
  for (let index = 0; index < 60; index++) write(path.join(root, `notes/note-${index}.md`), `# Note ${index}\n\n## Design\n\nText.\n`);
  write(path.join(root, 'notes/build/built.md'), '# Built notes\n');
  write(path.join(root, 'notes/Cafe\u0301.md'), '# Cafe\u0301 menu\n');
  const index = new PlanningSearch(root);
  const hits = (await index.search(searchQuery('design')!, 'Shop')).sort(compareHits);
  assert.deepEqual([hits[0].kind, hits[0].title], ['plan', 'Design system tokens']);
  assert.ok(hits.slice(1, 61).every(hit => hit.kind === 'heading' && hit.title === 'Design'));
  assert.deepEqual((await index.search(searchQuery('built')!, 'Shop')).map(hit => hit.path), ['notes/build/built.md'], 'a folder named build is read');
  assert.deepEqual((await index.search(searchQuery('café')!, 'Shop')).map(hit => hit.title), ['Caf\u00e9 menu'], 'a decomposed title is composed');
  assert.deepEqual((await index.search(searchQuery('#3')!, 'Shop')).sort(compareHits).slice(0, 1).map(hit => [hit.kind, hit.tier]), [['plan', 0]], 'a plan by its number');
  write(path.join(root, 'notes/v2/readme.md'), '# Readme\n');
  index.invalidate();
  assert.ok(!(await index.search(searchQuery('#2')!, 'Shop')).some(hit => hit.path === 'notes/v2/readme.md'), 'a one-character word does not match paths');
  assert.ok((await index.search(searchQuery('v2')!, 'Shop')).some(hit => hit.path === 'notes/v2/readme.md' && hit.tier === 4), 'longer words do');
});

test('a folder that takes long to read is waited for a while, then answered from what was read before', async t => {
  const root = temporary(t);
  planningFolder(root);
  let slow = false;
  class Slow extends PlanningSearch {
    protected override list() { return slow ? new Promise<never>(() => undefined) : super.list(); }
  }
  const index = new Slow(root);
  assert.ok((await index.search(searchQuery('coupons')!, 'Shop', 1000)).length);
  slow = true;
  index.invalidate();
  let started = Date.now();
  assert.deepEqual((await index.search(searchQuery('coupons')!, 'Shop', 100)).map(hit => hit.kind).sort(), ['plan'], 'the last read');
  assert.ok(Date.now() - started >= 90 && Date.now() - started < 1000);
  started = Date.now();
  await index.search(searchQuery('coupons')!, 'Shop', 100);
  assert.ok(Date.now() - started < 100, 'a read that is late already is not waited for again');
  const never = new Slow(root);
  assert.deepEqual(await never.search(searchQuery('coupons')!, 'Shop', 50), [], 'a folder never read finds nothing');
});
