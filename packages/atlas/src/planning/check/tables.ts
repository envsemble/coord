// Markdown tables that read cramped in Atlas. The app shows a plan in a column about 100 characters
// wide (its text at the size of a table's), so a table with many columns, or with long text in its
// cells, gets columns too narrow to read. `atlas check` warns about each such table with what to do,
// and the PostToolUse hook hands the warning to the agent that wrote it. Pure, so it is unit-tested.

/** About how many characters of a table's text the plan's column holds in a row. */
const columnCharacters = 100;
/** How much of a column's longest cell counts towards the table's width: a longer one wraps. */
const countedPerColumn = 50;
/** A cell this long is a paragraph, which reads badly in any table. */
const paragraphCharacters = 200;
/** A table with this many columns or more never fits the column readably. */
const tooManyColumns = 6;

/**
 * A table row's cells without the outer pipes, split as GFM splits them: on every pipe not escaped
 * with a backslash, inside code spans too.
 */
function cells(line: string): string[] {
  const row = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return row.split(/(?<!\\)\|/).map(cell => cell.replaceAll('\\|', '|'));
}

/** A cell's text as it reads: links by their words, without emphasis marks or code ticks. */
const visible = (cell: string) => cell.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/<[^>]+>/g, '').trim();

const delimiter = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * The tables of a Markdown text that will read cramped: the line each starts on (1-based) and why,
 * outside fenced and indented code.
 */
export function crampedTables(text: string): { line: number; reason: string }[] {
  const lines = text.split(/\r?\n/);
  const found: { line: number; reason: string }[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMark = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fenceMark) { fence = fence === fenceMark ? null : fence ?? fenceMark; continue; }
    // Indented code (four spaces) holds no table; a table's delimiter row has a cell per column.
    if (fence || /^ {4}/.test(line) || !line.includes('|') || !delimiter.test(lines[index + 1] ?? '') || !lines[index + 1].includes('-')) continue;
    const header = cells(line);
    if (cells(lines[index + 1]).length !== header.length) continue;
    const rows = [header];
    let end = index + 2;
    while (end < lines.length && lines[end].includes('|') && lines[end].trim()) rows.push(cells(lines[end++]));
    const columns = header.length;
    const longest = Array.from({ length: columns }, (_, column) => Math.max(...rows.map(row => visible(row[column] ?? '').length)));
    const width = longest.reduce((sum, length) => sum + Math.min(length, countedPerColumn) + 3, 0);
    const paragraph = Math.max(...longest);
    const reason = columns >= tooManyColumns ? `${columns} columns`
      : columns >= 3 && width > columnCharacters ? `${columns} columns about ${width} characters wide`
      : paragraph > paragraphCharacters ? `a cell of ${paragraph} characters`
      : null;
    if (reason) found.push({ line: index + 1, reason });
    index = end - 1;
  }
  return found;
}

/** check's warning for a cramped table of a file. */
export const crampedTableWarning = (file: string, table: { line: number; reason: string }) =>
  `${file}:${table.line}: a table with ${table.reason} reads cramped in Atlas, whose plan column holds about ${columnCharacters} characters: keep a table to a few short columns, and put long text in a list or paragraphs below it`;
