// The doc mirror (lib/docRoomBridge.js): a shared doc's live copy keeps its
// Yjs ids, carries nothing else of the cluster, follows every edit, and
// refuses any guest write that reaches past the doc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as Y from 'yjs';
import {
  extractDocSubtree, filterTransaction, validateGuestUpdate, placeOf, r2KeysIn,
  DOC_KEYS, CARD_FIELDS, YJS_SERIES,
} from './docRoomBridge.js';

const require = createRequire(import.meta.url);
const CARD = 'doc-1700000000000';
const KEY = 'ws-1/11111111-1111-4111-8111-111111111111.jpg';

// A cluster: the shared doc, another card with secrets, the links map.
function makeBoard() {
  const board = new Y.Doc({ gc: false });
  const cards = board.getMap('cards');
  board.transact(() => {
    const other = new Y.Map();
    cards.set('note-1', other);
    other.set('kind', 'note');
    other.set('x', 10);
    other.set('html', 'SECRET_OTHER_NOTE');
    const doc = new Y.Map();
    cards.set(CARD, doc);
    doc.set('kind', 'doc');
    doc.set('title', 'Script');
    doc.set('fontFamily', 'serif');
    doc.set('x', 4242);
    doc.set('privateNote', 'SECRET_CARD_FIELD');
    for (const k of DOC_KEYS) doc.set(k, k === 'docPages' ? new Y.Array() : new Y.Map());
    doc.get('docPages').push([{ id: 'p1', name: 'Page one', parent_id: null, order: 0 }]);
    const frag = new Y.XmlFragment();
    doc.get('docPageContent').set('p1', frag);
    const para = new Y.XmlElement('paragraph');
    const text = new Y.XmlText();
    para.insert(0, [text]);
    frag.insert(0, [para]);
    text.insert(0, 'Hello world');
    const img = new Y.XmlElement('image');
    img.setAttribute('src', `r2:${KEY}`);
    frag.insert(1, [img]);
    doc.get('docComments').set('t1', { pageId: 'p1', ts: 1, author: 'Rae', authorId: 'u-rae', body: 'nice', replies: [], resolved: false });
    doc.get('docMeta').set('mode', 'doc');
    board.getMap('links').set('l1', { pageId: 'p1', targets: ['SECRET_LINK_TARGET'] });
  });
  return board;
}

const cardMapOf = (doc) => doc.getMap('cards').get(CARD);
const pageText = (doc) => cardMapOf(doc).get('docPageContent').get('p1').toString();

// What a reader of the doc sees: the doc keys and the kept card fields.
function docJson(doc, { variant = 'edit' } = {}) {
  const m = cardMapOf(doc);
  if (!m) return null;
  const out = {};
  for (const k of DOC_KEYS) {
    if (variant === 'view' && k === 'docComments') continue;
    const v = m.get(k);
    out[k] = v && typeof v.toJSON === 'function' ? v.toJSON() : v;
  }
  for (const k of CARD_FIELDS) out[k] = m.get(k);
  return JSON.parse(JSON.stringify(out));
}

// Every string a decoded update carries.
function stringsIn(update) {
  const { structs } = Y.decodeUpdate(update);
  const out = [];
  for (const s of structs) {
    if (!(s instanceof Y.Item)) continue;
    if (typeof s.parentSub === 'string') out.push(s.parentSub);
    if (typeof s.parent === 'string') out.push(s.parent);
    const c = s.content;
    if (c instanceof Y.ContentString) out.push(c.str);
    else if (c instanceof Y.ContentAny) out.push(JSON.stringify(c.arr));
    else if (c instanceof Y.ContentFormat) out.push(c.key, JSON.stringify(c.value));
    else if (c instanceof Y.ContentType && c.type.nodeName) out.push(c.type.nodeName);
  }
  return out.join('\n');
}

function mirrorOf(board, variant = 'edit') {
  const room = new Y.Doc();
  const x = extractDocSubtree(board, CARD, { variant });
  Y.applyUpdate(room, x.update);
  return { room, sent: x.sent, update: x.update };
}

// The board forwards every transaction to the mirror, filtered.
function wire(board, room, { variant = 'edit', sent, log = [] } = {}) {
  board.on('afterTransaction', (tr) => {
    if (tr.origin === 'from-room') return;
    const u = filterTransaction(board, tr, CARD, { variant, sent });
    if (u) { log.push(u); Y.applyUpdate(room, u, 'from-board'); }
  });
  return log;
}

// A member: their own doc, synced both ways with the board.
function member(board) {
  const m = new Y.Doc();
  Y.applyUpdate(m, Y.encodeStateAsUpdate(board));
  // Each member is its own origin, so one member's edits reach the others.
  m.on('update', (u, origin) => { if (origin !== 'from-board') Y.applyUpdate(board, u, m); });
  board.on('update', (u, origin) => { if (origin !== m) Y.applyUpdate(m, u, 'from-board'); });
  return m;
}

// A guest: a doc synced from the mirror; returns the update a local edit made.
function guestOf(room) {
  const g = new Y.Doc();
  Y.applyUpdate(g, Y.encodeStateAsUpdate(room));
  return g;
}
function editAs(g, fn) {
  let out = null;
  const on = (u) => { out = out ? Y.mergeUpdates([out, u]) : u; };
  g.on('update', on);
  g.transact(fn);
  g.off('update', on);
  return out;
}
const ctxFor = (g, extra = {}) => ({
  cardKey: CARD, claims: new Set([g.clientID]), userId: 'u-guest', displayName: 'Guest',
  trustedKeys: new Set([KEY]), maxBytes: 1024 * 1024, ...extra,
});

test('yjs is the series the bridge was written against', () => {
  assert.ok(require('yjs/package.json').version.startsWith(YJS_SERIES));
});

test('the mirror is the doc exactly, and nothing else of the cluster', () => {
  const board = makeBoard();
  const { room, update } = mirrorOf(board);
  assert.deepEqual(docJson(room), docJson(board));
  assert.equal(room.getMap('cards').get('note-1'), undefined, 'no other card');
  assert.equal(cardMapOf(room).get('x'), undefined, 'no position');
  assert.equal(cardMapOf(room).get('privateNote'), undefined, 'no other card field');
  assert.equal(room.getMap('links').size, 0, 'no links map');
  const all = stringsIn(update);
  for (const secret of ['SECRET_OTHER_NOTE', 'SECRET_CARD_FIELD', 'SECRET_LINK_TARGET', 'note-1', 'privateNote']) {
    assert.ok(!all.includes(secret), `${secret} stays in the cluster`);
  }
  assert.equal(room.store.pendingStructs, null, 'nothing waits on a missing struct');
  // Every client's clocks are there, as GC where they are not the doc's.
  assert.deepEqual(Y.encodeStateVector(room), Y.encodeStateVector(board));
});

test('deleted text never leaves the cluster', () => {
  const board = makeBoard();
  const text = cardMapOf(board).get('docPageContent').get('p1').get(0).get(0);
  text.insert(5, ' DELETED_SECRET');
  text.delete(5, ' DELETED_SECRET'.length);
  cardMapOf(board).set('title', 'OLD_TITLE_SECRET');
  cardMapOf(board).set('title', 'Script');
  const { room, update } = mirrorOf(board);
  assert.equal(pageText(room), pageText(board));
  const all = stringsIn(update);
  assert.ok(!all.includes('DELETED_SECRET'));
  assert.ok(!all.includes('OLD_TITLE_SECRET'), 'an earlier value of a kept field');
});

test('the view mirror leaves the comment threads out', () => {
  const board = makeBoard();
  const { room, update } = mirrorOf(board, 'view');
  assert.equal(cardMapOf(room).get('docComments'), undefined);
  assert.ok(!stringsIn(update).includes('nice'));
  assert.deepEqual(docJson(room, { variant: 'view' }), docJson(board, { variant: 'view' }));
  // The edit mirror has them.
  assert.equal(cardMapOf(mirrorOf(board).room).get('docComments').get('t1').body, 'nice');
});

test('relative positions made in the cluster resolve in the mirror', () => {
  const board = makeBoard();
  const text = cardMapOf(board).get('docPageContent').get('p1').get(0).get(0);
  const rel = Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text, 6));
  const { room } = mirrorOf(board);
  const abs = Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(rel), room);
  assert.ok(abs, 'resolves');
  assert.equal(abs.index, 6);
  assert.equal(abs.type.toString(), text.toString());
});

test('placeOf names where an item sits', () => {
  const board = makeBoard();
  const cards = board.getMap('cards');
  const cardItem = cards._map.get(CARD);
  assert.equal(placeOf(cardItem, cards, CARD), 'card');
  const pagesItem = cardItem.content.type._map.get('docPages');
  assert.equal(placeOf(pagesItem, cards, CARD), 'entry:docPages');
  const page = pagesItem.content.type._start;
  assert.equal(placeOf(page, cards, CARD), 'in:docPages');
  assert.equal(placeOf(cards._map.get('note-1'), cards, CARD), null);
});

test('edits in the cluster follow, and edits elsewhere never cross', () => {
  const board = makeBoard();
  const { room, sent } = mirrorOf(board);
  const log = wire(board, room, { sent });
  const a = member(board);
  const b = member(board);
  const textOf = (d) => cardMapOf(d).get('docPageContent').get('p1').get(0).get(0);
  // Interleaved: other cards first (clocks advance), then the doc.
  for (let i = 0; i < 30; i++) {
    const who = i % 2 ? a : b;
    if (i % 3 === 0) who.getMap('cards').get('note-1').set('html', `SECRET_EDIT_${i}`);
    else if (i % 3 === 1) textOf(who).insert(Math.min(i, textOf(who).length), `w${i} `);
    else cardMapOf(who).get('docComments').set(`t${i}`, { body: `c${i}`, authorId: 'u-a', author: 'A', replies: [] });
    if (i % 5 === 0) textOf(who).delete(0, 1);
  }
  assert.deepEqual(docJson(room), docJson(board), 'the mirror holds what the cluster holds');
  assert.equal(room.store.pendingStructs, null, 'clocks stayed contiguous');
  for (const u of log) assert.ok(!stringsIn(u).includes('SECRET_EDIT'), 'other cards stay out');
  // A transaction that only touches another card sends nothing.
  const before = log.length;
  a.getMap('cards').get('note-1').set('x', 99);
  assert.equal(log.length, before, 'push on change only');
});

test('a guest’s edits merge into the cluster exactly, and both sides converge', () => {
  const board = makeBoard();
  const { room, sent } = mirrorOf(board);
  wire(board, room, { sent });
  const m = member(board);
  const g = guestOf(room);
  const gText = () => cardMapOf(g).get('docPageContent').get('p1').get(0).get(0);
  const u1 = editAs(g, () => {
    gText().insert(0, 'Guest says ');
    gText().format(0, 5, { bold: true });
    cardMapOf(g).get('docPages').push([{ id: 'p2', name: 'Page two', parent_id: null, order: 1 }]);
    cardMapOf(g).get('docComments').set('tg', { pageId: 'p1', ts: 2, author: 'Guest', authorId: 'u-guest', body: 'hi', replies: [], resolved: false });
  });
  const v1 = validateGuestUpdate(room, u1, ctxFor(g));
  assert.equal(v1.ok, true, v1.reason);
  Y.applyUpdate(room, u1, 'guest');
  Y.applyUpdate(board, u1, 'from-room');
  // A member types at the same time.
  cardMapOf(m).get('docPageContent').get('p1').get(0).get(0).insert(0, 'Member: ');
  // The guest sees it through the mirror.
  Y.applyUpdate(g, Y.encodeStateAsUpdate(room, Y.encodeStateVector(g)));
  assert.deepEqual(docJson(room), docJson(board));
  assert.deepEqual(docJson(g), docJson(room));
  assert.match(pageText(board), /<bold>Guest<\/bold> says/, 'the guest’s text and its bold');
  assert.match(pageText(board), /Member: /);
  assert.equal(board.getMap('cards').get('note-1').get('html'), 'SECRET_OTHER_NOTE', 'other cards untouched');
});

test('a guest can reply to a thread and resolve it, but not rewrite or remove someone else’s', () => {
  const board = makeBoard();
  const { room } = mirrorOf(board);
  const g = guestOf(room);
  const comments = () => cardMapOf(g).get('docComments');
  const t1 = () => comments().get('t1');
  const reply = editAs(g, () => comments().set('t1', { ...t1(), replies: [{ author: 'Guest', authorId: 'u-guest', body: 'agreed' }] }));
  assert.equal(validateGuestUpdate(room, reply, ctxFor(g)).ok, true);
  const g2 = guestOf(room);
  const resolve = editAs(g2, () => cardMapOf(g2).get('docComments').set('t1', { ...cardMapOf(g2).get('docComments').get('t1'), resolved: true }));
  assert.equal(validateGuestUpdate(room, resolve, ctxFor(g2)).ok, true, 'resolving is any editor’s');
  const g3 = guestOf(room);
  const rewrite = editAs(g3, () => cardMapOf(g3).get('docComments').set('t1', { ...cardMapOf(g3).get('docComments').get('t1'), body: 'EDITED' }));
  assert.equal(validateGuestUpdate(room, rewrite, ctxFor(g3)).reason, 'comment_author');
  const g4 = guestOf(room);
  const forged = editAs(g4, () => cardMapOf(g4).get('docComments').set('tf', { author: 'Rae', authorId: 'u-rae', body: 'pay me', replies: [] }));
  assert.equal(validateGuestUpdate(room, forged, ctxFor(g4)).reason, 'comment_author');
  const g5 = guestOf(room);
  const remove = editAs(g5, () => cardMapOf(g5).get('docComments').delete('t1'));
  assert.equal(validateGuestUpdate(room, remove, ctxFor(g5)).reason, 'comment_author');
});

test('a guest write that reaches past the doc is refused', () => {
  const board = makeBoard();
  const { room } = mirrorOf(board);
  const cases = [
    ['a new root entry', (g) => g.getMap('cards').set('evil', 'x'), 'root_write'],
    ['another root type', (g) => g.getMap('links').set('l9', { targets: ['x'] }), 'root_write'],
    ['a card field', (g) => cardMapOf(g).set('title', 'hacked'), 'outside_doc'],
    ['a position', (g) => cardMapOf(g).set('x', 1), 'outside_doc'],
    ['replacing a doc key', (g) => cardMapOf(g).set('docPages', new Y.Array()), 'outside_doc'],
    ['removing a doc key', (g) => cardMapOf(g).delete('docMeta'), 'outside_doc'],
    ['binary content', (g) => cardMapOf(g).get('docMeta').set('blob', new Uint8Array([1, 2, 3])), 'content'],
    ['a sub-document', (g) => cardMapOf(g).get('docMeta').set('sub', new Y.Doc()), 'content'],
    ['an outside image', (g) => {
      const el = new Y.XmlElement('image');
      el.setAttribute('src', 'https://tracker.example/p.gif');
      cardMapOf(g).get('docPageContent').get('p1').insert(0, [el]);
    }, 'untrusted_src'],
    ['an image key from elsewhere', (g) => {
      const el = new Y.XmlElement('image');
      el.setAttribute('src', 'r2:ws-2/someone-else.jpg');
      cardMapOf(g).get('docPageContent').get('p1').insert(0, [el]);
    }, 'untrusted_src'],
    ['a script link', (g) => {
      const t = cardMapOf(g).get('docPageContent').get('p1').get(0).get(0);
      t.format(0, 5, { link: { href: 'javascript:alert(1)' } });
    }, 'unsafe_link'],
  ];
  for (const [what, fn, reason] of cases) {
    const g = guestOf(room);
    const u = editAs(g, () => fn(g));
    assert.ok(u, `${what}: an update`);
    assert.equal(validateGuestUpdate(room, u, ctxFor(g)).reason, reason, what);
  }
  // A known image key copied within the doc is fine; so is an http link.
  const g = guestOf(room);
  const ok = editAs(g, () => {
    const el = new Y.XmlElement('image');
    el.setAttribute('src', `r2:${KEY}`);
    cardMapOf(g).get('docPageContent').get('p1').insert(0, [el]);
    cardMapOf(g).get('docPageContent').get('p1').get(1).get(0).format(0, 5, { link: { href: 'https://example.com' } });
  });
  assert.equal(validateGuestUpdate(room, ok, ctxFor(g)).ok, true);
});

test('a guest cannot write as someone else’s client, skip clocks, or point at what the mirror never had', () => {
  const board = makeBoard();
  const { room } = mirrorOf(board);
  // Someone else's client id (the cluster's own writer).
  const g = guestOf(room);
  const theirs = [...board.store.clients.keys()][0];
  g.clientID = theirs;
  const forged = editAs(g, () => cardMapOf(g).get('docMeta').set('mode', 'screenplay'));
  assert.equal(validateGuestUpdate(room, forged, ctxFor(g, { claims: new Set() })).reason, 'foreign_client');
  // A gap: the second half of a guest's edits without the first.
  const g2 = guestOf(room);
  const t = () => cardMapOf(g2).get('docPageContent').get('p1').get(0).get(0);
  editAs(g2, () => t().insert(0, 'one '));
  const sv = Y.encodeStateVector(g2);
  editAs(g2, () => t().insert(0, 'two '));
  const tail = Y.encodeStateAsUpdate(g2, sv);
  assert.equal(validateGuestUpdate(room, tail, ctxFor(g2)).reason, 'gap');
  // Writing into another card through ids the mirror only has as GC: build the
  // edit on a copy of the CLUSTER, then hand it to the mirror.
  const spy = new Y.Doc();
  Y.applyUpdate(spy, Y.encodeStateAsUpdate(board));
  const crafted = editAs(spy, () => spy.getMap('cards').get('note-1').set('html', 'OWNED'));
  const verdict = validateGuestUpdate(room, crafted, ctxFor(spy));
  assert.equal(verdict.ok, false);
  assert.ok(['gc_ref', 'missing_ref', 'outside_doc'].includes(verdict.reason), verdict.reason);
  // Too big.
  const g3 = guestOf(room);
  const big = editAs(g3, () => cardMapOf(g3).get('docPageContent').get('p1').get(0).get(0).insert(0, 'x'.repeat(5000)));
  assert.equal(validateGuestUpdate(room, big, ctxFor(g3, { maxBytes: 1000 })).reason, 'too_large');
});

test('a guest’s reconnect resends what the mirror already has: still theirs, still fine', () => {
  const board = makeBoard();
  const { room } = mirrorOf(board);
  const g = guestOf(room);
  const t = () => cardMapOf(g).get('docPageContent').get('p1').get(0).get(0);
  const u1 = editAs(g, () => t().insert(0, 'first '));
  assert.equal(validateGuestUpdate(room, u1, ctxFor(g)).ok, true);
  Y.applyUpdate(room, u1);
  // Offline edits, then the whole state again on reconnect (sync step 2).
  editAs(g, () => t().insert(0, 'second '));
  const step2 = Y.encodeStateAsUpdate(g, Y.encodeStateVector(new Y.Doc()));
  const v = validateGuestUpdate(room, Y.diffUpdate(step2, Y.encodeStateVector(room)), ctxFor(g));
  assert.equal(v.ok, true, v.reason);
});

test('image keys in a stretch of bytes', () => {
  const board = makeBoard();
  const keys = r2KeysIn(mirrorOf(board).update);
  assert.ok(keys.has(KEY));
});

// Seeded random play: members on the cluster, guests on the mirror, every
// edit forwarded both ways as DocParty does. Everyone converges, every guest
// frame passes the validator, nothing waits on a missing struct, and nothing
// of the rest of the cluster ever crosses.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('random play: members and guests converge, the mirror never learns the cluster', () => {
  // DOC_BRIDGE_SEEDS=300 for a longer run.
  const seeds = Number(process.env.DOC_BRIDGE_SEEDS) || 20;
  for (let seed = 1; seed <= seeds; seed++) {
    const rand = rng(seed);
    const pick = (n) => Math.floor(rand() * n);
    const board = makeBoard();
    const { room, sent } = mirrorOf(board);
    const log = wire(board, room, { sent });
    const members = [member(board), member(board)];
    const guests = [guestOf(room), guestOf(room)];
    const claims = new Map(guests.map((g) => [g, new Set([g.clientID])]));
    const textIn = (d) => {
      const frag = cardMapOf(d).get('docPageContent').get('p1');
      const para = frag.toArray().find((n) => n instanceof Y.XmlElement && n.nodeName === 'paragraph');
      return para ? para.get(0) : null;
    };
    const syncGuest = (g) => Y.applyUpdate(g, Y.encodeStateAsUpdate(room, Y.encodeStateVector(g)), 'from-room');
    for (let step = 0; step < 60; step++) {
      const asGuest = rand() < 0.45;
      if (asGuest) {
        const g = guests[pick(guests.length)];
        syncGuest(g);
        const t = textIn(g);
        const u = editAs(g, () => {
          const r = pick(4);
          if (r === 0 && t) t.insert(pick(t.length + 1), `g${step}`);
          else if (r === 1 && t && t.length > 2) t.delete(pick(t.length - 1), 1 + pick(2));
          else if (r === 2) cardMapOf(g).get('docPages').push([{ id: `pg${seed}-${step}`, name: `P${step}`, parent_id: null, order: step }]);
          else cardMapOf(g).get('docComments').set(`gc${step}`, { author: 'Guest', authorId: 'u-guest', body: `b${step}`, replies: [] });
        });
        if (!u) continue;
        const v = validateGuestUpdate(room, u, ctxFor(g, { claims: claims.get(g) }));
        assert.equal(v.ok, true, `seed ${seed} step ${step}: ${v.reason}`);
        Y.applyUpdate(room, u, 'guest');
        Y.applyUpdate(board, u, 'from-room');
      } else {
        const m = members[pick(members.length)];
        const t = textIn(m);
        const r = pick(5);
        if (r === 0) m.getMap('cards').get('note-1').set('html', `SECRET_RANDOM_${step}`);
        else if (r === 1 && t) t.insert(pick(t.length + 1), `m${step}`);
        else if (r === 2 && t && t.length > 2) t.delete(pick(t.length - 1), 1 + pick(3));
        else if (r === 3) cardMapOf(m).get('docMeta').set('pageless', rand() < 0.5);
        else m.getMap('links').set(`l${step}`, { targets: [`SECRET_LINK_${step}`] });
      }
    }
    for (const g of guests) syncGuest(g);
    const want = docJson(board);
    assert.deepEqual(docJson(room), want, `seed ${seed}: the mirror`);
    for (const g of guests) assert.deepEqual(docJson(g), want, `seed ${seed}: a guest`);
    for (const m of members) assert.deepEqual(docJson(m), want, `seed ${seed}: a member`);
    assert.equal(room.store.pendingStructs, null, `seed ${seed}: nothing pending in the mirror`);
    assert.equal(board.store.pendingStructs, null, `seed ${seed}: nothing pending in the cluster`);
    for (const u of log) {
      const s = stringsIn(u);
      assert.ok(!s.includes('SECRET_'), `seed ${seed}: a forwarded update carried the cluster`);
    }
    assert.equal(room.getMap('links').size, 0);
  }
});

test('a guest’s typed-and-deleted text passes, and its GC runs are its own', () => {
  const board = makeBoard();
  const { room } = mirrorOf(board);
  const g = guestOf(room);
  const t = () => cardMapOf(g).get('docPageContent').get('p1').get(0).get(0);
  editAs(g, () => t().insert(0, 'typo '));
  editAs(g, () => t().delete(0, 5));
  // What the guest sends on connect: its whole diff, deletions included.
  const step2 = Y.encodeStateAsUpdate(g, Y.encodeStateVector(room));
  const v = validateGuestUpdate(room, step2, ctxFor(g));
  assert.equal(v.ok, true, v.reason);
  Y.applyUpdate(room, step2);
  assert.equal(pageText(room), pageText(g));
});

test('the view mirror’s forwarder never carries comment threads', () => {
  const board = makeBoard();
  const { room, sent } = mirrorOf(board, 'view');
  const log = wire(board, room, { variant: 'view', sent });
  const m = member(board);
  cardMapOf(m).get('docComments').set('t-new', { body: 'SECRET_THREAD', authorId: 'u-a', author: 'A', replies: [] });
  assert.equal(log.length, 0, 'a comment alone is not the view mirror’s business');
  cardMapOf(m).get('docPageContent').get('p1').get(0).get(0).insert(0, 'Seen ');
  assert.equal(log.length, 1);
  for (const u of log) assert.ok(!stringsIn(u).includes('SECRET_THREAD'));
  assert.equal(cardMapOf(room).get('docComments'), undefined);
  assert.match(pageText(room), /^<paragraph>Seen /);
});

test('deleting the card on the cluster reaches the mirror', () => {
  const board = makeBoard();
  const { room, sent } = mirrorOf(board);
  wire(board, room, { sent });
  board.getMap('cards').delete(CARD);
  assert.equal(room.getMap('cards').get(CARD), undefined, 'the mirror loses it too');
  assert.equal(extractDocSubtree(board, CARD), null, 'and a new mirror has nothing to show');
});

test('guest limits: a sliding window, and the numbers the docs quote', async () => {
  const L = await import('./docRoomLimits.js');
  const w = L.rateWindow(3, 1000);
  assert.equal(w.hit(0), true);
  assert.equal(w.hit(10), true);
  assert.equal(w.hit(20), true);
  assert.equal(w.hit(30), false, 'the fourth in a second');
  assert.equal(w.hit(1001), true, 'the first one left the window');
  assert.ok(L.DOC_ROOM_FRAME_MAX_BYTES >= 64 * 1024);
  assert.ok(L.DOC_ROOM_SILENT_CLOSE_MS === 5 * 60 * 1000, 'the board room’s silent close');
  assert.ok(L.DOC_ROOM_GUEST_DOC_MAX_BYTES > L.DOC_ROOM_FRAME_MAX_BYTES);
});
