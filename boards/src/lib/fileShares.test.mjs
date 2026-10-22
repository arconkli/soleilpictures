import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fileRefOf, isShareableCard, isRiskyFile, fileShareUrl, formatAt, groupComments, friendlyShareError,
} from './fileShares.js';
import { FILE_SHARE_EVENT, openFileShare } from './fileShareBus.js';

test('formatAt', () => {
  assert.equal(formatAt(0), '0:00');
  assert.equal(formatAt(83000), '1:23');
  assert.equal(formatAt(3723000), '1:02:03');
  assert.equal(formatAt(-5), '0:00');
});

test('groupComments orders by time, then page, then created, and splits resolved', () => {
  const c = (id, o = {}) => ({ id, created_at: `2026-01-01T00:00:0${id}Z`, ...o });
  const timed = groupComments([c(1, { at_ms: 9000 }), c(2), c(3, { at_ms: 1000 }), c(4, { at_ms: 5000, resolved: true }),
    c(5, { reply_to: 3 }), c(6, { reply_to: 3 })]);
  assert.deepEqual(timed.open.map((x) => x.id), [3, 1, 2]);
  assert.deepEqual(timed.resolved.map((x) => x.id), [4]);
  assert.deepEqual(timed.open[0].replies.map((x) => x.id), [5, 6]);
  const paged = groupComments([c(1, { page: 3 }), c(2, { page: 1 }), c(3)]);
  assert.deepEqual(paged.open.map((x) => x.id), [2, 1, 3]);
  const plain = groupComments([c(2), c(1)]);
  assert.deepEqual(plain.open.map((x) => x.id), [1, 2]);
});

test('isShareableCard', () => {
  assert.equal(isShareableCard({ kind: 'image', src: 'r2:a' }), true);
  assert.equal(isShareableCard({ kind: 'video', src: 'r2:a' }), true);
  assert.equal(isShareableCard({ kind: 'audio', src: 'r2:a' }), true);
  assert.equal(isShareableCard({ kind: 'pdf', pdfSrc: 'r2:a', src: 'https://x/y.webp' }), true);
  assert.equal(isShareableCard({ kind: 'pdf', src: 'r2:thumb' }), false);
  assert.equal(isShareableCard({ kind: 'file', fileSrc: 'r2:a' }), true);
  assert.equal(isShareableCard({ kind: 'image', src: 'https://x/y.png' }), false);
  assert.equal(isShareableCard({ kind: 'image', src: 'r2:a', pending: true }), false);
  assert.equal(isShareableCard({ kind: 'note', src: 'r2:a' }), false);
  assert.equal(isShareableCard(null), false);
  assert.equal(fileRefOf({ kind: 'file', fileSrc: 'r2:f', src: 'r2:s' }), 'r2:f');
});

test('isRiskyFile', () => {
  assert.equal(isRiskyFile('setup.EXE'), true);
  assert.equal(isRiskyFile('cut.mov', 'video/quicktime'), false);
  assert.equal(isRiskyFile('noext', 'text/html'), true);
  assert.equal(isRiskyFile('page.HTML', ''), true);
});

test('fileShareUrl', () => {
  assert.equal(fileShareUrl('abc', 'https://x.test'), 'https://x.test/f/abc');
});

test('friendlyShareError', () => {
  assert.match(friendlyShareError({ hint: 'invite_limit_reached' }), /invite limit/);
  assert.match(friendlyShareError({ hint: 'sending_on_hold' }), /paused/);
  assert.match(friendlyShareError({ hint: 'comment_rate_limited' }), /Slow down/);
  assert.match(friendlyShareError({ hint: 'new_account_risky' }), /New accounts/);
  assert.match(friendlyShareError({ hint: 'not_shareable' }), /can't be shared/);
  assert.equal(friendlyShareError({ code: '42501' }), "You can't do that on this file.");
  assert.equal(friendlyShareError({ code: 'XX000' }), 'Something went wrong. Try again.');
  assert.equal(friendlyShareError(null), 'Something went wrong. Try again.');
});

test('openFileShare is a no-op without ids', () => {
  assert.equal(FILE_SHARE_EVENT, 'soleil-open-file-share');
  assert.doesNotThrow(() => openFileShare({}));
});

// A viewer far from any pane (the tag view, a hover popover) shares a file it
// knows by reference, only where the app shell says you can edit.
test('shareTargetForRef needs a registered rights resolver and a stored file', async () => {
  const { setShareRightsResolver, canShareIn, shareTargetForRef } = await import('./fileShareBus.js');
  setShareRightsResolver(null);
  assert.equal(canShareIn('b1'), false);
  assert.equal(shareTargetForRef({ boardId: 'b1', cardId: 'c1', src: 'r2:ws/a.jpg' }), null, 'no resolver: public pages never offer Share');
  setShareRightsResolver((id) => id === 'b1');
  try {
    const t = shareTargetForRef({ boardId: 'b1', cardId: 'c1', src: 'r2:ws/a.jpg', name: 'A' }, 'tag_view');
    assert.deepEqual(t, { boardId: 'b1', cardId: 'c1', card: { id: 'c1', kind: 'image', src: 'r2:ws/a.jpg', title: 'A' }, boardName: null, surface: 'tag_view' });
    assert.equal(shareTargetForRef({ boardId: 'b2', cardId: 'c1', src: 'r2:ws/a.jpg' }), null, 'a cluster you cannot edit');
    assert.equal(shareTargetForRef({ boardId: 'b1', cardId: 'c1', src: 'https://x.test/a.jpg' }), null, 'not a stored file');
    assert.equal(shareTargetForRef({ boardId: 'b1', src: 'r2:ws/a.jpg' }), null, 'no card id');
    setShareRightsResolver(() => { throw new Error('boom'); });
    assert.equal(canShareIn('b1'), false, 'a throwing resolver means no');
  } finally {
    setShareRightsResolver(null);
  }
});
