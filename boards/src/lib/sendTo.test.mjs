// Send to…: the snapshot a card or cluster goes as, who the sheet offers, and
// the sentence by the Send button. Run under scripts/linguiNode.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardSnap, cardAttachments, clusterAttachment, recipientsFrom, isEmailish, rowMatches,
  accessLine, tallySend, afterSendNotes, sentWords, storageKey,
} from './sendTo.js';

test('a storage key is never a web address, data: or blob:', () => {
  assert.equal(storageKey('r2:ws/b/a.jpg'), 'ws/b/a.jpg');
  assert.equal(storageKey('ws/b/a.jpg'), 'ws/b/a.jpg');
  for (const bad of ['https://x.com/a.jpg', 'http://x.com/a.jpg', 'data:image/png;base64,AA', 'blob:abc', '//x.com/a', '', null, 5, 'a b']) {
    assert.equal(storageKey(bad), null, String(bad));
  }
});

test('an image card keeps its key and size; an outside picture keeps nothing', () => {
  assert.deepEqual(cardSnap({ id: 'c', kind: 'image', src: 'r2:k/1.jpg', w: 800, h: 600 }), { v: 1, k: 'image', key: 'k/1.jpg', w: 800, h: 600 });
  assert.deepEqual(cardSnap({ id: 'c', kind: 'image', src: 'https://x.com/a.jpg', w: 8, h: 6 }), { v: 1, k: 'image', w: 8, h: 6 });
});

test('a note goes as plain words, cut at 600, with its heading', () => {
  const s = cardSnap({ id: 'c', kind: 'note', title: 'Alley', html: '<p>Neon &amp; rain</p><p>Second</p>' });
  assert.equal(s.k, 'note');
  assert.equal(s.heading, 'Alley');
  assert.equal(s.text, 'Neon & rain\nSecond');
  assert.equal(cardSnap({ id: 'c', kind: 'note', body: 'x'.repeat(900) }).text.length, 600);
});

test('a link keeps its address and host, and its picture only when stored here', () => {
  const s = cardSnap({ id: 'c', kind: 'link', link: 'https://www.vimeo.com/123', image: 'https://i.vimeocdn.com/a.jpg' });
  assert.deepEqual(s, { v: 1, k: 'link', url: 'https://www.vimeo.com/123', host: 'vimeo.com' });
  assert.equal(cardSnap({ id: 'c', kind: 'link', link: 'https://a.com/', image: 'r2:k/og.jpg' }).key, 'k/og.jpg');
  assert.equal(cardSnap({ id: 'c', kind: 'link', link: 'javascript:alert(1)' }).url, undefined);
});

test('palette, video, pdf, file, doc and unknown kinds', () => {
  assert.deepEqual(cardSnap({ kind: 'palette', swatches: ['#fff', { hex: '#000' }, 5] }).swatches, ['#fff', '#000']);
  assert.equal(cardSnap({ kind: 'palette', swatches: Array.from({ length: 20 }, () => '#111') }).swatches.length, 12);
  assert.deepEqual(cardSnap({ kind: 'video', poster: 'r2:p.jpg', duration: 12 }), { v: 1, k: 'video', key: 'p.jpg', duration: 12 });
  assert.deepEqual(cardSnap({ kind: 'pdf', src: 'r2:p1.png', name: 'Deck', pageCount: 4 }), { v: 1, k: 'pdf', key: 'p1.png', name: 'Deck', pages: 4 });
  assert.deepEqual(cardSnap({ kind: 'file', fileName: 'a.zip', mime: 'application/zip', sizeBytes: 10 }), { v: 1, k: 'file', name: 'a.zip', mime: 'application/zip', size: 10 });
  assert.deepEqual(cardSnap({ kind: 'doc', pages: [1, 2], lines: [1, 2, 3] }), { v: 1, k: 'doc', pages: 2, lines: 3 });
  assert.deepEqual(cardSnap({ kind: 'shape' }), { v: 1, k: 'shape' });
});

test('the cluster cover rides along only as a storage key', () => {
  assert.equal(cardSnap({ kind: 'shape' }, { cover: 'r2:c.jpg' }).cover, 'c.jpg');
  assert.equal(cardSnap({ kind: 'shape' }, { cover: 'https://x/c.jpg' }).cover, undefined);
});

test('several cards: one attachment each, only the first three carry a snapshot', () => {
  const cards = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, kind: 'note', title: `T${i}` }));
  const a = cardAttachments({ boardId: 'b', boardTitle: 'Night shoot', cards, cover: 'c.jpg' });
  assert.equal(a.length, 5);
  assert.deepEqual(a.map((x) => !!x.snap), [true, true, true, false, false]);
  const { snap, ...rest } = a[0];
  assert.deepEqual(rest, { kind: 'card', boardId: 'b', cardId: 'c0', title: 'T0', boardTitle: 'Night shoot' });
  assert.equal(snap.cover, 'c.jpg');
});

test('a cluster attachment carries both id keys', () => {
  const snap = { v: 1, k: 'cluster', keys: [], count: 3, ws: 'Soleil' };
  assert.deepEqual(clusterAttachment({ boardId: 'b', title: 'Night shoot', snap }), { kind: 'board', id: 'b', boardId: 'b', title: 'Night shoot', snap });
});

test('typed text offered as an email', () => {
  assert.equal(isEmailish('sam@studio.com'), true);
  assert.equal(isEmailish('  sam@studio.com '), true);
  for (const bad of ['sam', 'sam@', 'sam@x', 'a b@c.com', '', null]) assert.equal(isEmailish(bad), false, String(bad));
});

test('a row matches when every typed word is in its name or email', () => {
  const r = { name: 'Lena Park', email: 'lena@x.com' };
  assert.equal(rowMatches(r, 'len par'), true);
  assert.equal(rowMatches(r, 'x.com'), true);
  assert.equal(rowMatches(r, 'mara'), false);
  assert.equal(rowMatches(r, ''), true);
});

const ME = 'me';
const conv = (id, at, extra = {}) => ({ conversation_id: id, last_message_at: at, title: null, ...extra });
const part = (cid, uid, left = null) => ({ conversation_id: cid, user_id: uid, left_at: left });

test('Recent: the newest six I am active in; People: the rest, minus DM peers', () => {
  const people = [
    { user_id: 'u1', name: 'Zed', email: 'z@x.com' },
    { user_id: 'u2', name: 'Ana', email: 'a@x.com' },
    { user_id: 'u3', name: 'Mara', email: 'm@x.com' },
    { user_id: ME, name: 'Me', email: 'me@x.com' },
  ];
  const conversations = [
    conv('dm1', '2026-11-10T10:00:00Z'),
    conv('g1', '2026-11-12T10:00:00Z', { title: 'Crew' }),
    conv('left', '2026-11-13T10:00:00Z'),
  ];
  const participants = [
    part('dm1', ME), part('dm1', 'u1'),
    part('g1', ME), part('g1', 'u2'), part('g1', 'u3'),
    part('left', ME, '2026-11-13T11:00:00Z'), part('left', 'u3'),
  ];
  const { recent, people: rest } = recipientsFrom({ conversations, participants, people, me: ME });
  assert.deepEqual(recent.map((r) => [r.type, r.conversationId, r.name]), [['group', 'g1', 'Crew'], ['dm', 'dm1', 'Zed']]);
  assert.equal(recent[1].userId, 'u1');
  assert.deepEqual([...recent[0].memberIds].sort(), ['u2', 'u3']);
  assert.deepEqual(rest.map((p) => p.name), ['Ana', 'Mara']);
});

test('Recent stops at six and leaves out a conversation hidden by id', () => {
  const conversations = Array.from({ length: 9 }, (_, i) => conv(`c${i}`, `2026-11-0${i + 1}T10:00:00Z`));
  const participants = conversations.flatMap((c, i) => [part(c.conversation_id, ME), part(c.conversation_id, `u${i}`)]);
  const people = conversations.map((_, i) => ({ user_id: `u${i}`, name: `P${i}`, email: '' }));
  const { recent, people: rest } = recipientsFrom({ conversations, participants, people, me: ME, hidden: new Set(['c8']) });
  assert.equal(recent.length, 6);
  assert.equal(recent[0].conversationId, 'c7');
  assert.ok(rest.some((p) => p.userId === 'u0'));
  assert.ok(!rest.some((p) => p.userId === 'u7'));
});

test('the line by Send when I can let people in', () => {
  assert.equal(accessLine({ canGrant: true, closedNames: ['Lena'], boardTitle: 'Night shoot' }), 'Lena will be able to view Night shoot.');
  assert.equal(accessLine({ canGrant: true, closedNames: ['Lena', 'Mara'], emails: ['s@x.com'], boardTitle: 'Night shoot' }), 'Lena, Mara and s@x.com will be able to view Night shoot.');
  assert.equal(accessLine({ canGrant: true, closedNames: ['A', 'B', 'C'], emails: ['d@x.com'], boardTitle: 'Night shoot' }), '4 people will be able to view Night shoot.');
  assert.equal(accessLine({ canGrant: true, closedNames: [], emails: [], boardTitle: 'Night shoot' }), null);
});

test('the line by Send when I cannot', () => {
  assert.equal(accessLine({ canGrant: false, closedNames: ['Lena'], boardTitle: 'N' }), "Lena won't be able to open it: only its editors can let people in.");
  assert.equal(accessLine({ canGrant: false, closedNames: ['A', 'B', 'C', 'D'], boardTitle: 'N' }), "4 people won't be able to open it: only its editors can let people in.");
  assert.equal(accessLine({ canGrant: false, closedNames: [], emails: ['x@y.com'], boardTitle: 'N' }), null);
});

test('the answer to a send, tallied', () => {
  const r = tallySend({
    people: [
      { user_id: 'a', access: 'had' }, { user_id: 'b', access: 'granted' },
      { email: 'n@x.com', access: 'invited' }, { user_id: 'c', access: 'closed', why: 'limit' },
      { email: 'r@x.com', access: 'refused', why: 'viewer' }, { user_id: 'd', access: 'refused', why: 'not_messageable' },
    ],
    conversations: [{ conversation_id: 'g', granted: ['e', 'f'], closed: ['h'] }, { conversation_id: 'x', refused: true }],
  });
  assert.equal(r.granted, 3);
  assert.equal(r.invited, 1);
  assert.equal(r.closed, 2);
  assert.equal(r.refused, 3);
  assert.deepEqual(r.closedUserIds, ['c', 'h']);
  assert.deepEqual(r.closedBy, { limit: ['c'], viewer: [], other: ['h'] });
  assert.deepEqual(r.refusedEmailsBy.viewer, ['r@x.com']);
  assert.deepEqual(tallySend(null).closedUserIds, []);
});

test('the toast words', () => {
  assert.equal(sentWords(['Mara']), 'Sent to Mara');
  assert.equal(sentWords(['Mara', 'Lena']), 'Sent to Mara and Lena');
  assert.equal(sentWords(['A', 'B', 'C', 'D']), 'Sent to 4 people');
});

const nameOf = (id) => ({ a: 'Ann', b: 'Bo', c: 'Cy', d: 'Di' }[id] || id);

test('a person closed by limit, by viewer or by error keeps the reason', () => {
  const r = tallySend({
    people: [
      { user_id: 'a', access: 'closed', why: 'limit' },
      { user_id: 'b', access: 'closed', why: 'viewer' },
      { user_id: 'c', access: 'closed', why: 'error' },
    ],
  });
  assert.deepEqual(r.closedBy, { limit: ['a'], viewer: ['b'], other: ['c'] });
  assert.equal(r.closed, 3);
  assert.deepEqual(afterSendNotes(r, { nameOf, posted: 1 }), [
    "Ann can't open it yet: today's sharing limit is reached.",
    "Bo can't open it yet: only editors can let people in.",
    "Cy can't open it yet.",
  ]);
});

test('a group: limited members are the limit, the rest follow can_grant', () => {
  const conv = [{ conversation_id: 'g', granted: [], closed: ['a', 'b'], limited: ['a'] }];
  const open = tallySend({ can_grant: true, conversations: conv });
  assert.deepEqual(open.closedBy, { limit: ['a'], viewer: [], other: ['b'] });
  const shut = tallySend({ can_grant: false, conversations: conv });
  assert.deepEqual(shut.closedBy, { limit: ['a'], viewer: ['b'], other: [] });
  assert.equal(shut.closed, 2);
  assert.deepEqual(shut.closedUserIds, ['a', 'b']);
});

test('no id is counted twice across people and conversations', () => {
  const r = tallySend({
    can_grant: false,
    people: [{ user_id: 'a', access: 'closed', why: 'limit' }],
    conversations: [
      { conversation_id: 'g', closed: ['a', 'b'], limited: [] },
      { conversation_id: 'h', closed: ['b'], limited: ['b'] },
    ],
  });
  const all = [...r.closedBy.limit, ...r.closedBy.viewer, ...r.closedBy.other];
  assert.deepEqual(all.sort(), ['a', 'b']);
  assert.deepEqual(r.closedBy.limit, ['a']);
  assert.deepEqual(r.closedUserIds.sort(), ['a', 'b']);
});

test('refused emails go by their reason', () => {
  const r = tallySend({
    people: [
      { email: 'v@x.com', access: 'refused', why: 'viewer' },
      { email: 'l@x.com', access: 'refused', why: 'limit' },
      { email: 'bad', access: 'refused', why: 'bad_email' },
      { email: 'me@x.com', access: 'refused', why: 'self' },
      { email: 'o@x.com', access: 'refused', why: 'error' },
      { user_id: 'd', access: 'refused', why: 'not_messageable' },
    ],
  });
  assert.deepEqual(r.refusedEmailsBy, { viewer: ['v@x.com'], limit: ['l@x.com'], bad_email: ['bad'], self: ['me@x.com'], other: ['o@x.com'] });
  assert.deepEqual(r.refusedUserIds, ['d']);
  assert.equal(r.refused, 6);
  assert.deepEqual(afterSendNotes(r, { nameOf, posted: 1 }), [
    "v@x.com didn't get it: only editors can invite by email.",
    "l@x.com didn't get it: today's sharing limit is reached.",
    "bad didn't get it: check the address.",
    "You can't send it to yourself.",
    "Couldn't send to o@x.com. Try again.",
    "Di didn't get it.",
  ]);
});

test('the invite line only when something was posted', () => {
  const r = tallySend({ people: [{ email: 'n@x.com', access: 'invited' }] });
  assert.deepEqual(afterSendNotes(r, { nameOf, posted: 0 }), []);
  assert.deepEqual(afterSendNotes(r, { nameOf, posted: 2 }), ['n@x.com will get an email invite.']);
  assert.deepEqual(afterSendNotes(tallySend(null), { nameOf, posted: 1 }), []);
});
