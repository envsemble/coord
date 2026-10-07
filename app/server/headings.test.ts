import test from 'node:test';
import assert from 'node:assert/strict';
import { findHeadingId, headingPrefix, rehypeHeadingIds, type HeadingNode } from '../src/headings.ts';

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
