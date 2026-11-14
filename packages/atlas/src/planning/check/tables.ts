// Markdown tables that read badly in Atlas. The app shows a plan in a column about 100 characters
// wide (its text at the size of a table's), so a table with many columns, or with long text in its
// cells, gets columns too narrow to read; and rows a blank line cut off from their table's header
// show as one paragraph of pipes. `atlas check` warns about each with what to do, and the
// PostToolUse hook hands the warning to the agent that wrote it. Pure, so it is unit-tested.

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

/** The start of a row of table cells: a pipe first. */
const rowStart = /^ {0,3}\|/;

/**
 * The tables of a Markdown text that will read badly in Atlas, outside fenced and indented code: the
 * line each starts on (1-based) and what is wrong. A table reads cramped with too many columns, with
 * columns too wide together, or with a paragraph in a cell; rows with no header and delimiter row
 * above them (most often after a blank line that split a table) are no table at all, and read as text.
 */
export function tableProblems(text: string): { line: number; problem: string }[] {
  const lines = text.split(/\r?\n/);
  const found: { line: number; problem: string }[] = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fenceMark = /^\s*(```|~~~)/.exec(line)?.[1];
    if (fenceMark) { fence = fence === fenceMark ? null : fence ?? fenceMark; continue; }
    // Indented code (four spaces) holds no table.
    if (fence || /^ {4}/.test(line) || !line.includes('|')) continue;
    // A table's delimiter row has a cell per column.
    const next = lines[index + 1] ?? '';
    const header = cells(line);
    if (!delimiter.test(next) || !next.includes('-') || cells(next).length !== header.length) {
      if (!rowStart.test(line)) continue;
      found.push({ line: index + 1, problem: 'these table rows have no delimiter row (`| --- |`, a cell per column) under a header, so Atlas shows them as text: if a blank line split a table, remove it' });
      while (index + 1 < lines.length && rowStart.test(lines[index + 1])) index++;
      continue;
    }
    const rows = [header];
    let end = index + 2;
    while (end < lines.length && lines[end].includes('|') && lines[end].trim()) rows.push(cells(lines[end++]));
    const columns = header.length;
    const longest = Array.from({ length: columns }, (_, column) => Math.max(...rows.map(cellsOfRow => visible(cellsOfRow[column] ?? '').length)));
    const width = longest.reduce((sum, length) => sum + Math.min(length, countedPerColumn) + 3, 0);
    const paragraph = Math.max(...longest);
    const reason = columns >= tooManyColumns ? `${columns} columns`
      : columns >= 3 && width > columnCharacters ? `${columns} columns about ${width} characters wide`
      : paragraph > paragraphCharacters ? `a cell of ${paragraph} characters`
      : null;
    if (reason) found.push({ line: index + 1, problem: `a table with ${reason} reads cramped in Atlas, whose plan column holds about ${columnCharacters} characters: keep a table to a few short columns, and put long text in a list or paragraphs below it` });
    index = end - 1;
  }
  return found;
}
