import test from 'node:test';
import assert from 'node:assert/strict';
import { crampedTables } from './tables.ts';

test('a table reads cramped with many columns, with columns too wide together, or with a paragraph in a cell; not in code', () => {
  const short = '| Step | Owner |\n| --- | --- |\n| Draft | Ana |\n';
  const wide = '| Field | Meaning | Example | Notes |\n|---|---|---|---|\n| ' + ['a'.repeat(40), 'b'.repeat(45), 'c'.repeat(30), 'd'.repeat(30)].join(' | ') + ' |\n';
  const many = '| a | b | c | d | e | f |\n|-|-|-|-|-|-|\n| 1 | 2 | 3 | 4 | 5 | 6 |\n';
  const paragraph = '| Term | Text |\n| :-- | --: |\n| x | ' + 'word '.repeat(50) + '|\n';
  const fenced = '```md\n' + many + '```\n';
  assert.deepEqual(crampedTables(short), []);
  assert.deepEqual(crampedTables('# Plan\n\n' + wide).map(table => table.line), [3]);
  assert.match(crampedTables(many)[0].reason, /^6 columns$/);
  assert.match(crampedTables(paragraph)[0].reason, /a cell of \d+ characters/);
  assert.deepEqual(crampedTables(fenced), []);
  // Only an escaped pipe stays in its cell (GFM splits a code span on a pipe too).
  assert.deepEqual(crampedTables('| Flag | Use | Note |\n| --- | --- | --- |\n| a \\| b | c \\| d | e |\n'), []);
  // A header split by a code span's pipe has more cells than its delimiter: GFM draws no table.
  assert.deepEqual(crampedTables('| `a|b` | c |\n|---|---|\n'), []);
  // Not a table: a setext heading over text with pipes, a delimiter of another width, indented code.
  assert.deepEqual(crampedTables('Choose a | b | c | d | e | f\n---\n'), []);
  assert.deepEqual(crampedTables('    ' + many.split('\n').join('\n    ')), []);
});
