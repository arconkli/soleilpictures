// A shared doc's live mirror (DocParty): one card's doc, cut out of its
// cluster's Y.Doc WITH ITS OWN YJS ITEM IDS, so edits merge exactly in both
// directions and the cluster stays the only source of truth.
//
//   extractDocSubtree(doc, cardKey, { variant })
//     The whole mirror as one update. Kept, as they are: the card's item in
//     the root `cards` map, the card map's doc keys (DOC_KEYS) and a few plain
//     card fields (CARD_FIELDS), everything under them, and each key's history
//     of earlier values (an item whose origin is missing would lose its
//     parent). Kept as length only: anything deleted (ContentDeleted, so no
//     deleted text leaves the cluster). Everything else in the cluster — other
//     cards, positions, the links map, other docs — becomes empty GC runs that
//     carry a client id and a length and nothing else, so every client's
//     clocks stay contiguous. The 'view' variant also leaves out docComments.
//
//   filterTransaction(doc, tr, cardKey, { variant, sent })
//     One board transaction, filtered the same way, for a mirror that already
//     holds `sent` (a state vector the caller keeps per mirror). Null when the
//     transaction does not touch this doc: the board pushes on change only.
//     A client's earlier unrelated edits ride along as one GC run from the
//     clock the mirror already has.
//
//   validateGuestUpdate(roomDoc, update, ctx)
//     The security boundary for writes from people outside the cluster. A
//     frame passes only if every item lands inside one of the doc's types
//     (never the root, the card map or a card field), every reference resolves
//     to a live part of the doc or to the frame itself, the clients are the
//     connection's own, the content kinds are plain, image sources are files
//     already in the doc, links are http(s) or mailto, comments are plain
//     entries filed as lib/commentKeys.js says and carry the connection's own
//     author, and deletions stay inside the doc.
//
// It relies on yjs struct internals (Item, GC, the V1 encoder): yjs is pinned
// to 13.6.x and docRoomBridge.test.mjs is the property suite that holds it.
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import { parseCommentKey, isPlainEntry, isFiledReply, isFiledState } from './commentKeys.js';

export const YJS_SERIES = '13.6.';
export const DOC_KEYS = Object.freeze([
  'docPages', 'docPageContent', 'docBookmarks', 'docComments', 'docPageSheets', 'docSheetContent', 'docMeta',
]);
export const CARD_FIELDS = Object.freeze(['kind', 'title', 'fontFamily']);
const VIEW_HIDDEN = new Set(['docComments']);
const GC_REF = 0;   // yjs structGCRefNumber
// A doc nests a few levels (cards → card → doc key → fragment → block → text,
// lists a little deeper): any walk longer than this is not a doc.
const MAX_WALK = 64;
// One guest frame: at most this many structs and delete ranges (a keystroke is
// one or two; a paste of a long page a few hundred).
export const GUEST_MAX_STRUCTS = 5000;
export const GUEST_MAX_DELETE_RANGES = 5000;

export function keptKeys(variant = 'edit') {
  const all = [...DOC_KEYS, ...CARD_FIELDS];
  return new Set(variant === 'view' ? all.filter((k) => !VIEW_HIDDEN.has(k)) : all);
}

// Where an integrated item sits relative to one card's doc:
//   'card'        an item of the root `cards` map under this card's key
//   'entry:<k>'   a key of that card's map
//   'in:<k>'      inside the type held at key k
//   null          anywhere else
export function placeOf(item, cardsRoot, cardKey) {
  let it = item;
  for (let guard = 0; guard < MAX_WALK && it; guard++) {
    const parent = it.parent;
    if (!parent || typeof parent !== 'object' || !('_item' in parent)) return null;
    const pItem = parent._item;
    if (pItem === null) {
      return parent === cardsRoot && it.parentSub === cardKey && it === item ? 'card' : null;
    }
    if (pItem.parent === cardsRoot && pItem.parentSub === cardKey) {
      const key = it.parentSub;
      if (typeof key !== 'string') return null;
      return it === item ? `entry:${key}` : `in:${key}`;
    }
    it = pItem;
  }
  return null;
}

const keyOfPlace = (p) => (p && p.includes(':') ? p.slice(p.indexOf(':') + 1) : null);

// keep(item) → 'full' | 'deleted' | 'gc' for one card's mirror.
function keeper(doc, cardKey, variant) {
  const cardsRoot = doc.share.get('cards');
  const kept = keptKeys(variant);
  return (s) => {
    if (!cardsRoot || !(s instanceof Y.Item)) return 'gc';
    const p = placeOf(s, cardsRoot, cardKey);
    if (!p) return 'gc';
    if (p !== 'card' && !kept.has(keyOfPlace(p))) return 'gc';
    return s.deleted ? 'deleted' : 'full';
  };
}

// A deleted item as it goes out: same id, origins and parent, no content.
function deletedCopy(s) {
  return new Y.Item(s.id, null, s.origin, null, s.rightOrigin, s.parent, s.parentSub, new Y.ContentDeleted(s.length));
}

// Write one client's structs over [from, to), each as `decide` says, with
// adjacent GC runs merged. A kept struct that runs past `to` is written whole:
// the extra clocks are the same struct the board holds.
function writeClientRange(enc, structs, client, from, to, decide) {
  const out = [];
  let i = Y.findIndexSS(structs, from);
  let clock = from;
  while (i < structs.length && clock < to) {
    const s = structs[i];
    const offset = clock - s.id.clock;
    const mode = decide(s);
    if (mode === 'gc') {
      const end = Math.min(s.id.clock + s.length, to);
      const last = out[out.length - 1];
      if (last && last.mode === 'gc') last.len += end - clock;
      else out.push({ mode, len: end - clock });
      clock = end;
    } else {
      out.push({ mode, s, offset });
      clock = s.id.clock + s.length;
    }
    i += 1;
  }
  encoding.writeVarUint(enc.restEncoder, out.length);
  enc.writeClient(client);
  encoding.writeVarUint(enc.restEncoder, from);
  for (const o of out) {
    if (o.mode === 'gc') { enc.writeInfo(GC_REF); enc.writeLen(o.len); }
    else if (o.mode === 'full') o.s.write(enc, o.offset);
    else deletedCopy(o.s).write(enc, o.offset);
  }
  return clock;
}

function writeDeleteSet(enc, ranges) {
  const clients = [...ranges.entries()].filter(([, list]) => list.length).sort((a, b) => b[0] - a[0]);
  encoding.writeVarUint(enc.restEncoder, clients.length);
  for (const [client, list] of clients) {
    enc.resetDsCurVal();
    encoding.writeVarUint(enc.restEncoder, client);
    encoding.writeVarUint(enc.restEncoder, list.length);
    for (const [clock, len] of list) { enc.writeDsClock(clock); enc.writeDsLen(len); }
  }
}

// The whole mirror of one card's doc, or null when the card is not there.
// Returns { update, sent } — `sent` is the state vector the mirror now holds.
export function extractDocSubtree(doc, cardKey, { variant = 'edit' } = {}) {
  const cardsRoot = doc.share.get('cards');
  const cardItem = cardsRoot?._map?.get(cardKey);
  if (!cardItem || cardItem.deleted || !(cardItem.content instanceof Y.ContentType)) return null;
  const decide = keeper(doc, cardKey, variant);
  const enc = new Y.UpdateEncoderV1();
  const sent = new Map();
  const clients = [...doc.store.clients.entries()].sort((a, b) => b[0] - a[0]);
  encoding.writeVarUint(enc.restEncoder, clients.length);
  for (const [client, structs] of clients) {
    const from = structs[0].id.clock;
    const last = structs[structs.length - 1];
    const to = last.id.clock + last.length;
    writeClientRange(enc, structs, client, from, to, decide);
    sent.set(client, to);
  }
  // Deletions travel as ContentDeleted / GC: nothing to add.
  writeDeleteSet(enc, new Map());
  return { update: enc.toUint8Array(), sent };
}

// One transaction for one mirror, or null when it does not touch the doc.
// `sent` (Map client → clock) is advanced in place when an update is returned.
export function filterTransaction(doc, tr, cardKey, { variant = 'edit', sent = new Map() } = {}) {
  const decide = keeper(doc, cardKey, variant);
  // Clients whose new structs touch this doc.
  const touched = [];
  tr.afterState.forEach((after, client) => {
    const before = tr.beforeState.get(client) || 0;
    if (after <= before) return;
    const structs = doc.store.clients.get(client);
    if (!structs) return;
    let i = Y.findIndexSS(structs, before);
    for (; i < structs.length && structs[i].id.clock < after; i++) {
      if (decide(structs[i]) !== 'gc') { touched.push([client, after]); return; }
    }
  });
  // Deletions inside this doc.
  const dels = new Map();
  tr.deleteSet.clients.forEach((items, client) => {
    const structs = doc.store.clients.get(client);
    if (!structs) return;
    for (const { clock, len } of items) {
      const end = clock + len;
      let i = Y.findIndexSS(structs, clock);
      for (; i < structs.length && structs[i].id.clock < end; i++) {
        const s = structs[i];
        if (decide(s) === 'gc') continue;
        const a = Math.max(clock, s.id.clock);
        const b = Math.min(end, s.id.clock + s.length);
        if (b > a) {
          if (!dels.has(client)) dels.set(client, []);
          dels.get(client).push([a, b - a]);
        }
      }
    }
  });
  if (!touched.length && !dels.size) return null;
  const enc = new Y.UpdateEncoderV1();
  const ranges = touched
    .map(([client, after]) => [client, Math.min(sent.get(client) || 0, after), after])
    .filter(([, from, to]) => to > from)
    .sort((a, b) => b[0] - a[0]);
  encoding.writeVarUint(enc.restEncoder, ranges.length);
  for (const [client, from, to] of ranges) {
    const end = writeClientRange(enc, doc.store.clients.get(client), client, from, to, decide);
    sent.set(client, Math.max(sent.get(client) || 0, end));
  }
  writeDeleteSet(enc, dels);
  return enc.toUint8Array();
}

// Whether one board transaction put a NEW type in place of the doc, rather
// than editing the one there: the card's map itself (an undo of its delete, an
// API update that rewrites the card through cardToYMap, a doc-only restore
// that clones an old version in), or the type at one of the mirror's doc keys.
// The mirror would follow it exactly, but a reader bound to the old types
// (DocShareView, its editor, a guest's pending edits) would go on showing and
// writing into what the cluster has just thrown away, and the room would keep
// trusting the image keys the old doc held. So the board sends the room on
// (4012) instead, and a fresh room is built from the cluster as it now is.
// A map entry that takes the place of an earlier value has a left: the first
// value a key ever gets (initCardDocStore, a new card) has none.
export function replacesDoc(doc, tr, cardKey, { variant = 'edit' } = {}) {
  const cardsRoot = doc.share.get('cards');
  if (!cardsRoot) return false;
  const kept = keptKeys(variant);
  let hit = false;
  tr.afterState.forEach((after, client) => {
    if (hit) return;
    const before = tr.beforeState.get(client) || 0;
    if (after <= before) return;
    const structs = doc.store.clients.get(client);
    if (!structs) return;
    for (let i = Y.findIndexSS(structs, before); i < structs.length && structs[i].id.clock < after; i++) {
      const s = structs[i];
      if (!(s instanceof Y.Item) || s.left === null || !(s.content instanceof Y.ContentType)) continue;
      const p = placeOf(s, cardsRoot, cardKey);
      if (p === 'card' || (p && p.startsWith('entry:') && DOC_KEYS.includes(keyOfPlace(p)) && kept.has(keyOfPlace(p)))) {
        hit = true;
        return;
      }
    }
  });
  return hit;
}

// The mirror's state vector after it applied `update` from the board: what a
// caller records as `sent` for a mirror that has just been rebuilt.
export function stateVectorOf(doc) {
  return Y.decodeStateVector(Y.encodeStateVector(doc));
}

// Every r2:<key> written in a stretch of bytes (an update, a state).
export function r2KeysIn(bytes) {
  const out = new Set();
  if (!bytes || !bytes.length) return out;
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const re = /r2:([A-Za-z0-9][A-Za-z0-9._\-/]{2,300})/g;
  let m;
  while ((m = re.exec(s))) out.add(m[1]);
  return out;
}

// ── Guest writes ────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set([Y.XmlElement, Y.XmlText, Y.XmlFragment, Y.Map, Y.Array, Y.Text]);
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
// Attribute names a guest may write on a node. Anything shaped like an event
// handler, a style or another way to load a URL is refused, whether or not the
// editor's schema would drop it, in case some path ever serializes the doc
// itself (security review, 2026-10-18).
const ATTR_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const ATTR_DENY = /^(on|style$|srcset$|poster$|background$|formaction$|xlink|data$|action$|ping$|lowsrc$|dynsrc$|codebase$|manifest$|iframe|embed)/i;
const UNSAFE_VALUE = /(javascript|vbscript|livescript)\s*:|data\s*:\s*text\/html|url\s*\(/i;

function isAllowedContent(c) {
  if (c instanceof Y.ContentAny) return c.arr.length > 0;
  if (c instanceof Y.ContentString || c instanceof Y.ContentFormat || c instanceof Y.ContentDeleted) return true;
  if (c instanceof Y.ContentType) return ALLOWED_TYPES.has(c.type.constructor);
  return false;   // ContentDoc, ContentBinary, ContentEmbed, ContentJSON
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const COMMENT_MAX = 4000;   // docState's addCommentReply cuts a reply there

const byGuest = (x, ctx) => !!x && typeof x === 'object' && x.authorId === ctx.userId
  && (ctx.displayName == null || x.author === ctx.displayName);

// A comment thread written by a guest: a new one must be theirs; an existing
// one may only gain their own replies, or be resolved / reopened.
function threadChangeOk(prev, next, ctx) {
  if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
  const mine = (x) => byGuest(x, ctx);
  if (prev == null) return mine(next) && (!Array.isArray(next.replies) || next.replies.every(mine));
  if (typeof prev !== 'object') return false;
  const { replies: pr = [], resolved: pRes, ...pRest } = prev;
  const { replies: nr = [], resolved: nRes, ...nRest } = next;
  if (!sameJson(pRest, nRest)) return false;
  if (!Array.isArray(pr) || !Array.isArray(nr) || nr.length < pr.length) return false;
  for (let i = 0; i < pr.length; i++) if (!sameJson(pr[i], nr[i])) return false;
  for (let i = pr.length; i < nr.length; i++) if (!mine(nr[i])) return false;
  void pRes; void nRes;   // resolving or reopening is any editor's to do
  return true;
}

// One value a guest writes into docComments under `key` (lib/commentKeys.js):
// a thread as threadChangeOk allows, a reply of their own written once, or a
// resolve in their own name (resolving or reopening is any editor's to do).
// → null, or the reason it is refused.
function commentEntryRefusal(key, prev, next, ctx) {
  const p = parseCommentKey(key);
  if (!p) return 'comment_shape';
  if (p.kind === 'thread') return threadChangeOk(prev, next, ctx) ? null : 'comment_author';
  if (p.kind === 'reply') {
    if (!isFiledReply(key, next) || typeof next.body !== 'string' || next.body.length > COMMENT_MAX) return 'comment_shape';
    if (prev !== undefined) return 'comment_author';
    return byGuest(next, ctx) ? null : 'comment_author';
  }
  if (!isFiledState(key, next)) return 'comment_shape';
  // The name shown for whoever resolved it ("Resolved by …") is theirs too,
  // as docState.resolveComment files it, or there is none.
  if (next.byName != null && typeof next.byName !== 'string') return 'comment_shape';
  const named = next.byName == null || ctx.displayName == null
    || next.byName === String(ctx.displayName).trim().slice(0, 80);
  return next.by === ctx.userId && named ? null : 'comment_author';
}

// The values one item holds. An item can hold several (a frame may write a
// run of them as one), and a map entry reads as the LAST: every one is
// checked, and what the room reads of an item it already has is the last.
const valuesOf = (content) => (content instanceof Y.ContentAny ? content.arr : []);
const lastValue = (content) => {
  const v = valuesOf(content);
  return v.length ? v[v.length - 1] : undefined;
};
const isValueContent = (c) => c instanceof Y.ContentAny || c instanceof Y.ContentDeleted;

// ctx: { cardKey, claims: Set<client> (this connection's own clients),
//        userId, displayName, trustedKeys: Set<'<key>'>, maxBytes,
//        writableKeys?: Set<key>, structureOnly?: boolean }
// structureOnly: the board's own second look at a write its doc room already
// passed (security review): only WHERE everything lands is checked, against
// the board's full doc; who wrote it and what it says were the room's to judge.
// → { ok: true, clients: [ids it writes], empty } | { ok: false, reason }
export function validateGuestUpdate(roomDoc, update, ctx = {}) {
  const fail = (reason) => ({ ok: false, reason });
  if (!(update instanceof Uint8Array) || !update.length) return fail('empty');
  if (ctx.maxBytes && update.length > ctx.maxBytes) return fail('too_large');
  const cardsRoot = roomDoc.share.get('cards');
  if (!cardsRoot) return fail('no_doc');
  const writable = ctx.writableKeys || new Set(DOC_KEYS);
  let decoded;
  try { decoded = Y.decodeUpdate(update); } catch (_) { return fail('malformed'); }
  const { structs, ds } = decoded;
  const store = roomDoc.store;
  const state = (client) => Y.getState(store, client);
  const claims = ctx.claims || new Set();

  // Whose structs these are, and that they follow on from what the room has.
  const firstClock = new Map();
  for (const s of structs) {
    const c = s.id.client;
    if (!firstClock.has(c)) firstClock.set(c, s.id.clock);
  }
  for (const [client, clock] of firstClock) {
    if (!ctx.structureOnly && state(client) > 0 && !claims.has(client)) return fail('foreign_client');
    if (clock > state(client)) return fail('gap');
  }

  if (structs.length > GUEST_MAX_STRUCTS) return fail('too_many');
  let dsRanges = 0;
  for (const [, list] of ds.clients) dsRanges += list.length;
  if (dsRanges > GUEST_MAX_DELETE_RANGES) return fail('too_many');

  // New items, by id, for references inside the frame: per client, in clock
  // order (a frame lists each client's structs in order), found by bisection.
  const fresh = new Map();   // `${client}:${clock}` → { s, zone }
  const keyOf = (id) => `${id.client}:${id.clock}`;
  const byClient = new Map();
  for (const s of structs) {
    if (!byClient.has(s.id.client)) byClient.set(s.id.client, []);
    byClient.get(s.id.client).push(s);
  }
  const findFresh = (id) => {
    const list = byClient.get(id.client);
    if (!list) return null;
    let lo = 0;
    let hi = list.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid];
      if (id.clock < s.id.clock) hi = mid - 1;
      else if (id.clock >= s.id.clock + s.length) lo = mid + 1;
      else return s;
    }
    return null;
  };
  // The place of an existing room item, or of a fresh one (computed below).
  const placeOfRef = (id) => {
    if (id.clock < state(id.client)) {
      const it = Y.getItem(store, id);
      if (!(it instanceof Y.Item)) return { gc: true };
      return { place: placeOf(it, cardsRoot, ctx.cardKey), item: it };
    }
    const f = findFresh(id);
    if (!f) return { missing: true };
    return { fresh: f, place: fresh.get(keyOf(f.id))?.place ?? undefined };
  };
  const insideKey = (p) => (p && (p.startsWith('in:') || p.startsWith('entry:')) ? keyOfPlace(p) : null);

  // Items first, in order; a reference to a fresh item later in the frame is
  // resolved on a later pass.
  const items = structs.filter((s) => s instanceof Y.Item);
  const replacedThreads = new Set();
  for (const s of structs) {
    if (ctx.structureOnly) break;
    if (!(s instanceof Y.Item) && !claims.has(s.id.client) && state(s.id.client) > 0) return fail('foreign_client');
  }
  // The type a fresh item of this frame lands in, once it is known.
  const parentOfFresh = (f) => fresh.get(keyOf(f.id))?.parentObj ?? null;
  // A map key a fresh item writes: its own, or (when it replaces a value) its origin's.
  const subOfFresh = (f) => fresh.get(keyOf(f.id))?.sub ?? null;
  const commentsType = cardsRoot._map.get(ctx.cardKey)?.content?.type?._map?.get('docComments')?.content?.type || null;

  let pending = items;
  for (let pass = 0; pass < 8 && pending.length; pass++) {
    const next = [];
    for (const s of pending) {
      if (!isAllowedContent(s.content)) return fail('content');
      let key = null;
      let parentObj = null;   // the type the item lands in, existing or fresh
      let originSub = null;   // the map key of the value it replaces
      if (typeof s.parent === 'string') return fail('root_write');
      if (s.parent) {
        const r = placeOfRef(s.parent);
        if (r.missing) return fail('missing_ref');
        if (r.gc) return fail('gc_ref');
        if (r.place === undefined) { next.push(s); continue; }
        // The parent must be a doc type, or a type inside one.
        key = insideKey(r.place);
        if (!key || !writable.has(key)) return fail('outside_doc');
        const holder = r.item || r.fresh;
        parentObj = holder && holder.content instanceof Y.ContentType ? holder.content.type : null;
      } else {
        const ref = s.origin || s.rightOrigin;
        if (!ref) return fail('no_parent');
        for (const o of [s.origin, s.rightOrigin]) {
          if (!o) continue;
          const r = placeOfRef(o);
          if (r.missing) return fail('missing_ref');
          if (r.gc) return fail('gc_ref');
          if (r.place === undefined) { key = undefined; break; }
          // A sibling inside a doc type: never an entry of the card map (that
          // would replace a doc key) and never the card itself.
          if (!r.place || !r.place.startsWith('in:')) return fail('outside_doc');
          const k = keyOfPlace(r.place);
          if (!writable.has(k) || (key && key !== k)) return fail('outside_doc');
          key = k;
          if (r.item) {
            parentObj = r.item.parent || parentObj;
            if (o === s.origin) originSub = r.item.parentSub || null;
          } else if (r.fresh) {
            parentObj = parentOfFresh(r.fresh) || parentObj;
            if (o === s.origin) originSub = subOfFresh(r.fresh);
          }
        }
        if (key === undefined) { next.push(s); continue; }
      }
      const sub = s.parentSub || originSub || null;
      fresh.set(keyOf(s.id), { s, place: `in:${key}`, parentObj, sub });
      // docComments holds plain values, each straight under it: never a type,
      // and nothing inside one. Readers have never been written for anything
      // else, and a type under a thread's key once read as a thread.
      if (commentsType && key === 'docComments'
          && (parentObj !== commentsType || !isValueContent(s.content))) return fail('comment_shape');
      if (ctx.structureOnly) continue;

      // What it says.
      if (s.content instanceof Y.ContentFormat && s.content.key === 'link') {
        const href = s.content.value && typeof s.content.value === 'object' ? s.content.value.href : null;
        if (href != null && !SAFE_HREF.test(String(href))) return fail('unsafe_link');
      }
      // An attribute of a node (an entry of an XmlElement): its name and value,
      // and a value, never a type that a read would hand on as one.
      if (sub && parentObj instanceof Y.XmlElement) {
        if (!ATTR_NAME.test(sub) || ATTR_DENY.test(sub) || !isValueContent(s.content)) return fail('attribute');
        for (const v of valuesOf(s.content)) if (typeof v === 'string' && UNSAFE_VALUE.test(v)) return fail('unsafe_link');
      }
      if (sub === 'src') {
        if (!isValueContent(s.content)) return fail('untrusted_src');
        for (const v of valuesOf(s.content)) {
          if (v == null) continue;
          const m = /^r2:(.+)$/.exec(String(v));
          if (!m || !(ctx.trustedKeys && ctx.trustedKeys.has(m[1]))) return fail('untrusted_src');
        }
      }
      if (sub === 'href') {
        if (!isValueContent(s.content)) return fail('unsafe_link');
        for (const v of valuesOf(s.content)) if (v != null && !SAFE_HREF.test(String(v))) return fail('unsafe_link');
      }
      // A comment entry: docComments[<key>] = { … } (lib/commentKeys.js).
      if (commentsType && parentObj === commentsType && sub && s.content instanceof Y.ContentAny) {
        const prev = commentsType.get(sub);
        for (const v of valuesOf(s.content)) {
          const why = commentEntryRefusal(sub, prev, v, ctx);
          if (why) return fail(why);
        }
        // This key's old value may go: it was replaced by one that passed.
        replacedThreads.add(sub);
      }
    }
    if (next.length === pending.length) return fail('missing_ref');
    pending = next;
  }
  if (pending.length) return fail('missing_ref');

  // Deletions: only inside the doc. In docComments, a value this frame put a
  // valid new one in place of may go; otherwise a thread goes only when its
  // author removes it, a reply when its author does or its thread goes in the
  // same frame (or is gone already), and a resolve with any editor. Taking
  // away what is already gone changes nothing.
  const goneThreads = new Set();
  const repliesOf = [];   // threads whose replies (not the guest's) this frame removes
  for (const [client, list] of ds.clients) {
    for (const { clock, len } of list) {
      for (let c = clock; c < clock + len;) {
        if (c >= state(client)) {
          const f = findFresh(Y.createID(client, c));
          if (!f) return fail('missing_ref');
          c = f.id.clock + f.length;
          continue;
        }
        const it = Y.getItem(store, Y.createID(client, c));
        const next = it.id.clock + it.length;
        if (it instanceof Y.Item) {
          const p = placeOf(it, cardsRoot, ctx.cardKey);
          if (!p || !p.startsWith('in:') || !writable.has(keyOfPlace(p))) return fail('outside_doc');
          if (!ctx.structureOnly && commentsType && it.parent === commentsType && it.parentSub
              && !it.deleted && !replacedThreads.has(it.parentSub)) {
            const ck = parseCommentKey(it.parentSub);
            const prev = lastValue(it.content);
            const theirs = !!prev && typeof prev === 'object' && prev.authorId === ctx.userId;
            if (!ck) return fail('comment_shape');
            if (ck.kind === 'thread') {
              if (!theirs) return fail('comment_author');
              goneThreads.add(ck.threadId);
            } else if (ck.kind === 'reply' && !theirs) repliesOf.push(ck.threadId);
          }
        }
        c = next;
      }
    }
  }
  for (const id of repliesOf) {
    if (!goneThreads.has(id) && isPlainEntry(commentsType.get(id))) return fail('comment_author');
  }
  return { ok: true, clients: [...firstClock.keys()], empty: structs.length === 0 && ds.clients.size === 0 };
}
