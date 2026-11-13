// A work item's parts (its plan header's `parts`): other work items of the same project, in order,
// that one piece of work is made of. Only the group records them; a part knows its group from the
// group's list. Groups are one level deep. This is not a handoff: `continues` says where work went
// next, `parts` what it is made of. No imports: the reader, the project list and the check share it.

const workIdentity = /^work-[0-9]{4,}$/;

/** Whether a header's entry is a work ID, as `parts` writes them (bare: parts are of the same project). */
export const isWorkId = (value: unknown): value is string => typeof value === 'string' && workIdentity.test(value);

/** A plan header's parts as readers use them: the well-formed work IDs, each once, in their order, never the work item itself. */
export function partsOf(value: unknown, self?: string): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isWorkId))].filter(id => id !== self) : [];
}

/** Each part's group: the first work item, in the order given, whose parts list it. */
export function groupsOfParts(items: Iterable<{ id: string; parts?: readonly string[] }>): Map<string, string> {
  const groups = new Map<string, string>();
  for (const item of items) for (const part of item.parts ?? []) if (!groups.has(part)) groups.set(part, item.id);
  return groups;
}
