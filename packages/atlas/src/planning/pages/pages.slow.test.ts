import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildPage, pageOf } from './pages.ts';
import { checkPaths } from '../check/checkPaths.ts';
import { temporary } from '../../cli/testing.ts';

function planning(t: test.TestContext) {
  const root = temporary(t);
  const page = path.join(root, 'active', '0001-cart', 'pages', 'layout');
  mkdirSync(page, { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'shop', folders: [], work_items: [{ id: 'work-0001', path: 'active/0001-cart', current_plan: null }] }));
  return { root, page };
}

test('a page builds on the stack alone, from its folder: the imports the frame supplies, its files, its styles', async t => {
  const { root, page } = planning(t);
  writeFileSync(path.join(page, 'page.tsx'), [
    "import { useState } from 'react';",
    "import { Button } from '@envsemble/envui';",
    "import { IconAdd } from '@envsemble/envui/icons/Add';",
    "import { useChoice } from '@envsemble/atlas-page';",
    "import options from './options.json';",
    "import './page.css';",
    'export default function Page() { const [n, setN] = useState(0); const choice = useChoice("n"); return <Button startIcon={<IconAdd />} onClick={() => { setN(n + 1); void choice.choose(n); }}>{options.label}</Button>; }',
  ].join('\n'));
  writeFileSync(path.join(page, 'options.json'), '{ "label": "Add" }');
  writeFileSync(path.join(page, 'page.css'), '.x { color: red; }');
  const built = await buildPage(root, page);
  assert.ok(built.ok, JSON.stringify(built));
  assert.deepEqual(built.imports, ['@envsemble/atlas-page', '@envsemble/envui', '@envsemble/envui/icons/Add', 'react', 'react/jsx-runtime']);
  assert.deepEqual(built.inputs.sort(), ['active/0001-cart/pages/layout/options.json', 'active/0001-cart/pages/layout/page.css', 'active/0001-cart/pages/layout/page.tsx']);
  assert.match(built.css, /color: red/);
  assert.match(built.code, /require\("react"\)/);
  assert.equal(pageOf('active/0001-cart/pages/layout/options.json'), 'active/0001-cart/pages/layout');

  // What is not the stack, broken code and a folder without its entry are problems, which atlas check reports.
  writeFileSync(path.join(page, 'page.tsx'), "import chart from 'chart.js';\nexport default function Page() { return <div>{String(chart)}</div>; }\n");
  const refused = await buildPage(root, page);
  assert.ok(!refused.ok && /'chart\.js' is not part of Atlas's stack/.test(refused.problems[0].text));
  writeFileSync(path.join(page, 'page.tsx'), 'export default function Page() { return <div>; }\n');
  const [checked] = await checkPaths([path.join(page, 'options.json')]);
  assert.match(checked.errors.join('\n'), /^active\/0001-cart\/pages\/layout\/page\.tsx:1:\d+: /m);
  const empty = path.join(root, 'active', '0001-cart', 'pages', 'empty');
  mkdirSync(empty);
  writeFileSync(path.join(empty, 'data.json'), '{}');
  const [whole] = await checkPaths([root]);
  assert.match(whole.errors.join('\n'), /active\/0001-cart\/pages\/empty: A page starts from page\.tsx/);
});
