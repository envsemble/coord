import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '@envsemble/envui/markdown';
import { sectionAnchors } from '@envsemble/atlas/planning/headings';
import { findHeadingId, headingPrefix, isRequestHeading, rehypeFoldRequests, rehypeHeadingIds, type HeadingNode } from './headings.ts';
import { resolveLink } from './links.ts';
import type { Document } from '../types.ts';

const heading = (text: string, level = 2): HeadingNode => ({ type: 'element', tagName: 'h' + level, children: [{ type: 'text', value: text }] });
const ids = (tree: HeadingNode) => tree.children!.map(node => node.properties?.id as string);

test('repeated headings get stable document-local IDs and suffixed links reach later occurrences', () => {
  const transform = rehypeHeadingIds();
  const tree: HeadingNode = { type: 'root', children: [heading('Topic'), heading('Topic', 6)] };
  transform(tree);
  assert.deepEqual(ids(tree), [headingPrefix + 'topic', headingPrefix + 'topic-1']);
  assert.equal(findHeadingId('Topic-1', ids(tree)), ids(tree)[1]);
  transform(tree);
  assert.deepEqual(ids(tree), [headingPrefix + 'topic', headingPrefix + 'topic-1'], 'reprocessing cannot advance IDs');
  const refreshed: HeadingNode = { type: 'root', children: [heading('Topic'), heading('Topic', 6)] };
  transform(refreshed);
  assert.deepEqual(ids(refreshed), ids(tree), 'a refreshed document starts a fresh allocation');
});

test('literal slug collisions stay unique and pre-existing footnote IDs remain intact', () => {
  const footnote = { ...heading('Footnotes'), properties: { id: 'footnote-label' } };
  const tree: HeadingNode = { type: 'root', children: [heading('Topic 1'), heading('Topic'), heading('Topic'), footnote] };
  rehypeHeadingIds()(tree);
  assert.deepEqual(ids(tree), [headingPrefix + 'topic-1', headingPrefix + 'topic', headingPrefix + 'topic-2', 'footnote-label']);
  assert.equal(findHeadingId('topic-2', ids(tree)), ids(tree)[2]);
  assert.equal(findHeadingId('footnote-label', ids(tree)), 'footnote-label');
});

test('heading lookup uses retained document IDs and keeps generated IDs separate from the application root', () => {
  const tree: HeadingNode = { type: 'root', children: [heading('Root', 1), heading('Deep choice', 4)] };
  rehypeHeadingIds()(tree);
  assert.notEqual(ids(tree)[0], 'root');
  assert.equal(findHeadingId('Deep Choice', ids(tree)), ids(tree)[1]);
  assert.equal(findHeadingId('missing', ids(tree)), undefined);
});

test('GitHub punctuation fragments reach headings through local and cross-document links', () => {
  const tree: HeadingNode = { type: 'root', children: [heading("What's new?"), heading("What's new?"), heading('API_contract: C++ / C#'), heading('Déjà vu — choices')] };
  rehypeHeadingIds()(tree);
  const fragments = ['whats-new', 'whats-new-1', 'api_contract-c--c', 'déjà-vu--choices'];
  assert.deepEqual(ids(tree), fragments.map(fragment => headingPrefix + fragment));
  const source = 'active/0001-example/plan.md';
  const target = { path: 'active/0001-example/docs/decision.md' } as Document;
  for (const [index, fragment] of fragments.entries()) {
    for (const href of ['#' + encodeURIComponent(fragment), 'docs/decision.md#' + encodeURIComponent(fragment)]) {
      const destination = resolveLink(href, source, [target]);
      if (!href.startsWith('#')) assert.equal(destination.file, target);
      assert.equal(findHeadingId(destination.anchor!, ids(tree)), ids(tree)[index], href);
    }
  }
});

test('the anchors diagram links name are the ids the reader draws, footnote numbers included', () => {
  const documents = [
    '# Plan\n\n## Orders\n\n## Orders\n\n## The `ledger_status` field\n\n## *Emphasis* with [a link](x) ![an image](y.png) <b>raw</b> <kbd>K</kbd>',
    '## Title[^1]\n\nText.\n\n[^1]: A note.',
    'Before[^b].\n\n## Title[^a]\n\n## Again [^b]\n\n## Title2\n\n[^a]: A.\n[^b]: B.\n\n    ## In a note\n\n[^unused]: Never drawn.\n\n    ## Not drawn',
    '> [^q]: Quoted note.\n\n## Heading [^Q] and [^missing]',
    'Orders\n======\n\nLines\n---\n\n## Footnotes\n\nSee[^1].\n\n[^1]: Note.',
  ];
  for (const markdown of documents) {
    const html = renderToStaticMarkup(createElement(Markdown, { rehypePlugins: [rehypeHeadingIds], children: markdown }));
    const drawn = [...html.matchAll(/ id="planning-heading-([^"]*)"/g)].map(match => match[1].replaceAll('&amp;', '&'));
    assert.deepEqual([...sectionAnchors(markdown)], drawn, markdown);
  }
});

test("a plan's request folds: its heading at any level, up to the next heading of its level or above", () => {
  for (const heading of ['Request', 'request', 'Request (Jacob, 2026-10-14)', ' Request (Jacob) ']) assert.equal(isRequestHeading(heading), true, heading);
  for (const heading of ['Requests', 'The request', 'Request: the user', 'Requested changes']) assert.equal(isRequestHeading(heading), false, heading);
  const markdown = '# Plan\n\nIntro.\n\n## Request (Jacob, 2026-10-14)\n\n> Make it so.\n\n### Asked later\n\nMore words.\n\n## Decided\n\nDone.\n\n### Request\n\nNested.\n';
  const html = renderToStaticMarkup(createElement(Markdown, { rehypePlugins: [rehypeHeadingIds, rehypeFoldRequests], children: markdown }));
  const found = [...html.matchAll(/<section class="request-fold" data-fold="([^"]+)">(.*?)<\/section>/gs)];
  // Each is named by its heading's id, which the reader keeps its opened sections by.
  assert.deepEqual(found.map(match => match[1]), [headingPrefix + 'request-jacob-2026-10-14', headingPrefix + 'request']);
  const sections = found.map(match => match[2]);
  assert.equal(sections.length, 2);
  assert.match(sections[0], /^<h2 id="planning-heading-request-jacob-2026-10-14" data-fold-toggle="true">Request \(Jacob, 2026-10-14\)<\/h2>.*Make it so.*Asked later.*More words/s);
  assert.doesNotMatch(sections[0], /Decided/);
  assert.match(sections[1], /^<h3 id="planning-heading-request" data-fold-toggle="true">Request<\/h3>.*Nested/s);
  assert.match(html, /<h1[^>]*>Plan<\/h1>.*Intro.*<section/s, 'everything else stays as it was');
  assert.match(html, /<\/section>\s*<h2 id="planning-heading-decided">Decided<\/h2>/);
});
