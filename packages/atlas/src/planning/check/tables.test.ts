import test from 'node:test';
import assert from 'node:assert/strict';
import { tableProblems } from './tables.ts';

test('a table reads cramped with many columns, with columns too wide together, or with a paragraph in a cell; not in code', () => {
  const short = '| Step | Owner |\n| --- | --- |\n| Draft | Ana |\n';
  const wide = '| Field | Meaning | Example | Notes |\n|---|---|---|---|\n| ' + ['a'.repeat(40), 'b'.repeat(45), 'c'.repeat(30), 'd'.repeat(30)].join(' | ') + ' |\n';
  const many = '| a | b | c | d | e | f |\n|-|-|-|-|-|-|\n| 1 | 2 | 3 | 4 | 5 | 6 |\n';
  const paragraph = '| Term | Text |\n| :-- | --: |\n| x | ' + 'word '.repeat(50) + '|\n';
  const fenced = '```md\n' + many + '```\n';
  assert.deepEqual(tableProblems(short), []);
  assert.deepEqual(tableProblems('# Plan\n\n' + wide).map(table => table.line), [3]);
  assert.match(tableProblems(many)[0].problem, /^a table with 6 columns reads cramped/);
  assert.match(tableProblems(paragraph)[0].problem, /a cell of \d+ characters/);
  assert.deepEqual(tableProblems(fenced), []);
  // Only an escaped pipe stays in its cell (GFM splits a code span on a pipe too).
  assert.deepEqual(tableProblems('| Flag | Use | Note |\n| --- | --- | --- |\n| a \\| b | c \\| d | e |\n'), []);
  // Not a table: a setext heading over text with pipes, indented code.
  assert.deepEqual(tableProblems('Choose a | b | c | d | e | f\n---\n'), []);
  assert.deepEqual(tableProblems('    ' + many.split('\n').join('\n    ')), []);
});

test('rows cut off from their header, as by a blank line inside a table, are one problem: they read as text', () => {
  const split = '| Round | Score |\n| --- | --- |\n| 1 | 7.6 |\n\n| 2 | 7.8 |\n| 3 | 8.0 |\n\nAfter.\n';
  assert.deepEqual(tableProblems(split).map(table => [table.line, /blank line split a table/.test(table.problem)]), [[5, true]]);
  // A header whose delimiter row has another number of cells is no table either.
  assert.equal(tableProblems('| `a|b` | c |\n|---|---|\n').length, 1);
});
