// Notices for a doc's and a note's threads (lib/commentNotices.js): who is
// told what, and the call that tells the database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { docNoticePlan, docNoticeCall, threadPeople, noticeExcerpt, sendDocNotices, NOTICE_ID, NOTICE_MAX_PEOPLE } from './commentNotices.js';

const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ME = u(1), ANA = u(2), JUN = u(3), DEV = u(4);
const BOARD = u(99);
const row = (id, authorId, body = 'words', mentions = []) => ({ id, authorId, body, mentions });
const thread = (root, replies = []) => ({ id: root.id, root, replies });

test('a new thread: the maker is the database’s to pick; the people named get a mention', () => {
  assert.deepEqual(docNoticePlan({ what: 'new', threadId: 'cm_a', body: 'First', mentions: [] }, ME), [
    { kind: 'doc.new', comment: 'cm_a', recipients: [], excerpt: 'First' },
  ]);
  // doc.new is handed the people named, so a maker the comment names gets the
  // mention alone: one comment, one notice a person
  assert.deepEqual(docNoticePlan({ what: 'new', threadId: 'cm_a', body: '@Ana look', mentions: [ANA, ME, ANA] }, ME), [
    { kind: 'doc.new', comment: 'cm_a', recipients: [ANA], excerpt: '@Ana look' },
    { kind: 'doc.mention', comment: 'cm_a', recipients: [ANA], excerpt: '@Ana look' },
  ]);
});

test('a reply: everyone in the thread, never you, and the people it names only as a mention', () => {
  const t = thread(row('cm_a', ANA), [row('cr_1', JUN), row('cr_2', ME), row('cr_3', ANA), row('cr_4', DEV)]);
  assert.deepEqual(docNoticePlan({ what: 'reply', thread: t, replyId: 'cr_9', body: 'ok', mentions: [] }, ME), [
    { kind: 'doc.reply', comment: 'cr_9', recipients: [ANA, JUN, DEV], excerpt: 'ok' },
  ]);
  assert.deepEqual(docNoticePlan({ what: 'reply', thread: t, replyId: 'cr_9', body: '@Jun ok', mentions: [{ id: JUN, name: 'Jun' }] }, ME), [
    { kind: 'doc.mention', comment: 'cr_9', recipients: [JUN], excerpt: '@Jun ok' },
    { kind: 'doc.reply', comment: 'cr_9', recipients: [ANA, DEV], excerpt: '@Jun ok' },
  ]);
  // alone in your own thread: nobody to tell
  assert.deepEqual(docNoticePlan({ what: 'reply', thread: thread(row('cm_b', ME)), replyId: 'cr_1', body: 'x' }, ME), []);
});

test('an edit tells only the people it added; a resolve tells who started the thread', () => {
  const t = thread(row('cm_a', ANA, 'Crop this to 2.39'), [row('cr_1', ME, '@Jun hi', [{ id: JUN, name: 'Jun' }])]);
  assert.deepEqual(docNoticePlan({ what: 'edit', thread: t, rowId: 'cr_1', body: '@Jun @Dev hi', added: [DEV] }, ME), [
    { kind: 'doc.mention', comment: 'cr_1', recipients: [DEV], excerpt: '@Jun @Dev hi' },
  ]);
  assert.deepEqual(docNoticePlan({ what: 'edit', thread: t, rowId: 'cr_1', body: 'typo', added: [] }, ME), []);
  assert.deepEqual(docNoticePlan({ what: 'resolve', thread: t }, ME), [
    { kind: 'doc.resolved', comment: 'cm_a', recipients: [ANA], excerpt: 'Crop this to 2.39' },
  ]);
  // your own thread: nobody
  assert.deepEqual(docNoticePlan({ what: 'resolve', thread: thread(row('cm_b', ME)) }, ME), []);
});

test('nobody signed in, an unknown event and ids that are not people tell nobody', () => {
  assert.deepEqual(docNoticePlan({ what: 'new', threadId: 'cm_a', body: 'x' }, null), []);
  assert.deepEqual(docNoticePlan({ what: 'moved' }, ME), []);
  assert.deepEqual(threadPeople(thread(row('cm_a', 'not-a-uuid'), [row('cr_1', null), row('cr_2', ANA)]), [ME]), [ANA]);
  const many = Array.from({ length: 30 }, (_, i) => row('cr_' + i, u(100 + i)));
  assert.equal(threadPeople(thread(row('cm_a', ANA), many), [ME]).length, NOTICE_MAX_PEOPLE);
});

test('the excerpt is one line, at most 280 characters', () => {
  assert.equal(noticeExcerpt('  two\n\nlines\tand   spaces '), 'two lines and spaces');
  const long = noticeExcerpt('a'.repeat(400));
  assert.equal(long.length, 280);
  assert.ok(long.endsWith('…'));
  assert.equal(noticeExcerpt(null), '');
});

test('ids from another client: letters, digits, _ and - only', () => {
  for (const ok of ['cm_ab12', 'cr_x-1', u(5), 'api-123', 'x'.repeat(80)]) assert.ok(NOTICE_ID.test(ok), ok);
  for (const bad of ['', 'a b', 'a/b', '../x', 'a?b=1', 'a~b', '<x>', 'x'.repeat(81)]) assert.ok(!NOTICE_ID.test(bad), bad);
});

const fake = (answers) => {
  const calls = [];
  return {
    calls,
    rpc(name, args) { calls.push([name, args]); const a = answers[calls.length - 1] ?? { data: 1, error: null, status: 200 }; return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); },
  };
};

test('the call: one RPC a step, with the thread and the people', async () => {
  const c = fake([{ data: 1, error: null, status: 200 }, { data: 2, error: null, status: 200 }]);
  const plan = docNoticePlan({ what: 'new', threadId: 'cm_a', body: '@Ana look', mentions: [ANA] }, ME);
  assert.equal(await sendDocNotices(c, { boardId: BOARD, cardId: 'card-1', threadId: 'cm_a' }, plan), 3);
  assert.deepEqual(c.calls, [
    ['notify_doc_comment', { p_board: BOARD, p_card: 'card-1', p_thread: 'cm_a', p_comment: 'cm_a', p_kind: 'doc.new', p_recipients: [ANA], p_excerpt: '@Ana look' }],
    ['notify_doc_comment', { p_board: BOARD, p_card: 'card-1', p_thread: 'cm_a', p_comment: 'cm_a', p_kind: 'doc.mention', p_recipients: [ANA], p_excerpt: '@Ana look' }],
  ]);
});

const TOKEN = u(77);

test('which call: the cluster when it is known, else the share’s token, else nobody', () => {
  const step = { kind: 'doc.reply', comment: 'cr_9', recipients: [ANA], excerpt: 'ok' };
  const rest = { p_card: 'card-1', p_thread: 'cm_a', p_comment: 'cr_9', p_kind: 'doc.reply', p_recipients: [ANA], p_excerpt: 'ok' };
  assert.deepEqual(docNoticeCall({ boardId: BOARD, cardId: 'card-1', threadId: 'cm_a' }, step),
    { fn: 'notify_doc_comment', args: { p_board: BOARD, ...rest } });
  // both known: the cluster wins, and the token is not sent
  assert.deepEqual(docNoticeCall({ boardId: BOARD, shareToken: TOKEN, cardId: 'card-1', threadId: 'cm_a' }, step),
    { fn: 'notify_doc_comment', args: { p_board: BOARD, ...rest } });
  // a doc opened through its share, by a signed-in editor: the token form
  assert.deepEqual(docNoticeCall({ boardId: null, shareToken: TOKEN, cardId: 'card-1', threadId: 'cm_a' }, step),
    { fn: 'notify_shared_doc_comment', args: { p_token: TOKEN, ...rest } });
  // neither, a token that is not one, no card for the token to be checked against, no thread
  assert.equal(docNoticeCall({ boardId: null, shareToken: null, cardId: 'card-1', threadId: 'cm_a' }, step), null);
  assert.equal(docNoticeCall({ shareToken: 'not-a-token', cardId: 'card-1', threadId: 'cm_a' }, step), null);
  assert.equal(docNoticeCall({ boardId: 'card-key', cardId: 'card-1', threadId: 'cm_a' }, step), null);
  assert.equal(docNoticeCall({ shareToken: TOKEN, cardId: null, threadId: 'cm_a' }, step), null);
  assert.equal(docNoticeCall({ shareToken: TOKEN, cardId: 'card-1', threadId: '' }, step), null);
  assert.equal(docNoticeCall(undefined, step), null);
});

test('the token form is sent like the other: after the write, quiet when it is not there', async () => {
  const where = { boardId: null, shareToken: TOKEN, cardId: 'card-1', threadId: 'cm_a' };
  const t = thread(row('cm_a', ANA), [row('cr_1', JUN)]);
  const plan = docNoticePlan({ what: 'reply', thread: t, replyId: 'cr_9', body: 'ok', mentions: [] }, ME);
  const c = fake([{ data: 2, error: null, status: 200 }]);
  assert.equal(await sendDocNotices(c, where, plan), 2);
  assert.deepEqual(c.calls, [
    ['notify_shared_doc_comment', { p_token: TOKEN, p_card: 'card-1', p_thread: 'cm_a', p_comment: 'cr_9', p_kind: 'doc.reply', p_recipients: [ANA, JUN], p_excerpt: 'ok' }],
  ]);
  const warn = console.warn;
  const said = [];
  console.warn = (...a) => said.push(a);
  try {
    // the migration not applied: no error shown, nothing logged
    const missing = fake([{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }]);
    assert.equal(await sendDocNotices(missing, where, plan), 0);
    // the switch off: the database answers 0
    assert.equal(await sendDocNotices(fake([{ data: 0, error: null, status: 200 }]), where, plan), 0);
    assert.equal(await sendDocNotices(fake([new Error('offline')]), where, plan), 0);
    assert.equal(said.length, 1);
    // signed out or read-only: DocShareView hands over no token, and nothing is called
    const none = fake([]);
    assert.equal(await sendDocNotices(none, { ...where, shareToken: null }, plan), 0);
    assert.equal(none.calls.length, 0);
  } finally { console.warn = warn; }
});

test('the call never throws: no RPC yet, an error, a rejection, no cluster', async () => {
  const plan = docNoticePlan({ what: 'new', threadId: 'cm_a', body: '@Ana look', mentions: [ANA] }, ME);
  const where = { boardId: BOARD, cardId: 'card-1', threadId: 'cm_a' };
  const warn = console.warn;
  const said = [];
  console.warn = (...a) => said.push(a);
  try {
    // before the migration: quiet, and the rest of the plan is not tried
    const missing = fake([{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' }, status: 404 }]);
    assert.equal(await sendDocNotices(missing, where, plan), 0);
    assert.equal(missing.calls.length, 1);
    assert.equal(said.length, 0);
    const failing = fake([{ data: null, error: { code: '42501', message: 'no' }, status: 403 }]);
    assert.equal(await sendDocNotices(failing, where, plan), 0);
    assert.equal(said.length, 1);
    assert.equal(await sendDocNotices(fake([new Error('offline')]), where, plan), 0);
    const none = fake([]);
    assert.equal(await sendDocNotices(none, { ...where, boardId: null }, plan), 0);
    assert.equal(await sendDocNotices(none, { ...where, boardId: 'card-key' }, plan), 0);
    assert.equal(await sendDocNotices(null, where, plan), 0);
    assert.equal(none.calls.length, 0);
  } finally { console.warn = warn; }
});

test('docs and notes tell the database after the write, and never .catch() the builder', () => {
  const ops = readFileSync(new URL('../components/comments/docThreadOps.js', import.meta.url), 'utf8');
  assert.match(ops, /tell\(id, \{ what: 'new', threadId: id, body, mentions: ids \}\);/);
  assert.match(ops, /if \(replyId\) tell\(id, \{ what: 'reply', thread, replyId, body, mentions: ids \}\);/);
  assert.match(ops, /tell\(id, \{ what: 'edit', thread, rowId: row\.id, body, added: addedMentionIds\(row\.mentions, mentions\) \}\);/);
  assert.match(ops, /resolveComment\(ydoc, id, true, scope, by\);\s+tell\(id, \{ what: 'resolve', thread \}\);/);
  // the mention email's call is still made, next to the notice
  assert.match(ops, /notify\(id, ids, body\);\s+tell\(id, \{ what: 'new'/);
  assert.match(ops, /notify\(id, ids, body\);\s+if \(replyId\) tell\(/);
  const lib = readFileSync(new URL('./commentNotices.js', import.meta.url), 'utf8');
  assert.doesNotMatch(lib, /\.rpc\([^;]*\)\s*\.catch\(/);
  assert.match(lib, /const \{ data, error, status \} = await client\.rpc\(call\.fn, call\.args\);/);
});

test('a doc opened through its share: the cluster for who manages it, the token for a signed-in editor, nothing for a guest', () => {
  const ops = readFileSync(new URL('../components/comments/docThreadOps.js', import.meta.url), 'utf8');
  assert.match(ops, /const noticeBoard = boardId \|\| scope\?\.noticeBoardId \|\| null;/);
  assert.match(ops, /const noticeToken = noticeBoard \? null : scope\?\.noticeShareToken \|\| null;/);
  // nobody signed in tells nobody, whatever the scope holds
  assert.match(ops, /if \(!meId \|\| !threadId \|\| !\(noticeBoard \|\| noticeToken\)\) return;/);
  assert.match(ops, /try \{ sendDocNotices\(supabase, \{ boardId: noticeBoard, shareToken: noticeToken, cardId, threadId \}, docNoticePlan\(ev, meId\)\); \} catch/);
  const view = readFileSync(new URL('../components/fileShare/DocShareView.jsx', import.meta.url), 'utf8');
  assert.match(view, /const noticeBoardId = \(signedIn && res\.board_id\) \|\| null;/);
  assert.match(view, /const noticeShareToken = \(signedIn && !noticeBoardId && res\.can_edit && token\) \|\| null;/);
});
