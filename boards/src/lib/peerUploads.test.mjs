// Upload presence: what a tab publishes (encodeUploading, the throttled
// publisher), how peers' states are read, and what a card without its file says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UNFINISHED_AFTER_MS, encodeUploading, createUploadPublisher, readPeerUploads,
  peerCardView, createPeerUploadsStore,
} from './peerUploads.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  let seq = 0;
  const due = new Map();
  return {
    now: () => t,
    set(fn, ms) { const id = ++seq; due.set(id, { at: t + ms, fn }); return id; },
    clear(id) { due.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [id, d] of due) if (d.at <= end && (!next || d.at < next[1].at)) next = [id, d];
        if (!next) break;
        due.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
    timers: () => due.size,
  };
}

class FakeAwareness {
  constructor(clientID = 1) {
    this.clientID = clientID;
    this.states = new Map();
    this.handlers = new Set();
    this.writes = [];
  }
  setLocalStateField(k, v) { this.writes.push([k, v]); this.states.set(this.clientID, { ...(this.states.get(this.clientID) || {}), [k]: v }); }
  getStates() { return this.states; }
  on(ev, fn) { if (ev === 'change') this.handlers.add(fn); }
  off(ev, fn) { if (ev === 'change') this.handlers.delete(fn); }
  emit() { for (const fn of [...this.handlers]) fn(); }
  setPeer(id, state) { this.states.set(id, state); this.emit(); }
  dropPeer(id) { this.states.delete(id); this.emit(); }
  last() { return this.writes.at(-1)?.[1]; }
}

const B = 'board-1';
const item = (cardId, state, fraction = 0, boardId = B) => ({ boardId, cardId, state, fraction });

// ── encodeUploading ─────────────────────────────────────────────────────────

test('encodeUploading maps each state to its code', () => {
  const v = encodeUploading(B, [
    item('a', 'waiting'), item('b', 'failed'), item('c', 'finishing'),
    item('d', 'running', 0.426), item('e', 'running', 0.999), item('f', 'running', 1),
  ]);
  assert.deepEqual(v, { boardId: B, cards: { a: -1, b: -2, c: -3, d: 42, e: 99, f: 99 } });
});

test('encodeUploading leaves out other boards, items without a card and done items', () => {
  assert.equal(encodeUploading(B, [item('a', 'running', 0.5, 'other'), item(null, 'running', 0.5), item('b', 'done')]), null);
  assert.equal(encodeUploading(B, []), null);
  assert.equal(encodeUploading(B, null), null);
  assert.deepEqual(encodeUploading(B, [item('a', 'running', 0.1, 'other'), item('x', 'waiting')]), { boardId: B, cards: { x: -1 } });
});

// ── the publisher ───────────────────────────────────────────────────────────

function setup() {
  const clock = fakeClock();
  const aw = new FakeAwareness();
  const state = { aw };
  const pub = createUploadPublisher({ getAwareness: () => state.aw, boardId: B, clock });
  return { clock, aw, state, pub };
}

test('the first publish goes out at once', () => {
  const { aw, pub } = setup();
  pub.push([item('a', 'waiting')]);
  assert.deepEqual(aw.writes, [['uploading', { boardId: B, cards: { a: -1 } }]]);
});

test('state changes publish at most once a second, with a trailing publish', () => {
  const { clock, aw, pub } = setup();
  pub.push([item('a', 'waiting')]);
  clock.advance(300);
  pub.push([item('a', 'waiting'), item('b', 'waiting')]);
  clock.advance(200);
  pub.push([item('a', 'running', 0), item('b', 'waiting')]);
  assert.equal(aw.writes.length, 1);
  clock.advance(499);
  assert.equal(aw.writes.length, 1);
  clock.advance(1);
  assert.equal(aw.writes.length, 2);
  assert.deepEqual(aw.last(), { boardId: B, cards: { a: 0, b: -1 } }, 'the last value goes out');
});

test('percent-only changes wait for 5 points or 4 s', () => {
  const { clock, aw, pub } = setup();
  pub.push([item('a', 'running', 0.1)]);
  clock.advance(1500);
  pub.push([item('a', 'running', 0.13)]);
  assert.equal(aw.writes.length, 1, '3 points: not yet');
  pub.push([item('a', 'running', 0.15)]);
  assert.equal(aw.writes.length, 2, '5 points: now');
  assert.equal(aw.last().cards.a, 15);
  clock.advance(1200);
  pub.push([item('a', 'running', 0.16)]);
  assert.equal(aw.writes.length, 2);
  clock.advance(2799);
  assert.equal(aw.writes.length, 2);
  clock.advance(1);
  assert.equal(aw.writes.length, 3, '4 s after the last publish, the last value goes out');
  assert.equal(aw.last().cards.a, 16);
});

test('a big move inside the second still waits for the second', () => {
  const { clock, aw, pub } = setup();
  pub.push([item('a', 'running', 0.1)]);
  clock.advance(400);
  pub.push([item('a', 'running', 0.5)]);
  assert.equal(aw.writes.length, 1);
  clock.advance(600);
  assert.equal(aw.writes.length, 2);
});

test('identical values are skipped', () => {
  const { clock, aw, pub } = setup();
  pub.push([item('a', 'running', 0.101)]);
  pub.push([item('a', 'running', 0.109)]);
  clock.advance(10_000);
  pub.push([item('a', 'running', 0.105)]);
  clock.advance(10_000);
  assert.equal(aw.writes.length, 1);
  assert.equal(clock.timers(), 0);
});

test('an awareness that is not ready yet is tried again every 500 ms', () => {
  const { clock, aw, state, pub } = setup();
  state.aw = null;
  pub.push([item('a', 'waiting')]);
  clock.advance(1400);
  assert.equal(aw.writes.length, 0);
  state.aw = aw;
  clock.advance(100);
  assert.deepEqual(aw.last(), { boardId: B, cards: { a: -1 } });
});

test('a replaced awareness gets the last value at once', () => {
  const { clock, aw, state, pub } = setup();
  pub.push([item('a', 'running', 0.3)]);
  clock.advance(100);
  const aw2 = new FakeAwareness(2);
  state.aw = aw2;
  pub.push([item('a', 'running', 0.31)]);
  assert.equal(aw.writes.length, 1);
  assert.deepEqual(aw2.writes, [['uploading', { boardId: B, cards: { a: 31 } }]]);
});

test('dispose sends null once', () => {
  const { clock, aw, pub } = setup();
  pub.push([item('a', 'waiting')]);
  clock.advance(10);
  pub.dispose();
  pub.dispose();
  assert.deepEqual(aw.writes.map((w) => w[1]), [{ boardId: B, cards: { a: -1 } }, null]);
  assert.equal(clock.timers(), 0);
  pub.push([item('b', 'waiting')]);
  assert.equal(aw.writes.length, 2, 'nothing after dispose');
});

test('dispose sends nothing when the last published value was null', () => {
  const { clock, aw, pub } = setup();
  pub.push([item('a', 'waiting')]);
  clock.advance(1000);
  pub.push([]);
  pub.dispose();
  assert.deepEqual(aw.writes.map((w) => w[1]), [{ boardId: B, cards: { a: -1 } }, null]);
});

// ── readPeerUploads ─────────────────────────────────────────────────────────

const user = (id, name = id, color = '#abc') => ({ id, name, color });

test('readPeerUploads skips this client, reads cards of this board, marks legacy', () => {
  const states = new Map([
    [1, { user: user('me'), uploading: { boardId: B, cards: { mine: 5 } } }],
    [2, { user: user('lena', 'Lena', '#f00'), uploading: { boardId: B, cards: { c1: 42, c2: -1 } } }],
    [3, { user: user('old', 'Old', '#00f') }],
    [4, { user: user('away', 'Away'), uploading: { boardId: 'other', cards: { c9: 10 } } }],
    [5, { user: user('quiet'), uploading: null }],
    [6, { cursor: 1 }],
  ]);
  const r = readPeerUploads(states, { boardId: B, selfClientId: 1 });
  assert.deepEqual([...r.byCard.keys()].sort(), ['c1', 'c2']);
  assert.deepEqual(r.byCard.get('c1'), { code: 42, userId: 'lena', name: 'Lena', color: '#f00', clientId: 2 });
  assert.equal(r.users.get('old').legacy, true);
  assert.equal(r.users.get('lena').legacy, false);
  assert.equal(r.users.get('away').legacy, false);
  assert.equal(r.users.get('quiet').legacy, false);
  assert.equal(r.users.has('me'), false);
  assert.equal(r.users.size, 4);
});

test('a person with one old tab and one new tab is not legacy', () => {
  const states = new Map([[2, { user: user('p') }], [3, { user: user('p'), uploading: null }]]);
  assert.equal(readPeerUploads(states, { boardId: B, selfClientId: 1 }).users.get('p').legacy, false);
});

// ── peerCardView ────────────────────────────────────────────────────────────

const NOW = 10_000_000;
const view = (over = {}) => peerCardView({
  card: { id: 'c1', createdBy: 'lena', createdAt: new Date(NOW - 10 * UNFINISHED_AFTER_MS).toISOString() },
  me: 'me',
  peers: readPeerUploads(new Map(), { boardId: B }),
  lastListedAt: null, firstSeen: null, liveSince: NOW - 60_000, now: NOW, ...over,
});
const peersOf = (states) => readPeerUploads(new Map(states), { boardId: B, selfClientId: 1 });

test('peerCardView: a listed card is a mate, mine when it is my other tab', () => {
  const peers = peersOf([[2, { user: user('lena', 'Lena', '#f00'), uploading: { boardId: B, cards: { c1: 42 } } }]]);
  assert.deepEqual(view({ peers }), { kind: 'mate', code: 42, name: 'Lena', color: '#f00', mine: false });
  const mine = peersOf([[2, { user: user('me', 'Me', '#0f0'), uploading: { boardId: B, cards: { c1: -1 } } }]]);
  assert.deepEqual(view({ peers: mine }), { kind: 'mate', code: -1, name: 'Me', color: '#0f0', mine: true });
});

test('peerCardView: a creator on an older build is legacy', () => {
  const peers = peersOf([[2, { user: user('lena', 'Lena', '#f00') }]]);
  assert.deepEqual(view({ peers }), { kind: 'legacy', name: 'Lena', color: '#f00' });
  assert.equal(view({ peers: peersOf([[2, { user: user('other') }]]) }).kind, 'gone', 'only the creator counts');
});

test('peerCardView: quiet until the socket has been live for 5 s', () => {
  assert.equal(view({ liveSince: null }).kind, 'quiet');
  assert.equal(view({ liveSince: NOW - 4999 }).kind, 'quiet');
  assert.equal(view({ liveSince: NOW - 5000 }).kind, 'gone');
});

test('peerCardView: quiet inside 2 minutes of the last listing, creation or first sighting', () => {
  assert.equal(view({ lastListedAt: NOW - (UNFINISHED_AFTER_MS - 1) }).kind, 'quiet');
  assert.equal(view({ lastListedAt: NOW - UNFINISHED_AFTER_MS }).kind, 'gone');
  const fresh = { id: 'c1', createdBy: 'lena', createdAt: new Date(NOW - 1000).toISOString() };
  assert.equal(view({ card: fresh }).kind, 'quiet');
  const undated = { id: 'c1', createdBy: 'lena' };
  assert.equal(view({ card: undated, firstSeen: NOW - 1000 }).kind, 'quiet');
  assert.equal(view({ card: undated, firstSeen: NOW - UNFINISHED_AFTER_MS }).kind, 'gone');
  assert.equal(view({ card: undated }).kind, 'quiet', 'nothing known: just seen');
});

const awayOf = (id, boards, name = 'Lena') => new Map([[id, { name, color: '#f00', boards: new Set(boards) }]]);

test('peerCardView: away beats gone after 2 minutes, and listed beats away', () => {
  const away = awayOf('lena', [B]);
  assert.deepEqual(view({ away, boardId: B }), { kind: 'away', name: 'Lena', color: '#f00', mine: false });
  const peers = peersOf([[2, { user: user('lena', 'Lena', '#f00'), uploading: { boardId: B, cards: { c1: 42 } } }]]);
  assert.equal(view({ away, boardId: B, peers }).kind, 'mate');
});

test('peerCardView: away for another cluster, or another person, does not count', () => {
  assert.equal(view({ away: awayOf('lena', ['other']), boardId: B }).kind, 'gone');
  assert.equal(view({ away: awayOf('someone', [B]), boardId: B }).kind, 'gone');
});

test('peerCardView: away says mine for my own other tab', () => {
  const mine = { id: 'c1', createdBy: 'me', createdAt: new Date(NOW - 10 * UNFINISHED_AFTER_MS).toISOString() };
  assert.deepEqual(view({ card: mine, away: awayOf('me', [B], 'Me'), boardId: B }), { kind: 'away', name: 'Me', color: '#f00', mine: true });
});

test('peerCardView: gone says whether it is mine', () => {
  assert.deepEqual(view(), { kind: 'gone', mine: false });
  const mine = { id: 'c1', createdBy: 'me', createdAt: new Date(NOW - 10 * UNFINISHED_AFTER_MS).toISOString() };
  assert.deepEqual(view({ card: mine }), { kind: 'gone', mine: true });
});

// ── the store ───────────────────────────────────────────────────────────────

function storeSetup({ live = true } = {}) {
  const clock = fakeClock();
  const aw = new FakeAwareness(1);
  const room = { wsconnected: live, synced: live };
  const state = { aw };
  const store = createPeerUploadsStore({ getAwareness: () => state.aw, getRoom: () => room, boardId: B, me: 'me', clock });
  let n = 0;
  const off = store.subscribe(() => { n++; });
  return { clock, aw, room, state, store, off, count: () => n };
}
const card = { id: 'c1', createdBy: 'lena', createdAt: new Date(1_000_000 - 10 * UNFINISHED_AFTER_MS).toISOString() };

test('the store notifies only when a view changes', () => {
  const s = storeSetup();
  s.clock.advance(6000);
  const base = s.count();
  s.aw.emit();
  assert.equal(s.count(), base, 'a change event that changes nothing');
  s.aw.setPeer(2, { user: user('lena', 'Lena', '#f00'), uploading: { boardId: B, cards: { c1: 10 } } });
  assert.equal(s.count(), base + 1);
  assert.equal(s.store.viewKey(card), 'm|10|Lena|#f00|0');
  s.aw.setPeer(2, { user: user('lena', 'Lena', '#f00'), uploading: { boardId: B, cards: { c1: 10 } } });
  assert.equal(s.count(), base + 1, 'the same state again');
  s.aw.setPeer(2, { user: user('lena', 'Lena', '#f00'), uploading: { boardId: B, cards: { c1: -3 } } });
  assert.equal(s.count(), base + 2);
  assert.equal(s.store.view(card).code, -3);
});

test('the store finds an awareness that appears late and one that is replaced', () => {
  const clock = fakeClock();
  const state = { aw: null };
  const room = { wsconnected: true, synced: true };
  const store = createPeerUploadsStore({ getAwareness: () => state.aw, getRoom: () => room, boardId: B, me: 'me', clock });
  let n = 0;
  store.subscribe(() => { n++; });
  const a1 = new FakeAwareness(1);
  a1.states.set(2, { user: user('lena', 'Lena'), uploading: { boardId: B, cards: { c1: 5 } } });
  state.aw = a1;
  clock.advance(500);
  assert.equal(store.view(card).code, 5);
  const a2 = new FakeAwareness(9);
  state.aw = a2;
  clock.advance(500);
  assert.notEqual(store.view(card).kind, 'mate');
  assert.equal(a1.handlers.size, 0, 'let go of the old one');
  assert.equal(a2.handlers.size, 1);
  assert.ok(n >= 2);
});

test('the store ticks every 10 s while subscribed so the 2-minute rule can flip', () => {
  const s = storeSetup();
  s.clock.advance(6000);
  const fresh = { id: 'c2', createdBy: 'lena', createdAt: new Date(s.clock.now()).toISOString() };
  assert.equal(s.store.viewKey(fresh), 'q');
  const base = s.count();
  s.clock.advance(10_000);
  assert.equal(s.count(), base + 1);
  s.clock.advance(UNFINISHED_AFTER_MS);
  assert.equal(s.store.viewKey(fresh), 'g|0');
  assert.ok(s.count() > base + 1);
  s.off();
  const after = s.count();
  s.clock.advance(60_000);
  assert.equal(s.count(), after, 'no ticks without subscribers');
});

test('the store is quiet until live for 5 s, and follows the room', () => {
  const s = storeSetup({ live: false });
  assert.equal(s.store.viewKey(card), 'q');
  s.clock.advance(10_000);
  assert.equal(s.store.viewKey(card), 'q', 'never live');
  s.room.wsconnected = true;
  s.room.synced = true;
  s.clock.advance(1000);
  assert.equal(s.store.viewKey(card), 'q', 'live a moment');
  s.clock.advance(5000);
  assert.equal(s.store.viewKey(card), 'g|0');
  s.room.wsconnected = false;
  s.aw.emit();
  assert.equal(s.store.viewKey(card), 'q', 'our own socket closed');
});

test('the store remembers when a card was last listed', () => {
  const s = storeSetup();
  s.clock.advance(6000);
  s.aw.setPeer(2, { user: user('lena'), uploading: { boardId: B, cards: { c1: 10 } } });
  s.aw.dropPeer(2);
  s.clock.advance(UNFINISHED_AFTER_MS - 1000);
  assert.equal(s.store.viewKey(card), 'q');
  s.clock.advance(1000);
  assert.equal(s.store.viewKey(card), 'g|0');
});

test('setAway notifies only when a view for this cluster changes', () => {
  const s = storeSetup();
  s.clock.advance(6000);
  const base = s.count();
  assert.equal(s.store.viewKey(card), 'g|0');
  s.store.setAway(awayOf('lena', ['other']));
  assert.equal(s.count(), base, 'another cluster');
  s.store.setAway(awayOf('lena', [B]));
  assert.equal(s.count(), base + 1);
  assert.equal(s.store.viewKey(card), 'a|Lena|#f00|0');
  s.store.setAway(awayOf('lena', [B]));
  assert.equal(s.count(), base + 1, 'the same map again');
  s.store.setAway(null);
  assert.equal(s.count(), base + 2);
  assert.equal(s.store.viewKey(card), 'g|0');
});

test('dispose stops everything', () => {
  const s = storeSetup();
  s.store.dispose();
  assert.equal(s.aw.handlers.size, 0);
  assert.equal(s.clock.timers(), 0);
});
