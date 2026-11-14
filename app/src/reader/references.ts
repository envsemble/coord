// What a planning file references, as the reader finds it in its text: PRs and issues
// (`envsemble/coord#22`, a GitHub URL), commits (`envsemble/coord@4ab195a`, a GitHub URL), files in
// the project's folders (`app/src/hub/Hub.tsx:68`), other work items (`work-0023`) and applications'
// links (`t3-thread://…`). The host resolves the first three (references.resolve); the reader links
// what leads somewhere. A PR or commit names its repository in full: `coord#22`, `#22` and a bare hash
// are text. Careful with what only looks like a reference: a path needs a folder or a code span and
// ends in a file's extension. Pure, so it is unit-tested.
import type { ReferenceInput } from '../types';

export type Found =
  | { kind: 'host'; input: ReferenceInput }
  | { kind: 'work'; work: string }
  | { kind: 'app'; url: string };
export interface Match { start: number; end: number; found: Found }

/** The schemes of applications' links the reader links: T3 Code's (main allows the same and no others from a page). */
export const appSchemes = ['t3-thread', 't3code'];

/** One key per reference, to resolve each once per document and find its answer again. */
export const referenceKey = (input: ReferenceInput) => [input.kind, input.repository ?? '', input.value, input.line ?? ''].join('\u0000');

const github = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues|commit)\/([0-9a-f]{7,40}|\d+)(?:[/?#][^\s]*)?$/i;
/** A GitHub PR, issue or commit by its URL, as the host resolves it; null for any other address. */
export function fromUrl(url: string): ReferenceInput | null {
  const match = github.exec(url);
  if (!match) return null;
  const [, repository, kind, value] = match;
  if (kind.toLowerCase() === 'commit') return /^[0-9a-f]{7,40}$/i.test(value) ? { kind: 'commit', repository, value: value.toLowerCase(), line: null } : null;
  return /^\d+$/.test(value) ? { kind: 'pull', repository, value, line: null } : null;
}

const name = '[A-Za-z0-9][A-Za-z0-9._-]*';
/** A repository as a reference names it: `owner/repo`. */
const repository = name + '/' + name;
/** `skip`: text no other reference may be found in (a web address that is not GitHub's). */
const patterns: { pattern: RegExp; found(match: RegExpExecArray, code: boolean): Found | 'skip' | null }[] = [
  // A web address (GitHub's PRs, issues and commits resolve; other addresses are left to markdown).
  { pattern: /https?:\/\/[^\s<>()[\]`'"]+/g, found: match => { const input = fromUrl(trimEnd(match[0])); return input ? { kind: 'host', input } : 'skip'; } },
  { pattern: new RegExp('\\b(?:' + appSchemes.join('|') + '):\\/\\/[^\\s<>()[\\]`\'"]+', 'g'), found: match => ({ kind: 'app', url: trimEnd(match[0]) }) },
  { pattern: /\bwork-\d{4}\b/g, found: match => ({ kind: 'work', work: match[0] }) },
  // envsemble/coord#22: a repository's PR or issue (not a URL's fragment or an HTML entity).
  { pattern: new RegExp('(?<![\\w/&#.-])(' + repository + ')#(\\d{1,7})\\b', 'g'), found: match => ({ kind: 'host', input: { kind: 'pull', repository: match[1], value: match[2], line: null } }) },
  // envsemble/coord@4ab195a: a repository's commit (not an e-mail address).
  { pattern: new RegExp('(?<![\\w/.-])(' + repository + ')@([0-9a-f]{7,40})(?![\\w-]|\\.\\w)', 'g'), found: match => ({ kind: 'host', input: { kind: 'commit', repository: match[1], value: match[2], line: null } }) },
  // A path with a file's extension, at a line: in a code span also without a folder.
  {
    pattern: /(?<![\w@:/.-])((?:\.\/)?(?:[\w@+-][\w.@+-]*\/)*[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\d{1,7}))?(?![\w/@(-]|\.\w)/g,
    found: (match, code) => match[1].includes('/') || code ? { kind: 'host', input: { kind: 'path', repository: null, value: match[1].replace(/^\.\//, ''), line: match[2] ? Number(match[2]) : null } } : null,
  },
];
/** An address without the punctuation that ends its sentence. */
const trimEnd = (value: string) => value.replace(/[.,;:!?]+$/, '');

/** The references in a run of text, in order and without overlaps; `code`: the text of a code span. */
export function findReferences(text: string, code = false): Match[] {
  const matches: Match[] = [];
  const taken: { start: number; end: number }[] = [];
  for (const { pattern, found } of patterns) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      const start = match.index;
      const result = found(match, code);
      if (!result) continue;
      const end = start + (result === 'skip' ? match[0].length : result.kind === 'app' ? result.url.length : /^https?:/.test(match[0]) ? trimEnd(match[0]).length : match[0].length);
      if (taken.some(other => start < other.end && other.start < end)) continue;
      taken.push({ start, end });
      if (result !== 'skip') matches.push({ start, end, found: result });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

/** A node of the document's HTML tree, as the markdown renderer hands it to plugins. */
interface Node { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Node[] }
/** A reference an address names as a whole, as the reader finds one (`app/src/x.ts:12`, `envsemble/coord#22`, `t3-thread://…`). */
export function wholeReference(href: string): Found | null {
  const [match] = findReferences(href, true);
  return match && match.start === 0 && match.end === href.length ? match.found : null;
}

/** What a document's rendering found for the host to resolve, by key, filled as it renders. */
export interface Collected { inputs: Map<string, ReferenceInput> }
const collect = (collected: Collected | undefined, found: Found | null) => { if (collected && found?.kind === 'host') collected.inputs.set(referenceKey(found.input), found.input); };

/** A run of text with its references as links, each carrying what it found (`data-reference`). */
function linked(text: string, code: boolean, collected: Collected | undefined): Node[] {
  const matches = findReferences(text, code);
  for (const match of matches) collect(collected, match.found);
  if (!matches.length) return [{ type: 'text', value: text }];
  const parts: Node[] = [];
  let at = 0;
  for (const match of matches) {
    if (match.start > at) parts.push({ type: 'text', value: text.slice(at, match.start) });
    parts.push({ type: 'element', tagName: 'a', properties: { href: '#', dataReference: JSON.stringify(match.found) }, children: [{ type: 'text', value: text.slice(match.start, match.end) }] });
    at = match.end;
  }
  if (at < text.length) parts.push({ type: 'text', value: text.slice(at) });
  return parts;
}
/**
 * Make the references in a document's text and code spans links (not in its links, headings or code
 * blocks), and collect what the host is to resolve (`collected`): those references, and the links'
 * addresses that are GitHub's PRs, issues or commits, or (`addresses: 'all'`) any address naming a
 * reference. So the host is asked only about what the document can link.
 */
export function rehypeReferences(options: { collected?: Collected; addresses?: 'web' | 'all' } = {}) {
  const { collected, addresses = 'web' } = options;
  const visit = (node: Node, code: boolean) => {
    if (!node.children) return;
    node.children = node.children.flatMap(child => {
      if (child.type === 'text') return linked(child.value ?? '', code, collected);
      if (child.type === 'element' && child.tagName === 'a') {
        const href = typeof child.properties?.href === 'string' ? child.properties.href : '';
        const input = fromUrl(href);
        collect(collected, input ? { kind: 'host', input } : addresses === 'all' ? wholeReference(href) : null);
      } else if (child.type === 'element' && !/^(?:pre|h[1-6])$/.test(child.tagName ?? '')) visit(child, code || child.tagName === 'code');
      return [child];
    });
  };
  return (tree: Node) => { collected?.inputs.clear(); visit(tree, false); };
}
