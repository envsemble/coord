import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareHits, fold, PlanningSearch, searchFileLimit, searchQuery, snippetOf, type RankedHit } from './search.ts';

function temporary(t: TestContext) {
  const directory = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'atlas-search-')));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function write(file: string, text: string) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); }

/** A planning folder with a plan in progress (its ledger, glossary, decision and diagram) and a closed one, knowledge, and files the search leaves out. */
function planningFolder(root: string) {
  write(path.join(root, 'planning.json'), JSON.stringify({
    schema_version: 1, name: 'Shop', repositories: [],
    work_items: [{ id: 'work-0012', path: 'active/0012-saved-cards', current_plan: 'active/0012-saved-cards/plan.md' }, { id: 'work-0007', path: 'archive/0007-coupons', current_plan: 'archive/0007-coupons/plan.md' }],
  }));
  write(path.join(root, 'active/0012-saved-cards/plan.md'), '---\nkind: plan\ntitle: Saved cards\nsummary: "Customers reuse a card at the café checkout."\n---\n\n# Saved cards\n\n## Outcome\n\nReturning customers pay with a **stored** token.\n\n## Outcome\n\nAgain, with `code`.\n');
  write(path.join(root, 'active/0012-saved-cards/ledger.md'), '---\nkind: ledger\nsteps:\n  - title: "Store the vault token"\n    status: done\n  - title: "Show cards on the account page"\n    status: todo\n---\n\n# Saved cards: ledger\n\n- 2026-10-01: Started.\n');
  write(path.join(root, 'active/0012-saved-cards/CONTEXT.md'), '# Saved cards\n\n## Language\n\n**Payment token**:\nWhat the acquirer gives back for a card.\n_Avoid_: card number\n\n### Risk\n\n**Step-up:**\nAn extra challenge.\n');
  write(path.join(root, 'active/0012-saved-cards/docs/adr/0001-tokens.md'), '# Keep acquirer tokens only\n\nWe never store card numbers.\n');
  write(path.join(root, 'active/0012-saved-cards/diagrams/checkout.puml'), '@startuml\ntitle Checkout model\nclass "Saved Card" as SavedCard\nclass Order\nSavedCard --> Order\n@enduml\n');
  write(path.join(root, 'archive/0007-coupons/plan.md'), '---\nkind: plan\ntitle: Coupons\n---\n\n# Coupons\n\nDiscount codes at checkout.\n');
  write(path.join(root, 'knowledge/payments.md'), '# Payments constraints\n\nTokens belong to one acquirer; a saved card cannot move between them.\n');
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
  write(path.join(root, 'knowledge/birds.md'), '# Birds\n\nA flamingo.\n');
  assert.deepEqual(await find('flamingo'), [], 'until told, the index stands');
  index.invalidate();
  assert.deepEqual(await find('flamingo'), ['Birds']);
  rmSync(path.join(root, 'knowledge/birds.md'));
  index.invalidate();
  assert.deepEqual(await find('flamingo'), [], 'a removed file is gone');
  write(path.join(root, 'knowledge/huge.md'), '# Huge\n\n' + 'flamingo '.repeat(searchFileLimit / 9 + 10));
  index.invalidate();
  assert.deepEqual(await find('flamingo'), [], 'a large file is not read');
  assert.deepEqual(await find('huge.md'), ['huge.md'], 'but found by its name');
});

test('matching folds case and accents in place, and snippets are short passages on one line', () => {
  assert.equal(fold('Café ÉLAN Straße'), 'cafe elan straße');
  assert.equal(fold('İstanbul').length, 'İstanbul'.length);
  assert.deepEqual(searchQuery('  #0023  Hub '), { text: '0023 hub', words: ['0023', 'hub'], number: null });
  assert.deepEqual(searchQuery('#0023'), { text: '0023', words: ['0023'], number: 23 });
  assert.equal(searchQuery(' # '), null);
  const long = 'Lorem ipsum dolor sit amet. '.repeat(10) + 'The flamingo stands on one leg.\n\nAnother line. ' + 'Consectetur adipiscing elit. '.repeat(10);
  const snippet = snippetOf({ text: long, folded: fold(long) }, ['flamingo'])!;
  assert.match(snippet, /^….*flamingo stands.*…$/);
  assert.ok(snippet.length <= 125 && !snippet.includes('\n'), snippet);
});
