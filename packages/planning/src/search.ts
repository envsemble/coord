// Search in a planning folder: its plans (title, number, summary), their ledgers' steps, its Markdown
// documents (title, path, headings and text), glossary terms in CONTEXT.md files, diagrams (file
// name and title) and their elements. A project's index is built on its first search and kept in
// memory; it is marked stale when the folder changes, and then reads again only the files whose size
// or time changed. Git's folder, hidden folders, dependencies, work items' evidence and anything but
// Markdown and diagrams are left out, and files over a size are known by their name only.
//
// Markdown is read line by line, in time linear in its size, never parsed whole: a parser can take
// minutes over some files (large tables, deep quotes), and indexing runs on the host's main thread,
// which it gives back between files. Only a heading's own line goes through the Markdown parser, for
// the text its anchor is made of.
//
// Matching ignores case and accents, and every word of the query must match, in any order. Exact and
// prefix title matches rank first, then titles with every word, then other fields (a path, a summary),
// then text. Within each, plans and projects come first, then steps, documents, headings, diagrams,
// elements and terms, an exact title before a prefix, then the latest changed.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Nodes } from 'mdast';
import atlas from '@envsemble/atlas-diagrams';
import { parseFrontmatter } from './check.ts';
import { headingAnchors, markdownBody, parseMarkdown } from './headings.ts';

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
/** Folders never read wherever they are, besides hidden ones; a work item's `evidence` is left out too, as the home's watch leaves it. */
const skippedFolders = new Set(['node_modules', '__pycache__']);
/** Headings go through the Markdown parser up to this length; longer ones, and those after the first thousand, are read plainly. */
const headingLimit = 1000;
const kindOrder: Record<SearchKind, number> = { plan: 0, project: 0, step: 1, document: 2, heading: 3, diagram: 4, element: 5, term: 6 };

const foldedCharacters = new Map<string, string>();
/**
 * Text for matching: composed (NFC), lower case, without accents, and as long as the composed text,
 * so a match's position is its position in it.
 */
export function fold(text: string): string {
  return text.normalize('NFC').replace(/[A-Z]|[^\x00-\x7f]/gu, character => {
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

/**
 * Best first: exact and prefix titles together, then titles with every word at a word's start, then
 * titles with them within, other fields, and text; within each by kind (plans and projects first),
 * an exact title before a prefix, the latest changed, and by title.
 */
export function compareHits(a: RankedHit, b: RankedHit) {
  const group = (hit: RankedHit) => Math.max(0, hit.tier - 1);
  return group(a) - group(b) || a.order - b.order || a.tier - b.tier || b.changed - a.changed || a.title.localeCompare(b.title);
}

/** Text to match, composed (NFC) and folded; words shorter than `minimum` do not match it (`#1` against a path). */
interface Field { text: string; folded: string; minimum: number }
const field = (text: string, minimum = 1): Field => { const composed = text.normalize('NFC'); return { text: composed, folded: fold(composed), minimum }; };
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
    kind: entry.kind, title: entry.title.normalize('NFC'), snippet, work: entry.work, path: entry.path, anchor: entry.anchor, element: entry.element,
    tier, order: kindOrder[entry.kind], changed: entry.changed,
  });
  if (entry.number !== null && entry.number === query.number) return hit(0, null);
  let best: number | null = null;
  for (const name of entry.names) { const tier = titleTier(name, query); if (tier !== null && (best === null || tier < best)) best = tier; }
  if (best !== null) return entry.elsewhere ? null : hit(best, null);
  const named = entry.names.join(' ');
  const inField = (item: Field, word: string) => word.length >= item.minimum && item.folded.includes(word);
  if (entry.fields.length && query.words.every(word => named.includes(word) || entry.fields.some(item => inField(item, word)))) {
    const source = entry.fields.find(item => query.words.some(word => !named.includes(word) && inField(item, word)))!;
    return hit(4, snippetOf(source, query.words.filter(word => inField(source, word))));
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
/** A line's text without its Markdown: markers, emphasis, link targets and tags. Every pattern is bounded, so a line takes time linear in its length. */
function lineText(line: string) {
  return line.replace(/^[ \t]{0,3}(?:>[ \t]?)*/, '').replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '').replace(/^#{1,6}(?=[ \t]|$)/, '')
    .replace(/!?\[([^\]\n]{0,200})\]\([^)\n]{0,200}\)/g, '$1').replace(/<\/?[A-Za-z][^<>\n]{0,200}>/g, '').replace(/\*\*|__|[*`~|]/g, ' ');
}
/**
 * A heading's text as the readers draw it, untrimmed as its anchor is made from it: its own Markdown
 * (an ATX line, or a setext paragraph with its underline) through the parser, with the document's
 * link definitions.
 */
function renderedHeading(markdown: string, definitions: string[]) {
  if (markdown.length > headingLimit) return lineText(markdown.replace(/\n[ \t]*[=-]+[ \t]*$/, '')).replace(/\s+/g, ' ').trim();
  const tree = parseMarkdown(markdown + (markdown.includes('[') && definitions.length ? '\n\n' + definitions.join('\n') : ''));
  const heading = tree.children[0];
  return heading?.type === 'heading' ? headingText(heading) : lineText(markdown).trim();
}

const fence = /^[ \t]{0,3}(`{3,}|~{3,})/;
const atx = /^[ \t]{0,3}(#{1,6})(?:[ \t]+|$)/;
/** A quote's markers and a list item's marker before a heading in them. */
const containerPrefix = /^[ \t]{0,3}(?:(?:>[ \t]?)+(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?|(?:[-*+]|\d{1,9}[.)])[ \t]+)/;
const underline = /^[ \t]{0,3}(=+|-+)[ \t]*$/;
const container = /^[ \t]{0,3}(?:>|[-*+][ \t]|\d{1,9}[.)][ \t]|\|)/;
const definition = /^[ \t]{0,3}\[[^\]\n]{1,200}\]:[ \t]*\S/;
const glossaryTerm = /^\*\*([^*\n]{1,200}?)(?::\*\*|\*\*[ \t]*:)/;

/**
 * A Markdown document read line by line: its title, its headings (ATX and setext, outside code
 * fences, numbered as the readers number them), a glossary's terms (a paragraph starting with a term
 * in bold and a colon, under its heading), and its text without the title's own heading.
 */
export function readMarkdown(relative: string, source: string, metadata: Record<string, unknown> | null): Parsed {
  const lines = markdownBody(source).split(/\r?\n/);
  const definitions = lines.filter(line => definition.test(line)).slice(0, 100);
  const anchor = headingAnchors();
  const glossary = /(^|\/)context\.md$/i.test(relative);
  const headings: { text: string; anchor: string; depth: number; line: number }[] = [];
  const terms: { term: string; anchor: string | null }[] = [];
  const text: string[] = [];
  // The fence a code block opened with, the lines of the paragraph so far, and whether the lines
  // since the last blank one are in a list, quote or table (where an underline is no heading).
  let open: string | null = null, paragraph: number[] = [], nested = false;
  const heading = (markdown: string, depth: number, line: number) => {
    const read = headings.length < 1000 ? renderedHeading(markdown, definitions) : lineText(markdown).trim();
    headings.push({ text: read.trim(), anchor: anchor(read), depth, line });
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const opened = fence.exec(line);
    if (open !== null) {
      if (opened && opened[1][0] === open[0] && opened[1].length >= open.length && !line.trim().slice(opened[1].length)) open = null;
      else text.push(line);
      continue;
    }
    if (opened) { open = opened[1]; paragraph = []; nested = false; continue; }
    if (!line.trim()) { paragraph = []; nested = false; text.push(''); continue; }
    const inner = line.length <= headingLimit * 2 ? line.replace(containerPrefix, '') : '';
    const hashes = atx.exec(inner);
    if (hashes) {
      heading(inner.trimStart(), hashes[1].length, text.length);
      text.push(lineText(line));
      paragraph = []; nested = false;
      continue;
    }
    const under = underline.exec(line);
    if (under && paragraph.length && !nested) {
      heading(paragraph.map(at => lines[at]).join('\n') + '\n' + line, under[1][0] === '=' ? 1 : 2, text.length - paragraph.length);
      paragraph = [];
      continue;
    }
    if (container.test(line)) nested = true;
    else if (!nested) {
      if (glossary && !paragraph.length) { const term = glossaryTerm.exec(line); if (term) terms.push({ term: term[1].trim(), anchor: headings.at(-1)?.anchor ?? null }); }
      paragraph.push(index);
    }
    text.push(lineText(line));
  }
  const first = headings.find(item => item.depth === 1 && item.text);
  const title = (typeof metadata?.title === 'string' && metadata.title.trim()) || first?.text || path.posix.basename(relative);
  // The title's own heading is the title, not text.
  if (first && fold(first.text) === fold(title)) text[first.line] = '';
  return {
    metadata, title, headings: headings.filter(item => item.text).map(({ text, anchor }) => ({ text, anchor })), terms: glossary ? terms : undefined,
    text: text.join('\n').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(),
  };
}

function parseFile(relative: string, source: string): Parsed {
  const text = source.replace(/^\uFEFF/, '');
  if (/\.puml$/i.test(relative)) {
    const fallback = path.posix.basename(relative).replace(/\.[^.]*$/, '');
    try {
      const { diagram } = atlas.parseDiagram(text, { path: relative });
      return { diagram: { title: diagram?.title || fallback, elements: (diagram?.elements ?? []).map(element => ({ id: element.id, name: element.name })) } };
    } catch { return { diagram: { title: fallback, elements: [] } }; }
  }
  let metadata: Record<string, unknown> | null = null;
  try { metadata = parseFrontmatter(text, { entryLists: ['steps'] }); } catch { /* A header that does not parse reads as none. */ }
  return readMarkdown(relative, text, metadata);
}

/** The Markdown and diagram files of a planning folder, with their sizes and times. */
async function listFiles(root: string, relative = ''): Promise<{ relative: string; size: number; mtime: number }[]> {
  const result: { relative: string; size: number; mtime: number }[] = [];
  const entries = await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => []);
  await Promise.all(entries.map(async entry => {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) return;
    const child = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      const evidence = /^(?:active|archive)\/[^/]+\/evidence$/.test(child);
      if (!skippedFolders.has(entry.name) && !evidence) result.push(...await listFiles(root, child));
      return;
    }
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
  /** No planning.json was found (or the folder has not been read yet): nothing is found in it. */
  private missing = true;
  private stale = true;
  private checked = 0;
  private refreshing: Promise<void> | null = null;
  private refreshStarted = 0;
  constructor(root: string) { this.root = root; }

  /** Something in the folder changed: the next search looks again. */
  invalidate() { this.stale = true; }

  /**
   * Everything in the folder that matches, unordered; the project itself under `name`. A search waits
   * at most `wait` ms for the folder to be read again (a folder on a share that stopped answering),
   * then answers from what it read before, if anything; one that has been read for longer already is
   * not waited for again.
   */
  async search(query: SearchQuery, name: string, wait = Number.POSITIVE_INFINITY): Promise<RankedHit[]> {
    while (this.stale || Date.now() - this.checked >= trusted) {
      if (!this.refreshing) {
        this.refreshStarted = Date.now();
        this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
      }
      const left = this.refreshStarted + wait - Date.now();
      if (left <= 0 || !await within(this.refreshing, left)) break;
    }
    if (this.missing) return [];
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
      const listed = await this.list();
      const files = new Map<string, FileRecord>();
      let changed = listed.length !== this.files.size;
      await inTurns(listed, 16, async file => {
        const known = this.files.get(file.relative);
        if (known && known.size === file.size && known.mtime === file.mtime) { files.set(file.relative, known); return; }
        changed = true;
        let parsed: Parsed = {};
        if (file.relative !== 'planning.json' && file.size <= searchFileLimit) {
          try { parsed = parseFile(file.relative, await readFile(path.join(this.root, file.relative), 'utf8')); } catch { /* Gone or unreadable: known by its name. */ }
          // Give the thread back between files.
          await new Promise(resolve => setImmediate(resolve));
        }
        files.set(file.relative, { size: file.size, mtime: file.mtime, parsed });
      });
      if (changed) {
        let registry: { work_items?: unknown } | null = null;
        try { registry = JSON.parse((await readFile(path.join(this.root, 'planning.json'), 'utf8')).replace(/^\uFEFF/, '')); } catch { /* No work items then. */ }
        this.entries = gather(files, registry);
      }
      this.files = files;
      this.missing = !files.has('planning.json');
    } catch {
      this.files = new Map();
      this.entries = [];
      this.missing = true;
    }
    this.checked = started;
  }
  /** The folder's files to index (tests make it slow). */
  protected list() { return listFiles(this.root); }
}

/** Whether a promise settles within `ms`. */
async function within(pending: Promise<unknown>, ms: number): Promise<boolean> {
  if (!Number.isFinite(ms)) return pending.then(() => true, () => true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), ms); timer.unref?.(); });
  try { return await Promise.race([pending.then(() => true, () => true), late]); } finally { clearTimeout(timer); }
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
      ...base, kind: 'plan', title, names: [fold(title)], fields: [...summary ? [field(summary)] : [], ...number === null ? [] : [field(number, 2)]], number: number === null ? null : Number(number),
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
    entries.push({ ...base, ...at, kind: 'document', title: shown, names: [fold(shown)], fields: isPlan ? [] : [field(relative, 2)], elsewhere: isPlan, body: file.parsed.text ? field(file.parsed.text) : null });
    const titled = fold(shown);
    for (const heading of headings ?? []) {
      if (fold(heading.text) === titled) continue;
      entries.push({ ...base, ...at, kind: 'heading', title: heading.text, names: [fold(heading.text)], anchor: heading.anchor });
    }
    for (const term of terms ?? []) entries.push({ ...base, ...at, kind: 'term', title: term.term, names: [fold(term.term)], anchor: term.anchor });
  }
  return entries;
}
