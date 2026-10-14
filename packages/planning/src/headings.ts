// Markdown headings as Atlas's readers show them. The app and the plan viewer render GitHub-flavoured
// Markdown and give each heading an id from the slug of its text, numbered when it repeats; the
// diagram links of a document name their heading the same way, so a link's section is the heading
// the reader draws. Shared by Node and the browser, so nothing here may import Node modules.
import { slug } from 'github-slugger';
import type { Heading, Nodes, Root } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { toString } from 'mdast-util-to-string';
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

/** A heading's text as it reads: code keeps its text, images and raw HTML have none. */
export function headingText(heading: Heading) {
  return toString(heading, { includeImageAlt: false, includeHtml: false });
}

/**
 * Hands out heading anchors in document order: the slug of a heading's text (`section` when it has
 * none), with `-1`, `-2` added when that anchor is already taken.
 */
export function headingAnchors() {
  const used = new Set<string>();
  return (text: string) => {
    const base = slug(text) || 'section';
    let anchor = base, suffix = 0;
    while (used.has(anchor)) anchor = base + '-' + ++suffix;
    used.add(anchor);
    return anchor;
  };
}

/** The anchors of every heading in a Markdown body. */
export function sectionAnchors(markdown: string): Set<string> {
  const anchor = headingAnchors();
  const anchors = new Set<string>();
  const walk = (node: Nodes) => {
    if (node.type === 'heading') anchors.add(anchor(headingText(node)));
    else if ('children' in node) for (const child of node.children) walk(child);
  };
  walk(parseMarkdown(markdown));
  return anchors;
}
