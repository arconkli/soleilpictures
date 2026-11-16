// The open conversation card and the comments list, the parts of the canvas's
// comments that only a press needs: where the card goes beside its card, who
// "@" offers, and the list's tabs under the keyboard. Pure: no React, no DOM.
// Apart from lib/commentPins.js (the pins, which every cluster carries) so
// that these arrive with the card (components/comments/commentPartsLazy.jsx).
import { PIN_SIZE, turnOf } from './commentPins.js';

// Who "@" offers on a cluster: the people who can see it. The workspace's
// members, the people the cluster (or one above it) is shared with, and
// anyone who has already written here; never me, each once, by name.
//   members: [{ user_id }]   shares: [{ user_id, email, role }]
//   authors: [id]            nameOf(id) → { name, avatar, color } | null
export function mentionCandidates({ members = [], shares = [], authors = [], meId = null, nameOf } = {}) {
  const out = new Map();
  const add = (id, hint) => {
    if (!id || id === meId || out.has(id)) return;
    const p = nameOf?.(id) || null;
    const email = hint?.email || p?.email || '';
    const name = String(p?.name || (email ? email.split('@')[0] : '') || '').trim();
    if (!name) return;
    out.set(id, { id, name, avatar: p?.avatar || null, color: p?.color || null });
  };
  for (const m of members || []) add(m?.user_id, m);
  for (const s of shares || []) add(s?.user_id, s);
  for (const id of authors || []) add(id, null);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// What the open conversation card stands beside, in the canvas view's own px
// (pan + world × zoom): its card or section, else the pin on its point.
// null for a cluster-level conversation, which has no place on the canvas.
export function anchorScreenRect(anchor, pan, zoom) {
  if (!anchor || anchor.kind === 'board') return null;
  const px = pan?.x || 0; const py = pan?.y || 0;
  if (anchor.box) {
    // a turned card: the upright box that holds it
    const b = anchor.box;
    const { cos, sin } = turnOf(b);
    const hw = (Math.abs(b.w * cos) + Math.abs(b.h * sin)) / 2;
    const hh = (Math.abs(b.w * sin) + Math.abs(b.h * cos)) / 2;
    const cx = b.x + b.w / 2; const cy = b.y + b.h / 2;
    return {
      left: px + (cx - hw) * zoom, top: py + (cy - hh) * zoom,
      right: px + (cx + hw) * zoom, bottom: py + (cy + hh) * zoom, pin: false,
    };
  }
  const tx = px + anchor.wx * zoom + (anchor.dx || 0); const ty = py + anchor.wy * zoom + (anchor.dy || 0);
  return { left: tx, top: ty - PIN_SIZE, right: tx + PIN_SIZE, bottom: ty, pin: true };
}

// Where a w × h card goes beside `rect` in a vw × vh view: to its right,
// to its left when the right has no room, and always `margin` inside the
// view. With no rect it takes `fallback` (clamped the same way).
// `avoid` is the card's own pin (view px). When being kept inside the view
// would put the card over it, the card takes the other side, then below,
// then above: the first that leaves the pin showing.
export function placeBeside({ rect, w, h, vw, vh, margin = 12, gapRight = 14, gapLeft = 14, fallback = null, avoid = null }) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  const maxL = vw - w - margin; const maxT = vh - h - margin;
  if (!rect) {
    return { left: clamp(fallback?.left ?? margin, margin, maxL), top: clamp(fallback?.top ?? margin, margin, maxT), side: 'free' };
  }
  const put = (left, top, side) => ({ left: clamp(left, margin, maxL), top: clamp(top, margin, maxT), side });
  const toRight = () => put(rect.right + gapRight, rect.top, 'right');
  const toLeft = () => put(rect.left - gapLeft - w, rect.top, 'left');
  let first = toRight();
  if (rect.right + gapRight > maxL) {
    if (rect.left - gapLeft - w >= margin) first = toLeft();
  }
  if (!avoid) return first;
  const pad = 4;
  const covers = (p) => p.left < avoid.right + pad && p.left + w > avoid.left - pad
    && p.top < avoid.bottom + pad && p.top + h > avoid.top - pad;
  if (!covers(first)) return first;
  const gap = Math.min(gapRight, gapLeft);
  const tries = [
    first.side === 'right' ? toLeft() : toRight(),
    put(rect.left, Math.max(rect.bottom, avoid.bottom) + gap, 'below'),
    put(rect.left, Math.min(rect.top, avoid.top) - gap - h, 'above'),
  ];
  return tries.find((p) => !covers(p)) || first;
}

// Where a pin drawn from `at` (a layoutPins item: wx, wy, dx, dy) is in the
// canvas view's own px: the 30px body up and to the right of its tip.
export function pinScreenRect(at, pan, zoom) {
  if (!at) return null;
  const tx = (pan?.x || 0) + at.wx * zoom + (at.dx || 0);
  const ty = (pan?.y || 0) + at.wy * zoom + (at.dy || 0);
  return { left: tx, top: ty - PIN_SIZE, right: tx + PIN_SIZE, bottom: ty };
}

// The list's tabs under the keyboard: Left / Right step (and wrap), Home and
// End go to the ends. → the tab id to move to, or null for any other key.
export function tabForKey(ids, current, key) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return null;
  const i = Math.max(0, list.indexOf(current));
  if (key === 'ArrowRight') return list[(i + 1) % list.length];
  if (key === 'ArrowLeft') return list[(i - 1 + list.length) % list.length];
  if (key === 'Home') return list[0];
  if (key === 'End') return list[list.length - 1];
  return null;
}

