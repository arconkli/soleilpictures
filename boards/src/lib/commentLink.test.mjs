import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCommentLink, withoutCommentLink, LOOSE_ID } from './commentLink.js';
import { NOTICE_ID as BELL_ID } from './notificationsBell.js';
import { NOTICE_ID as WRITER_ID } from './commentNotices.js';
import { commentLinkUrl } from './commentLinkUrl.js';
import { cardLinkUrl } from './cardLink.js';
import { fileShareUrl } from './fileShares.js';

const BOARD = '0b0b0b0b-1111-4222-8333-444444444444';
const CARD = 'aaaaaaaa-1111-4222-8333-444444444444';
const COMMENT = 'cccccccc-1111-4222-8333-444444444444';
const TOKEN = 'ffffffff-1111-4222-8333-444444444444';
const HERE = 'https://clusters.soleilpictures.com/?view=canvas&x=1#top';

test('canvas: the cluster and the comment', () => {
  const url = commentLinkUrl(HERE, { surface: 'canvas', boardId: BOARD, commentId: COMMENT });
  assert.equal(url, `https://clusters.soleilpictures.com/?board=${BOARD}&comment=${COMMENT}`);
  assert.deepEqual(readCommentLink(url), { surface: 'canvas', boardId: BOARD, commentId: COMMENT });
});

test('doc and note: the app\'s own card link, plus the thread', () => {
  for (const surface of ['doc', 'note']) {
    const url = commentLinkUrl(HERE, { surface, boardId: BOARD, cardId: CARD, commentId: 'cm_ab12cd34xyz' });
    assert.equal(url, `${cardLinkUrl(HERE, BOARD, CARD)}&comment=cm_ab12cd34xyz`);
    assert.deepEqual(readCommentLink(url), { surface: 'card', boardId: BOARD, cardId: CARD, commentId: 'cm_ab12cd34xyz' });
  }
  // a card the API made
  const api = commentLinkUrl(HERE, { surface: 'doc', boardId: BOARD, cardId: 'api-Xy_9', commentId: 'cm_1' });
  assert.equal(readCommentLink(api).cardId, 'api-Xy_9');
  assert.equal(commentLinkUrl(HERE, { surface: 'doc', boardId: BOARD, commentId: 'cm_1' }), null, 'a doc thread needs its card');
});

test('shared file: /f/<token>?comment=', () => {
  const url = commentLinkUrl('https://clusters.soleilpictures.com/f/' + TOKEN + '?x=1', { surface: 'file', token: TOKEN, commentId: COMMENT });
  assert.equal(url, `${fileShareUrl(TOKEN, 'https://clusters.soleilpictures.com')}?comment=${COMMENT}`);
  assert.deepEqual(readCommentLink(url), { surface: 'file', token: TOKEN, commentId: COMMENT });
  assert.deepEqual(readCommentLink(`/f/${TOKEN}/?comment=${COMMENT}`), { surface: 'file', token: TOKEN, commentId: COMMENT });
});

test('uuids come back lower-case; other ids as they are', () => {
  const url = commentLinkUrl(HERE, { surface: 'canvas', boardId: BOARD.toUpperCase(), commentId: COMMENT.toUpperCase() });
  assert.equal(url, `https://clusters.soleilpictures.com/?board=${BOARD}&comment=${COMMENT}`);
  assert.equal(readCommentLink(`https://x.test/?board=${BOARD.toUpperCase()}&comment=${COMMENT.toUpperCase()}`).commentId, COMMENT);
  assert.equal(readCommentLink(`https://x.test/?board=${BOARD}&card=${CARD}&comment=cm_AbC`).commentId, 'cm_AbC');
});

test('the path the app is on is kept', () => {
  assert.equal(
    commentLinkUrl('http://localhost:5292/app?local=1', { surface: 'canvas', boardId: BOARD, commentId: COMMENT }),
    `http://localhost:5292/app?board=${BOARD}&comment=${COMMENT}`,
  );
});

test('missing or malformed parts give no link', () => {
  assert.equal(commentLinkUrl(HERE, { surface: 'canvas', boardId: BOARD }), null);
  assert.equal(commentLinkUrl(HERE, { surface: 'canvas', boardId: 'not-a-uuid', commentId: COMMENT }), null);
  assert.equal(commentLinkUrl(HERE, { surface: 'canvas', boardId: BOARD, commentId: 'has space' }), null);
  assert.equal(commentLinkUrl(HERE, { surface: 'file', token: 'nope', commentId: COMMENT }), null);
  assert.equal(commentLinkUrl(HERE, { surface: 'elsewhere', boardId: BOARD, commentId: COMMENT }), null);
  assert.equal(commentLinkUrl('not a url', { surface: 'canvas', boardId: BOARD, commentId: COMMENT }), null);
  assert.equal(commentLinkUrl(HERE), null);
});

test('reading: only addresses that name a comment', () => {
  assert.equal(readCommentLink(`https://x.test/?board=${BOARD}&card=${CARD}`), null);
  assert.equal(readCommentLink(`https://x.test/?comment=${COMMENT}`), null, 'the app needs the cluster too');
  assert.equal(readCommentLink(`https://x.test/?board=nope&comment=${COMMENT}`), null);
  assert.equal(readCommentLink(`https://x.test/?board=${BOARD}&comment=%3Cscript%3E`), null);
  assert.equal(readCommentLink(`https://x.test/?board=${BOARD}&card=bad%20id&comment=${COMMENT}`), null);
  assert.equal(readCommentLink(`https://x.test/f/not-a-token-not-a-token-not-a-token-xx?comment=${COMMENT}`), null);
  assert.equal(readCommentLink(''), null);
});

test('once open, the address drops the comment', () => {
  assert.equal(withoutCommentLink(`https://x.test/?board=${BOARD}&card=${CARD}&comment=cm_1&keep=1#h`), '/?keep=1#h');
  assert.equal(withoutCommentLink(`https://x.test/?board=${BOARD}&comment=${COMMENT}`), '/');
  assert.equal(withoutCommentLink(`https://x.test/f/${TOKEN}?comment=${COMMENT}&v=2`), `/f/${TOKEN}?v=2`);
});

test('an email’s link (?w=&b=&comment=) is carried into the app’s own form', async () => {
  const { emailCommentKeys } = await import('./commentLink.js');
  const keys = (q) => emailCommentKeys(new URLSearchParams(q));
  assert.deepEqual(keys(`w=x&b=${BOARD.toUpperCase()}&comment=${COMMENT}`), { board: BOARD, comment: COMMENT });
  assert.deepEqual(keys(`w=x&b=${BOARD}&card=${CARD}&comment=cm_ab12`), { board: BOARD, card: CARD, comment: 'cm_ab12' });
  // what the gate leaves in the address reads as a comment link
  const k = keys(`b=${BOARD}&card=${CARD}&comment=cm_ab12`);
  assert.deepEqual(readCommentLink(`https://x.test/?board=${k.board}&card=${k.card}&comment=${k.comment}`),
    { surface: 'card', boardId: BOARD, cardId: CARD, commentId: 'cm_ab12' });
  // no comment, no cluster, or an id that is not one: nothing is carried
  for (const q of [`w=x&b=${BOARD}`, `comment=${COMMENT}`, `b=nope&comment=${COMMENT}`, `b=${BOARD}&comment=a%20b`,
    `b=${BOARD}&card=..%2Fx&comment=${COMMENT}`]) assert.equal(keys(q), null, q);
  assert.equal(emailCommentKeys(null), null);
  // the gate and the resume page both use it
  const { readFileSync } = await import('node:fs');
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  assert.match(read('../auth/AuthGate.jsx'), /if \(comment\) url\.searchParams\.set\('board', comment\.board\);/);
  const resume = read('../pages/ResumePage.jsx');
  assert.match(resume, /comment: emailCommentKeys\(p\),/);
  assert.match(resume, /window\.location\.assign\(appUrl\(\{ w, b, comment \}\)\);/);
});

test('one id rule, 80 characters, in the link, the bell, the doc notices and the emails', () => {
  assert.equal(LOOSE_ID.source, '^[A-Za-z0-9_-]{1,80}$');
  assert.equal(BELL_ID, LOOSE_ID, 'the bell imports it');
  assert.equal(WRITER_ID, LOOSE_ID, 'the doc notices import it');
  const literal = (rel, name) => {
    const m = new RegExp(`const ${name} = /(.+)/;`).exec(readFileSync(new URL(rel, import.meta.url), 'utf8'));
    assert.ok(m, `${rel} has ${name}`);
    return m[1];
  };
  assert.equal(literal('./commentLinkUrl.js', 'LOOSE_ID'), LOOSE_ID.source, 'the link writer');
  assert.equal(literal('../../../supabase/functions/_shared/email/templates.ts', 'LINK_ID'), LOOSE_ID.source, 'the emails');
  const at = (n) => `https://x.test/?board=${BOARD}&comment=${'x'.repeat(n)}`;
  assert.equal(readCommentLink(at(80)).commentId, 'x'.repeat(80));
  assert.equal(readCommentLink(at(81)), null);
  assert.ok(commentLinkUrl(HERE, { surface: 'canvas', boardId: BOARD, commentId: 'x'.repeat(80) }));
  assert.equal(commentLinkUrl(HERE, { surface: 'canvas', boardId: BOARD, commentId: 'x'.repeat(81) }), null);
});
