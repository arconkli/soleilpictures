// universeMoments — what the admin Universe shows as it happens, decided apart
// from the renderer so it can be tested without a GPU.
//
// The Universe draws what exists. Since 2026-10-21 it also shows what people are
// doing while you watch: a flare in the card's colour where a card is made, a
// warm halo on a cluster someone is in, a gold star for a new account, an arc
// when two people meet in one cluster, a comet for a visitor from outside. And,
// when the director is on, a camera that flies to the moment and a caption that
// says what it was. UniverseGraph turns these into light; this file decides what
// a moment is, what it is called, and when the camera may take it.
//
// Nothing here invents a place. An event names a cluster, or a person the
// universe already draws, or it is dropped. The only light without a cluster is
// a signed-out visit, which comes in from the rim because a visitor is, honestly,
// someone from outside. And nothing here is content: kinds and counts only, as
// in the rest of the Universe.

// ── Colours ──────────────────────────────────────────────────────────────
// Display sRGB, drawn additively over the finished frame (see
// universeMomentFx.js), so these are the colours you see. The card hues are the
// legend's, lifted: the legend's own sit at the dim end of the scale, and a
// flare in them reads as a smudge against the star field.
export const MOMENT_HUE = {
  image: '#a48cf0', note: '#ff9a7d', grid: '#9bd47a', link: '#8cbcf2',
  palette: '#6fd3c8', doc: '#ffe9b8', board: '#ffc14d', boardlink: '#e8cf96',
  card: '#aab6c2',
};
export const WARM = '#fff4d8';         // here now
export const GOLD = '#ffd06b';         // a new account
export const SPIKE = '#fff1cc';        // a new account's diffraction spikes
export const TOGETHER = '#bfe3ff';     // invites, shared work
export const VISIT = '#a9c2ee';        // public pages
export const COMET_HEAD = '#dbe7ff';
export const WS_HUE = '#b9b8d6';       // a workspace no new account claimed
export const WHITE = '#ffffff';

const OWN_HUE = new Set(['image', 'note', 'grid', 'link', 'palette', 'doc', 'board', 'boardlink']);

/** A card kind as the moments see it: its own hue, or the catch-all. */
export function momentKind(kind) {
  return OWN_HUE.has(kind) ? kind : 'card';
}

// What someone is doing, for "Someone is …".
export const KIND_ING = {
  image: 'placing images', note: 'writing notes', grid: 'building a grid',
  board: 'making clusters', link: 'saving links', doc: 'writing a doc',
  palette: 'making a palette', boardlink: 'linking clusters', card: 'adding files',
};
// One of them, for "… placed its first card: an image".
export const KIND_A = {
  image: 'an image', note: 'a note', grid: 'a grid', board: 'a cluster',
  link: 'a link', doc: 'a doc', palette: 'a palette', boardlink: 'a linked cluster',
  card: 'a file',
};

const ACT = {
  delete: 'tidying a cluster',
  cluster: 'making clusters',
  open: 'looking through a cluster',
  together: 'working with someone',
  joined: 'joining a cluster',
  invite: 'sharing a cluster',
  other: 'working in a cluster',
};

const LANDINGS = new Set(['lp_view', 'landing_view', 'seo_landing_view']);

function count(v, fallback = 1, max = 500) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/**
 * One pushed analytics_events row, as a moment, or null.
 *
 *   make        card_placed: a flare where the card went; `n` cards, `kind`
 *   delete      card_deleted: a small implosion
 *   import      import_batch: no light of its own (its cards are card_placed);
 *               its n_accepted is the honest size of a burst
 *   presence    anything else signed in, on a cluster: a halo, nothing more
 *   together    collab_session: two or more people were in one cluster at once
 *   joined      invite_link_claimed: someone came in through an invite link
 *   invite      access_granted / invite_sent: an arc going out
 *   share       share_view: a visitor from outside, to the cluster they opened
 *   landing     a public page: a visitor from outside, toward the middle
 *   first_card  onboarding_first_card: no board of its own; it is paired with
 *               the same person's card_placed
 *
 * Every moment that has a board and a person also carries `act`, what the
 * presence halo says they were doing.
 */
export function momentOf(ev) {
  if (!ev || typeof ev.event !== 'string') return null;
  const p = ev.props && typeof ev.props === 'object' ? ev.props : {};
  const board = typeof p.board_id === 'string' && p.board_id ? p.board_id : null;
  const user = typeof ev.user_id === 'string' && ev.user_id ? ev.user_id : null;
  switch (ev.event) {
    case 'card_placed': {
      const kind = momentKind(p.kind);
      return { type: 'make', board, user, n: count(p.n), kind, act: KIND_ING[kind] };
    }
    case 'card_deleted':
      return { type: 'delete', board, user, n: count(p.n), act: ACT.delete };
    case 'import_batch':
      return { type: 'import', board, user, n: count(p.n_accepted, 0, 100_000) };
    case 'cluster_create':
      return board && user ? { type: 'presence', board, user, act: ACT.cluster } : null;
    case 'board_open':
      return board && user ? { type: 'presence', board, user, act: ACT.open } : null;
    case 'collab_session':
      // peak_peers counts the OTHER people; the one who sent it is one more.
      return { type: 'together', board, user, people: count(p.peak_peers) + 1, act: ACT.together };
    case 'invite_link_claimed':
      // claim_collab_link only ever writes 'joined'; anything else is not a join.
      if (p.status != null && p.status !== 'joined') return null;
      return { type: 'joined', board, user, role: p.role === 'editor' || p.role === 'viewer' ? p.role : null, act: ACT.joined };
    case 'access_granted':
    case 'invite_sent':
      return user ? { type: 'invite', board, user, act: ACT.invite } : null;
    case 'share_view':
      return board && p.valid !== false ? { type: 'share', board } : null;
    case 'onboarding_first_card':
      return user ? { type: 'first_card', user } : null;
    case 'ps_signup':
      return null;   // the account's own nodes arriving are the moment
    default:
      if (LANDINGS.has(ev.event)) return { type: 'landing' };
      return board && user ? { type: 'presence', board, user, act: ACT.other } : null;
  }
}

// ── Words ────────────────────────────────────────────────────────────────
function plural(n, one, many) { return n === 1 ? one : many; }

/** "under a minute", "a minute", "12 minutes", "3 hours", "2 days". */
export function sinceWords(ms) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'under a minute';
  if (m < 60) return m === 1 ? 'a minute' : `${m} minutes`;
  const h = Math.floor(m / 60);
  if (h < 48) return h === 1 ? 'an hour' : `${h} hours`;
  const d = Math.floor(h / 24);
  return `${d} ${plural(d, 'day', 'days')}`;
}

/** "a few seconds", "40 seconds", "a minute", "4 minutes". */
export function agoWords(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 10) return 'a few seconds';
  if (s < 60) return `${s} seconds`;
  const m = Math.floor(s / 60);
  return m === 1 ? 'a minute' : `${m} minutes`;
}

function fmt(n) { return Math.round(n).toLocaleString('en-US'); }

/**
 * What the director's caption says. `e` the eyebrow, `l` the line, `m` the
 * small line under it, `follow` the status pill's "Director · following …".
 * Every one of them is true of the event that triggered it, and says no more
 * than the event does: there are no names, titles or places in any of them.
 */
export function captionFor(kind, d = {}) {
  switch (kind) {
    case 'import': {
      const what = d.what === 'images' ? plural(d.n, 'image', 'images') : plural(d.n, 'card', 'cards');
      return { e: 'Import', l: `${fmt(d.n)} ${what} came in at once`, m: 'into one cluster, just now', follow: 'following an import' };
    }
    case 'cluster':
      return { e: 'New cluster', l: 'Someone made a new cluster', m: 'just now', follow: 'following a new cluster' };
    case 'signup':
      return { e: 'New account', l: 'Someone signed up and got their first workspace', m: 'just now', follow: 'following a new account' };
    case 'invited':
      return { e: 'New account · invited', l: 'An invite became a new account', m: 'they joined a workspace someone shared with them', follow: 'following an invite' };
    case 'first_card':
      return {
        e: 'First card', l: 'A new account placed its first card',
        m: `${KIND_A[d.kind] || KIND_A.card}, ${d.sinceMs == null ? 'just now' : `${sinceWords(d.sinceMs)} after signing up`}`,
        follow: 'following a first card',
      };
    case 'together':
      return { e: 'Together', l: `${fmt(Math.max(2, d.people || 2))} people worked in one cluster at once`, m: 'their session just ended', follow: 'following people working together' };
    case 'joined':
      return {
        e: 'Together', l: 'Someone joined a cluster through an invite link',
        m: d.role === 'editor' ? 'as an editor' : d.role === 'viewer' ? 'as a viewer' : 'just now',
        follow: 'following an invite link',
      };
    case 'here':
      return { e: 'Here now', l: `Someone is ${d.act || ACT.other}`, m: `their last move was ${agoWords(d.agoMs)} ago`, follow: 'touring while it is quiet' };
    default:
      return null;
  }
}

// ── The director ─────────────────────────────────────────────────────────
// It takes one moment at a time. From the wide view (or a quiet tour) a moment
// worth a shot sends the camera to it, the moment's light waits until the camera
// is there, the caption shows, and after a while the camera goes back to the
// wide view. Nothing happening for a while, it tours a cluster someone is in.
// Touching the view in any way hands the camera to you for a minute. Off, it
// is the plain universe: the same light, no camera moves, no captions.
export const DIRECTOR = {
  shotZoom: 2.35,        // the wide view's distance over this, for a shot
  tourZoom: 1.8,
  flyMs: 2400,           // to a moment
  effectDelayMs: 2500,   // the moment's light waits for the camera
  holdMs: 8000,          // on it, caption showing
  minHoldMs: 4500,       // on it at least this long before the next moment takes it
  nextWaitMs: 9500,      // a moment that has to wait longer than this for the camera plays where it is
  backMs: 2400,          // back to the wide view
  wideMs: 16000,         // wide and quiet this long, then a tour
  tourFlyMs: 3200,
  tourCaptionMs: 2600,
  tourMs: 9500,
  tourBackMs: 2600,
  pauseMs: 60000,        // yours, after you last touched it
  offMs: 1600,           // turned off: back to the wide view
};

export function newDirector(on) {
  return { mode: on ? 'wide' : 'off', since: 0, dur: 0, pausedUntil: 0, label: '' };
}

/**
 * Whether a moment may take the camera now: from the wide view, a tour, or on
 * the way back to the wide view. One on another moment waits its turn instead
 * (the engine's `next`).
 */
export function directorCanSpot(d, now) {
  return !!d && (d.mode === 'wide' || d.mode === 'tour' || d.mode === 'back') && now >= d.pausedUntil;
}

/**
 * The next thing the director does, from its state alone:
 * 'hold' | 'back' | 'wide' | 'tour' | null. The caller does it and moves the
 * state on; this never moves a camera.
 */
export function directorNext(d, now) {
  if (!d || d.mode === 'off') return null;
  if (now < d.pausedUntil) return null;
  if (d.mode === 'paused') return 'back';
  const age = now - d.since;
  if (d.mode === 'go' && age > DIRECTOR.flyMs) return 'hold';
  if (d.mode === 'hold' && age > DIRECTOR.holdMs) return 'back';
  if (d.mode === 'back' && age > d.dur) return 'wide';
  if (d.mode === 'wide' && age > DIRECTOR.wideMs) return 'tour';
  if (d.mode === 'tour' && age > DIRECTOR.tourMs) return 'back';
  return null;
}

/** The status pill's words. `status` is what UniverseGraph reports. */
export function directorText(status, now) {
  if (!status || !status.on) return status && status.available === false ? 'Director off · reduced motion' : 'Director off';
  if (status.available === false) return 'Director off · reduced motion';
  if (status.pausedUntil > now) {
    if (!Number.isFinite(status.pausedUntil)) return 'Yours while you steer';
    return `Yours for a minute · back in ${Math.max(1, Math.ceil((status.pausedUntil - now) / 1000))} s`;
  }
  if ((status.mode === 'go' || status.mode === 'hold' || status.mode === 'tour') && status.label) return `Director · ${status.label}`;
  return 'Director · watching for the next moment';
}

// ── Bursts ───────────────────────────────────────────────────────────────
// One person placing ten photos sends ten card_placed rows, one per file, a few
// hundred milliseconds apart (the import_batch row that names the gesture comes
// in on the five-second batch, well after). So placements are held per person
// per cluster until they stop for a moment, and three or more together are one
// import: one shot, the flares staggered once the camera is there, and the
// caption's count is the larger of what arrived and what the batch row says
// (the pushed list keeps the newest few dozen, so a big burst can lose some).
export const BURST = { settleMs: 900, maxMs: 3000, importAt: 3 };

export function makeBursts({ settleMs = BURST.settleMs, maxMs = BURST.maxMs } = {}) {
  const open = new Map();
  return {
    add(m, at) {
      const key = `${m.board}\u001f${m.user || ''}`;
      let g = open.get(key);
      if (!g) { g = { board: m.board, user: m.user, first: at, last: at, n: 0, items: [], kinds: {} }; open.set(key, g); }
      g.last = at;
      g.n += m.n;
      g.items.push({ at, n: m.n, kind: m.kind });
      g.kinds[m.kind] = (g.kinds[m.kind] || 0) + m.n;
      return g;
    },
    /** Groups that have stopped growing, oldest first, removed from the buffer. */
    due(now) {
      const out = [];
      for (const [key, g] of open) {
        if (now - g.last >= settleMs || now - g.first >= maxMs) { out.push(g); open.delete(key); }
      }
      return out.sort((a, b) => a.first - b.first);
    },
    get size() { return open.size; },
  };
}

/** The burst's most common kind, and whether it was all images. */
export function burstShape(g) {
  let top = 'card', topN = -1;
  for (const [k, n] of Object.entries(g.kinds || {})) if (n > topN) { top = k; topN = n; }
  return { kind: top, what: topN === g.n && top === 'image' ? 'images' : 'cards' };
}

// ── Presence ─────────────────────────────────────────────────────────────
// Who is here: a cluster stays warm for five minutes after the last thing
// someone signed in did there. Fades in over 1.6s and out over 2.6s, as the
// mockup's halos did, so a halo arriving or leaving is never a pop.
export const PRESENCE = { windowMs: 5 * 60_000, fadeInMs: 1600, fadeOutMs: 2600 };

export function makePresence({ windowMs = PRESENCE.windowMs } = {}) {
  const byBoard = new Map();   // key → { key, users: Map(user → at), born, act, lastAt, lastUser }
  function liveCount(e, now) {
    let n = 0;
    for (const at of e.users.values()) if (now - at <= windowMs) n++;
    return n;
  }
  function lastOf(e) {
    let last = -Infinity;
    for (const at of e.users.values()) if (at > last) last = at;
    return last;
  }
  return {
    touch(key, user, act, at) {
      let e = byBoard.get(key);
      if (e && lastOf(e) + windowMs + PRESENCE.fadeOutMs < at) { byBoard.delete(key); e = null; }
      if (!e) { e = { key, users: new Map(), born: at, act, lastAt: at, lastUser: user }; byBoard.set(key, e); }
      e.users.set(user, at);
      if (at >= e.lastAt) { e.lastAt = at; e.act = act || e.act; e.lastUser = user; }
      return e;
    },
    /** Every warm cluster: { key, n, alpha, act, lastAt }. Drops the cold ones. */
    list(now) {
      const out = [];
      for (const [key, e] of byBoard) {
        const n = liveCount(e, now);
        let a = Math.min(1, Math.max(0, (now - e.born) / PRESENCE.fadeInMs));
        if (n === 0) {
          const gone = lastOf(e) + windowMs;
          const fade = Math.min(1, Math.max(0, (now - gone) / PRESENCE.fadeOutMs));
          if (fade >= 1) { byBoard.delete(key); continue; }
          a *= 1 - fade;
        }
        out.push({ key, n: Math.max(1, n), alpha: a, act: e.act, lastAt: e.lastAt, live: n > 0 });
      }
      return out;
    },
    /** The warm clusters someone is in right now, newest move first. */
    here(now) {
      return this.list(now).filter((e) => e.live).sort((a, b) => b.lastAt - a.lastAt);
    },
    get size() { return byBoard.size; },
  };
}

// ── The ticker ───────────────────────────────────────────────────────────
/** "16d 9h 05m": days, hours, and minutes always two digits. */
export function dhm(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m < 10 ? '0' : ''}${m}m`;
}

// ── Easing, shared with the renderer ─────────────────────────────────────
export function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
export function ease(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
export function inout(t) { t = clamp01(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
