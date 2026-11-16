// What the canvas needs of its comments the moment it opens, before the pins
// have arrived (they are a chunk of their own, fetched as the canvas mounts:
// components/comments/commentPartsLazy.jsx): the little store the comment
// parts share, which presses and keys belong to a comment part, the island's
// count, when a look is dated, and where a conversation is (a comment link
// goes there). Everything about drawing pins is lib/commentPins.js, which
// hands these on too, so the comment parts read one file.
//
// The canvas, the island and the comments hook import THIS file. A static
// import of lib/commentPins.js or lib/commentModel.js from any of them puts
// the pins back into the app's first download (scripts/bundleBudget.mjs
// LAZY_IN_APP fails on it).
//
// Pure: no React, no DOM.
import { toMs } from './toMs.js';
import { t, plural } from '@lingui/core/macro';

// What the comments button says aloud: the island on the canvas and the
// button on a doc's frame say the same thing in the same words.
export function openCommentsLabel(open, unread) {
  if (!open) return t`Comments`;
  return unread
    ? plural(open, { one: 'Comments, # open, some unread', other: 'Comments, # open, some unread' })
    : plural(open, { one: 'Comments, # open', other: 'Comments, # open' });
}

// A pin's tip sits this far in (screen px) from its card's top-right corner.
export const PIN_INSET = 10;

// The comment parts that take the keyboard and a held finger for themselves:
// the pins, the open conversation (card or sheet), the list, their menus and
// the island, and a note's own conversation (the card beside it) and a doc's
// panel. While the press or the caret is in one, the canvas's own
// shortcuts (Delete, arrows, tool letters, copy / paste, undo) and its hold
// menu stand down.
export const COMMENT_SURFACE_SELECTOR = '.cmt-pin, .cmt-canvas-card, .cmt-list, .cmt-list-scrim, .cmt-sheet-host, .cmt-sheet-scrim, .cmt-pop, .cnv-comments-eye, .cmt-float-host, .cmt-panel';
export function inCommentSurface(target) {
  try { return !!(target && typeof target.closest === 'function' && target.closest(COMMENT_SURFACE_SELECTOR)); }
  catch (_) { return false; }
}

// When a look at a conversation is dated: now, and never earlier than its
// newest row. A device whose clock runs behind the server's would otherwise
// date the look before the reply it is looking at, and the conversation would
// read as unread while open.
//   nowMs: this device's clock   newestMs: the newest row's created time
export function viewedStamp(nowMs, newestMs) {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const newest = toMs(newestMs);
  return newest == null ? now : Math.max(now, newest + 1);
}
// The server's "last looked" times, joined with the looks made here before
// they arrived: per conversation, the later of the two.
//   server, local: Map(rootId → ISO | ms)   → Map(rootId → same)
export function mergeViews(server, local) {
  const out = new Map(server instanceof Map ? server : []);
  for (const [id, at] of (local instanceof Map ? local : [])) {
    const a = toMs(at); const b = toMs(out.get(id));
    if (a != null && (b == null || a > b)) out.set(id, at);
  }
  return out;
}

// What the comments island says before anything is pressed: how many
// conversations are open here, and whether any is unread. Counted from the
// rows themselves, so the island does not wait for the conversation model;
// it is the same answer the list gives (canvasThreads + threadAnchor +
// threadUnread in lib/commentPins.js; commentCanvas.test.mjs holds the two
// together).
//   rows      public.comments rows
//   hasCard(id), groupBox(id)   is that card / section on the canvas
//   meId, views   me, and Map(rootId → when I last looked); nothing is unread
//                 until `views` has come back (null before)
//   → { open, unread }
export function openCommentTally(rows, { hasCard, groupBox } = {}, meId = null, views = null) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.id && r.anchor_kind !== 'doc_range');
  const open = new Set();
  for (const r of list) {
    // resolved, or put away by the old per-comment Hide: both list under Resolved
    if (r.reply_to || r.resolved || r.hidden) continue;
    const k = r.anchor_kind;
    // a conversation whose card is gone has nowhere to be: it is not counted
    const here = k === 'card' ? !!hasCard?.(r.anchor_id)
      : k === 'group' ? !!groupBox?.(r.anchor_id)
        : (k === 'point' || k === 'board');
    if (here) open.add(r.id);
  }
  let unread = false;
  if (meId && views) {
    for (const r of list) {
      const root = r.reply_to || r.id;
      if (!open.has(root) || r.deleted_at || (r.author || null) === meId) continue;
      const seen = toMs(views.get?.(root));
      const at = toMs(r.created_at);
      if (seen == null || (at != null && at > seen)) { unread = true; break; }
    }
  }
  return { open: open.size, unread };
}

// A draft shaped like a conversation, so it sits on the canvas as one does.
//   opts.id      its own id (draftTargetId), so drafts on two points stay apart
//   opts.active  the one being written now
export function draftThread(anchor, opts = {}) {
  if (!anchor) return null;
  return {
    id: opts.id || 'new',
    draft: true,
    active: !!opts.active,
    draftAnchor: anchor,
    root: { meta: { anchorKind: anchor.kind, anchorId: anchor.id ?? null, anchorX: anchor.x ?? null, anchorY: anchor.y ?? null } },
    replies: [],
  };
}

// The conversation a comment link names: the id of a root, or of a reply
// (then `rowId` is the reply to point out). null when no such row is left.
//   rows: public.comments rows (soft-deleted ones are already not listed)
export function findCommentThread(rows, commentId) {
  const id = String(commentId || '').toLowerCase();
  if (!id) return null;
  const list = Array.isArray(rows) ? rows : [];
  const hit = list.find((r) => r && String(r.id).toLowerCase() === id && r.anchor_kind !== 'doc_range');
  if (!hit) return null;
  if (!hit.reply_to) return { rootId: hit.id, rowId: null };
  const root = list.find((r) => r && r.id === hit.reply_to && !r.reply_to);
  return root ? { rootId: root.id, rowId: hit.id } : null;
}

// A box's turn (box.rot, degrees clockwise as CSS rotate) as cos / sin; an
// unturned box is exactly 1 / 0, so its numbers stay whole.
export function turnOf(box) {
  const deg = Number(box?.rot) || 0;
  if (!deg) return { cos: 1, sin: 0 };
  const r = (deg * Math.PI) / 180;
  return { cos: Math.cos(r), sin: Math.sin(r) };
}

// What a conversation is on. `cardBox(id)` / `groupBox(id)` give a world box
// { x, y, w, h, rot? } or null when the card or section is not on the canvas.
//   → { kind, key, id, box, wx, wy, dx, dy, ux, uy }
//        wx/wy world, dx/dy screen px; ux/uy the way a row of pins runs
//        (along the card's top edge, away from its top-right corner)
//   → { kind: 'board', key: 'board' }          no pin: the list only
//   → null                                     its card or section is gone
export function threadAnchor(thread, { cardBox, groupBox } = {}) {
  const m = thread?.root?.meta;
  if (!m) return null;
  if (m.anchorKind === 'card' || m.anchorKind === 'group') {
    const box = (m.anchorKind === 'card' ? cardBox : groupBox)?.(m.anchorId) || null;
    if (!box) return null;
    // A turned card: its top-right corner is where the turn put it, and the
    // pins run along the turned top edge (each pin stays upright).
    const { cos, sin } = turnOf(box);
    const hw = box.w / 2; const hh = box.h / 2;
    return {
      kind: m.anchorKind, key: `${m.anchorKind}:${m.anchorId}`, id: m.anchorId, box,
      wx: box.x + hw + hw * cos + hh * sin,
      wy: box.y + hh + hw * sin - hh * cos,
      dx: PIN_INSET * (-cos - sin), dy: PIN_INSET * (cos - sin),
      ux: -cos, uy: -sin || 0,
    };
  }
  if (m.anchorKind === 'point') {
    return { kind: 'point', key: `point:${thread.id}`, id: null, box: null, wx: m.anchorX || 0, wy: m.anchorY || 0, dx: 0, dy: 0, ux: -1, uy: 0 };
  }
  if (m.anchorKind === 'board') return { kind: 'board', key: 'board', id: null, box: null };
  return null;
}

// Where the camera should go so a conversation's place is in view at this
// zoom, with room beside it for the open card: a new pan, or null when its
// pin is already comfortably in view (or it has no place: the cluster's own).
// The pin is where threadAnchor put it (wx / wy), so a turned card's pin is
// looked for at its turned corner, and a turned card is measured by the room
// it takes up turned.
//   anchor  a threadAnchor   view  { pan, zoom, w, h } in the canvas's px
export function panToAnchor(anchor, view) {
  if (!anchor || anchor.kind === 'board' || !view || !(view.w >= 50)) return null;
  const z = view.zoom > 0 ? view.zoom : 1;
  const p = view.pan || { x: 0, y: 0 };
  const b = anchor.box || { x: anchor.wx, y: anchor.wy, w: 0, h: 0 };
  const wx = Number.isFinite(anchor.wx) ? anchor.wx : b.x + b.w;
  const wy = Number.isFinite(anchor.wy) ? anchor.wy : b.y;
  const pinX = p.x + wx * z; const pinY = p.y + wy * z;
  if (pinX > 80 && pinX < view.w - 40 && pinY > 70 && pinY < view.h - 80) return null;
  const { cos, sin } = turnOf(b);
  const tw = Math.abs(b.w * cos) + Math.abs(b.h * sin);
  const th = Math.abs(b.w * sin) + Math.abs(b.h * cos);
  const fits = tw * z < view.w - 120 && th * z < view.h - 120;
  return fits
    ? { x: view.w / 2 - (b.x + b.w / 2) * z, y: view.h / 2 - (b.y + b.h / 2) * z }
    : { x: view.w / 2 - wx * z, y: view.h / 3 - wy * z };
}

// The personal "Show comments on the canvas" switch: this browser only, per
// person and cluster. It never touches the comments themselves.
const SHOW_PREFIX = 'soleil.boards.comments.show.';
function showKey(userId, boardId) { return `${SHOW_PREFIX}${userId || 'anon'}.${boardId || '-'}`; }
function localStore() { try { return globalThis.localStorage || null; } catch (_) { return null; } }
export function readShowComments(userId, boardId, storage = localStore()) {
  try { return storage?.getItem(showKey(userId, boardId)) !== '0'; } catch (_) { return true; }
}
export function writeShowComments(userId, boardId, on, storage = localStore()) {
  try {
    if (on) storage?.removeItem(showKey(userId, boardId));
    else storage?.setItem(showKey(userId, boardId), '0');
  } catch (_) { /* a browser that refuses storage: the switch lasts the visit */ }
}

// The little shared state of the canvas's comment UI: which conversation is
// open, which row the list is pointing at, whether the list is open, and a
// comment being started. Outside React state so the canvas itself is not
// re-rendered when a pin is opened or a row is hovered.
//   { openId, hoverId, listOpen, tab, draft: { anchor } | null,
//     parked: [anchor]   comments started and left with words in them,
//     flashRowId         a reply a link pointed at, lit for a moment,
//     focusCard          the conversation opened from the keyboard, whose
//                        card takes the caret when it shows }
export function createCommentUi() {
  // openPin: where the open conversation's pin is drawn ({ wx, wy, dx, dy }),
  // which the pins tell the open card so it can stand clear of it
  let state = { openId: null, hoverId: null, listOpen: false, tab: 'open', draft: null, parked: [], flashRowId: null, focusCard: null, openPin: null };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      if (!p) return;
      let changed = false;
      for (const k of Object.keys(p)) if (state[k] !== p[k]) { changed = true; break; }
      if (!changed) return;
      state = { ...state, ...p };
      subs.forEach((f) => f());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
}
