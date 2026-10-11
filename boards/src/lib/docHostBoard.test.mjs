// A doc card's scope knows the cluster it sits on. Comment @-mention
// notifications (notifyCommentMentions returns early with no boardId), doc
// tagging and the save footer are all keyed by that HOST board; the doc card's
// own id is not a board. Wiring only — Playwright is not in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const docked = app.slice(app.indexOf('<DockedDocPane'), app.indexOf('onSetFull={setSplitDocFull} />'));
  assert.match(docked, /hostBoardId=\{splitId\}/, 'the board splitYb loaded — the one renderSplitDoc reads the card from');
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
  assert.match(yb, /if \(origin === 'local' \|\| origin === 'doc-struct' \|\| origin\?\.key === 'y-sync\$'\) \{ pendingLocal = true; emitSaveState\('saving'\); \}/,
    'typing (y-prosemirror) and doc structure, not only canvas edits');
  assert.match(read('./docState.js'), /const DOC_ORIGIN = 'doc-struct';/);
});
