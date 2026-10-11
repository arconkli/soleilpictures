// A doc @-mention inserts the picked names. It used to insert the editor's
// query — usually '' because the picker takes focus as it opens — and fell
// back to `targets[0].name`, which no target carries, so the '@' became the
// linked word "mention". (Playwright is not in CI, and the ?docqa harness has
// no workspace to search, so this reads the code.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

// The picker's own rowToTarget, lifted out of the component and run.
function loadRowToTarget() {
  const src = read('../components/EntityPicker.jsx');
  const start = src.indexOf('function rowToTarget(row) {');
  assert.ok(start >= 0, 'rowToTarget is still where the mention reads its targets');
  const end = src.indexOf('\n}\n', start) + 2;
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end)}; return rowToTarget;`)();
}

test('every kind of picked row carries its display title', () => {
  const rowToTarget = loadRowToTarget();
  const rows = [
    { kind: 'board', board_id: 'b1', title: 'Moodboard' },
    { kind: 'doc', card_id: 'd1', title: 'Treatment' },
    { kind: 'user', id: 'u1', title: 'Maya' },
    { kind: 'tag', id: 't1', title: 'Night' },
    { kind: 'image', board_id: 'b1', card_id: 'c1', title: 'Diner still' },
  ];
  for (const row of rows) assert.equal(rowToTarget(row).title, row.title, row.kind);
});

test('the doc mention inserts the picked names, and the query only when none has one', () => {
  const ed = read('../components/DocPageEditor.jsx');
  assert.match(ed, /const names = targets\.map\(t => t\?\.title \|\| t\?\.name\)\.filter\(Boolean\)\.join\(', '\);\s*const text = names \|\| \(mention\.query && mention\.query\.trim\(\)\) \|\| 'mention';/);
});

test('the picked title goes in as text, so the link covers exactly its characters', () => {
  const ed = read('../components/DocPageEditor.jsx');
  assert.match(ed, /\.deleteRange\(mention\.range\)\s*\.insertContent\(\{ type: 'text', text \}\)\s*\.setTextSelection\(\{ from: mention\.range\.from, to: mention\.range\.from \+ text\.length \}\)/);
});
