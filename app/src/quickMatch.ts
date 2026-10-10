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

export interface QuickItem { id: string; kind: 'work' | 'file' | 'diagram'; label: string; detail: string }

export function rankItems<T extends QuickItem>(items: T[], query: string, limit = 60): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map(item => {
      const name = fuzzyScore(query, item.label);
      const detail = fuzzyScore(query, item.label + ' ' + item.detail);
      return { item, score: Math.max(name >= 0 ? name * 1.5 : -1, detail) };
    })
    .filter(entry => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map(entry => entry.item);
}
