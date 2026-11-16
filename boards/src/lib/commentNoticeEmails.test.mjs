// The two emails a comment sends (mention_email, comment_reply_email) link to
// the comment itself, and a mention in a comment on the canvas says so. Bell
// only: a new conversation and a resolve send no email, so there is no
// template for them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { emailCommentKeys, readCommentLink } from './commentLink.js';

const root = new URL('../../../supabase/', import.meta.url);
const { renderTemplate, TEMPLATE_NAMES } = await import(new URL('functions/_shared/email/templates.ts', root));

const W = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const B = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const C = '1b4e28ba-2fa1-4d2e-9a3b-5c6d7e8f9012';
const CARD = 'api-card_77';
const APP = 'https://clusters.soleilpictures.com/';
const mention = (over = {}) => ({
  mentionerName: 'Jun Park', surface: 'canvas', surfaceContext: 'Night Shift, look',
  messagePreview: 'Maya, is this the lamp we tested on Tuesday?',
  workspaceId: W, boardId: B, threadId: C, commentId: C, unsubscribeToken: 'a'.repeat(64), ...over,
});
const reply = (over = {}) => ({
  replierName: 'Lena Ortiz', boardName: 'Night Shift, look', workspaceName: 'Soleil Pictures',
  replyPreview: 'Yes, and it reads warmer on the wide.', workspaceId: W, boardId: B, commentId: C, threadId: C,
  unsubscribeToken: 'a'.repeat(64), ...over,
});
// The button's address, as the mail client hands it to the browser.
const link = (r) => {
  const m = r.text.match(/https:\/\/clusters\.soleilpictures\.com\/\?[^\s]+/);
  assert.ok(m, 'the text part carries the link');
  assert.ok(r.html.includes(m[0].replace(/&/g, '&amp;')), 'and the button has the same one');
  return new URL(m[0]);
};

test('a mention in a comment on the canvas: its words, and a link to that comment', () => {
  const r = renderTemplate('mention_email', mention());
  assert.equal(r.subject, 'Jun Park mentioned you in a comment in Night Shift, look');
  assert.ok(r.html.includes('In a comment in Night Shift, look.'));
  assert.ok(r.html.includes('Open the comment'));
  const u = link(r);
  assert.equal(u.origin + u.pathname, APP);
  assert.deepEqual(Object.fromEntries(u.searchParams), { w: W, b: B, comment: C });
  // the app reads it: the gate carries it into ?board=&comment=
  const k = emailCommentKeys(u.searchParams);
  assert.deepEqual(readCommentLink(`${APP}?board=${k.board}&comment=${k.comment}`), { surface: 'canvas', boardId: B, commentId: C });
});

test('a mention in a comment on a doc or a note links to its thread on that card', () => {
  const r = renderTemplate('mention_email', mention({ surface: 'board', cardId: CARD, threadId: 'cm_ab12', commentId: undefined }));
  assert.equal(r.subject, 'Jun Park mentioned you in Night Shift, look', 'the words it always had');
  assert.deepEqual(Object.fromEntries(link(r).searchParams), { w: W, b: B, card: CARD, comment: 'cm_ab12' });
  assert.ok(r.html.includes('Open the comment'));
  // a message in the cluster's chat: the cluster, as before
  const chat = renderTemplate('mention_email', mention({ surface: 'board', threadId: undefined, commentId: undefined }));
  assert.deepEqual(Object.fromEntries(link(chat).searchParams), { w: W, b: B });
  assert.ok(chat.html.includes('Open in Clusters') && !chat.html.includes('Open the comment'));
  // a thread with no card named is not a link to a comment
  const half = renderTemplate('mention_email', mention({ surface: 'board', cardId: undefined, threadId: 'cm_ab12' }));
  assert.deepEqual(Object.fromEntries(link(half).searchParams), { w: W, b: B });
});

test('a reply’s email links to the reply', () => {
  const r = renderTemplate('comment_reply_email', reply());
  assert.deepEqual(Object.fromEntries(link(r).searchParams), { w: W, b: B, comment: C });
  // sent by a database from before the comment notices migration: the cluster
  assert.deepEqual(Object.fromEntries(link(renderTemplate('comment_reply_email', reply({ commentId: undefined }))).searchParams), { w: W, b: B });
});

test('an id that is not an id never reaches the link', () => {
  for (const bad of ['x&w=evil', 'a b', '../../x', '"><a href=//evil.test>', 'x#y', 'x'.repeat(81), '', {}, 7.5]) {
    const m = link(renderTemplate('mention_email', mention({ commentId: bad })));
    assert.deepEqual(Object.fromEntries(m.searchParams), { w: W, b: B }, `canvas ${String(bad).slice(0, 10)}`);
    const d = link(renderTemplate('mention_email', mention({ surface: 'board', cardId: bad, threadId: 'cm_ab12' })));
    assert.deepEqual(Object.fromEntries(d.searchParams), { w: W, b: B }, `card ${String(bad).slice(0, 10)}`);
    const t = link(renderTemplate('mention_email', mention({ surface: 'board', cardId: CARD, threadId: bad })));
    assert.deepEqual(Object.fromEntries(t.searchParams), { w: W, b: B }, `thread ${String(bad).slice(0, 10)}`);
    const rr = link(renderTemplate('comment_reply_email', reply({ commentId: bad })));
    assert.deepEqual(Object.fromEntries(rr.searchParams), { w: W, b: B }, `reply ${String(bad).slice(0, 10)}`);
  }
  // no cluster, no comment link
  const none = renderTemplate('mention_email', mention({ boardId: undefined }));
  assert.ok(!/comment=/.test(none.text));
});

test('every language has the canvas words, and an unknown surface is still a workspace mention', () => {
  for (const loc of ['es', 'fr', 'pt-BR', 'ru', 'ja', 'ko']) {
    const en = renderTemplate('mention_email', mention());
    const r = renderTemplate('mention_email', mention(), loc);
    assert.notEqual(r.subject, en.subject, loc);
    assert.ok(r.subject.includes('Jun Park') && r.subject.includes('Night Shift, look'), loc);
    assert.deepEqual(Object.fromEntries(link(r).searchParams), { w: W, b: B, comment: C }, loc);
  }
  const odd = renderTemplate('mention_email', mention({ surface: 'elsewhere' }));
  assert.equal(odd.subject, 'Jun Park mentioned you in Night Shift, look');
  assert.deepEqual(Object.fromEntries(link(odd).searchParams), { w: W });
  // bell only: no template was added for a new conversation or a resolve
  for (const n of TEMPLATE_NAMES) assert.doesNotMatch(n, /resolved|comment_new|new_comment/);
});

// STEP6_EMAIL_SHOTS=<dir> writes the three bodies there, to look at.
test('the three bodies render', () => {
  const out = process.env.STEP6_EMAIL_SHOTS;
  const bodies = {
    'email-mention-canvas': renderTemplate('mention_email', mention()),
    'email-mention-doc': renderTemplate('mention_email', mention({ surface: 'board', cardId: CARD, threadId: 'cm_ab12', commentId: undefined })),
    'email-reply': renderTemplate('comment_reply_email', reply()),
  };
  for (const [name, r] of Object.entries(bodies)) {
    assert.ok(r.html.length > 500 && r.subject, name);
    if (out) { mkdirSync(out, { recursive: true }); writeFileSync(`${out}/${name}.html`, r.html); }
  }
});
