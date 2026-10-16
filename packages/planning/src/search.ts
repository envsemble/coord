// Search in a planning folder: its plans (title, number, summary), their ledgers' steps, its Markdown
// documents (title, path, headings and text), glossary terms in CONTEXT.md files, diagrams (file
// name and title) and their elements. A project's index is built on its first search and kept in
// memory; it is marked stale when the folder changes, and then reads again only the files whose size
// or time changed. Git's folder, hidden folders, dependencies, evidence and anything but Markdown and
// diagrams are left out, and files over a size are known by their name only.
//
// Matching ignores case and accents, and every word of the query must match, in any order. Exact and
// prefix title matches rank first, then titles with every word, then other fields (a path, a summary),
// then text; at each, plans and projects come before the rest, and text last; then the latest changed.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Nodes, Root } from 'mdast';
import atlas from '@envsemble/atlas-diagrams';
import { parseFrontmatter } from './check.ts';
import { documentAnchors, markdownBody, parseMarkdown } from './headings.ts';

export type SearchKind = 'plan' | 'step' | 'document' | 'heading' | 'diagram' | 'element' | 'term' | 'project';
/**
 * What a search found in a planning folder: its kind and title, a snippet around the match (null when
 * a title matched), and where it opens: the work item, the file (POSIX-relative), a heading's anchor
 * as the readers give it, or a diagram element by its identity.
 */
export interface SearchHit { kind: SearchKind; title: string; snippet: string | null; work: string | null; path: string | null; anchor: string | null; element: string | null }
/** A hit with what orders it among others (see compareHits). */
export interface RankedHit extends SearchHit { tier: number; order: number; changed: number }
/** A query: its words, folded, and the whole of it. */
export interface SearchQuery { text: string; words: string[]; number: number | null }

/** Markdown and diagram files larger than this are known by their name only. */
export const searchFileLimit = 2 * 1024 * 1024;
/** How long an index is trusted without a change being reported, in case one was missed. */
const trusted = 60_000;
const skippedFolders = new Set(['node_modules', '__pycache__', 'dist', 'build', 'evidence', 'artifacts']);
const blocks = new Set(['paragraph', 'heading', 'listItem', 'tableCell', 'tableRow', 'code', 'blockquote', 'thematicBreak', 'footnoteDefinition']);

const foldedCharacters = new Map<string, string>();
/**
 * Text for matching: lower case, without accents, and as long as the original, so a match's position
 * is its position in the text.
 */
export function fold(text: string): string {
  return text.replace(/[A-Z]|[^\x00-\x7f]/gu, character => {
    let folded = foldedCharacters.get(character);
    if (folded === undefined) {
      const plain = character.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
      const lower = character.toLowerCase();
      folded = plain.length === character.length ? plain : lower.length === character.length ? lower : character;
      if (foldedCharacters.size < 10_000) foldedCharacters.set(character, folded);
    }
    return folded;
  });
}

/** A query's words (a `#` before a word ignored) and, for one like `0023`, `#23` or `work-0023`, the plan number; null without words. */
export function searchQuery(text: string): SearchQuery | null {
  const whole = fold(text.trim().replace(/\s+/g, ' '));
  const words = [...new Set(whole.split(' ').map(word => word.replace(/^#+/, '')).filter(Boolean))];
  if (!words.length) return null;
  const number = /^#?(?:work-)?(\d{1,9})$/.exec(whole);
  return { text: whole.replace(/^#+/, ''), words, number: number ? Number(number[1]) : null };
}

/** Best first: by tier, then plans and projects before the rest and text last, then the latest changed, then by title. */
export function compareHits(a: RankedHit, b: RankedHit) {
  return a.tier - b.tier || a.order - b.order || b.changed - a.changed || a.title.localeCompare(b.title);
}

interface Field { text: string; folded: string }
const field = (text: string): Field => ({ text, folded: fold(text) });
/** Something the index can find: its titles (any can match), other fields, and text; `elsewhere`: found by its titles as something else (a plan's file as its work item). */
interface Entry {
  kind: SearchKind; title: string; names: string[]; fields: Field[]; body: Field | null; number: number | null; elsewhere?: boolean;
  work: string | null; path: string | null; anchor: string | null; element: string | null; changed: number;
}

/** Where a word starts in a title: at its start or after something that is not a letter or digit. */
function atWordStart(title: string, word: string) {
  for (let index = title.indexOf(word); index >= 0; index = title.indexOf(word, index + 1)) {
    if (index === 0 || !/[\p{L}\p{N}]/u.test(title[index - 1])) return true;
  }
  return false;
}
/** A title's tier: exact 0, prefix 1, every word at a word's start 2, every word within it 3; null when a word is missing. */
function titleTier(title: string, query: SearchQuery) {
  if (title === query.text) return 0;
  if (title.startsWith(query.text)) return 1;
  if (query.words.every(word => atWordStart(title, word))) return 2;
  return query.words.every(word => title.includes(word)) ? 3 : null;
}

/**
 * A short passage of the text around the query's words, on one line: at the first match of the word
 * that comes latest, so the passage shows it after the others, and not a title the text starts with.
 */
export function snippetOf(source: Field, words: string[], width = 120): string | null {
  let at = -1, length = 0;
  for (const word of words) {
    const index = source.folded.indexOf(word);
    if (index > at) { at = index; length = word.length; }
  }
  if (at < 0) return null;
  const { text } = source;
  if (text.length <= width) return text.replace(/\s+/g, ' ').trim();
  let start = Math.max(0, at - Math.round(width / 3)), end = Math.min(text.length, Math.max(at + length, start + width));
  if (start > 0) { const space = text.slice(start, at).search(/\s/); if (space >= 0) start += space + 1; }
  if (end < text.length) { const space = text.slice(at + length, end).search(/\s\S*$/); if (space >= 0) end = at + length + space; }
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

function matchEntry(entry: Entry, query: SearchQuery): RankedHit | null {
  const hit = (tier: number, snippet: string | null): RankedHit => ({
    kind: entry.kind, title: entry.title, snippet, work: entry.work, path: entry.path, anchor: entry.anchor, element: entry.element,
    tier, order: tier === 5 ? 2 : entry.kind === 'plan' || entry.kind === 'project' ? 0 : 1, changed: entry.changed,
  });
  if (entry.number !== null && entry.number === query.number) return hit(0, null);
  let best: number | null = null;
  for (const name of entry.names) { const tier = titleTier(name, query); if (tier !== null && (best === null || tier < best)) best = tier; }
  if (best !== null) return entry.elsewhere ? null : hit(best, null);
  const named = entry.names.join(' ');
  if (entry.fields.length && query.words.every(word => named.includes(word) || entry.fields.some(item => item.folded.includes(word)))) {
    const source = entry.fields.find(item => query.words.some(word => !named.includes(word) && item.folded.includes(word)))!;
    return hit(4, snippetOf(source, query.words.filter(word => source.folded.includes(word))));
  }
  if (entry.body && query.words.every(word => named.includes(word) || entry.body!.folded.includes(word))) {
    return hit(5, snippetOf(entry.body, query.words.filter(word => entry.body!.folded.includes(word))));
  }
  return null;
}

/** What one file contributes, kept until the file changes. */
interface Parsed {
  /** Markdown: its header, its title, its headings and terms, its text. */
  metadata?: Record<string, unknown> | null; title?: string;
  headings?: { text: string; anchor: string }[]; terms?: { term: string; anchor: string | null }[]; text?: string;
  /** A diagram: its title and elements. */
  diagram?: { title: string; elements: { id: string; name: string }[] };
}
interface FileRecord { size: number; mtime: number; parsed: Parsed }

/** The text a heading reads, as its anchor is made from it: code keeps its text, images have none. */
function headingText(node: Nodes): string {
  return node.type === 'text' || node.type === 'inlineCode' ? node.value : node.type !== 'image' && node.type !== 'imageReference' && 'children' in node ? node.children.map(headingText).join('') : '';
}
/** A Markdown tree's text, one line per block, without the heading given (its title). */
function plainText(tree: Root, title?: Nodes): string {
  const parts: string[] = [];
  const walk = (node: Nodes) => {
    if (node === title) return;
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') parts.push(node.value);
    else if (node.type === 'image') parts.push(node.alt ?? '');
    else if (node.type === 'break') parts.push(' ');
    else if (node.type !== 'html' && node.type !== 'definition' && 'children' in node) for (const child of node.children) walk(child);
    if (blocks.has(node.type)) parts.push('\n');
  };
  walk(tree);
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
/** A glossary's terms: paragraphs that start with a term in bold and a colon, under their headings. */
function glossaryTerms(tree: Root, anchors: Map<Nodes, string>) {
  const terms: { term: string; anchor: string | null }[] = [];
  let section: string | null = null;
  for (const node of tree.children) {
    if (node.type === 'heading') section = anchors.get(node) ?? section;
    if (node.type !== 'paragraph' || node.children[0]?.type !== 'strong') continue;
    const [strong, next] = node.children;
    const term = headingText(strong).trim();
    const colon = term.endsWith(':') || (next?.type === 'text' && next.value.startsWith(':'));
    if (colon && term.replace(/:$/, '').trim()) terms.push({ term: term.replace(/:$/, '').trim(), anchor: section });
  }
  return terms;
}

function parseFile(relative: string, source: string): Parsed {
  const text = source.replace(/^﻿/, '');
  if (/\.puml$/i.test(relative)) {
    const fallback = path.posix.basename(relative).replace(/\.[^.]*$/, '');
    try {
      const { diagram } = atlas.parseDiagram(text, { path: relative });
      return { diagram: { title: diagram?.title || fallback, elements: (diagram?.elements ?? []).map(element => ({ id: element.id, name: element.name })) } };
    } catch { return { diagram: { title: fallback, elements: [] } }; }
  }
  let metadata: Record<string, unknown> | null = null;
  try { metadata = parseFrontmatter(text, { entryLists: ['steps'] }); } catch { /* A header that does not parse reads as none. */ }
  const tree = parseMarkdown(markdownBody(text));
  const anchors = documentAnchors(tree);
  const headings = [...anchors].map(([node, anchor]) => ({ node, text: headingText(node).trim(), anchor })).filter(heading => heading.text);
  const first = headings.find(heading => heading.node.depth === 1);
  const title = (typeof metadata?.title === 'string' && metadata.title.trim()) || first?.text || path.posix.basename(relative);
  const parsed: Parsed = { metadata, title, headings: headings.map(({ text, anchor }) => ({ text, anchor })), text: plainText(tree, first && fold(first.text) === fold(title) ? first.node : undefined) };
  if (/(^|\/)context\.md$/i.test(relative)) parsed.terms = glossaryTerms(tree, anchors as Map<Nodes, string>);
  return parsed;
}

/** The Markdown and diagram files of a planning folder, with their sizes and times. */
async function listFiles(root: string, relative = ''): Promise<{ relative: string; size: number; mtime: number }[]> {
  const result: { relative: string; size: number; mtime: number }[] = [];
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async entry => {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) return;
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) { if (!skippedFolders.has(entry.name.toLowerCase())) result.push(...await listFiles(root, child)); return; }
    if (!entry.isFile() || !(/\.(md|puml)$/i.test(entry.name) || child === 'planning.json')) return;
    const info = await stat(path.join(root, child)).catch(() => null);
    if (info) result.push({ relative: child, size: info.size, mtime: info.mtimeMs });
  }));
  return result;
}

/** Run at most `limit` at a time. */
async function inTurns<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) await run(items[next++]); }));
}

const sameKey = (value: string) => process.platform === 'win32' || process.platform === 'darwin' ? value.toLowerCase() : value;
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

/** A planning folder's search index, built on its first search; `invalidate` when the folder changes. */
export class PlanningSearch {
  readonly root: string;
  private files = new Map<string, FileRecord>();
  private entries: Entry[] = [];
  private stale = true;
  private checked = 0;
  private refreshing: Promise<void> | null = null;
  constructor(root: string) { this.root = root; }

  /** Something in the folder changed: the next search looks again. */
  invalidate() { this.stale = true; }

  /** Everything in the folder that matches, unordered; the project itself under `name`. */
  async search(query: SearchQuery, name: string): Promise<RankedHit[]> {
    while (this.stale || Date.now() - this.checked >= trusted) {
      this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    const hits: RankedHit[] = [];
    const project: Entry = { kind: 'project', title: name, names: [fold(name)], fields: [], body: null, number: null, work: null, path: null, anchor: null, element: null, changed: Math.max(0, ...[...this.files.values()].map(file => file.mtime)) };
    for (const entry of [project, ...this.entries]) { const hit = matchEntry(entry, query); if (hit) hits.push(hit); }
    return hits;
  }

  /** Read the files that changed since the last look, and gather the entries again when any did. */
  private async refresh() {
    this.stale = false;
    const started = Date.now();
    try {
      const listed = await listFiles(this.root);
      const files = new Map<string, FileRecord>();
      let changed = listed.length !== this.files.size;
      await inTurns(listed, 16, async file => {
        const known = this.files.get(file.relative);
        if (known && known.size === file.size && known.mtime === file.mtime) { files.set(file.relative, known); return; }
        changed = true;
        let parsed: Parsed = {};
        if (file.relative !== 'planning.json' && file.size <= searchFileLimit) {
          try { parsed = parseFile(file.relative, await readFile(path.join(this.root, file.relative), 'utf8')); } catch { /* Gone or unreadable: known by its name. */ }
        }
        files.set(file.relative, { size: file.size, mtime: file.mtime, parsed });
      });
      if (changed) {
        let registry: { work_items?: unknown } | null = null;
        try { registry = JSON.parse((await readFile(path.join(this.root, 'planning.json'), 'utf8')).replace(/^﻿/, '')); } catch { /* No work items then. */ }
        this.entries = gather(files, registry);
      }
      this.files = files;
    } catch {
      this.files = new Map();
      this.entries = [];
    }
    this.checked = started;
  }
}

/** The index's entries from its files and registry. */
function gather(files: Map<string, FileRecord>, registry: { work_items?: unknown } | null): Entry[] {
  const work = (Array.isArray(registry?.work_items) ? registry.work_items as { id?: unknown; path?: unknown; current_plan?: unknown }[] : [])
    .filter(item => typeof item?.id === 'string' && typeof item.path === 'string')
    .map(item => ({ id: item.id as string, path: (item.path as string).replace(/\/+$/, ''), plan: typeof item.current_plan === 'string' ? item.current_plan : null }))
    .sort((a, b) => b.path.length - a.path.length);
  const plans = new Set(work.flatMap(item => item.plan ? [sameKey(item.plan)] : []));
  const owner = (relative: string) => work.find(item => sameKey(relative).startsWith(sameKey(item.path) + '/'))?.id ?? null;
  const entries: Entry[] = [];
  const base = { fields: [], body: null, number: null, anchor: null, element: null };
  for (const item of work) {
    const plan = item.plan ? files.get(item.plan) : undefined;
    const ledger = files.get(item.path + '/ledger.md');
    const metadata = plan?.parsed.metadata;
    const title = text(metadata?.title) ?? plan?.parsed.title ?? item.path.split('/').at(-1)!;
    const number = /(\d+)$/.exec(item.id)?.[1] ?? null;
    const summary = text(metadata?.summary);
    entries.push({
      ...base, kind: 'plan', title, names: [fold(title)], fields: [...summary ? [field(summary)] : [], ...number === null ? [] : [field(number)]], number: number === null ? null : Number(number),
      work: item.id, path: item.plan, changed: plan?.mtime ?? 0,
    });
    const steps = ledger?.parsed.metadata?.steps;
    for (const step of Array.isArray(steps) ? steps as { title?: unknown }[] : []) {
      const name = text(step?.title);
      if (name) entries.push({ ...base, kind: 'step', title: name, names: [fold(name)], work: item.id, path: item.plan ?? item.path + '/ledger.md', changed: ledger!.mtime });
    }
  }
  for (const [relative, file] of files) {
    if (relative === 'planning.json') continue;
    const workId = owner(relative);
    const at = { work: workId, path: relative, changed: file.mtime };
    const { diagram, title, headings, terms } = file.parsed;
    const name = path.posix.basename(relative);
    if (/\.puml$/i.test(relative)) {
      const shown = diagram?.title ?? name.replace(/\.[^.]*$/, '');
      entries.push({ ...base, ...at, kind: 'diagram', title: shown, names: [...new Set([fold(shown), fold(name.replace(/\.[^.]*$/, ''))])] });
      for (const element of diagram?.elements ?? []) {
        entries.push({ ...base, ...at, kind: 'element', title: element.name, names: [...new Set([fold(element.name), fold(element.id)])], element: element.id });
      }
      continue;
    }
    // A plan is found as its work item; its text and headings are found here.
    const isPlan = plans.has(sameKey(relative));
    const shown = title ?? name;
    entries.push({ ...base, ...at, kind: 'document', title: shown, names: [fold(shown)], fields: isPlan ? [] : [field(relative)], elsewhere: isPlan, body: file.parsed.text ? field(file.parsed.text) : null });
    const titled = fold(shown);
    for (const heading of headings ?? []) {
      if (fold(heading.text) === titled) continue;
      entries.push({ ...base, ...at, kind: 'heading', title: heading.text, names: [fold(heading.text)], anchor: heading.anchor });
    }
    for (const term of terms ?? []) entries.push({ ...base, ...at, kind: 'term', title: term.term, names: [fold(term.term)], anchor: term.anchor });
  }
  return entries;
}
