// Canvas comments as pins: where each conversation's pin sits, which pins
// gather into one count when they crowd, what is unread, what is "for you".
// Where the open conversation card goes beside its card is
// lib/commentCardPlace.js.
//
// It arrives with the pins, just after the canvas. What the canvas needs
// before then (the store the comment parts share, where a conversation is,
// the island's count) is lib/commentCanvas.js, handed on from here so the
// comment parts read one file; the canvas itself never imports this one.
//
// Pure: no React, no DOM. `threads` are commentModel Threads built from
// public.comments rows (fromCanvasRows); a root's meta says what it is on.
//
// A pin is a 30px teardrop whose tip (bottom-left corner) is on its anchor.
// It is drawn inside the canvas transform at a WORLD point and scaled back by
// 1/zoom, so every offset below that is in SCREEN px stays that size at any
// zoom: the tip sits 10px in from a card's top-right corner, and several
// conversations on one card line up leftward 26px apart, oldest rightmost.
import { t, plural } from '@lingui/core/macro';
import { commentBy } from './commentAuthor.js';
import { fromCanvasRows, toMs } from './commentModel.js';
import { PIN_INSET, draftThread, threadAnchor } from './commentCanvas.js';

export * from './commentCanvas.js';

export const PIN_SIZE = 30;
export const PIN_STEP = 26;
export const GATHER_PX = 40;

// The canvas's own conversations. A doc range's comments live inside the doc.
export function canvasThreads(rows, people) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.anchor_kind !== 'doc_range');
  return fromCanvasRows(list, people);
}

// Resolved, or put away by the old per-comment Hide: both list under Resolved.
export function isShelved(thread) {
  return !!thread && (!!thread.resolved || !!thread.root?.meta?.hidden);
}

// Unread for me: something written by someone else since I last looked. A
// conversation I have never opened that someone else started is unread.
export function threadUnread(thread, meId, lastViewedAt) {
  if (!thread?.root) return false;
  const seen = toMs(lastViewedAt);
  return [thread.root, ...(thread.replies || [])].some((r) => (
    !r.deleted && r.authorId !== meId && (seen == null || (r.createdAt != null && r.createdAt > seen))
  ));
}

// The newest thing written in a conversation (ms), deleted rows included: a
// look at it covers them too.
export function threadNewestMs(thread) {
  if (!thread?.root) return null;
  const times = [thread.root, ...(thread.replies || [])].map((r) => toMs(r?.createdAt)).filter((t) => t != null);
  return times.length ? Math.max(...times) : null;
}

// For me: an open conversation that mentions me, or one I started or replied
// in where someone else wrote after my last words.
export function threadForMe(thread, meId) {
  if (!thread?.root || !meId || isShelved(thread)) return false;
  const rows = [thread.root, ...(thread.replies || [])].filter((r) => !r.deleted);
  if (rows.some((r) => r.authorId !== meId && (r.mentions || []).some((m) => m.id === meId))) return true;
  const mine = rows.filter((r) => r.authorId === meId).map((r) => r.createdAt ?? 0);
  if (!mine.length) return false;
  const last = Math.max(...mine);
  return rows.some((r) => r.authorId !== meId && (r.createdAt ?? 0) > last);
}

// "Comment by Ana, 2 replies, unread": what a pin says to a screen reader.
// Whose it is comes as a whole phrase of its own (lib/commentAuthor.js
// commentBy: "Comment by Ana", "Your comment", or just "Comment" when no name
// is known), and what follows it is one message around that phrase.
export function pinLabel(thread, meId = null) {
  if (!thread?.root) return t`Comment`;
  const n = (thread.replies || []).filter((r) => !r.deleted).length;
  const whose = commentBy(thread.root.authorName, !!meId && thread.root.authorId === meId);
  if (!n) return thread.unread ? t`${whose}, unread` : whose;
  return thread.unread
    ? plural(n, { one: `${whose}, # reply, unread`, other: `${whose}, # replies, unread` })
    : plural(n, { one: `${whose}, # reply`, other: `${whose}, # replies` });
}

// A comment being started is filed (its unsent words, lib/commentDraft.js)
// under what it is on, so the same place always finds the same words:
//   new:card:<id> | new:group:<id> | new:point:<x>:<y> | new:board
export function draftTargetId(anchor) {
  if (!anchor) return 'new';
  if (anchor.kind === 'card' || anchor.kind === 'group') return `new:${anchor.kind}:${anchor.id}`;
  if (anchor.kind === 'point') return `new:point:${Math.round(anchor.x)}:${Math.round(anchor.y)}`;
  return 'new:board';
}
// …and back: the anchor a kept draft was started on, or null when the key is
// not a new comment's (a reply's or an edit's draft).
export function anchorFromDraftTarget(target) {
  const t = String(target ?? '');
  if (t === 'new:board') return { kind: 'board' };
  let m = /^new:(card|group):(.+)$/.exec(t);
  if (m) return { kind: m[1], id: m[2] };
  m = /^new:point:(-?\d+):(-?\d+)$/.exec(t);
  if (m) return { kind: 'point', x: Number(m[1]), y: Number(m[2]) };
  return null;
}

// How far apart two rows of pins are on screen: each a stretch from its first
// tip (sx, sy) to its last (ex, ey); a lone pin or a count is a point.
function gapBetween(a, b) {
  const toRow = (px, py, s) => {
    const vx = s.ex - s.sx; const vy = s.ey - s.sy;
    const len = vx * vx + vy * vy;
    const t = len ? Math.max(0, Math.min(1, ((px - s.sx) * vx + (py - s.sy) * vy) / len)) : 0;
    return Math.hypot(px - (s.sx + t * vx), py - (s.sy + t * vy));
  };
  return Math.min(toRow(a.sx, a.sy, b), toRow(a.ex, a.ey, b), toRow(b.sx, b.sy, a), toRow(b.ex, b.ey, a));
}

// The pins to draw at this zoom, for the open conversations given (oldest
// first, as fromCanvasRows hands them over) and the comments being started
// (`drafts`: [{ id, anchor, active }]; each takes the last place in its row).
//   → [{ type: 'pin', key, thread, anchor, slot, wx, wy, dx, dy }
//      | { type: 'draft', key, id, draftAnchor, active, anchor, slot, wx, wy, dx, dy }
//      | { type: 'count', key, threads, drafts, n, active, unread, wx, wy, dx, dy }]
// Pins that come within GATHER_PX of each other on screen become one count
// pin, measured between each card's whole row of pins and not only its
// corner. So does one card's row of pins once the card is narrower on screen
// than the row. A draft gathers as a conversation does.
export function layoutPins(threads, resolvers, zoom = 1, { drafts = [] } = {}) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const stacks = new Map();
  const all = [
    ...(threads || []),
    ...(drafts || [])
      .map((d) => (d && d.anchor ? draftThread(d.anchor, { id: d.id || draftTargetId(d.anchor), active: d.active }) : null))
      .filter(Boolean),
  ];
  for (const t of all) {
    const a = threadAnchor(t, resolvers);
    if (!a || a.kind === 'board') continue;
    if (!stacks.has(a.key)) stacks.set(a.key, { anchor: a, threads: [] });
    stacks.get(a.key).threads.push(t);
  }
  const items = [...stacks.values()].map((s) => {
    const n = s.threads.length;
    const fits = n === 1 || (!!s.anchor.box && (n - 1) * PIN_STEP + PIN_INSET <= s.anchor.box.w * z);
    const sx = s.anchor.wx * z + s.anchor.dx;
    const sy = s.anchor.wy * z + s.anchor.dy;
    const run = fits ? (n - 1) * PIN_STEP : 0;
    return { ...s, fits, sx, sy, ex: sx + run * s.anchor.ux, ey: sy + run * s.anchor.uy };
  });
  // single-linkage: any two within reach end up in the same gathering
  const parent = items.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (gapBetween(items[i], items[j]) < GATHER_PX) parent[find(i)] = find(j);
    }
  }
  const groups = new Map();
  items.forEach((it, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it);
  });
  const out = [];
  for (const g of groups.values()) {
    if (g.length === 1 && g[0].fits) {
      const { anchor, threads: ts } = g[0];
      ts.forEach((thread, slot) => {
        const at = {
          anchor, slot, wx: anchor.wx, wy: anchor.wy,
          dx: anchor.dx + slot * PIN_STEP * anchor.ux, dy: anchor.dy + slot * PIN_STEP * anchor.uy,
        };
        out.push(thread.draft
          ? { type: 'draft', key: thread.id, id: thread.id, draftAnchor: thread.draftAnchor, active: thread.active, ...at }
          : { type: 'pin', key: thread.id, thread, ...at });
      });
      continue;
    }
    const every = g.flatMap((s) => s.threads);
    const ts = every.filter((t) => !t.draft);
    const ds = every.filter((t) => t.draft);
    const mean = (f) => g.reduce((n, s) => n + f(s.anchor), 0) / g.length;
    out.push({
      type: 'count',
      key: `n:${every.map((t) => String(t.id)).sort()[0]}`,
      threads: ts,
      drafts: ds.map((t) => ({ id: t.id, anchor: t.draftAnchor, active: t.active })),
      n: every.length,
      active: ds.some((t) => t.active),
      unread: ts.some((t) => t.unread),
      wx: mean((a) => a.wx), wy: mean((a) => a.wy), dx: mean((a) => a.dx), dy: mean((a) => a.dy),
    });
  }
  return out;
}

// The world box that holds what these conversations are on (to zoom to).
export function threadsBounds(threads, resolvers) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const t of threads || []) {
    const a = threadAnchor(t, resolvers);
    if (!a || a.kind === 'board') continue;
    const b = a.box || { x: a.wx, y: a.wy, w: 0, h: 0 };
    x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
  }
  if (!Number.isFinite(x0)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
