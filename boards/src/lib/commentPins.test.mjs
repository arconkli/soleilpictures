// Canvas comment pins: where they sit, when they gather, what is unread, what
// is "for you", where the open card goes, and the personal switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canvasThreads, isShelved, threadUnread, threadForMe, threadAnchor, layoutPins, threadsBounds,
  readShowComments, writeShowComments, createCommentUi,
  viewedStamp, threadNewestMs, mergeViews, inCommentSurface, COMMENT_SURFACE_SELECTOR,
  PIN_STEP, PIN_INSET, PIN_SIZE,
} from './commentPins.js';
import { anchorScreenRect, placeBeside, pinScreenRect, tabForKey } from './commentCardPlace.js';

const ME = 'me';
const iso = (min) => new Date(Date.UTC(2026, 10, 15, 12, 0, 0) - min * 60000).toISOString();
const row = (o) => ({ board_id: 'b', anchor_kind: 'card', anchor_id: null, reply_to: null, resolved: false, hidden: false, ...o });
const BOXES = { a: { x: 100, y: 100, w: 300, h: 200 }, b: { x: 1000, y: 100, w: 200, h: 200 } };
const res = { cardBox: (id) => BOXES[id] || null, groupBox: (id) => (id === 'g' ? { x: 0, y: 500, w: 400, h: 300 } : null) };

test('a doc range comment is not a canvas conversation', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'one', created_at: iso(10) }),
    row({ id: '2', anchor_kind: 'doc_range', anchor_id: 'doc', author: 'x', body: 'in the doc', created_at: iso(9) }),
  ]);
  assert.deepEqual(ts.map((t) => t.id), ['1']);
});

test('resolved and hidden both count as put away', () => {
  const [a, b, c] = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(3), resolved: true }),
    row({ id: '2', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(2), hidden: true }),
    row({ id: '3', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(1) }),
  ]);
  assert.equal(isShelved(a), true);
  assert.equal(isShelved(b), true);
  assert.equal(isShelved(c), false);
});

test('unread: someone else wrote since I last looked', () => {
  const [t] = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: ME, body: 'mine', created_at: iso(60) }),
    row({ id: '2', anchor_id: 'a', author: 'x', body: 'theirs', created_at: iso(10), reply_to: '1' }),
  ]);
  assert.equal(threadUnread(t, ME, null), true, 'never opened, a reply by someone else');
  assert.equal(threadUnread(t, ME, iso(20)), true, 'looked before the reply');
  assert.equal(threadUnread(t, ME, iso(5)), false, 'looked after it');
  const [own] = canvasThreads([row({ id: '3', anchor_id: 'a', author: ME, body: 'mine', created_at: iso(60) })]);
  assert.equal(threadUnread(own, ME, null), false, 'only my own words');
  const [theirs] = canvasThreads([row({ id: '4', anchor_id: 'a', author: 'x', body: 'new', created_at: iso(60) })]);
  assert.equal(threadUnread(theirs, ME, null), true, 'someone else started it and I never opened it');
});

test('for me: mentioned, or someone wrote after me', () => {
  const people = { [ME]: { name: 'Me' }, x: { name: 'Xan' } };
  const [mention] = canvasThreads([row({ id: '1', anchor_id: 'a', author: 'x', body: '@Me look', mentions: [ME], created_at: iso(5) })], people);
  assert.equal(threadForMe(mention, ME), true);
  const [after] = canvasThreads([
    row({ id: '2', anchor_id: 'a', author: ME, body: 'mine', created_at: iso(9) }),
    row({ id: '3', anchor_id: 'a', author: 'x', body: 'answer', created_at: iso(4), reply_to: '2' }),
  ], people);
  assert.equal(threadForMe(after, ME), true);
  const [last] = canvasThreads([
    row({ id: '4', anchor_id: 'a', author: 'x', body: 'theirs', created_at: iso(9) }),
    row({ id: '5', anchor_id: 'a', author: ME, body: 'my answer', created_at: iso(4), reply_to: '4' }),
  ], people);
  assert.equal(threadForMe(last, ME), false, 'I had the last word');
  const [other] = canvasThreads([row({ id: '6', anchor_id: 'a', author: 'x', body: 'not mine', created_at: iso(9) })], people);
  assert.equal(threadForMe(other, ME), false);
  const [done] = canvasThreads([row({ id: '7', anchor_id: 'a', author: 'x', body: '@Me', mentions: [ME], resolved: true, created_at: iso(5) })], people);
  assert.equal(threadForMe(done, ME), false, 'resolved is not waiting on me');
});

test('a pin sits on the top-right corner of its card; a point pin on its point', () => {
  const [card, point, board, gone, group] = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_kind: 'point', anchor_x: 640, anchor_y: 480, author: 'x', body: 'x', created_at: iso(8) }),
    row({ id: '3', anchor_kind: 'board', author: 'x', body: 'x', created_at: iso(7) }),
    row({ id: '4', anchor_id: 'deleted-card', author: 'x', body: 'x', created_at: iso(6) }),
    row({ id: '5', anchor_kind: 'group', anchor_id: 'g', author: 'x', body: 'x', created_at: iso(5) }),
  ]);
  assert.deepEqual(threadAnchor(card, res), { kind: 'card', key: 'card:a', id: 'a', box: BOXES.a, wx: 400, wy: 100, dx: -PIN_INSET, dy: PIN_INSET, ux: -1, uy: 0 });
  const p = threadAnchor(point, res);
  assert.deepEqual([p.kind, p.wx, p.wy, p.dx, p.dy], ['point', 640, 480, 0, 0]);
  assert.equal(threadAnchor(board, res).kind, 'board');
  assert.equal(threadAnchor(gone, res), null, 'its card is gone');
  const g = threadAnchor(group, res);
  assert.deepEqual([g.kind, g.wx, g.wy], ['group', 400, 500]);
});

test('several conversations on one card line up leftward, oldest rightmost', () => {
  const ts = canvasThreads([
    row({ id: 'new', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(1) }),
    row({ id: 'old', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(50) }),
    row({ id: 'mid', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(20) }),
  ]);
  const pins = layoutPins(ts, res, 1);
  assert.deepEqual(pins.map((p) => [p.type, p.key, p.dx]), [
    ['pin', 'old', -PIN_INSET],
    ['pin', 'mid', -PIN_INSET - PIN_STEP],
    ['pin', 'new', -PIN_INSET - 2 * PIN_STEP],
  ]);
  assert.ok(pins.every((p) => p.wx === 400 && p.wy === 100 && p.dy === PIN_INSET));
});

test('a cluster-level conversation and one on a missing card draw no pin', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_kind: 'board', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_id: 'nope', author: 'x', body: 'x', created_at: iso(8) }),
  ]);
  assert.deepEqual(layoutPins(ts, res, 1), []);
});

test('pins closer than 40px on screen gather into one count', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_id: 'b', author: 'x', body: 'x', created_at: iso(8) }),
  ]).map((t) => ({ ...t, unread: t.id === '2' }));
  // tips 800 world px apart: apart at 100%, 32px apart at 4%
  assert.deepEqual(layoutPins(ts, res, 1).map((p) => p.type), ['pin', 'pin']);
  const [n] = layoutPins(ts, res, 0.04);
  assert.equal(n.type, 'count');
  assert.equal(n.threads.length, 2);
  assert.equal(n.unread, true, 'one inside is unread');
  assert.equal(n.key, 'n:1');
  assert.equal(n.wx, 800);
  // just out of reach: 800 × 0.06 = 48px
  assert.deepEqual(layoutPins(ts, res, 0.06).map((p) => p.type), ['pin', 'pin']);
});

test('a card too narrow on screen for its row of pins shows their count', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(8) }),
    row({ id: '3', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(7) }),
  ]);
  // row needs 2 × 26 + 10 = 62px; the card is 300 world px wide
  assert.equal(layoutPins(ts, res, 0.25).length, 3, '75px on screen: the row fits');
  const out = layoutPins(ts, res, 0.2);
  assert.deepEqual(out.map((p) => [p.type, p.threads.length]), [['count', 3]], '60px on screen: one count');
  assert.equal(out[0].dx, -PIN_INSET);
});

test('gathering chains: A near B near C is one count', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_kind: 'point', anchor_x: 0, anchor_y: 0, author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_kind: 'point', anchor_x: 30, anchor_y: 0, author: 'x', body: 'x', created_at: iso(8) }),
    row({ id: '3', anchor_kind: 'point', anchor_x: 60, anchor_y: 0, author: 'x', body: 'x', created_at: iso(7) }),
    row({ id: '4', anchor_kind: 'point', anchor_x: 400, anchor_y: 0, author: 'x', body: 'x', created_at: iso(6) }),
  ]);
  const out = layoutPins(ts, res, 1);
  assert.deepEqual(out.map((p) => p.type).sort(), ['count', 'pin']);
  assert.equal(out.find((p) => p.type === 'count').threads.length, 3);
});

test('the box to zoom to holds every card and point', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_kind: 'point', anchor_x: 900, anchor_y: 700, author: 'x', body: 'x', created_at: iso(8) }),
    row({ id: '3', anchor_kind: 'board', author: 'x', body: 'x', created_at: iso(7) }),
  ]);
  assert.deepEqual(threadsBounds(ts, res), { x: 100, y: 100, w: 800, h: 600 });
  assert.equal(threadsBounds([ts[2]], res), null);
});

test('the open card stands beside its card: right, else left, always inside', () => {
  const anchor = { kind: 'card', box: { x: 100, y: 50, w: 200, h: 100 } };
  const rect = anchorScreenRect(anchor, { x: 40, y: 60 }, 2);
  assert.deepEqual(rect, { left: 240, top: 160, right: 640, bottom: 360, pin: false });
  const view = { w: 320, h: 300, vw: 1200, vh: 760 };
  assert.deepEqual(placeBeside({ rect, ...view }), { left: 654, top: 160, side: 'right' });
  // no room on the right
  const far = { left: 700, top: 64, right: 970, bottom: 254 };
  assert.deepEqual(placeBeside({ rect: far, ...view }), { left: 366, top: 64, side: 'left' });
  // neither side: stays 12px inside the view
  const wide = { left: 100, top: 700, right: 1100, bottom: 900 };
  assert.deepEqual(placeBeside({ rect: wide, ...view }), { left: 868, top: 448, side: 'right' });
  // above the view
  assert.equal(placeBeside({ rect: { left: 0, top: -400, right: 100, bottom: -300 }, ...view }).top, 12);
  // a point: beside its pin
  const pin = anchorScreenRect({ kind: 'point', box: null, wx: 100, wy: 100, dx: 0, dy: 0 }, { x: 0, y: 0 }, 1);
  assert.deepEqual(pin, { left: 100, top: 100 - PIN_SIZE, right: 100 + PIN_SIZE, bottom: 100, pin: true });
  // cluster-level: nowhere on the canvas
  assert.equal(anchorScreenRect({ kind: 'board' }, { x: 0, y: 0 }, 1), null);
  assert.deepEqual(placeBeside({ rect: null, ...view, fallback: { left: 14, top: 54 } }), { left: 14, top: 54, side: 'free' });
});

test('the open card never covers its own pin: other side, then below, then above', () => {
  const view = { w: 320, h: 300, vw: 1000, vh: 700 };
  // a wide card: right has no room, left has none either, so the card is
  // clamped to the right edge, over the pin at the card's top-right corner
  const rect = { left: 60, top: 100, right: 960, bottom: 300, pin: false };
  const pin = { left: 950, top: 80, right: 980, bottom: 110 };
  assert.deepEqual(placeBeside({ rect, ...view }), { left: 668, top: 100, side: 'right' }, 'without a pin to mind: as before');
  // the other side (clamped to the left edge) is clear of the pin
  assert.deepEqual(placeBeside({ rect, ...view, avoid: pin }), { left: 12, top: 100, side: 'left' });
  // a pin that both sides would cover: below the card
  const narrow = { w: 320, h: 300, vw: 340, vh: 900 };
  const r2 = { left: 20, top: 100, right: 320, bottom: 260, pin: false };
  const p2 = { left: 150, top: 80, right: 180, bottom: 110 };
  assert.deepEqual(placeBeside({ rect: r2, ...narrow, avoid: p2 }), { left: 12, top: 274, side: 'below' });
  // no room below either: above the pin
  const low = { w: 320, h: 300, vw: 340, vh: 800 };
  const r3 = { left: 20, top: 480, right: 320, bottom: 640, pin: false };
  const p3 = { left: 150, top: 460, right: 180, bottom: 490 };
  assert.deepEqual(placeBeside({ rect: r3, ...low, avoid: p3 }), { left: 12, top: 146, side: 'above' });
  // nowhere clear: what it would have been anyway
  const tiny = { w: 320, h: 300, vw: 340, vh: 320 };
  assert.equal(placeBeside({ rect: r2, ...tiny, avoid: p2 }).side, 'right');
  // a pin the first choice leaves showing changes nothing
  const ok = { left: 100, top: 100, right: 300, bottom: 200, pin: false };
  assert.deepEqual(
    placeBeside({ rect: ok, ...view, avoid: { left: 270, top: 80, right: 300, bottom: 110 } }),
    placeBeside({ rect: ok, ...view }),
  );
  assert.deepEqual(pinScreenRect({ wx: 100, wy: 50, dx: -10, dy: 10 }, { x: 5, y: 6 }, 2), { left: 195, top: 86, right: 225, bottom: 116 });
  assert.equal(pinScreenRect(null, { x: 0, y: 0 }, 1), null);
});

test('a turned card carries its pin on the corner the turn put it', () => {
  const sq = { x: 0, y: 0, w: 200, h: 200, rot: 90 };
  const [t] = canvasThreads([row({ id: '1', anchor_id: 'q', author: 'x', body: 'x', created_at: iso(9) })]);
  const a = threadAnchor(t, { cardBox: () => sq });
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  // a quarter turn clockwise: the top-right corner is now bottom-right
  assert.ok(near(a.wx, 200) && near(a.wy, 200), `${a.wx},${a.wy}`);
  // 10px inside that corner, and the row runs up the right-hand edge
  assert.ok(near(a.dx, -10) && near(a.dy, -10), `${a.dx},${a.dy}`);
  assert.ok(near(a.ux, 0) && near(a.uy, -1));
  // the open card stands beside the upright box that holds the turned one
  const wide = { kind: 'card', box: { x: 0, y: 0, w: 400, h: 200, rot: 90 } };
  const r = anchorScreenRect(wide, { x: 0, y: 0 }, 1);
  assert.ok(near(r.left, 100) && near(r.right, 300) && near(r.top, -100) && near(r.bottom, 300));
  // two on a turned card: the second is one step along the turned edge
  const two = canvasThreads([
    row({ id: '1', anchor_id: 'q', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_id: 'q', author: 'x', body: 'x', created_at: iso(8) }),
  ]);
  const pins = layoutPins(two, { cardBox: () => sq }, 1);
  assert.ok(near(pins[1].dx, pins[0].dx) && near(pins[1].dy, pins[0].dy - PIN_STEP));
});

test('a comment being started takes the next place in its card\'s row, and gathers with it', () => {
  const ts = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(9) }),
    row({ id: '2', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(8) }),
  ]);
  const drafts = [{ id: 'new:card:a', anchor: { kind: 'card', id: 'a' }, active: true }];
  const out = layoutPins(ts, res, 1, { drafts });
  assert.deepEqual(out.map((p) => [p.type, p.key, p.dx]), [
    ['pin', '1', -PIN_INSET],
    ['pin', '2', -PIN_INSET - PIN_STEP],
    ['draft', 'new:card:a', -PIN_INSET - 2 * PIN_STEP],
  ]);
  assert.equal(out[2].active, true);
  assert.deepEqual(out[2].draftAnchor, { kind: 'card', id: 'a' });
  // the card too narrow for three: one count that holds the draft too
  const [n] = layoutPins(ts, res, 0.2, { drafts });
  assert.deepEqual([n.type, n.threads.length, n.drafts.length, n.n, n.active], ['count', 2, 1, 3, true]);
  // a draft alone on a point is its own pin; two points stay two
  const pts = [
    { id: 'new:point:0:0', anchor: { kind: 'point', x: 0, y: 0 }, active: false },
    { id: 'new:point:900:0', anchor: { kind: 'point', x: 900, y: 0 }, active: false },
  ];
  assert.deepEqual(layoutPins([], res, 1, { drafts: pts }).map((p) => [p.type, p.wx]), [['draft', 0], ['draft', 900]]);
  // a cluster-level draft has no pin
  assert.deepEqual(layoutPins([], res, 1, { drafts: [{ id: 'new:board', anchor: { kind: 'board' } }] }), []);
});

test('gathering measures each card\'s whole row of pins, not only its corner', () => {
  // card n's row of four runs 78px left of its corner, toward card m's pin
  const boxes = { m: { x: 0, y: 0, w: 200, h: 100 }, n: { x: 220, y: 0, w: 120, h: 100 } };
  const r = { cardBox: (id) => boxes[id] || null };
  const ts = canvasThreads([
    row({ id: 'm1', anchor_id: 'm', author: 'x', body: 'x', created_at: iso(9) }),
    ...[1, 2, 3, 4].map((i) => row({ id: `n${i}`, anchor_id: 'n', author: 'x', body: 'x', created_at: iso(9 - i) })),
  ]);
  // corners are 140px apart, but n's last pin is 62px from m's: still apart
  assert.equal(layoutPins(ts, r, 1).length, 5);
  // one more on n: its last pin is 36px from m's, so they gather
  const more = canvasThreads([
    row({ id: 'm1', anchor_id: 'm', author: 'x', body: 'x', created_at: iso(9) }),
    ...[1, 2, 3, 4, 5].map((i) => row({ id: `n${i}`, anchor_id: 'n', author: 'x', body: 'x', created_at: iso(9 - i) })),
  ]);
  // (five need 4 × 26 + 10 = 114px of a 120px card: the row fits)
  const out = layoutPins(more, r, 1);
  assert.deepEqual(out.map((p) => [p.type, p.n]), [['count', 6]]);
});

test('a look is dated no earlier than the newest row it looked at', () => {
  const newest = Date.parse(iso(0));
  assert.equal(viewedStamp(newest + 5000, newest), newest + 5000, 'a clock that is ahead: now');
  assert.equal(viewedStamp(newest - 5000, newest), newest + 1, 'a clock that is behind: just after the row');
  assert.equal(viewedStamp(1234, null), 1234);
  assert.equal(viewedStamp(newest - 5000, iso(0)), newest + 1, 'takes an ISO time too');
  const [t] = canvasThreads([
    row({ id: '1', anchor_id: 'a', author: 'x', body: 'x', created_at: iso(30) }),
    row({ id: '2', reply_to: '1', anchor_id: 'a', author: 'y', body: 'x', created_at: iso(2) }),
  ]);
  assert.equal(threadNewestMs(t), Date.parse(iso(2)));
  assert.equal(threadNewestMs(null), null);
  // so a reply read on a slow clock is read
  const seen = new Date(viewedStamp(Date.parse(iso(10)), threadNewestMs(t))).toISOString();
  assert.equal(threadUnread(t, ME, seen), false);
});

test('looks made before the server answered are kept: the later time per conversation', () => {
  const server = new Map([['a', iso(60)], ['b', iso(5)]]);
  const local = new Map([['a', iso(1)], ['b', iso(30)], ['c', iso(2)]]);
  const m = mergeViews(server, local);
  assert.deepEqual([...m.entries()].sort(), [['a', iso(1)], ['b', iso(5)], ['c', iso(2)]]);
  assert.deepEqual([...mergeViews(server, new Map()).entries()], [...server.entries()]);
  assert.equal(mergeViews(null, null).size, 0);
  assert.notEqual(m, server, 'a new map');
});

test('the canvas keys stand down inside a comment part', () => {
  const el = (hit) => ({ closest: (sel) => (sel === COMMENT_SURFACE_SELECTOR && hit ? {} : null) });
  assert.equal(inCommentSurface(el(true)), true);
  assert.equal(inCommentSurface(el(false)), false);
  assert.equal(inCommentSurface(null), false);
  assert.equal(inCommentSurface({}), false, 'a text node, the window');
  assert.equal(inCommentSurface({ closest() { throw new Error('x'); } }), false);
  for (const part of ['.cmt-pin', '.cmt-canvas-card', '.cmt-list', '.cmt-sheet-host', '.cmt-pop', '.cnv-comments-eye', '.cmt-float-host', '.cmt-panel']) {
    assert.ok(COMMENT_SURFACE_SELECTOR.split(', ').includes(part), part);
  }
});

test('the list tabs under the arrow keys', () => {
  const ids = ['open', 'resolved', 'mine'];
  assert.equal(tabForKey(ids, 'open', 'ArrowRight'), 'resolved');
  assert.equal(tabForKey(ids, 'mine', 'ArrowRight'), 'open', 'wraps');
  assert.equal(tabForKey(ids, 'open', 'ArrowLeft'), 'mine');
  assert.equal(tabForKey(ids, 'resolved', 'Home'), 'open');
  assert.equal(tabForKey(ids, 'resolved', 'End'), 'mine');
  assert.equal(tabForKey(ids, 'open', 'Enter'), null);
  assert.equal(tabForKey([], 'open', 'ArrowRight'), null);
});

test('the switch is kept per person and cluster, and only in this browser', () => {
  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  assert.equal(readShowComments('u1', 'b1', storage), true, 'on until turned off');
  writeShowComments('u1', 'b1', false, storage);
  assert.equal(readShowComments('u1', 'b1', storage), false);
  assert.equal(readShowComments('u1', 'b2', storage), true, 'another cluster');
  assert.equal(readShowComments('u2', 'b1', storage), true, 'another person');
  writeShowComments('u1', 'b1', true, storage);
  assert.equal(mem.size, 0, 'on leaves nothing behind');
  const broken = { getItem() { throw new Error('no'); }, setItem() { throw new Error('no'); }, removeItem() { throw new Error('no'); } };
  assert.equal(readShowComments('u1', 'b1', broken), true);
  assert.doesNotThrow(() => writeShowComments('u1', 'b1', false, broken));
});

test('the ui store tells its listeners only when something changed', () => {
  const ui = createCommentUi();
  let n = 0;
  const off = ui.subscribe(() => { n += 1; });
  ui.set({ openId: 'a' });
  ui.set({ openId: 'a' });
  ui.set((s) => ({ listOpen: !s.listOpen }));
  assert.equal(n, 2);
  assert.deepEqual([ui.get().openId, ui.get().listOpen, ui.get().tab], ['a', true, 'open']);
  off();
  ui.set({ openId: null });
  assert.equal(n, 2);
});

// ── going to a conversation ───────────────────────────────────────────────
test('going to a conversation: left alone in view, centred when out of it', async () => {
  const { panToAnchor } = await import('./commentPins.js');
  const view = { pan: { x: 0, y: 0 }, zoom: 1, w: 1200, h: 800 };
  const at = (box) => threadAnchor({ id: 't', root: { meta: { anchorKind: 'card', anchorId: 'a' } } }, { cardBox: () => box });
  // pin at (400, 100): comfortably in view
  assert.equal(panToAnchor(at({ x: 100, y: 100, w: 300, h: 200 }), view), null);
  // far away: its card is centred
  assert.deepEqual(panToAnchor(at({ x: 5000, y: 5000, w: 300, h: 200 }), view), { x: 600 - 5150, y: 400 - 5100 });
  // the cluster's own comment has no place; no view, no move
  assert.equal(panToAnchor({ kind: 'board', key: 'board' }, view), null);
  assert.equal(panToAnchor(at({ x: 5000, y: 5000, w: 300, h: 200 }), null), null);
  // a point
  const pt = threadAnchor({ id: 'p', root: { meta: { anchorKind: 'point', anchorX: 3000, anchorY: 2000 } } }, {});
  assert.deepEqual(panToAnchor(pt, view), { x: 600 - 3000, y: 400 - 2000 });
});

test('going to a conversation on a turned card looks for the pin at its turned corner', async () => {
  const { panToAnchor } = await import('./commentPins.js');
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const at = (box) => threadAnchor({ id: 't', root: { meta: { anchorKind: 'card', anchorId: 'a' } } }, { cardBox: () => box });
  // A tall card turned a quarter. Unturned, its top-right corner is (300, 100);
  // turned about its middle (200, 400), that corner is at (500, 500).
  const a = at({ x: 100, y: 100, w: 200, h: 600, rot: 90 });
  assert.ok(near(a.wx, 500) && near(a.wy, 500), 'the turned corner');
  // a view that holds the unturned corner but not the pin: the camera moves
  const narrow = { pan: { x: 0, y: 0 }, zoom: 1, w: 520, h: 800 };
  const moved = panToAnchor(a, narrow);
  assert.ok(moved, 'the pin is out of view');
  // turned it is 600 wide, more than this view has room for: the pin itself
  // is brought in, a third of the way down
  assert.ok(near(moved.x, 260 - 500) && near(moved.y, 800 / 3 - 500));
  // the other way round: the unturned corner (300, -300) is above the view,
  // the pin (500, 100) is in it
  const b = at({ x: 100, y: -300, w: 200, h: 600, rot: 90 });
  assert.ok(near(b.wx, 500) && near(b.wy, 100));
  assert.equal(panToAnchor(b, { pan: { x: 0, y: 0 }, zoom: 1, w: 1200, h: 800 }), null);
  // a turned card that fits is centred on its middle, which a turn does not move
  assert.deepEqual(panToAnchor(a, { pan: { x: -4000, y: 0 }, zoom: 1, w: 1200, h: 800 }), { x: 600 - 200, y: 400 - 400 });
});
