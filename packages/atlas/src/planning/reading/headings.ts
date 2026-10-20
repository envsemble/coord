// Markdown headings as Atlas's readers show them. The app and the plan viewer render GitHub-flavoured
// Markdown and give each heading an id from the slug of its text, numbered when it repeats; the
// diagram links of a document name their heading the same way, so a link's section is the heading
// the reader draws. Shared by Node and the browser, so nothing here may import Node modules.
import { slug } from 'github-slugger';
import type { FootnoteDefinition, Heading, Nodes, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

/** A document without its leading metadata header, as the readers show it. */
export function markdownBody(source: string) {
  const text = source.replace(/^﻿/, '');
  const header = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
  return header ? text.slice(header[0].length) : text;
}

/** The document's syntax tree, parsed as the readers parse it. */
export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/**
 * Hands out heading anchors in document order: the slug of a heading's text (`section` when it has
 * none), with `-1`, `-2` added when that anchor is already taken.
 */
export function headingAnchors() {
  const used = new Set<string>();
  // The last number given to each anchor: those below it are taken already, so a heading repeated
  // many times does not count from 1 again.
  const last = new Map<string, number>();
  return (text: string) => {
    const base = slug(text) || 'section';
    let anchor = base, suffix = last.get(base) ?? 0;
    if (suffix) anchor = base + '-' + suffix;
    while (used.has(anchor)) anchor = base + '-' + ++suffix;
    used.add(anchor);
    last.set(base, suffix);
    return anchor;
  };
}

/**
 * The anchor of every heading in the tree, in the order the readers draw them. A heading's text is
 * what it reads: code keeps its text, images and raw HTML have none, and a footnote reference reads
 * as the number the reader shows, which counts footnotes by their first reference. The referenced
 * footnotes are drawn after the document, in that order, so their headings come last.
 */
export function documentAnchors(tree: Root): Map<Heading, string> {
  const anchor = headingAnchors();
  const anchors = new Map<Heading, string>();
  const order: string[] = [];
  const footnotes = new Map<string, FootnoteDefinition>();
  const number = (identifier: string) => {
    const id = identifier.toUpperCase();
    const index = order.indexOf(id);
    return String(index < 0 ? order.push(id) : index + 1);
  };
  const text = (node: Nodes): string =>
    node.type === 'footnoteReference' ? number(node.identifier)
      : node.type === 'text' || node.type === 'inlineCode' ? node.value
      : node.type !== 'image' && node.type !== 'imageReference' && 'children' in node ? node.children.map(text).join('') : '';
  const walk = (node: Nodes) => {
    if (node.type === 'heading') anchors.set(node, anchor(text(node)));
    else if (node.type === 'footnoteReference') number(node.identifier);
    else if (node.type !== 'footnoteDefinition' && 'children' in node) for (const child of node.children) walk(child);
  };
  const collect = (node: Nodes) => {
    const id = node.type === 'footnoteDefinition' ? node.identifier.toUpperCase() : null;
    if (id && !footnotes.has(id)) footnotes.set(id, node as FootnoteDefinition);
    if ('children' in node) for (const child of node.children) collect(child);
  };
  collect(tree);
  walk(tree);
  for (let index = 0; index < order.length; index++) {
    const footnote = footnotes.get(order[index]);
    if (footnote) for (const child of footnote.children) walk(child);
  }
  return anchors;
}

/** The anchors of every heading in a Markdown body. */
export function sectionAnchors(markdown: string): Set<string> {
  return new Set(documentAnchors(parseMarkdown(markdown)).values());
}
