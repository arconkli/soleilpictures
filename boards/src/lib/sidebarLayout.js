// The floating sidebar's two cards, and the size of each (ClusterSidebar,
// SidebarHandles, clusterSidebar.css).
//
// Each card has its own size: the owner picked "Each card" from a live
// prototype (2026-10-19, the Sidebar Sizing Lab, artifact X8LhZu6zxrAGQ5Brk2e8Xp)
// after asking to "adjust the sizes of the left bar in all directions", e.g.
// side by side, both short at the top left, the clusters skinny and the files
// wide. Every card has a right edge and a bottom edge; the gap between them
// gives one card room from the other.
//
// Two arrangements: the files under the clusters (stacked) or beside them
// (side by side). The button above the files switches, and so does dragging
// (owner: "Dragging wide flips it too"): a stacked card pulled wider than
// SIZES.stackMaxW puts the files beside the clusters, and side by side pulled
// narrower than SIZES.sideMinFootprint stacks them again. A window too narrow
// for side by side (SIDE_FITS_QUERY) keeps them stacked, and so does a touch
// screen.
//
// Sizes are CSS px, heights measured down from the top of the sidebar. A
// height is a number, or 'full' (down to the window's bottom margin), or for
// the clusters' card 'hug' (as tall as what's in it). Each arrangement keeps
// its own sizes, so switching back finds them as they were. They are
// remembered per device: they belong to the screen, not the work. Storage can
// be missing or throw (private windows, blocked site data); nothing here throws.

export const SIDEBAR_LAYOUT_KEY = 'soleil.ui.sidebarLayout';
// One width for the whole sidebar, before the cards were sized apart.
export const OLD_SIDEBAR_W_KEY = 'soleil.ui.sidebarW';

// The cards' margin from the window's edges, and the gap between them.
export const EDGE = 8;
export const SIZES = Object.freeze({
  treeMinW: 196, treeMaxW: 480,
  filesMinW: 232, filesMaxW: 760,
  // A stacked card dragged wider than this (a 540px sidebar, the old
  // threshold) puts the files beside the clusters.
  stackMaxW: 532,
  // Side by side dragged narrower than this (the sidebar's whole width)
  // stacks them again. Lower than the way in, so the edge doesn't flicker.
  sideMinFootprint: 500,
  treeMinH: 132, filesMinH: 220,
  // The board keeps at least this much of the window beside the sidebar.
  room: 420,
  // Stacked, the clusters' list stops at this share of the window until the
  // divider says otherwise (the list scrolls).
  stackNavShare: 0.42,
});
export const LAYOUT_DEFAULT = Object.freeze({
  arr: 'stack',
  stack: Object.freeze({ tw: 312, fw: 312, th: 'hug', bottom: 'full' }),
  side: Object.freeze({ tw: 240, fw: 384, tBottom: 'hug', fBottom: 'full' }),
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const width = (v, lo, hi, d) => (num(v) == null ? d : Math.round(clamp(v, lo, hi)));
// A stored bottom: 'full', a token the card allows, or a y no higher than the
// card's shortest.
const bottom = (v, tokens, lowest, d) => (tokens.includes(v) ? v : num(v) == null ? d : Math.round(Math.max(lowest, v)));

export function defaultLayout() {
  return { arr: 'stack', stack: { ...LAYOUT_DEFAULT.stack }, side: { ...LAYOUT_DEFAULT.side } };
}

// Whatever came out of storage, as a layout.
export function sanitizeLayout(raw) {
  const d = defaultLayout();
  if (!raw || typeof raw !== 'object') return d;
  const st = raw.stack && typeof raw.stack === 'object' ? raw.stack : {};
  const sd = raw.side && typeof raw.side === 'object' ? raw.side : {};
  return {
    arr: raw.arr === 'side' ? 'side' : 'stack',
    stack: {
      tw: width(st.tw, SIZES.treeMinW, SIZES.stackMaxW, d.stack.tw),
      fw: width(st.fw, SIZES.filesMinW, SIZES.stackMaxW, d.stack.fw),
      th: st.th === 'hug' ? 'hug' : num(st.th) == null ? 'hug' : Math.round(Math.max(SIZES.treeMinH, st.th)),
      bottom: bottom(st.bottom, ['full'], EDGE + SIZES.treeMinH + EDGE + SIZES.filesMinH, 'full'),
    },
    side: {
      tw: width(sd.tw, SIZES.treeMinW, SIZES.treeMaxW, d.side.tw),
      fw: width(sd.fw, SIZES.filesMinW, SIZES.filesMaxW, d.side.fw),
      tBottom: bottom(sd.tBottom, ['hug', 'full'], EDGE + SIZES.treeMinH, 'hug'),
      fBottom: bottom(sd.fBottom, ['full'], EDGE + SIZES.filesMinH, 'full'),
    },
  };
}

// The sidebar as it was before (one width): under 540 the files sat under the
// clusters at that width; wider, beside them, the clusters taking 38%.
export function layoutFromOldWidth(w) {
  const d = defaultLayout();
  const v = num(Number(w));
  if (v == null) return d;
  if (v < 540) {
    const cw = Math.round(clamp(v - EDGE, SIZES.filesMinW, SIZES.stackMaxW));
    return { ...d, stack: { ...d.stack, tw: cw, fw: cw } };
  }
  // Its grid: an 8px margin, the clusters minmax(232px, 38%), an 8px gap.
  const w2 = Math.min(v, 760);
  const tw = Math.round(clamp((w2 - EDGE) * 0.38, 232, SIZES.treeMaxW));
  return { ...d, arr: 'side', side: { ...d.side, tw, fw: Math.round(clamp(w2 - EDGE - EDGE - tw, SIZES.filesMinW, SIZES.filesMaxW)) } };
}

export function readSidebarLayout(storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(SIDEBAR_LAYOUT_KEY);
    if (raw != null) return sanitizeLayout(JSON.parse(raw));
    const old = storage.getItem(OLD_SIDEBAR_W_KEY);
    return old != null ? layoutFromOldWidth(old) : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

export function writeSidebarLayout(layout, storage = globalThis.localStorage) {
  const v = sanitizeLayout(layout);
  try { storage.setItem(SIDEBAR_LAYOUT_KEY, JSON.stringify(v)); } catch { /* unwritable: just not remembered */ }
  return v;
}

// Side by side needs a window as wide as the board's room and the narrowest
// side-by-side sidebar together; narrower, the files go under the clusters.
export const SIDE_FITS_QUERY = `(min-width: ${SIZES.room + SIZES.sideMinFootprint}px)`;

// The arrangement in force. `fit`: { coarse (a touch screen, whose rows are
// taller and whose finger needs the width), roomy (SIDE_FITS_QUERY matches) }.
export const arrangementOf = (layout, { coarse = false, roomy = true } = {}) =>
  (!coarse && roomy && layout?.arr === 'side' ? 'side' : 'stack');

// The sidebar's column: the cards and their margin. The window may cut it
// shorter (clusterSidebar.css keeps SIZES.room for the board).
export function sidebarFootprint(layout, fit = {}) {
  const l = layout || LAYOUT_DEFAULT;
  if (arrangementOf(l, fit) === 'side') return EDGE + l.side.tw + EDGE + l.side.fw;
  return EDGE + Math.max(l.stack.tw, l.stack.fw);
}

// What clusterSidebar.css lays the cards out by, as custom properties on
// .sbf-frame.
export function frameVars(layout, fit = {}) {
  const l = layout || LAYOUT_DEFAULT;
  if (arrangementOf(l, fit) === 'side') {
    const s = l.side;
    return {
      '--sbf-tw': `${s.tw}px`,
      '--sbf-fw': `${s.fw}px`,
      '--sbf-th': s.tBottom === 'hug' ? 'auto' : s.tBottom === 'full' ? '100%' : `${s.tBottom - EDGE}px`,
      '--sbf-fh': s.fBottom === 'full' ? '100%' : `${s.fBottom - EDGE}px`,
      '--sbf-frame-h': '100%',
      '--sbf-nav-max': 'none',
    };
  }
  const s = l.stack;
  return {
    '--sbf-tw': `${s.tw}px`,
    '--sbf-fw': `${s.fw}px`,
    '--sbf-th': s.th === 'hug' ? 'auto' : `${s.th}px`,
    '--sbf-fh': 'auto',
    '--sbf-frame-h': s.bottom === 'full' ? '100%' : `${s.bottom + EDGE}px`,
    '--sbf-nav-max': s.th === 'hug' ? `${Math.round(SIZES.stackNavShare * 100)}vh` : 'none',
  };
}

// The arrangement the button switches to, each with its own sizes.
export const toggledLayout = (layout) => ({ ...sanitizeLayout(layout), arr: layout?.arr === 'side' ? 'stack' : 'side' });

// ── The handles ──────────────────────────────────────────────────────────────
// Where each handle goes, from where the cards are (viewport rects: x, y, w, h).
// kind: 'v' an edge you drag sideways, 'h' one you drag up and down, 'grip'
// the stacked divider, 'corner' both ways. A handle stops RADIUS short of a
// card's corner; the corners are handles of their own. `focus`: in the Tab
// order (the corners only repeat two edges, so they aren't).
const RADIUS = 12;
const ZONE = 8;
const LABELS = {
  treeRight: 'Width of the clusters',
  filesRight: 'Width of the files',
  divider: 'Share the height between clusters and files',
  bottom: 'Height of the files',
  corner: 'Size of the files',
  split: 'Share the width between clusters and files',
  right: 'Width of the files',
  treeBottom: 'Height of the clusters',
  treeCorner: 'Size of the clusters',
};
const HANDLES = {
  stack: [['treeRight', 'v'], ['filesRight', 'v'], ['divider', 'grip'], ['bottom', 'h'], ['corner', 'corner']],
  side: [['split', 'v'], ['right', 'v'], ['treeBottom', 'h'], ['bottom', 'h'], ['treeCorner', 'corner'], ['corner', 'corner']],
};
// The handles an arrangement has, in the order they render.
export const handleList = (arr) => HANDLES[arr === 'side' ? 'side' : 'stack']
  .map(([id, kind]) => ({ id, kind, label: LABELS[id], focus: kind !== 'corner' }));
export function handleSpecs(arr, { t, f }, { coarse = false } = {}) {
  const z = coarse ? 16 : ZONE;
  const R = RADIUS;
  const at = {};
  const put = (id, x, y, w, h) => { at[id] = { x, y, w: Math.max(0, w), h: Math.max(0, h) }; };
  const corner = (id, r) => put(id, r.x + r.w - 18, r.y + r.h - 18, 24, 24);
  if (arr === 'side') {
    // The gap, where the two cards face each other.
    const top = Math.max(t.y, f.y) + R;
    put('split', t.x + t.w, top, f.x - (t.x + t.w), Math.min(t.y + t.h, f.y + f.h) - R - top);
    put('right', f.x + f.w - z / 2, f.y + R, z, f.h - 2 * R);
    put('treeBottom', t.x + R, t.y + t.h - z / 2, t.w - 2 * R, z);
    put('bottom', f.x + R, f.y + f.h - z / 2, f.w - 2 * R, z);
    corner('treeCorner', t);
    corner('corner', f);
  } else {
    put('treeRight', t.x + t.w - z / 2, t.y + R, z, t.h - 2 * R);
    put('filesRight', f.x + f.w - z / 2, f.y + R, z, f.h - 2 * R);
    // The gap between the cards; a finger gets a little either side of it.
    const gy = t.y + t.h, gh = f.y - gy, more = coarse ? 4 : 0;
    put('divider', t.x + R, gy - more, Math.min(t.w, f.w) - 2 * R, gh + 2 * more);
    put('bottom', f.x + R, f.y + f.h - z / 2, f.w - 2 * R, z);
    corner('corner', f);
  }
  return handleList(arr).map((h) => ({ ...h, ...at[h.id] }));
}

// ── Dragging one ─────────────────────────────────────────────────────────────
// `start`: the drag's beginning, measured — { layout, arr, t, f (the cards'
// viewport rects), top (the sidebar's top, viewport y), full (a full-height
// card's bottom, viewport y), hug (the clusters' card as tall as what's in it,
// px), x (the pointer), vw, coarse, flips (false: never change the
// arrangement) }. Returns the layout the pointer asks for
// `dx`, `dy` from where it started, `align` (a viewport y the two bottoms
// snapped together at, for a guide) and `flip` (the handle the drag carries on
// with when it changed the arrangement).
const SNAP_FULL = 20;
const SNAP = 10;
export function dragLayout(start, id, dx, dy) {
  const { t, f, top, full, hug, vw, coarse } = start;
  const canFlip = !coarse && start.flips !== false;
  const layout = sanitizeLayout(start.layout);
  const ys = (y) => Math.round(y - top);                  // viewport y → a stored bottom
  const fullB = ys(full);
  const left = t.x - EDGE;                                 // the sidebar's left edge
  const widest = vw - SIZES.room - left;                   // the most the sidebar's column gets
  const px = start.x + dx;                                 // the pointer now
  let align = null;
  const yBottom = (y, lo) => {
    const v = clamp(Math.round(y), lo, full);
    return { v, full: full - v <= SNAP_FULL };
  };

  if (start.arr === 'side') {
    const s = layout.side;
    if (id === 'split' || id === 'treeCorner') {
      const sum = t.w + f.w;
      const tw = Math.round(clamp(t.w + dx, SIZES.treeMinW, Math.min(SIZES.treeMaxW, sum - SIZES.filesMinW)));
      s.tw = tw;
      s.fw = Math.round(clamp(sum - tw, SIZES.filesMinW, SIZES.filesMaxW));
    }
    if (id === 'right' || id === 'corner') {
      const want = f.w + dx;
      if (canFlip && EDGE + t.w + EDGE + want < SIZES.sideMinFootprint) {
        // Narrow enough to stack: the files go under the clusters, their right
        // edge under the pointer.
        const st = layout.stack;
        st.fw = Math.round(clamp(px - left - EDGE, SIZES.filesMinW, Math.max(SIZES.filesMinW, Math.min(SIZES.stackMaxW, widest - EDGE))));
        return { layout: { ...layout, arr: 'stack' }, align: null, flip: id === 'corner' ? 'corner' : 'filesRight' };
      }
      const roomFor = Math.max(SIZES.filesMinW, widest - EDGE - t.w - EDGE);
      s.fw = Math.round(clamp(want, SIZES.filesMinW, Math.min(SIZES.filesMaxW, roomFor)));
    }
    if (id === 'bottom' || id === 'corner') {
      const b = yBottom(f.y + f.h + dy, f.y + SIZES.filesMinH);
      const tb = t.y + t.h;
      if (b.full) s.fBottom = 'full';
      else if (full - tb > SNAP_FULL && Math.abs(b.v - tb) <= SNAP) { s.fBottom = ys(tb); align = tb; }
      else s.fBottom = ys(b.v);
    }
    if (id === 'treeBottom' || id === 'treeCorner') {
      const b = yBottom(t.y + t.h + dy, t.y + SIZES.treeMinH);
      const fb = f.y + f.h;
      const hb = t.y + hug;
      if (b.full) s.tBottom = 'full';
      else if (full - fb > SNAP_FULL && Math.abs(b.v - fb) <= SNAP) { s.tBottom = ys(fb); align = fb; }
      else if (Math.abs(b.v - hb) <= SNAP) s.tBottom = 'hug';
      else s.tBottom = ys(b.v);
    }
    return { layout, align, flip: null };
  }

  const s = layout.stack;
  // Only where the window has the room for side by side.
  const wide = (w) => canFlip && widest >= SIZES.sideMinFootprint && w > SIZES.stackMaxW;
  if (id === 'treeRight' || id === 'filesRight' || id === 'corner') {
    const w = (id === 'treeRight' ? t.w : f.w) + dx;
    if (wide(w)) {
      // Wide enough to go side by side: the files go beside the clusters,
      // their right edge under the pointer (the clusters narrower than they
      // were side by side, if that's what it takes).
      const sd = layout.side;
      const both = Math.min(px - left, widest) - EDGE - EDGE;
      sd.tw = Math.round(clamp(Math.min(sd.tw, both - SIZES.filesMinW), SIZES.treeMinW, SIZES.treeMaxW));
      sd.fw = Math.round(clamp(both - sd.tw, SIZES.filesMinW, SIZES.filesMaxW));
      return { layout: { ...layout, arr: 'side' }, align: null, flip: id === 'corner' ? 'corner' : 'right' };
    }
    const cap = Math.max(SIZES.filesMinW, Math.min(SIZES.stackMaxW, widest - EDGE));
    if (id === 'treeRight') s.tw = Math.round(clamp(w, SIZES.treeMinW, cap));
    else s.fw = Math.round(clamp(w, SIZES.filesMinW, cap));
  }
  if (id === 'divider') {
    // The line between them moves; the files keep their bottom.
    const th = Math.round(clamp(t.h + dy, SIZES.treeMinH, f.y + f.h - t.y - EDGE - SIZES.filesMinH));
    s.th = Math.abs(th - hug) <= SNAP ? 'hug' : th;
  }
  if (id === 'bottom' || id === 'corner') {
    const b = yBottom(f.y + f.h + dy, f.y + SIZES.filesMinH);
    s.bottom = b.full ? 'full' : Math.min(ys(b.v), fullB);
  }
  return { layout, align, flip: null };
}

// A handle double-clicked: what it sizes goes back to how it started.
export function resetLayout(layout, arr, id) {
  const l = sanitizeLayout(layout);
  const d = defaultLayout();
  if (arr === 'side') {
    if (id === 'split' || id === 'treeCorner') { l.side.tw = d.side.tw; l.side.fw = d.side.fw; }
    if (id === 'right' || id === 'corner') l.side.fw = d.side.fw;
    if (id === 'bottom' || id === 'corner') l.side.fBottom = 'full';
    if (id === 'treeBottom' || id === 'treeCorner') l.side.tBottom = 'hug';
    return l;
  }
  if (id === 'treeRight') l.stack.tw = d.stack.tw;
  if (id === 'filesRight' || id === 'corner') l.stack.fw = d.stack.fw;
  if (id === 'divider') l.stack.th = 'hug';
  if (id === 'bottom' || id === 'corner') l.stack.bottom = 'full';
  return l;
}

// The arrow keys on a focused handle: 16px a press, 64 with Shift. A handle
// that moves sideways ignores ↑/↓ and the other way round. The keys never
// change the arrangement; the button does that.
export function keyStep(key, shift = false) {
  const n = shift ? 64 : 16;
  return {
    ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n],
  }[key] || null;
}
export function keyLayout(start, id, kind, key, shift = false) {
  const step = keyStep(key, shift);
  if (!step) return null;
  const [dx, dy] = [kind === 'h' || kind === 'grip' ? 0 : step[0], kind === 'v' ? 0 : step[1]];
  if (!dx && !dy) return null;
  return dragLayout({ ...start, flips: false }, id, dx, dy).layout;
}
