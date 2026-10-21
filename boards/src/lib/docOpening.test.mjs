// Every way a doc opens waits the same way (components/DocOpening.jsx): it
// says it is opening, to a screen reader too, and after a while that it is
// still connecting, with a reload. tests/doc-opening.spec.js drives it; this
// pins that each place a doc can wait uses it, and that the docked panes,
// which have no header of their own until the doc arrives, offer their close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(resolve(SRC, f), 'utf8');

const WAITS = ['App.jsx', 'components/DocCard.jsx', 'components/fileShare/DocShareView.jsx', 'components/DocSurface.jsx'];

test('no doc waits behind a silent skeleton: each waits through DocOpening', () => {
  for (const f of WAITS) {
    const src = read(f);
    assert.doesNotMatch(src, /doc-surface-skeleton/, `${f} draws its own skeleton`);
    assert.match(src, /<DocOpening\b/, `${f} waits through DocOpening`);
  }
});

test('a docked doc still opening offers its pane\'s close: nothing else in the pane does yet', () => {
  const app = read('App.jsx');
  const start = app.indexOf('const renderDocPane = ');
  const fn = app.slice(start, app.indexOf('const renderSplitDoc = ', start));
  assert.ok(start > 0 && fn.length > 0, 'App renders its doc panes in renderDocPane');
  assert.equal((fn.match(/<DocOpening onClose=\{onClose\} \/>/g) || []).length, 2,
    'the doc\'s code loading and its cluster loading');
});

test('the overlay and a shared doc wait with no second close: their own header has one', () => {
  assert.match(read('components/DocCard.jsx'), /<Suspense fallback=\{<DocOpening \/>\}>/);
  assert.match(read('components/fileShare/DocShareView.jsx'), /<Suspense fallback=\{<DocOpening \/>\}>/);
});

test('a DocSurface waiting on its doc waits the same way', () => {
  assert.match(read('components/DocSurface.jsx'), /if \(!ready\) return <DocOpening \/>;/);
});
