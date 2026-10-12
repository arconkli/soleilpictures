// The docs generator's table rows (scripts/lib/markdown.mjs). GFM writes a
// literal pipe inside a cell as `\|`, code spans included; splitting on every
// `|` turned /docs/mcp's `(`board`\|`card`)` into a phantom third column that
// ran off the right edge of the table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, inlineText } from '../../scripts/lib/markdown.mjs';
import { DOCS_CONTENT } from './docsiteContent.js';

const table = (md) => parseMarkdown(md).find((b) => b.type === 'table');

test('an escaped \\| inside a code span stays in its cell', () => {
  const t = table([
    '| Tool | Input |',
    '|---|---|',
    '| `search` | `q`, `kind?` (`board`\\|`card`), paging |',
  ].join('\n'));
  assert.equal(t.head.length, 2);
  assert.equal(t.rows[0].length, 2, 'the escaped pipe must not open a third cell');
  assert.equal(inlineText(t.rows[0][1]), 'q, kind? (board|card), paging');
  const codes = t.rows[0][1].filter((n) => n.t === 'code').map((n) => n.v);
  assert.deepEqual(codes, ['q', 'kind?', 'board', 'card']);
});

test('an escaped \\| in plain cell text is a literal pipe', () => {
  const t = table('| a | b |\n|---|---|\n| x \\| y | z |');
  assert.deepEqual(t.rows[0].map(inlineText), ['x | y', 'z']);
});

test('unescaped pipes still separate cells, outer pipes optional at the end', () => {
  const t = table('| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |');
  assert.deepEqual(t.rows[0].map(inlineText), ['1', '2', '3']);
});

test('every generated docs table row has as many cells as its header', () => {
  const problems = [];
  for (const [path, blocks] of Object.entries(DOCS_CONTENT)) {
    for (const b of blocks) {
      if (b.type !== 'table') continue;
      for (const row of b.rows) {
        if (row.length !== b.head.length) problems.push(`${path}: ${row.length} cells under a ${b.head.length}-cell header`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
