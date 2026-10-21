// universeMoments.test.mjs — node --test src/lib/universeMoments.test.mjs
//
// What the live Universe calls a moment, what its caption says, and when the
// director may take the camera. The renderer (universeMomentFx.js) and the
// engine that drives it need a GPU; everything they decide with is here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  momentOf, momentKind, captionFor, sinceWords, agoWords,
  DIRECTOR, newDirector, directorCanSpot, directorNext, directorText,
  BURST, makeBursts, burstShape, PRESENCE, makePresence, dhm,
} from './universeMoments.js';

const row = (event, props = {}, user_id = 'u1') => ({ id: 'e', event, occurred_at: '2026-10-21T12:00:00Z', user_id, props });

test('a placed card is a flare in its own kind, at its cluster', () => {
  assert.deepEqual(momentOf(row('card_placed', { n: 1, kind: 'image', board_id: 'b1' })),
    { type: 'make', board: 'b1', user: 'u1', n: 1, kind: 'image', act: 'placing images' });
  // A kind with no hue of its own takes the catch-all, and so does its words.
  const m = momentOf(row('card_placed', { n: 2, kind: 'audio', board_id: 'b1' }));
  assert.equal(m.kind, 'card');
  assert.equal(m.act, 'adding files');
  assert.equal(momentKind('audio'), 'card');
  assert.equal(momentKind('boardlink'), 'boardlink');
});

test('counts are whole, positive and bounded', () => {
  assert.equal(momentOf(row('card_placed', { n: 'x', kind: 'note', board_id: 'b' })).n, 1);
  assert.equal(momentOf(row('card_placed', { n: -4, kind: 'note', board_id: 'b' })).n, 1);
  assert.equal(momentOf(row('card_placed', { n: 9999, kind: 'note', board_id: 'b' })).n, 500);
  assert.equal(momentOf(row('import_batch', { n_accepted: 120, board_id: 'b' })).n, 120);
  assert.equal(momentOf(row('import_batch', { board_id: 'b' })).n, 0);
});

test('presence needs a cluster and a person', () => {
  assert.deepEqual(momentOf(row('board_open', { board_id: 'b' })),
    { type: 'presence', board: 'b', user: 'u1', act: 'looking through a cluster' });
  assert.equal(momentOf(row('cluster_create', { board_id: 'b' })).act, 'making clusters');
  assert.equal(momentOf(row('board_open', {})), null);
  assert.equal(momentOf(row('board_open', { board_id: 'b' }, null)), null);
  assert.equal(momentOf(row('anything_else', { board_id: 'b' })).act, 'working in a cluster');
  assert.equal(momentOf(row('anything_else', {})), null);
});

test('together counts the sender as well as the peers', () => {
  const m = momentOf(row('collab_session', { board_id: 'b', peak_peers: 2, ms: 60000 }));
  assert.equal(m.type, 'together');
  assert.equal(m.people, 3);
});

test('an invite link is a join only when it says so', () => {
  assert.equal(momentOf(row('invite_link_claimed', { board_id: 'b', role: 'editor', status: 'joined' })).role, 'editor');
  assert.equal(momentOf(row('invite_link_claimed', { board_id: 'b', role: 'owner', status: 'joined' })).role, null);
  assert.equal(momentOf(row('invite_link_claimed', { board_id: 'b', status: 'expired' })), null);
});

test('invites, visits and first cards', () => {
  assert.equal(momentOf(row('access_granted', { how: 'email', board_id: 'b' })).type, 'invite');
  assert.equal(momentOf(row('invite_sent', {})).type, 'invite');
  assert.equal(momentOf(row('invite_sent', {}, null)), null);
  assert.deepEqual(momentOf(row('share_view', { board_id: 'b', valid: true }, null)), { type: 'share', board: 'b' });
  assert.equal(momentOf(row('share_view', { board_id: 'b', valid: false }, null)), null);
  for (const e of ['lp_view', 'landing_view', 'seo_landing_view']) assert.deepEqual(momentOf(row(e, {}, null)), { type: 'landing' });
  assert.deepEqual(momentOf(row('onboarding_first_card', {})), { type: 'first_card', user: 'u1' });
  // The account's own nodes arriving are the signup moment, not this row.
  assert.equal(momentOf(row('ps_signup', {})), null);
  assert.equal(momentOf(null), null);
  assert.equal(momentOf({ event: 7 }), null);
});

test('every caption says what happened and nothing about whose it was', () => {
  const kinds = {
    import: { n: 8, what: 'images' }, cluster: {}, signup: {}, invited: {},
    first_card: { kind: 'note', sinceMs: 4 * 60_000 }, together: { people: 3 },
    joined: { role: 'viewer' }, here: { act: 'writing notes', agoMs: 40_000 },
  };
  for (const [k, d] of Object.entries(kinds)) {
    const c = captionFor(k, d);
    for (const f of ['e', 'l', 'm', 'follow']) assert.ok(typeof c[f] === 'string' && c[f].length > 0, `${k}.${f}`);
  }
  assert.equal(captionFor('import', { n: 8, what: 'images' }).l, '8 images came in at once');
  assert.equal(captionFor('import', { n: 1, what: 'cards' }).l, '1 card came in at once');
  assert.equal(captionFor('import', { n: 1200, what: 'cards' }).l, '1,200 cards came in at once');
  assert.equal(captionFor('first_card', { kind: 'note', sinceMs: 4 * 60_000 }).m, 'a note, 4 minutes after signing up');
  assert.equal(captionFor('first_card', { kind: 'audio', sinceMs: null }).m, 'a file, just now');
  assert.equal(captionFor('together', { people: 1 }).l, '2 people worked in one cluster at once');
  assert.equal(captionFor('joined', { role: 'editor' }).m, 'as an editor');
  assert.equal(captionFor('joined', {}).m, 'just now');
  assert.equal(captionFor('here', { act: 'writing notes', agoMs: 40_000 }).l, 'Someone is writing notes');
  assert.equal(captionFor('here', { act: 'writing notes', agoMs: 40_000 }).m, 'their last move was 40 seconds ago');
  assert.equal(captionFor('nope'), null);
});

test('the words for time', () => {
  assert.equal(sinceWords(20_000), 'under a minute');
  assert.equal(sinceWords(60_000), 'a minute');
  assert.equal(sinceWords(12 * 60_000), '12 minutes');
  assert.equal(sinceWords(60 * 60_000), 'an hour');
  assert.equal(sinceWords(47 * 3600_000), '47 hours');
  assert.equal(sinceWords(72 * 3600_000), '3 days');
  assert.equal(agoWords(3000), 'a few seconds');
  assert.equal(agoWords(40_000), '40 seconds');
  assert.equal(agoWords(61_000), 'a minute');
  assert.equal(agoWords(4 * 60_000 + 5000), '4 minutes');
});

test('the director goes to a moment, holds it, comes back, and tours when it is quiet', () => {
  const d = newDirector(true);
  assert.equal(d.mode, 'wide');
  assert.equal(newDirector(false).mode, 'off');
  assert.equal(directorNext(newDirector(false), 0), null);

  assert.equal(directorNext({ ...d, mode: 'go', since: 0 }, DIRECTOR.flyMs - 1), null);
  assert.equal(directorNext({ ...d, mode: 'go', since: 0 }, DIRECTOR.flyMs + 1), 'hold');
  assert.equal(directorNext({ ...d, mode: 'hold', since: 0 }, DIRECTOR.holdMs + 1), 'back');
  assert.equal(directorNext({ ...d, mode: 'back', since: 0, dur: 2400 }, 2401), 'wide');
  assert.equal(directorNext({ ...d, mode: 'wide', since: 0 }, DIRECTOR.wideMs - 1), null);
  assert.equal(directorNext({ ...d, mode: 'wide', since: 0 }, DIRECTOR.wideMs + 1), 'tour');
  assert.equal(directorNext({ ...d, mode: 'tour', since: 0 }, DIRECTOR.tourMs + 1), 'back');
  // A moment waits its turn behind another one; it holds long enough to be read.
  assert.ok(DIRECTOR.minHoldMs < DIRECTOR.holdMs);
  assert.ok(DIRECTOR.effectDelayMs >= DIRECTOR.flyMs, 'the light waits for the camera');
});

test('touching the view takes the camera until the pause runs out', () => {
  const p = { ...newDirector(true), mode: 'paused', since: 0, pausedUntil: 60_000 };
  assert.equal(directorNext(p, 30_000), null);
  assert.equal(directorNext(p, 60_001), 'back');
  assert.equal(directorCanSpot(p, 30_000), false);
  assert.equal(directorNext({ ...p, pausedUntil: Infinity }, 1e12), null);
});

test('who may take the camera', () => {
  const d = newDirector(true);
  assert.equal(directorCanSpot(d, 0), true);
  assert.equal(directorCanSpot({ ...d, mode: 'tour' }, 0), true);
  assert.equal(directorCanSpot({ ...d, mode: 'back' }, 0), true);
  assert.equal(directorCanSpot({ ...d, mode: 'go' }, 0), false);
  assert.equal(directorCanSpot({ ...d, mode: 'hold' }, 0), false);
  assert.equal(directorCanSpot({ ...d, mode: 'off' }, 0), false);
  assert.equal(directorCanSpot(null, 0), false);
});

test('the pill says what the director is doing', () => {
  const base = { on: true, available: true, mode: 'wide', label: '', pausedUntil: 0 };
  assert.equal(directorText({ ...base, on: false }, 0), 'Director off');
  assert.equal(directorText(null, 0), 'Director off');
  assert.equal(directorText({ ...base, available: false }, 0), 'Director off · reduced motion');
  assert.equal(directorText({ ...base, on: false, available: false }, 0), 'Director off · reduced motion');
  assert.equal(directorText(base, 0), 'Director · watching for the next moment');
  assert.equal(directorText({ ...base, mode: 'hold', label: 'following an import' }, 0), 'Director · following an import');
  assert.equal(directorText({ ...base, mode: 'back', label: 'following an import' }, 0), 'Director · watching for the next moment');
  assert.equal(directorText({ ...base, mode: 'paused', pausedUntil: Infinity }, 5), 'Yours while you steer');
  assert.equal(directorText({ ...base, mode: 'paused', pausedUntil: 42_000 }, 0), 'Yours for a minute · back in 42 s');
  assert.equal(directorText({ ...base, mode: 'paused', pausedUntil: 41_001 }, 41_000), 'Yours for a minute · back in 1 s');
});

test('placements in a row are one burst, and three are an import', () => {
  const b = makeBursts();
  b.add({ board: 'b1', user: 'u1', n: 1, kind: 'image' }, 0);
  b.add({ board: 'b1', user: 'u1', n: 1, kind: 'image' }, 300);
  b.add({ board: 'b1', user: 'u1', n: 1, kind: 'image' }, 600);
  b.add({ board: 'b2', user: 'u1', n: 1, kind: 'note' }, 650);
  assert.deepEqual(b.due(600 + BURST.settleMs - 1).map((g) => g.board), []);
  const [g] = b.due(600 + BURST.settleMs);
  assert.equal(g.board, 'b1');
  assert.equal(g.n, 3);
  assert.ok(g.n >= BURST.importAt);
  assert.deepEqual(burstShape(g), { kind: 'image', what: 'images' });
  assert.equal(b.size, 1);
  assert.equal(b.due(650 + BURST.settleMs)[0].n, 1);
  assert.equal(b.size, 0);
});

test('a burst that never pauses still resolves', () => {
  const b = makeBursts();
  for (let t = 0; t <= BURST.maxMs; t += 200) b.add({ board: 'b', user: 'u', n: 1, kind: 'note' }, t);
  assert.equal(b.due(BURST.maxMs).length, 1);
});

test('a mixed burst is cards, not images', () => {
  const b = makeBursts();
  b.add({ board: 'b', user: 'u', n: 2, kind: 'image' }, 0);
  b.add({ board: 'b', user: 'u', n: 1, kind: 'note' }, 100);
  assert.deepEqual(burstShape(b.due(5000)[0]), { kind: 'image', what: 'cards' });
});

test('presence fades in, stays warm for its window, and fades out', () => {
  const p = makePresence();
  p.touch(7, 'u1', 'writing notes', 0);
  assert.equal(p.list(0)[0].alpha, 0);
  assert.equal(p.list(PRESENCE.fadeInMs).at(0).alpha, 1);
  p.touch(7, 'u2', 'placing images', 1000);
  const [e] = p.here(2000);
  assert.equal(e.n, 2);
  assert.equal(e.act, 'placing images');
  assert.equal(e.lastAt, 1000);
  // Past the window nobody is here, and the halo is fading.
  const later = 1000 + PRESENCE.windowMs + PRESENCE.fadeOutMs / 2;
  assert.equal(p.here(later).length, 0);
  const fading = p.list(later)[0];
  assert.ok(fading.alpha > 0 && fading.alpha < 1);
  assert.equal(fading.live, false);
  assert.equal(p.list(1000 + PRESENCE.windowMs + PRESENCE.fadeOutMs).length, 0);
  assert.equal(p.size, 0);
});

test('here puts the newest move first', () => {
  const p = makePresence();
  p.touch(1, 'a', 'x', 0);
  p.touch(2, 'b', 'y', 500);
  assert.deepEqual(p.here(600).map((e) => e.key), [2, 1]);
});

test('time in app reads days, hours and two-digit minutes', () => {
  assert.equal(dhm(0), '0d 0h 00m');
  assert.equal(dhm(59), '0d 0h 00m');
  assert.equal(dhm(16 * 86400 + 9 * 3600 + 5 * 60), '16d 9h 05m');
  assert.equal(dhm(86399), '0d 23h 59m');
  assert.equal(dhm(-5), '0d 0h 00m');
  assert.equal(dhm('nope'), '0d 0h 00m');
});
