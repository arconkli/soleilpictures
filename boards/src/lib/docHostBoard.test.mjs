// A doc card's scope knows the cluster it sits on. Comment @-mention
// notifications (notifyCommentMentions returns early with no boardId), doc
// tagging and the save footer are all keyed by that HOST board; the doc card's
// own id is not a board. Wiring only — Playwright is not in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from 'yjs';
import { PluginKey } from '@tiptap/pm/state';
import { ySyncPluginKey, yUndoPluginKey } from 'y-prosemirror';
import { DOC_ORIGIN, DOC_MODE_ORIGIN } from './docState.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, rel), 'utf8');

test('both doc hosts put the host board id in the scope', () => {
  const card = read('../components/DocCard.jsx');
  const scopes = card.match(/\{ \.\.\.cardScope\(cardYMap\), cardId: card\.id, docCardId: card\.id, boardId: hostBoardId \|\| null \}/g) || [];
  assert.equal(scopes.length, 2, 'RichDocCard and DockedDocPane');
  assert.doesNotMatch(card, /docCardId: card\.id \}/, 'no scope left without it');
});

test('the canvas and the docked pane pass the board they render', () => {
  const canvas = read('../components/CanvasSurface.jsx');
  const rich = canvas.slice(canvas.indexOf('<RichDocCard '), canvas.indexOf('onUpdate={onUpdate} />', canvas.indexOf('<RichDocCard ')));
  assert.match(rich, /hostBoardId=\{board\.id\}/);
  const app = read('../App.jsx');
  // One pane renderer for the docked doc and the doc beside it: the card, its
  // Y.Doc and the host board all come from the board that pane's Y.Doc holds.
  const docked = app.slice(app.indexOf('<DockedDocPane'), app.indexOf('pane={pane} />', app.indexOf('<DockedDocPane')));
  assert.match(docked, /hostBoardId=\{boardId\}/, 'the board ybh loaded — the one renderDocPane reads the card from');
  assert.match(docked, /ydoc=\{ybh\.ydoc\}/);
  assert.match(app, /const here = ybh\.ready && ybh\.boardId === boardId;/);
  assert.match(app, /pane: 'split', cardId: splitDoc\?\.cardId, ybh: splitYb, boardId: splitId,/);
  assert.match(app, /pane: 'beside', cardId: besideDoc\?\.cardId, ybh: yb, boardId: besideDoc\?\.boardId,/);
});

test('the comment flows read the board from that scope', () => {
  const ed = read('../components/DocPageEditor.jsx');
  assert.ok((ed.match(/boardId: scope\?\.boardId \|\| null/g) || []).length >= 2, 'tagging + add-comment');
  assert.match(ed, /<CommentInlinePopover[\s\S]*?boardId=\{scope\?\.boardId \|\| null\}/, 'replies');
});

test('the save footer listens for the host board, and doc edits count as my saves', () => {
  const ds = read('../components/DocSurface.jsx');
  assert.match(ds, /<DocStatusFooter [^>]*boardId=\{scope\?\.boardId \|\| \(scope \? null : board\.id\)\}/,
    'board.id is the doc CARD id in a card scope; yboard reports the host board');
  const yb = read('./yboard.js');
  assert.match(yb, /if \(isLocalEditOrigin\(origin\)\) \{ pendingLocal = true; emitSaveState\('saving'\); \}/);
});

// yboard.js can't be imported under node (Supabase, workers), so lift the
// predicate out and run it against the REAL origins.
function loadIsLocalEditOrigin() {
  const src = read('./yboard.js');
  const start = src.indexOf('export function isLocalEditOrigin(origin) {');
  assert.ok(start >= 0);
  const end = src.indexOf('\n}\n', start) + 2;
  // eslint-disable-next-line no-new-func
  return new Function('Y', `${src.slice(start + 'export '.length, end)}; return isLocalEditOrigin;`)(Y);
}

test('my own doc edits count as saves, whatever made them; a peer\'s do not', () => {
  const isLocal = loadIsLocalEditOrigin();
  assert.equal(isLocal('local'), true, 'canvas');
  assert.equal(isLocal(DOC_ORIGIN), true, 'doc structure');
  assert.equal(isLocal(DOC_MODE_ORIGIN), true, 'the Screenplay switch');
  assert.equal(isLocal(ySyncPluginKey), true, 'typing in a doc or note');
  assert.equal(isLocal(new PluginKey('y-sync')), true, 'a second y-sync key is still typing');
  const ydoc = new Y.Doc();
  assert.equal(isLocal(new Y.UndoManager(ydoc.getText('t'))), true, 'undo and redo');
  assert.equal(isLocal('remote'), false);
  assert.equal(isLocal({ key: 'something-else$' }), false);
  assert.equal(isLocal(null), false);
  assert.equal(isLocal(yUndoPluginKey), false, 'not every PluginKey is typing');
});
