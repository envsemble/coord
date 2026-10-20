// A work item's tags (its plan header's `tags`): what it can be found by later, the release it
// ships in (`0.8.0`) and the areas it touches (`search`, `hub`). A tag is lowercase ASCII letters,
// digits, dots and hyphens, so the search finds it as written. No imports: the app window and the
// plan export viewer use this module too.

/** The longest tag. */
export const tagLimit = 40;
const tagPattern = /^[a-z0-9][a-z0-9.-]*$/;

/** Whether a header's tag is well formed, as written. */
export const isTag = (value: unknown): value is string => typeof value === 'string' && value.length <= tagLimit && tagPattern.test(value);

/** A tag as an agent or a person gives it ("Tag Search", "UI_hub"), written well formed; null when it cannot be. */
export function normalTag(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tag = value.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return isTag(tag) ? tag : null;
}

/** A plan header's tags as readers use them: the well-formed ones, each once, in their order. */
export function tagsOf(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter(isTag))] : [];
}

/** How many work items carry each tag, the most used first, then by name. */
export function tagCounts(lists: readonly (readonly string[])[]): Record<string, number> {
  const counts = new Map<string, number>();
  for (const tags of lists) for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return Object.fromEntries([...counts].sort(([a, one], [b, other]) => other - one || a.localeCompare(b)));
}
