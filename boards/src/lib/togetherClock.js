// Who is working together in one cluster, for the party worker's board room
// (party/together.ts, wired into party/board.ts). Pure: no Yjs, no Cloudflare,
// so it is tested here (togetherClock.test.mjs) and imported there, as
// roomGc.js is.
//
// Active = real input within TOGETHER_ACTIVE_SECONDS: an edit, a change to a
// presence field that only input moves (INPUT_FIELDS), or the app's `here`
// stamp (yPartyKit.js: on real input while the tab is on screen, so a phone or
// a reader with no cursor counts too). Counted per VERIFIED account, the one
// the door stamps on the socket: two tabs are one person, and the name a
// browser announces in its presence is never trusted.
//
// Every TOGETHER_TICK_MS while two or more are active, the room asks the
// database what each person's seconds together pay (live_together_tick, 0862),
// which decides who is a real person and holds the month's cap.

import { TOGETHER_ACTIVE_SECONDS, TOGETHER_ENDED, togetherMessage } from './liveTogether.js';

export const ACTIVE_WINDOW_MS = TOGETHER_ACTIVE_SECONDS * 1000;
// live_together_tick's c_max_tick: the most one call credits anyone.
export const MAX_TICK_SECONDS = 120;
// The app stamps `here` at most this often while someone uses the page.
export const HERE_EVERY_MS = 30_000;

// Presence fields that change only on real input. Not `user` (name and
// colour, sent on connect) and not `videoEpoch` (playback moves it by itself).
export const INPUT_FIELDS = Object.freeze([
  'canvasCursor', 'canvasSelection', 'marquee', 'liveDrag',
  'docCursor', 'docCaret', 'docSelection',
  'noteCaret', 'noteSelection', 'noteEdit', 'here',
]);

export function inputSignature(state) {
  if (!state || typeof state !== 'object') return '';
  try {
    return JSON.stringify(INPUT_FIELDS.map((k) => (state[k] === undefined ? null : state[k])));
  } catch (_) {
    return '';
  }
}

// Did this presence change come from someone's input? `before` is the last
// signature seen for that client. A first state (undefined: a new tab, a
// reconnect, or a room that restarted) never counts: a reconnecting tab
// re-sends its old cursor and `here` with no new input behind them. The next
// change does.
export function inputMoved(before, state) {
  const now = inputSignature(state);
  if (before === undefined) return { moved: false, sig: now };
  return { moved: now !== before, sig: now };
}

// One person's activity: lastAt is their latest input, since the start of the
// unbroken run it belongs to (no gap longer than the window).
export function noteActivity(people, userId, now) {
  if (!userId) return;
  const p = people.get(userId);
  if (!p || now - p.lastAt > ACTIVE_WINDOW_MS) people.set(userId, { lastAt: now, since: now });
  else if (now > p.lastAt) p.lastAt = now;
}

// The people active now among those connected, earliest run first. Anyone no
// longer connected is forgotten: being there is half of working together.
export function activeNow(people, connected, now) {
  for (const id of [...people.keys()]) if (!connected.has(id)) people.delete(id);
  const out = [];
  for (const [id, p] of people) {
    if (now - p.lastAt <= ACTIVE_WINDOW_MS) out.push({ id, lastAt: p.lastAt, since: p.since });
  }
  return out.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Each active person's whole seconds together since the room's last tick:
// from the latest of that tick, the moment a second person became active, and
// their own run's start. Nobody is together alone. `skip`: ids the database
// last said aren't real people (a guest, a service account). They never make
// anyone's "together" start, though they are still sent, so the database can
// say again.
export function togetherSeconds(active, now, lastTickAt, skip = null) {
  const out = new Map();
  if (!Array.isArray(active)) return out;
  const real = skip && skip.size ? active.filter((p) => !skip.has(p.id)) : active;
  if (real.length < 2) return out;
  const twoActiveSince = real[1].since;
  const tickFloor = Number.isFinite(lastTickAt) ? lastTickAt : -Infinity;
  for (const p of active) {
    const from = Math.max(tickFloor, twoActiveSince, p.since);
    out.set(p.id, Math.max(0, Math.min(MAX_TICK_SECONDS, Math.floor((now - from) / 1000))));
  }
  return out;
}

// After a tick: what each person's sockets hear, and whose stretch ended.
//   told    Map id → { at, earned }: who heard "together" last tick, since when,
//           and the cards this stretch has paid them so far.
//   answer  live_together_tick's answer, or null when nobody is together now
//           (fewer than two active, or the function is off).
// Returns { told, say: Map id → message, ended: [{ id, s }] } — `s`, the ended
// stretch's length in seconds, for live_together_tick(…, p_ended => true).
export function settleTick(told, answer, now) {
  const next = new Map();
  const say = new Map();
  if (answer && answer.boost > 0 && Array.isArray(answer.results)) {
    const eligible = answer.results.filter((r) => r && r.eligible === true && typeof r.id === 'string');
    for (const r of eligible) {
      const was = told.get(r.id);
      const t = { at: was?.at ?? now, earned: (was?.earned ?? 0) + Math.max(0, Math.floor(Number(r.earned) || 0)) };
      next.set(r.id, t);
      say.set(r.id, togetherMessage({
        peers: eligible.filter((x) => x.id !== r.id).map((x) => x.id),
        boost: answer.boost,
        earned: t.earned,
        month: Math.max(0, Math.floor(Number(r.month) || 0)),
        cap: answer.cap,
        capped: r.capped === true,
        progress: r.progress,
      }));
    }
  }
  const ended = [];
  for (const [id, t] of told) {
    if (next.has(id)) continue;
    ended.push({ id, s: Math.max(0, Math.round((now - t.at) / 1000)) });
    say.set(id, TOGETHER_ENDED);
  }
  return { told: next, say, ended };
}
