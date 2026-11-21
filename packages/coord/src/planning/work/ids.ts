// Work IDs. A work item has a number (0032) and is made of parts, numbered from 1 in the order they
// were made; a part's number never changes and is never given to another. A part's ID is the work
// item's number and its own: work-0032-2, shown #0032-2. The first part's ID is the number alone,
// work-0032, as planning folders have always written it; it is shown #0032-1, and work-0032-1 names
// it too. So a number alone, as every reference written before parts shared a number is, still
// names what it named. A part that had a number of its own before it joined a work item keeps that
// ID as a former one (the registry's `former_ids`), which names it for good and is never given to
// new work. No imports: the reader, the tools, the check and the app share this.

/** Any name of a part, in a pattern: its ID, or its first part's with or without the 1. */
export const workIdSource = 'work-[0-9]{4,}(?:-[1-9][0-9]*)?';
const workName = new RegExp('^work-([0-9]{4,})(?:-([1-9][0-9]*))?$');

/** A work ID's work item number and part number (1 for the number alone); null for anything else. */
export function parseWorkId(value: unknown): { number: string; part: number } | null {
  const match = typeof value === 'string' ? workName.exec(value) : null;
  return match ? { number: match[1], part: match[2] === undefined ? 1 : Number(match[2]) } : null;
}

/** The ID of a work item's part as planning folders write it: the number alone for the first. */
export const partId = (number: string, part: number) => part === 1 ? 'work-' + number : 'work-' + number + '-' + part;

/** Whether a value names a part: `work-0032`, `work-0032-1`, `work-0032-2`. */
export const isWorkId = (value: unknown): value is string => parseWorkId(value) !== null;

/** A work ID as planning folders write it (work-0032-1 is work-0032); null for anything else. */
export function writtenWorkId(value: unknown): string | null {
  const parsed = parseWorkId(value);
  return parsed && partId(parsed.number, parsed.part);
}

/** The work item's first part, which stands for the whole: work-0032 for work-0032-3. */
export function firstPartId(value: unknown): string | null {
  const parsed = parseWorkId(value);
  return parsed && partId(parsed.number, 1);
}

/** A work ID as people read it: #0032-1, #0032-2. */
export function shownWorkId(value: string): string {
  const parsed = parseWorkId(value);
  return parsed ? '#' + parsed.number + '-' + parsed.part : value;
}

/** A registry's former IDs (`former_ids`): each a work ID that now names the part beside it. */
export function formerIds(value: unknown): Map<string, string> {
  const former = new Map<string, string>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return former;
  for (const [old, now] of Object.entries(value)) {
    const from = writtenWorkId(old), to = writtenWorkId(now);
    if (from && to && from !== to) former.set(from, to);
  }
  return former;
}

/**
 * The ID a name leads to in a registry: as written when a work item has it, else the part a former
 * ID now names; null when it names nothing registered.
 */
export function resolveWorkId(registry: { work_items?: unknown; former_ids?: unknown } | null | undefined, name: unknown): string | null {
  const written = writtenWorkId(name);
  if (!written || !registry) return null;
  const registered = (id: string) => Array.isArray(registry.work_items) && registry.work_items.some(item => (item as { id?: unknown } | null)?.id === id);
  if (registered(written)) return written;
  const now = formerIds(registry.former_ids).get(written);
  return now && registered(now) ? now : null;
}

/** Work IDs in the order of their work items' numbers, then their parts'. */
export function compareWorkIds(a: string, b: string): number {
  const left = parseWorkId(a), right = parseWorkId(b);
  if (!left || !right) return a.localeCompare(b);
  return Number(left.number) - Number(right.number) || left.part - right.part;
}

/**
 * The parts of each work item among these IDs: per first part's ID, the IDs of the work item's
 * other parts, in their numbers' order. A work item whose first part is not among them has none.
 */
export function partsByWorkItem(ids: Iterable<string>): Map<string, string[]> {
  const all = [...ids], known = new Set(all);
  const parts = new Map<string, string[]>();
  for (const id of all) {
    const parsed = parseWorkId(id);
    if (!parsed || parsed.part === 1) continue;
    const first = partId(parsed.number, 1);
    if (!known.has(first)) continue;
    parts.set(first, [...parts.get(first) ?? [], id]);
  }
  for (const list of parts.values()) list.sort(compareWorkIds);
  return parts;
}
