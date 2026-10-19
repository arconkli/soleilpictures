// moveFailure.test.mjs — a failed move says so once, and takes back a cluster
// made for it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { failMove, madeClusterFailMessage, MOVE_FAIL_TTL } from './moveFailure.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const spy = () => {
  const calls = [];
  const fn = (arg) => { calls.push(arg); };
  return { calls, fn };
};

test('a plain move: the step’s message, once, and nothing trashed', async () => {
  const toast = spy();
  const trash = spy();
  const cause = new Error('/reset 404: error code: 1042');
  const out = await failMove({ err: cause, message: 'Move incomplete — try again.', trash: trash.fn, toast: toast.fn });
  assert.equal(out, cause);
  assert.equal(out.createdBoardTrashed, false);
  assert.equal(trash.calls.length, 0);
  assert.deepEqual(toast.calls, [{ type: 'error', ttl: MOVE_FAIL_TTL, message: 'Move incomplete — try again.' }]);
});

test('a cluster made for the move goes to the trash, and the message names it', async () => {
  const toast = spy();
  const order = [];
  const out = await failMove({
    err: new Error('reset failed'), message: 'Move incomplete — try again.',
    createdBoardId: 'b-new', createdBoardName: 'swag',
    trash: async (id) => { order.push(`trash ${id}`); },
    toast: (t) => { order.push('toast'); toast.fn(t); },
  });
  assert.equal(out.createdBoardTrashed, true);
  assert.deepEqual(order, ['trash b-new', 'toast'], 'trashed before anyone is told');
  assert.equal(toast.calls.length, 1);
  assert.equal(toast.calls[0].message, 'Couldn’t make “swag”. Your cards are still here — try again.');
  assert.equal(madeClusterFailMessage(null), 'Couldn’t make “Untitled cluster”. Your cards are still here — try again.');
});

test('a trash that fails leaves the cluster, card and all, with the step’s message', async () => {
  const toast = spy();
  const out = await failMove({
    err: new Error('offline'), message: 'Move failed: offline',
    createdBoardId: 'b-new', createdBoardName: 'swag',
    trash: async () => { throw new Error('offline'); },
    toast: toast.fn,
  });
  assert.equal(out.createdBoardTrashed, false);
  assert.deepEqual(toast.calls.map((t) => t.message), ['Move failed: offline']);
});

test('after the source was told to let go, the cluster holds the cards and stays', async () => {
  const trash = spy();
  const out = await failMove({
    err: new Error('late'), message: 'Move failed: late',
    createdBoardId: 'b-new', createdBoardName: 'swag', acked: true, trash: trash.fn, toast: () => {},
  });
  assert.equal(trash.calls.length, 0);
  assert.equal(out.createdBoardTrashed, false);
});

test('whatever was thrown comes back an Error', async () => {
  const out = await failMove({ err: 'tmp card count below expected', message: 'Move cancelled.', toast: () => {} });
  assert.ok(out instanceof Error);
  assert.equal(out.message, 'tmp card count below expected');
  const none = await failMove({ err: undefined, message: 'Move failed.', toast: () => {} });
  assert.equal(none.message, 'move failed');
});

test('App’s listener fails every step through it; the canvas and the list stay quiet and drop the card', () => {
  const app = read('../App.jsx');
  const start = app.indexOf("const onDrop = async (e) => {\n      // createdBoardId");
  const end = app.indexOf("document.addEventListener('soleil-card-into-board-drop', onDrop);", start);
  assert.ok(start > 0 && end > start, 'the listener is where this test looks for it');
  const listener = app.slice(start, end);
  assert.match(listener, /failMove\(\{/);
  assert.match(listener, /const ack\s+= \(\) => \{ acked = true;/);
  // Every error toast in it goes through fail(); none is raised beside it.
  assert.doesNotMatch(listener.slice(0, listener.indexOf('undoToast(feedback')), /feedback\.toast\(\{\s*type: 'error'/);
  assert.equal((listener.match(/await fail\(/g) || []).length, 5);

  const canvas = read('../components/CanvasSurface.jsx');
  const move = canvas.slice(canvas.indexOf('const moveCardsIntoBoard = async'), canvas.indexOf('// "New cluster from N cards": make the cluster'));
  const caught = move.slice(move.indexOf('await targetSaved;'), move.indexOf('removeCommentsByAnchorIds('));
  assert.doesNotMatch(caught, /feedback\.toast/);
  assert.match(caught, /if \(createdBoardId && err\?\.createdBoardTrashed\) mutators\.deleteCardsForMove\?\.\(\[createdBoardId\], \{ refund: true \}\);/);

  const list = read('../components/ListSurface.jsx');
  const moveTo = list.slice(list.indexOf('const moveCardsTo = useCallback('), list.indexOf('// New cluster from the selected cards'));
  assert.match(moveTo, /if \(extra\?\.createdBoardId && err\?\.createdBoardTrashed\) \{\s*from\.mutators\?\.deleteCardsForMove\?\.\(\[extra\.createdBoardId\], \{ refund: true \}\);/);
});
