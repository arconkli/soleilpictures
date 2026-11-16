// Comment notices in the bell (lib/notificationsBell.js): a fold takes its
// row's place, where each kind leads, and when one toasts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  mergeNotice, notificationTarget, isCommentNotice, noticeThreadId, noticeMore,
  shouldToastNotice, noteNoticeToast, fileCommentQuery, NOTICE_TOAST_GAP_MS, NOTICE_ID,
} from './notificationsBell.js';
import { NOTICE_ID as WRITER_ID } from './commentNotices.js';
import { holdThreadOpen, isThreadOpen } from './openThreads.js';

const src = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const B = '11111111-1111-4111-8111-111111111111';
const T = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const TOKEN = '44444444-4444-4444-8444-444444444444';
const canvas = (kind, data = {}, over = {}) => ({ id: 7, kind, board_id: B, data: { board_id: B, thread_id: T, comment_id: C, count: 1, ...data }, ...over });
const doc = (kind, data = {}, over = {}) => ({ id: 8, kind, board_id: B, data: { board_id: B, card_id: 'card_1', thread_id: 'cm_ab12', comment_id: 'cr_cd34', count: 1, ...data }, ...over });

test('a live notice whose id is listed replaces that row, at the top, keeping its read_at', () => {
  const list = [{ id: 1, title: 'a', read_at: 'x' }, { id: 7, title: 'old', read_at: null, data: { count: 1 } }, { id: 3, title: 'c', read_at: null }];
  const out = mergeNotice(list, { id: 7, title: 'new', data: { count: 2 } });
  assert.deepEqual(out.map((x) => x.id), [7, 1, 3]);
  assert.deepEqual(out[0], { id: 7, title: 'new', data: { count: 2 }, read_at: null }, 'a fold into an unread row stays unread');
  assert.equal(list.length, 3, 'the list handed in is left as it was');
  // a new id is put first; the list keeps its length cap
  assert.deepEqual(mergeNotice(list, { id: 9 }).map((x) => x.id), [9, 1, 7, 3]);
  assert.equal(mergeNotice(Array.from({ length: 50 }, (_, i) => ({ id: i })), { id: 99 }).length, 50);
  assert.deepEqual(mergeNotice(list, null), list);
  assert.deepEqual(mergeNotice(null, { id: 1 }), [{ id: 1, read_at: null }]);
});

test('one replace-by-id rule for every kind: read stays read, a read made elsewhere arrives, a new id is unread', () => {
  const READ = '2026-11-15T10:00:00.000Z';
  // a row the person read, and its ping comes again (realtime delivered it twice)
  const ping = { id: 7, kind: 'comment.reply', title: 'Ana replied in Moodboard', body: 'yes', data: { thread_id: T, count: 1 }, created_at: 't1' };
  const read = [{ id: 2, read_at: null }, { ...ping, read_at: READ }];
  const again = mergeNotice(read, ping);
  assert.deepEqual(again.map((x) => x.id), [7, 2]);
  assert.equal(again[0].read_at, READ, 'a read row stays read when its ping comes again');
  assert.equal(again.filter((x) => !x.read_at).length, 1, 'the bell’s number does not move');

  // team.joined counting up (0897): the same id, new words and time, read_at kept
  const joined = { id: 11, kind: 'team.joined', title: 'Ana joined Studio', body: 'They accepted an invite. They can edit.', data: { org_id: 'o', count: 1 }, created_at: 't1', read_at: READ, user_id: 'u' };
  const resent = { id: 11, kind: 'team.joined', title: 'Ben and 1 other joined Studio', body: 'See who in People.', data: { org_id: 'o', count: 2 }, created_at: 't2' };
  const team = mergeNotice([{ id: 2, read_at: null }, joined], resent);
  assert.deepEqual(team[0], { ...joined, ...resent, read_at: READ });
  assert.equal(team[0].user_id, 'u', 'what the payload does not carry is kept from the row');
  // …and the same re-send onto an unread row stays unread
  assert.equal(mergeNotice([{ ...joined, read_at: null }], resent)[0].read_at, null);

  // a row read elsewhere: the payload itself carries the read_at
  const elsewhere = mergeNotice([{ ...ping, read_at: null }], { ...ping, read_at: READ });
  assert.equal(elsewhere[0].read_at, READ, 'listed unread, arrives read');
  assert.equal(mergeNotice([], { ...ping, id: 30, read_at: READ })[0].read_at, READ, 'a new id that arrives read');
  // the payload's own read_at wins over the row's
  assert.equal(mergeNotice([{ ...ping, read_at: 'earlier' }], { ...ping, read_at: READ })[0].read_at, READ);

  // only a new id arrives unread, for any kind
  for (const kind of ['comment.new', 'doc.mention', 'team.joined', 'file.shared', 'invite.reward']) {
    const fresh = mergeNotice(read, { id: 99, kind });
    assert.equal(fresh[0].id, 99);
    assert.equal(fresh[0].read_at, null, kind);
    assert.equal(fresh.find((x) => x.id === 7).read_at, READ, 'and the others are left as they were');
  }
});

test('which rows are comment notices, their conversation and their "+n more"', () => {
  for (const k of ['comment.new', 'comment.reply', 'comment.mention', 'comment.resolved', 'doc.new', 'doc.reply', 'doc.mention', 'doc.resolved', 'file.commented', 'file.replied']) {
    assert.ok(isCommentNotice({ kind: k }), k);
  }
  for (const k of ['file.shared', 'comment.other', 'doc', 'edit_request', '']) assert.ok(!isCommentNotice({ kind: k }), k);
  assert.equal(noticeThreadId(canvas('comment.reply')), T);
  assert.equal(noticeThreadId(doc('doc.reply')), 'cm_ab12');
  assert.equal(noticeThreadId({ kind: 'file.replied', data: { token: TOKEN, thread_id: T } }), T);
  assert.equal(noticeThreadId({ kind: 'file.commented', data: { token: TOKEN } }), null, 'a file notice from before the migration');
  assert.equal(noticeThreadId(doc('doc.reply', { thread_id: '../x' })), null);
  assert.equal(noticeThreadId({ kind: 'file.shared', data: { thread_id: T } }), null);
  assert.equal(noticeMore(canvas('comment.reply', { count: 3 })), 2);
  assert.equal(noticeMore(canvas('comment.reply', { count: 1 })), 0);
  assert.equal(noticeMore(canvas('comment.reply', { count: 'x' })), 0);
  assert.equal(noticeMore(canvas('comment.reply', { count: 5000 })), 99);
  assert.equal(noticeMore({ kind: 'invite.reward', data: { count: 4 } }), 0);
});

test('a canvas comment notice opens its conversation', () => {
  for (const k of ['comment.new', 'comment.reply', 'comment.mention', 'comment.resolved']) {
    assert.deepEqual(notificationTarget(canvas(k)), { kind: 'comment', surface: 'canvas', boardId: B, threadId: T, commentId: C }, k);
  }
  // one of the two ids is enough
  assert.deepEqual(notificationTarget(canvas('comment.new', { comment_id: undefined })), { kind: 'comment', surface: 'canvas', boardId: B, threadId: T, commentId: T });
  assert.deepEqual(notificationTarget(canvas('comment.reply', { thread_id: null })), { kind: 'comment', surface: 'canvas', boardId: B, threadId: C, commentId: C });
});

test('a doc or note comment notice opens the thread on that card', () => {
  for (const k of ['doc.new', 'doc.reply', 'doc.mention', 'doc.resolved']) {
    assert.deepEqual(notificationTarget(doc(k)), { kind: 'comment', surface: 'doc', boardId: B, cardId: 'card_1', threadId: 'cm_ab12', commentId: 'cr_cd34' }, k);
  }
  assert.deepEqual(notificationTarget(doc('doc.resolved', { comment_id: null })).commentId, 'cm_ab12');
});

test('ids that are not ids open the cluster, and the cluster is the row’s own', () => {
  const board = { kind: 'board', boardId: B };
  for (const bad of ['../etc', 'a b', 'x?y=1', 'a/b', '<img>', 'a~b', '', 'x'.repeat(81), 42, null, { id: 'x' }]) {
    assert.deepEqual(notificationTarget(doc('doc.reply', { card_id: bad })), board, `card ${String(bad).slice(0, 12)}`);
    assert.deepEqual(notificationTarget(doc('doc.reply', { thread_id: bad })), board, `thread ${String(bad).slice(0, 12)}`);
    assert.deepEqual(notificationTarget(canvas('comment.reply', { thread_id: bad, comment_id: bad })), board);
  }
  // a bad comment id alone: the thread still opens, at the thread
  assert.equal(notificationTarget(doc('doc.reply', { comment_id: 'a b' })).commentId, 'cm_ab12');
  // data.board_id is never where it opens
  const other = '99999999-9999-4999-8999-999999999999';
  assert.equal(notificationTarget(doc('doc.reply', { board_id: other })).boardId, B);
  assert.equal(notificationTarget(doc('doc.reply', {}, { board_id: null })), null);
  assert.equal(notificationTarget(canvas('comment.new', {}, { board_id: 'not-a-uuid' })).kind, 'board');
  assert.equal(NOTICE_ID, WRITER_ID, 'the reader and the writer keep one rule for an id');
  assert.equal(NOTICE_ID.source, '^[A-Za-z0-9_-]{1,80}$');
  assert.equal(notificationTarget(doc('doc.reply', { thread_id: 'x'.repeat(80) })).threadId, 'x'.repeat(80));
});

test('a file comment notice opens the file at the comment', () => {
  const n = { kind: 'file.replied', data: { token: TOKEN, share_id: 's', comment_id: C.toUpperCase(), thread_id: T, file_name: 'cut.mp4' } };
  assert.deepEqual(notificationTarget(n), { kind: 'file', token: TOKEN, inApp: true, commentId: C });
  assert.deepEqual(notificationTarget({ kind: 'file.commented', data: { token: TOKEN, comment_id: 'x y' } }), { kind: 'file', token: TOKEN, inApp: true });
  assert.equal(fileCommentQuery(C), '?comment=' + C);
  assert.equal(fileCommentQuery('x&y=1'), '');
  assert.equal(fileCommentQuery(null), '');
});

test('a toast: once per id, and for a comment notice once per conversation every two minutes', () => {
  const memory = (now) => ({ toastedIds: ids, lastByThread: threads, now, threadOpen: isThreadOpen });
  const ids = new Set();
  const threads = new Map();
  const t0 = 1_000_000;
  // any other notice: by id, forever
  const share = { id: 1, kind: 'file.shared', data: { token: TOKEN } };
  assert.ok(shouldToastNotice(share, memory(t0)));
  noteNoticeToast(share, memory(t0));
  assert.ok(!shouldToastNotice(share, memory(t0 + 60 * 60 * 1000)));
  // a comment notice: its row folds (the same id), and toasts again only
  // after the gap
  const reply = canvas('comment.reply');
  assert.ok(shouldToastNotice(reply, memory(t0)));
  noteNoticeToast(reply, memory(t0));
  assert.ok(!shouldToastNotice({ ...reply, data: { ...reply.data, count: 2 } }, memory(t0 + 5000)), 'a fold inside two minutes');
  assert.ok(!shouldToastNotice(reply, memory(t0 + NOTICE_TOAST_GAP_MS - 1)));
  assert.ok(shouldToastNotice(reply, memory(t0 + NOTICE_TOAST_GAP_MS)), 'a fold two minutes on');
  // another conversation is not held back by it
  assert.ok(shouldToastNotice(doc('doc.reply'), memory(t0 + 1)));
  // a file notice with no thread named falls back to its id
  const old = { id: 5, kind: 'file.commented', data: { token: TOKEN } };
  assert.ok(shouldToastNotice(old, memory(t0)));
  noteNoticeToast(old, memory(t0));
  assert.ok(!shouldToastNotice(old, memory(t0 + NOTICE_TOAST_GAP_MS * 2)));
  assert.ok(!shouldToastNotice(null, memory(t0)));
});

test('never a toast for the conversation open on screen, nor for doc.mention', () => {
  const memory = { toastedIds: new Set(), lastByThread: new Map(), now: 5, threadOpen: isThreadOpen };
  const release = holdThreadOpen('cm_ab12');
  const again = holdThreadOpen('cm_ab12');
  assert.ok(isThreadOpen('cm_ab12'));
  assert.ok(!shouldToastNotice(doc('doc.reply'), memory));
  assert.ok(shouldToastNotice(canvas('comment.reply'), memory), 'another conversation still toasts');
  release();
  release();   // released once, however often it is called
  assert.ok(isThreadOpen('cm_ab12'), 'the second card still holds it');
  again();
  assert.ok(!isThreadOpen('cm_ab12'));
  assert.ok(shouldToastNotice(doc('doc.reply'), memory));
  // its toast is the mention's own (App.jsx)
  assert.ok(!shouldToastNotice(doc('doc.mention'), memory));
  assert.ok(shouldToastNotice(canvas('comment.mention'), memory));
  assert.equal(holdThreadOpen(null)(), undefined);
  assert.ok(!isThreadOpen(null));
});

test('the hook and the panel use them, and the shared card holds its thread open', () => {
  const hook = src('../hooks/useNotifications.js');
  assert.match(hook, /setItems\(\(prev\) => mergeNotice\(prev, payload\)\);/);
  assert.doesNotMatch(hook, /prev\.some\(\(x\) => x\.id === payload\.id\)\) return prev/, 'a fold is no longer ignored');
  assert.match(hook, /if \(!shouldToastNotice\(payload, memory\)\) return;\s+noteNoticeToast\(payload, memory\);/);
  assert.match(hook, /threadOpen: isThreadOpen/);
  assert.match(hook, /if \(target\?\.kind === 'comment' && onCommentRef\.current\) onCommentRef\.current\(target\);/);
  assert.match(hook, /tag: `ntf:\$\{payload\.id\}`/, 'a fold replaces the earlier browser notice');
  const panel = src('../components/NotificationsPanel.jsx');
  assert.match(panel, /if \(target\.kind === 'comment'\) \{\s+onOpenComment\?\.\(target\);/);
  assert.match(panel, /noticeMore\(n\)/);
  // the bell and the toasts sit in the app's own code: nothing of the lazy
  // comment parts is imported there
  for (const s of [hook, panel, src('./notificationsBell.js'), src('./notificationWords.js')]) {
    assert.doesNotMatch(s, /from '[^']*components\/comments\//);
    assert.doesNotMatch(s, /CommentTime|commentParts/);
  }
  assert.match(src('../components/comments/CommentCard.jsx'), /useEffect\(\(\) => holdThreadOpen\(tid\), \[tid\]\);/);
});
