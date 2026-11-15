// Quick open matching: a query matches when its characters appear in order (case-insensitive).
// Contiguous runs, word starts and matches in the name rank higher than scattered matches in the path.

export function fuzzyScore(query: string, text: string): number {
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return 0;
  const haystack = text.toLowerCase();
  let score = 0, position = -1, run = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, position + 1);
    if (found < 0) return -1;
    run = found === position + 1 ? run + 1 : 0;
    const boundary = found === 0 || /[\s/\\_.\-#]/.test(haystack[found - 1]);
    score += 1 + run * 2 + (boundary ? 3 : 0) - Math.min(3, (found - position - 1) * 0.05);
    position = found;
  }
  if (haystack.startsWith(needle)) score += 6;
  else if (haystack.includes(needle)) score += 4;
  return score;
}

/** `penalty` lowers an item against equally good matches, such as a closed plan below open ones. */
export interface QuickItem { id: string; kind: 'work' | 'file' | 'diagram'; label: string; detail: string; penalty?: number }

/** A query's words, each as a pattern that matches it at the start of a word. */
export function wordPatterns(query: string): RegExp[] {
  return query.trim().split(/\s+/).filter(Boolean).map(word => new RegExp('(?<![\\p{L}\\p{N}])' + escapeRegExp(word), 'iu'));
}
/** The text, with what regular expressions read as their own characters escaped. */
export const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Whether every word of the query starts a word of the text (any case): "sign" in "sign-in", not
 * in "design"; not only its letters in order.
 */
export function hasWords(text: string, query: string): boolean {
  return wordPatterns(query).every(pattern => pattern.test(text));
}

export function rankItems<T extends QuickItem>(items: T[], query: string, limit = 60): T[] {
  if (!query.trim()) return items.slice(0, limit);
  // When some items have the query's words as typed, the ones that only have its letters in order
  // (scattered through a title) are noise: they are left out.
  const words = items.filter(item => hasWords(item.label + ' ' + item.detail, query));
  return (words.length ? words : items)
    .map(item => {
      const name = fuzzyScore(query, item.label);
      const detail = fuzzyScore(query, item.label + ' ' + item.detail);
      const score = Math.max(name >= 0 ? name * 1.5 : -1, detail);
      return { item, score: score < 0 ? score : score - (item.penalty ?? 0) };
    })
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map(entry => entry.item);
}
