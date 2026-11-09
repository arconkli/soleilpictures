// Who is uploading what, through presence. Each tab publishes the uploads it
// is moving for the open cluster as an awareness field:
//
//   uploading = { boardId, cards: { [cardId]: code } }   or null
//
// code: 0..100 percent sent, -1 waiting, -2 didn't upload, -3 making a preview.
// Everyone else reads it to say, on a card that has no file yet, who is on it.
//
// Every awareness write is a billed room message relayed to every socket, so
// the publisher keeps them sparse (at most one a second, percent-only changes
// rarer still). lib/yPartyKit.js sets `uploading: null` with `user`, so a state
// with `user` and no `uploading` key is a build from before (`legacy`).

export const UNFINISHED_AFTER_MS = 120000;   // a card nobody lists this long didn't finish
const SETTLE_MS = 5000;        // after the room connects, states arrive a moment later
const PUBLISH_EVERY_MS = 1000;
const PERCENT_EVERY_MS = 4000;
const PERCENT_STEP = 5;
const RETRY_MS = 500;
const RESOLVE_MS = 500;
const LIVE_POLL_MS = 1000;
const TICK_MS = 10000;

const WAITING = -1;
const FAILED = -2;
const FINISHING = -3;

const systemClock = {
  now: () => Date.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id),
};

// items: the activity store's items (lib/activity.js).
export function encodeUploading(boardId, items) {
  const cards = {};
  let any = false;
  for (const it of items || []) {
    if (!it || it.boardId !== boardId || !it.cardId) continue;
    let code;
    if (it.state === 'waiting') code = WAITING;
    else if (it.state === 'failed') code = FAILED;
    else if (it.state === 'finishing') code = FINISHING;
    else if (it.state === 'running') code = Math.min(99, Math.max(0, Math.floor((it.fraction || 0) * 100)));
    else continue;
    cards[it.cardId] = code;
    any = true;
  }
  if (!any) return null;
  const sorted = {};
  for (const k of Object.keys(cards).sort()) sorted[k] = cards[k];
  return { boardId, cards: sorted };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const category = (code) => (code >= 0 ? 'running' : code);

// Whether going from `a` to `b` adds, drops or re-categorises a card.
function structural(a, b) {
  const ac = a?.cards || {};
  const bc = b?.cards || {};
  const ak = Object.keys(ac);
  if (ak.length !== Object.keys(bc).length) return true;
  for (const k of ak) if (!(k in bc) || category(ac[k]) !== category(bc[k])) return true;
  return false;
}
function movedFar(a, b) {
  const ac = a?.cards || {};
  const bc = b?.cards || {};
  for (const k in bc) if (k in ac && ac[k] >= 0 && bc[k] >= 0 && Math.abs(bc[k] - ac[k]) >= PERCENT_STEP) return true;
  return false;
}

// `getAwareness()` is asked at each publish: null while the room isn't there
// yet, and a different object once a remount replaced it.
export function createUploadPublisher({ getAwareness, boardId, clock = systemClock } = {}) {
  let wanted = null;
  let written = null;          // what the current awareness holds from us
  let writtenAt = -Infinity;
  let aw = null;
  let timer = null;
  let disposed = false;

  const cancel = () => { if (timer != null) { clock.clear(timer); timer = null; } };
  const later = (ms) => {
    cancel();
    timer = clock.set(() => { timer = null; evaluate(); }, Math.max(0, ms));
  };
  const write = (a, value) => {
    try { a.setLocalStateField('uploading', value); } catch (_) { /* a destroyed awareness */ }
    written = value;
    writtenAt = clock.now();
  };

  function evaluate() {
    if (disposed) return;
    const a = getAwareness?.() || null;
    if (!a) {
      if (wanted != null || written != null) later(RETRY_MS);
      return;
    }
    if (a !== aw) {
      // A new room starts from `uploading: null`; hand it the last value at once.
      aw = a;
      written = null;
      writtenAt = -Infinity;
      if (wanted != null) { cancel(); write(a, wanted); }
      return;
    }
    if (same(wanted, written)) { cancel(); return; }
    const now = clock.now();
    const sinceLast = now - writtenAt;
    let wait;
    if (written == null || wanted == null || structural(written, wanted)) wait = PUBLISH_EVERY_MS - sinceLast;
    else if (movedFar(written, wanted)) wait = PUBLISH_EVERY_MS - sinceLast;
    else wait = PERCENT_EVERY_MS - sinceLast;
    if (wait <= 0) { cancel(); write(a, wanted); } else later(wait);
  }

  return {
    push(items) {
      if (disposed) return;
      wanted = encodeUploading(boardId, items);
      evaluate();
    },
    dispose() {
      if (disposed) return;
      cancel();
      const a = getAwareness?.() || null;
      if (a && a === aw && written != null) write(a, null);
      disposed = true;
    },
  };
}

// states: awareness.getStates().
export function readPeerUploads(states, { boardId, selfClientId } = {}) {
  const byCard = new Map();
  const users = new Map();
  if (!states) return { byCard, users };
  for (const [clientId, s] of states) {
    if (clientId === selfClientId || !s?.user) continue;
    const { id: userId, name, color } = s.user;
    const legacy = !('uploading' in s);
    const had = users.get(userId);
    users.set(userId, { name, color, legacy: legacy && (had ? had.legacy : true) });
    const up = s.uploading;
    if (!up || up.boardId !== boardId || !up.cards) continue;
    for (const cardId of Object.keys(up.cards)) {
      if (!byCard.has(cardId)) byCard.set(cardId, { code: up.cards[cardId], userId, name, color, clientId });
    }
  }
  return { byCard, users };
}

// What a card without its file shows. `card`: { id, createdBy, createdAt };
// `peers`: readPeerUploads; `me`: my user id; `lastListedAt`, `firstSeen`: ms
// this tab last saw a state list the card, and first saw the card. `away`:
// Map userId -> { name, color, boards: Set<boardId> } of people whose tab is
// on another cluster but still uploading to these (workspace presence); with
// `boardId` it says "still uploading" where no open tab lists the card.
export function peerCardView({ card, me, peers, away = null, boardId = null, lastListedAt = null, firstSeen = null, liveSince = null, now }) {
  const listed = peers?.byCard.get(card.id);
  if (listed) return { kind: 'mate', code: listed.code, name: listed.name, color: listed.color, mine: listed.userId === me };
  const gone = card.createdBy ? away?.get(card.createdBy) : null;
  if (gone && boardId != null && gone.boards?.has(boardId)) {
    return { kind: 'away', name: gone.name, color: gone.color, mine: !!me && card.createdBy === me };
  }
  const creator = card.createdBy ? peers?.users.get(card.createdBy) : null;
  if (creator?.legacy) return { kind: 'legacy', name: creator.name, color: creator.color };
  // Our own socket closing wipes every remote state, and states arrive a
  // moment after connecting: nothing is known yet.
  if (liveSince == null || now - liveSince < SETTLE_MS) return { kind: 'quiet' };
  const since = Math.max(lastListedAt ?? 0, Date.parse(card.createdAt) || firstSeen || now);
  if (now - since < UNFINISHED_AFTER_MS) return { kind: 'quiet' };
  return { kind: 'gone', mine: !!me && card.createdBy === me };
}

const viewKeyOf = (v) => {
  if (v.kind === 'mate') return `m|${v.code}|${v.name}|${v.color}|${v.mine ? 1 : 0}`;
  if (v.kind === 'away') return `a|${v.name}|${v.color}|${v.mine ? 1 : 0}`;
  if (v.kind === 'legacy') return `l|${v.name}|${v.color}`;
  if (v.kind === 'gone') return `g|${v.mine ? 1 : 0}`;
  return 'q';
};

export function createPeerUploadsStore({ getAwareness, getRoom, boardId, me, clock = systemClock } = {}) {
  const subs = new Set();
  const lastListedAt = new Map();
  const firstSeen = new Map();
  let aw = null;
  let peers = readPeerUploads(null);
  let away = null;
  let awayKey = '[]';
  let liveSince = null;
  let fingerprint = '';
  let resolveTimer = null;
  let liveTimer = null;
  let tickTimer = null;
  let disposed = false;

  const notify = () => { for (const fn of [...subs]) fn(); };

  // Returns whether what views are made from changed.
  const recompute = () => {
    const now = clock.now();
    peers = aw ? readPeerUploads(aw.getStates(), { boardId, selfClientId: aw.clientID }) : readPeerUploads(null);
    for (const id of peers.byCard.keys()) lastListedAt.set(id, now);
    const room = getRoom?.();
    const live = !!(room && room.wsconnected && room.synced);
    if (live) { if (liveSince == null) liveSince = now; } else liveSince = null;
    const fp = JSON.stringify([
      [...peers.byCard].map(([id, v]) => [id, v.code, v.userId, v.name, v.color]),
      [...peers.users].map(([id, u]) => [id, u.name, u.color, u.legacy]),
      liveSince != null,
    ]);
    const changed = fp !== fingerprint;
    fingerprint = fp;
    if (!live) pollLive();
    return changed;
  };
  const onChange = () => { if (recompute()) notify(); };

  function pollLive() {
    if (liveTimer != null || disposed) return;
    liveTimer = clock.set(() => {
      liveTimer = null;
      onChange();
    }, LIVE_POLL_MS);
  }

  const resolve = () => {
    if (disposed) return;
    const next = getAwareness?.() || null;
    if (next !== aw) {
      aw?.off('change', onChange);
      aw = next;
      aw?.on('change', onChange);
      onChange();
    }
    resolveTimer = clock.set(resolve, RESOLVE_MS);
  };

  const startTick = () => {
    tickTimer = clock.set(() => { tickTimer = null; if (subs.size) { notify(); startTick(); } }, TICK_MS);
  };

  resolve();
  recompute();

  function view(card) {
    const now = clock.now();
    if (!firstSeen.has(card.id)) firstSeen.set(card.id, now);
    return peerCardView({
      card, me, peers, away, boardId, now, liveSince,
      lastListedAt: lastListedAt.get(card.id) ?? null,
      firstSeen: firstSeen.get(card.id),
    });
  }

  // Only entries that name this cluster can change a view.
  const awayKeyOf = (m) => JSON.stringify([...(m || [])]
    .filter(([, u]) => u?.boards?.has(boardId))
    .map(([id, u]) => [id, u.name, u.color]).sort());

  return {
    setAway(map) {
      away = map || null;
      const key = awayKeyOf(away);
      if (key === awayKey) return;
      awayKey = key;
      if (!disposed) notify();
    },
    subscribe(fn) {
      subs.add(fn);
      if (subs.size === 1 && tickTimer == null && !disposed) startTick();
      return () => {
        subs.delete(fn);
        if (!subs.size && tickTimer != null) { clock.clear(tickTimer); tickTimer = null; }
      };
    },
    viewKey: (card) => viewKeyOf(view(card)),
    view,
    dispose() {
      disposed = true;
      for (const t of [resolveTimer, liveTimer, tickTimer]) if (t != null) clock.clear(t);
      resolveTimer = liveTimer = tickTimer = null;
      aw?.off('change', onChange);
      aw = null;
      subs.clear();
    },
  };
}
