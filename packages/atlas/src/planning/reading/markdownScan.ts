// Markdown read without blocking: whether a document may go through the readers' parser, and a
// line-by-line reading for those that may not. The parser (micromark) takes time growing with the
// square of some inputs: dense runs of emphasis, strikethrough, code or link marks in a paragraph,
// many setext headings, containers (quotes, list items, footnotes) opened often or nested deep, by
// markers or by indentation. A document is parsed only when an estimate of its cost, made in one
// pass over its lines, stays within a budget; the estimate is calibrated against those inputs to
// over-estimate, so the parse takes at most about 100 ms where it is allowed. Larger or costlier
// documents are read line by line, in time linear in their size, their headings' own parsing kept
// within a budget: close to the parser, not exact.
// Node only; the readers' own parsing (headings.ts) is shared with the browser.
import type { Nodes } from 'mdast';
import { headingAnchors, parseMarkdown } from './headings.ts';

/** Markdown documents up to this size may go through the parser whole. */
export const fullParseLimit = 64 * 1024;
/** What the parser may cost, in the estimate's milliseconds. */
const parseBudget = 100;
/** A line with more containers than this (quotes, list items) runs the parser out of stack. */
const deeplyNested = /^(?:[ \t]*(?:>|[-*+][ \t]|\d{1,9}[.)][ \t])){33}/m;
/** In a document read line by line, what its headings' own parsing may cost in all, in the estimate's milliseconds; the rest are read plainly. */
const headingBudget = 40;
/** A heading longer than this is read plainly. */
const headingLimit = 1000;
/** What parsing a heading alone costs besides its text, in the estimate's milliseconds. */
const headingParse = 0.1;
/** A document read line by line is read up to this size, the readers' own limit (readableLimit in planningIndex.ts); what follows is left out. */
const scanLimit = 4 * 1024 * 1024;

/**
 * The weight of a line's containers: its quote and list markers, and for a list item its indentation
 * (a nested list takes at least two columns a level, and costs more than its markers); 0 without any.
 */
function containerWeight(line: string) {
  let index = 0, markers = 0, columns = 0;
  for (;;) {
    while (line[index] === ' ' || line[index] === '\t') columns += line[index++] === '\t' ? 4 : 1;
    const character = line[index];
    const spaced = (at: number) => at >= line.length || line[at] === ' ' || line[at] === '\t';
    if (character === '>') { markers++; index++; continue; }
    if ((character === '-' || character === '*' || character === '+') && spaced(index + 1)) { markers++; index++; continue; }
    let digits = 0;
    while (digits < 9 && line.charCodeAt(index + digits) >= 48 && line.charCodeAt(index + digits) <= 57) digits++;
    if (digits && (line[index + digits] === '.' || line[index + digits] === ')') && spaced(index + digits + 1)) { markers++; index += digits + 1; continue; }
    return markers && markers + (columns * 3 >> 2);
  }
}

const setextLike = /^[ \t]{0,3}(?:=+|-+)[ \t]*$/;
const footnoteStart = /^[ \t]{0,3}\[\^/;
/** Marks the parser pairs within a paragraph: a run of emphasis, strikethrough or code marks, and link brackets and parentheses. */
const inlineMarks = /([*_~`])\1*|[[\]()]/g;
/** Other marks that each cost the parser a little: tags and table cells. */
const otherMarks = /[<|]/g;

/**
 * What parsing a Markdown body (and reading its tree) would cost, estimated in one pass over its
 * lines, in about the milliseconds it takes, over rather than under: its size, lines, headings and
 * marks; its containers and setext headings, each costing time growing with the lines around it; and
 * per paragraph, the square of its inline marks.
 */
export function parseCost(body: string) {
  let lines = 0, headings = 0, containers = 0, squares = 0, marks = 0, tokens = 0, blank = true;
  for (let start = 0; start <= body.length;) {
    let end = body.indexOf('\n', start);
    if (end < 0) end = body.length;
    const line = body.slice(start, end);
    start = end + 1;
    lines++;
    if (!line.trim()) { squares += marks * marks; marks = 0; blank = true; continue; }
    const weight = containerWeight(line) || (!blank && setextLike.test(line) ? 1 : 0) || (footnoteStart.test(line) ? 1 : 0);
    const heading = /^[ \t]*#/.test(line);
    containers += weight;
    if (heading) headings++;
    // A container, a heading or a table row starts another paragraph (or cell).
    if (weight || heading || line.includes('|')) { squares += marks * marks; marks = 0; }
    inlineMarks.lastIndex = 0;
    while (inlineMarks.exec(line)) { marks++; tokens++; }
    otherMarks.lastIndex = 0;
    while (otherMarks.exec(line)) tokens++;
    blank = false;
  }
  squares += marks * marks;
  return body.length / 4096 + lines * 0.02 + headings * 0.03 + tokens * 0.01 + containers * lines * 4e-5 + squares * 2e-5;
}

/** Whether a Markdown body goes through the parser: small, not nested deep and not costly to parse (see parseCost). */
export function parseable(body: string) {
  return body.length <= fullParseLimit && !deeplyNested.test(body) && parseCost(body) <= parseBudget;
}

/** A footnote's number as the readers show it, by its label; null for one without a definition (it reads as written). */
export type FootnoteNumber = (label: string) => string | null;
/** The text a heading reads, as its anchor is made from it: code keeps its text, images have none, a footnote reference reads as its number. */
export function headingText(node: Nodes, footnote: FootnoteNumber = () => null): string {
  if (node.type === 'footnoteReference') return footnote(node.identifier) ?? '';
  return node.type === 'text' || node.type === 'inlineCode' ? node.value : node.type !== 'image' && node.type !== 'imageReference' && 'children' in node ? node.children.map(child => headingText(child, footnote)).join('') : '';
}

/**
 * A line's text without its Markdown: markers, emphasis, link targets and tags. Every pattern is
 * bounded and stops at the next bracket or tag, so a line takes time linear in its length; marks are
 * replaced by splitting, which stays fast on a line made of them.
 */
export function lineText(line: string) {
  let text = line.replace(/^[ \t]{0,3}(?:>[ \t]?)*/, '').replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '').replace(/^#{1,6}(?=[ \t]|$)/, '')
    .replace(/!?\[([^[\]\n]{0,200})\]\([^()[\]\n]{0,200}\)/g, '$1').replace(/<\/?[A-Za-z][^<>\n]{0,200}>/g, '');
  for (const mark of ['**', '__', '*', '`', '~', '|']) if (text.includes(mark)) text = text.split(mark).join(' ');
  return text;
}

const quotes = /^(?:[ \t]{0,3}>[ \t]?)+/;
const listItem = /^([ \t]{0,3}(?:[-*+]|\d{1,9}[.)]))(?:[ \t]{1,4}|$)/;
const fence = /^[ \t]{0,3}(`{3,}|~{3,})/;
const atx = /^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/;
const underline = /^[ \t]{0,3}(=+|-+)[ \t]*$/;
const thematicBreak = /^[ \t]{0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const tableDelimiter = /^[ \t]{0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const htmlStart = /^[ \t]{0,3}<(?:!--|\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$))/;
const definition = /^[ \t]{0,3}\[[^\]\n]{1,200}\]:[ \t]*\S/;
const linkDefinition = /^[ \t]{0,3}\[([^\]\n^][^\]\n]{0,199})\]:[ \t]*(?:<([^>\n]{0,1000})>|(\S{1,1000}))/;
const footnoteDefinition = /^[ \t]{0,3}\[\^([^\]\s]{1,100})\]:/;
const footnoteReference = /\[\^([^\]\s]{1,100})\]/g;
const glossaryTerm = /^\*\*([^*\n]{1,200}?)(?::\*\*|\*\*[ \t]*:)/;
const destination = /[ \t]*(?:<([^<>\n]{0,1000})>|([^\s()]{0,1000}))/y;

/** A link or definition label as the parser matches it: whitespace collapsed, case folded. */
export const normalizeLabel = (label: string) => label.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase().toUpperCase();

/** A line with its code spans blanked out: a run of backticks up to the next run as long. */
function withoutCode(line: string) {
  const runs: { start: number; end: number }[] = [];
  for (let index = line.indexOf('`'); index >= 0; index = line.indexOf('`', index)) {
    const start = index;
    while (line[index] === '`') index++;
    runs.push({ start, end: index });
  }
  if (runs.length < 2) return line;
  // The next run of the same length after each, found from the end.
  const next: number[] = [], last = new Map<number, number>();
  for (let index = runs.length - 1; index >= 0; index--) {
    const length = runs[index].end - runs[index].start;
    next[index] = last.get(length) ?? -1;
    last.set(length, index);
  }
  let blanked = '', from = 0;
  for (let index = 0; index < runs.length; index++) {
    if (next[index] < 0) continue;
    blanked += line.slice(from, runs[index].start) + ' '.repeat(runs[next[index]].end - runs[index].start);
    from = runs[next[index]].end;
    index = next[index];
  }
  return blanked + line.slice(from);
}

/**
 * The link targets on a line, in order: inline links' destinations, and reference links' labels
 * (full, collapsed or shortcut) resolved by `definition`. A bracket pair is the innermost one; a link
 * over lines is not read. Linear in the line's length.
 */
function lineLinks(line: string, definition: (label: string) => string | undefined): string[] {
  const plain = withoutCode(line), found: string[] = [];
  let open = -1;
  for (let index = 0; index < plain.length; index++) {
    const character = plain[index];
    if (character === '[') { open = index; continue; }
    if (character !== ']' || open < 0) continue;
    const label = plain.slice(open + 1, index);
    open = -1;
    if (plain[index + 1] === '(') {
      destination.lastIndex = index + 2;
      const match = destination.exec(plain);
      if (match) { found.push(match[1] ?? match[2]); index = destination.lastIndex - 1; }
      continue;
    }
    let reference = label;
    if (plain[index + 1] === '[') {
      const close = plain.indexOf(']', index + 2);
      const second = close < 0 ? '[' : plain.slice(index + 2, close);
      if (!second.includes('[')) { if (second.trim()) reference = second; index = close; }
    }
    const target = reference.trim() && reference.length <= 1000 && !reference.startsWith('^') ? definition(normalizeLabel(reference)) : undefined;
    if (target !== undefined) found.push(target);
  }
  return found;
}

/** A Markdown body read line by line (see scanMarkdown). Its links are read only when asked. */
export interface MarkdownScan {
  /** Its headings with their text, anchor, level and the index of their line in `text`. */
  headings: { text: string; anchor: string; depth: number; line: number }[];
  /** A glossary's terms, under their headings' anchors. */
  terms: { term: string; anchor: string | null }[];
  /** Its text, a line per line (code fences and HTML comments left out). */
  text: string[];
  /** Its links' targets (a reference link's by its definition), with the index of their line in `text`. */
  links: { href: string; line: number }[];
}

/**
 * A Markdown body read line by line, in time linear in its size, up to a limit (what follows it is
 * left out): its headings (ATX and setext, in quotes and lists too, outside code fences, HTML blocks
 * and comments, numbered as the readers number them), a glossary's terms (a paragraph starting with a
 * term in bold and a colon), its text and, when asked, its links (on one line, outside code). Close to
 * the parser, not exact: headings inside footnotes, for one, are not read.
 */
export function scanLines(body: string, options: { glossary?: boolean; links?: boolean } = {}): MarkdownScan {
  const lines = body.slice(0, scanLimit).split(/\r?\n/);
  const definitionLines = lines.filter(line => definition.test(line));
  // A heading's own parsing is given the document's definitions (the first hundred short ones) for its references.
  const definitions = definitionLines.filter(line => line.length <= 300).slice(0, 100);
  const targets = new Map<string, string>();
  if (options.links) for (const line of definitionLines) {
    const match = linkDefinition.exec(line);
    const label = match && normalizeLabel(match[1]);
    if (label && !targets.has(label)) targets.set(label, match[2] ?? match[3]);
  }
  const footnotes = new Set(lines.flatMap(line => { const match = footnoteDefinition.exec(line); return match ? [match[1].toUpperCase()] : []; }));
  // Footnotes are numbered by their first reference.
  const order = new Map<string, number>();
  const footnote: FootnoteNumber = label => { const index = order.get(label.toUpperCase()); return index === undefined ? null : String(index); };
  const anchor = headingAnchors();
  const headings: MarkdownScan['headings'] = [];
  const terms: MarkdownScan['terms'] = [];
  const links: MarkdownScan['links'] = [];
  const text: string[] = [];
  let budget = headingBudget, parsed = 0;
  const appended = definitions.length ? '\n\n' + definitions.join('\n') : '';
  const appendedCost = appended ? parseCost(appended) : 0;
  /**
   * A heading's text as the readers draw it, untrimmed as its anchor is made from it: its own Markdown
   * (an ATX line, or a setext paragraph with its underline) through the parser, with the document's
   * definitions, for the first thousand while their cost is within the budget; read plainly after.
   */
  const rendered = (markdown: string) => {
    const references = markdown.includes('[');
    const cost = budget > 0 && parsed < 1000 && markdown.length <= headingLimit ? headingParse + parseCost(markdown) + (references ? appendedCost : 0) : Infinity;
    if (cost > budget) return lineText(markdown.replace(/\n[ \t]*[=-]+[ \t]*$/, '')).replace(/\s+/g, ' ').trim();
    budget -= cost;
    parsed++;
    const heading = parseMarkdown(references ? markdown + appended : markdown).children[0];
    return heading?.type === 'heading' ? headingText(heading, footnote) : lineText(markdown).trim();
  };
  const heading = (markdown: string, depth: number, line: number) => {
    const read = rendered(markdown);
    headings.push({ text: read.trim(), anchor: anchor(read), depth, line });
  };
  const linksIn = (content: string) => {
    if (!content.includes('[') || definition.test(content)) return;
    for (const href of lineLinks(content, label => targets.get(label))) links.push({ href, line: text.length });
  };
  // The open code fence (with the quote depth it opened at), HTML block or comment; the list item's
  // content column; the paragraph's lines (their content) and the container it is in (its quote
  // depth and column); a table.
  let fenced: { marker: string; depth: number } | null = null, html: 'block' | 'comment' | null = null, column = 0;
  let paragraph: string[] = [], container = { depth: -1, column: 0 }, table = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const quoted = quotes.exec(line);
    const depth = quoted ? (quoted[0].match(/>/g) ?? []).length : 0;
    let content = quoted ? line.slice(quoted[0].length) : line;
    if (fenced && depth >= fenced.depth) {
      const close = fence.exec(content.slice(Math.min(column, /^[ \t]*/.exec(content)![0].length)));
      if (close && close[1][0] === fenced.marker[0] && close[1].length >= fenced.marker.length && !content.trim().slice(close[1].length)) fenced = null;
      else text.push(content);
      continue;
    }
    // A quote that ends closes the code in it.
    fenced = null;
    if (html === 'comment') { if (line.includes('-->')) html = null; continue; }
    if (!content.trim()) { paragraph = []; table = false; if (html === 'block') html = null; if (!depth) column = 0; text.push(''); continue; }
    if (html === 'block') { text.push(lineText(content)); continue; }
    if (!definition.test(content)) for (const match of content.matchAll(footnoteReference)) {
      const label = match[1].toUpperCase();
      if (footnotes.has(label) && !order.has(label)) order.set(label, order.size + 1);
    }
    // A list item's content, or a line within one.
    const item = listItem.exec(content);
    const indent = /^[ \t]*/.exec(content)![0].length;
    let fresh = false;
    if (item && !underline.test(content)) { column = item[0].length; content = content.slice(column); fresh = true; }
    else if (column && indent >= column) content = content.slice(column);
    // A line left of the item's content is not in it (a paragraph's lazy continuation at most).
    const here = { depth, column: fresh || indent >= column ? column : 0 };
    const same = container.depth === here.depth && container.column === here.column;
    if (fence.test(content)) { fenced = { marker: fence.exec(content)![1], depth }; paragraph = []; continue; }
    if (htmlStart.test(content) && (!paragraph.length || /^[ \t]{0,3}<!--/.test(content))) {
      html = /^[ \t]{0,3}<!--/.test(content) ? (content.includes('-->') ? null : 'comment') : 'block';
      if (html === null) continue;
      paragraph = [];
      continue;
    }
    const hashes = content.length <= headingLimit * 2 ? atx.exec(content) : null;
    if (hashes) {
      if (options.links) linksIn(content);
      heading(content.trimStart(), hashes[1].length, text.length);
      text.push(lineText(content));
      paragraph = [];
      continue;
    }
    const under = underline.exec(content);
    if (under && paragraph.length && same && !fresh) {
      heading(paragraph.join('\n') + '\n' + content, under[1][0] === '=' ? 1 : 2, text.length - paragraph.length);
      paragraph = [];
      continue;
    }
    if (paragraph.length === 1 && tableDelimiter.test(content) && content.includes('|')) { paragraph = []; table = true; }
    if (table || /^[ \t]{4}/.test(content) && !paragraph.length) {
      if (table && options.links) linksIn(content);
      text.push(lineText(content));
      continue;
    }
    // A line outside the paragraph's quote or list item continues it lazily, unless it breaks it
    // (a thematic break; an underline cannot be lazy): the paragraph stays in its container, so a
    // line under it is no underline.
    const lazy = paragraph.length && !fresh && !same && (here.depth < container.depth || here.depth === container.depth && here.column < container.column) && !thematicBreak.test(content);
    if (!lazy && (fresh || !same)) paragraph = [];
    if (options.glossary && !paragraph.length) { const term = glossaryTerm.exec(content); if (term) terms.push({ term: term[1].trim(), anchor: headings.at(-1)?.anchor ?? null }); }
    paragraph.push(content);
    if (!lazy) container = here;
    if (options.links) linksIn(content);
    text.push(lineText(content));
  }
  return { headings, terms, text, links };
}
