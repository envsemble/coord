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
  // A pipe inside code or escaped is part of its cell.
  assert.deepEqual(crampedTables('| Flag | Use |\n| --- | --- |\n| `a|b` | c \| d |\n'), []);
});
