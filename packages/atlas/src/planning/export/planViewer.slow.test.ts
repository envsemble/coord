// The exported viewer in a real Chromium: it opens offline from a file, makes no network
// requests, runs none of the embedded content and keeps diagrams interactive.
// Skipped when no Chromium-based browser is installed (set ATLAS_TEST_CHROMIUM to choose one).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChromium, launchChromium } from '../testing/headlessChromium.ts';
import { exportPlan } from './planExport.ts';

const hostileTitle = 'Checkout </script><script>window.__pwned = "title"</script>';
const hostileMarkdown = [
  '# Hostile notes', '',
  '<script>window.__pwned = "markdown script"</script>', '',
  '<img src="x" onerror="window.__pwned = \'markdown image\'">', '',
  '<iframe src="https://example.invalid/frame"></iframe>', '',
  '[script link](javascript:window.__pwned=\'link\') and [web page](https://example.invalid/page) and [plan](../plan.md#data-model)', '',
  '![remote tracker](https://example.invalid/track.png) ![local photo](photo.svg)', '',
].join('\n');

function fixture(root: string) {
  const work = path.join(root, 'active/0001-checkout');
  mkdirSync(path.join(work, 'evidence'), { recursive: true });
  writeFileSync(path.join(root, 'planning.json'), JSON.stringify({ schema_version: 2, name: 'Shop', folders: [], work_items: [{ id: 'work-0001', path: 'active/0001-checkout', current_plan: 'active/0001-checkout/plan.md' }] }, null, 2));
  writeFileSync(path.join(work, 'plan.md'), ['---', 'schema_version: 2', 'kind: plan', 'id: work-0001', 'title: ' + JSON.stringify(hostileTitle), 'created: "2026-10-01"', 'updated: "2026-10-02"', 'design_status: accepted', 'implementation_status: in_progress', 'accepted_at: "2026-10-02"', 'completed_at: null', 'supersedes: []', 'superseded_by: null', '---', '', '# Checkout', '', '## Data model', '', '[Orders](orders.puml#Order) have lines. See the [hostile notes](evidence/hostile.md).', ''].join('\n'));
  writeFileSync(path.join(work, 'evidence/hostile.md'), hostileMarkdown);
  writeFileSync(path.join(work, 'evidence/page.html'), '<!doctype html><script>window.__pwned = "html attachment"</script><p>Attached page</p>');
  writeFileSync(path.join(work, 'evidence/photo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="window.parent.__pwned=\'svg\'"><script>window.parent.__pwned = "svg script"</script><rect width="10" height="10" fill="red"/></svg>');
  writeFileSync(path.join(work, 'evidence/binary.bin'), Buffer.from([0, 1, 2, 255]));
  writeFileSync(path.join(work, 'orders.puml'), '@startuml\ntitle Orders\nclass Order\nclass OrderLine\nOrder "1" *-- "0..*" OrderLine : lines\n@enduml\n');
}

test('the export opens offline in Chromium, makes no requests and runs no embedded content', { skip: !findChromium() && 'no Chromium-based browser installed' }, async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'plan-viewer-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  fixture(directory);
  const file = path.join(directory, 'checkout.atlas-plan.html');
  writeFileSync(file, (await exportPlan(directory, 'work-0001')).html);
  const browser = (await launchChromium())!;
  t.after(() => browser.close());
  const page = await browser.open();
  await page.navigate(pathToFileURL(file).href);
  const pwned = () => page.evaluate<unknown>('window.__pwned');

  // Plan tab: the title is text, and the plan links its diagram under the heading.
  await page.waitFor(`document.querySelector('.work-header h1')`);
  assert.equal(await page.evaluate('document.querySelector(".work-header h1").textContent'), hostileTitle);
  await page.waitFor(`document.querySelector('.diagram-card')`);
  // envUI's theme startup script, the two inert payloads and the viewer: nothing the content adds.
  assert.equal(await page.evaluate('document.querySelectorAll("script").length'), 4);

  // Hostile Markdown renders no elements, handlers or remote images: envUI's Markdown ignores raw HTML.
  await page.evaluate(`location.hash = 'tab=files&file=evidence%2Fhostile.md'`);
  await page.waitFor(`document.querySelector('.reader-name strong')?.textContent === 'hostile.md'`);
  const prose = await page.evaluate<{ text: string; images: string[]; frames: number; links: string[]; handlers: number }>(`(() => {
    const prose = document.querySelector('.prose');
    return { text: prose.textContent, images: [...prose.querySelectorAll('img')].map(img => img.getAttribute('src')),
      frames: document.querySelectorAll('iframe, object, embed').length, links: [...prose.querySelectorAll('a')].map(a => a.getAttribute('href')),
      handlers: document.querySelectorAll('[onerror], [onload], [onclick]').length };
  })()`);
  assert.doesNotMatch(prose.text, /window\.__pwned/, 'raw HTML is ignored, not rendered or shown');
  assert.match(prose.text, /Hostile notes/);
  assert.equal(prose.frames, 0);
  assert.equal(prose.handlers, 0);
  assert.ok(prose.images.every(src => src.startsWith('blob:')), 'only exported images are shown: ' + prose.images.join(', '));
  assert.equal(prose.images.length, 1);
  assert.ok(prose.links.every(href => !/^javascript:/i.test(href)), prose.links.join(', '));
  assert.ok(prose.links.includes('https://example.invalid/page'));
  assert.equal(await page.evaluate('document.querySelector(".prose a[href*=\\"plan.md\\"]") !== null'), true, 'links between exported files stay inside the viewer');

  // Attachments are displayed inertly and downloadable.
  await page.evaluate(`location.hash = 'tab=files&file=evidence%2Fpage.html'`);
  await page.waitFor(`document.querySelector('.source-text')?.textContent.includes('Attached page')`);
  await page.evaluate(`location.hash = 'tab=files&file=evidence%2Fphoto.svg'`);
  await page.waitFor(`document.querySelector('.attachment img')?.complete`);
  await page.evaluate(`location.hash = 'tab=files&file=evidence%2Fbinary.bin'`);
  await page.waitFor(`document.querySelector('.reader-toolbar a[download="binary.bin"]')?.href.startsWith('blob:')`);

  // Diagrams render with the shared viewer and respond to selection.
  await page.evaluate(`location.hash = 'tab=diagrams'`);
  await page.waitFor(`document.querySelector('.atlas-panel [data-element-kind="node"][data-element-id="Order"]')`);
  // The camera settles after fitting: the node stays put for three looks in a row.
  await page.evaluate(`window.__still = 0`);
  await page.waitFor(`(() => { const rect = document.querySelector('[data-element-kind="node"][data-element-id="Order"]').getBoundingClientRect(); const place = rect.left + ',' + rect.top + ',' + rect.width; window.__still = place === window.__place ? window.__still + 1 : 0; window.__place = place; return window.__still >= 3; })()`);
  const box = await page.evaluate<{ x: number; y: number }>(`(() => { const rect = document.querySelector('[data-element-kind="node"][data-element-id="Order"]').getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  const hit = await page.evaluate<string>(`document.elementFromPoint(${box.x}, ${box.y})?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? document.elementFromPoint(${box.x}, ${box.y})?.outerHTML.slice(0, 200)`);
  assert.equal(hit, 'Order', 'the node is visible at its centre');
  await page.click(box.x, box.y);
  await page.waitFor(`document.querySelector('[data-element-kind="node"][data-element-id="Order"]').getAttribute('class').includes('selected')`);
  await page.waitFor(`document.querySelector('.atlas-panel .inspector.open')?.textContent.includes('Order')`);

  assert.equal(await pwned(), undefined, 'no embedded content ran');
  assert.deepEqual(page.errors, [], 'no errors or content security policy reports');
  const offline = page.requests.filter(url => !url.startsWith('file:') && !url.startsWith('data:') && !url.startsWith('blob:'));
  assert.deepEqual(offline, [], 'no network requests');
  assert.equal(page.requests.filter(url => url.startsWith('file:')).length, 1, 'only the export itself is loaded');
});
