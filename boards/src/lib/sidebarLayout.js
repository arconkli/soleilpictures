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
// narrower than SIZES.sideMinFootprint stacks them again. Side by side chosen
// with the button is `pinned`: it stays however narrow it's dragged, until the
// button stacks them again (owner, 2026-10-19). A window too narrow for side by
// side keeps them stacked (SIDE_FITS_QUERY; KEPT_FITS_QUERY for side by side
// the button keeps, which can be narrower).
//
// A touch screen with the floating cards (a tablet held sideways) keeps its
// own: side by side by default, two full-height columns (owner, 2026-10-20:
// stacked, the files card showed about one file under 44px rows), with only
// the button to stack them — a finger sizing a card never flips them — and
// sizes of its own (`touchArr`, `touchSide`), so a desktop layout never lands
// on a tablet or the other way round.
//
// The files can be hidden (owner, 2026-10-19: "a way to hide/unhide the files
// bar. it needs to be SUPER easy and SUPER obvious on how to get it back"):
// `filesHidden` folds the files' card to its heading, under the clusters' card,
// in either arrangement, and the clusters' card keeps its width. The board
// gets the files' room, and their sizes wait for Show.
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
  pinned: false,
  filesHidden: false,
  stack: Object.freeze({ tw: 312, fw: 312, th: 'hug', bottom: 'full' }),
  side: Object.freeze({ tw: 240, fw: 384, tBottom: 'hug', fBottom: 'full' }),
  // A tablet: about 470px of a 1133–1366px screen, both cards full height.
  touchArr: 'side',
  touchSide: Object.freeze({ tw: 208, fw: 248, tBottom: 'full', fBottom: 'full' }),
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const width = (v, lo, hi, d) => (num(v) == null ? d : Math.round(clamp(v, lo, hi)));
// A stored bottom: 'full', a token the card allows, or a y no higher than the
// card's shortest.
const bottom = (v, tokens, lowest, d) => (tokens.includes(v) ? v : num(v) == null ? d : Math.round(Math.max(lowest, v)));

export function defaultLayout() {
  return {
    arr: 'stack', pinned: false, filesHidden: false, stack: { ...LAYOUT_DEFAULT.stack }, side: { ...LAYOUT_DEFAULT.side },
    touchArr: LAYOUT_DEFAULT.touchArr, touchSide: { ...LAYOUT_DEFAULT.touchSide },
  };
}

// Whatever came out of storage, as a layout.
export function sanitizeLayout(raw) {
  const d = defaultLayout();
  if (!raw || typeof raw !== 'object') return d;
  const st = raw.stack && typeof raw.stack === 'object' ? raw.stack : {};
  const sd = raw.side && typeof raw.side === 'object' ? raw.side : {};
  const ts = raw.touchSide && typeof raw.touchSide === 'object' ? raw.touchSide : {};
  return {
    arr: raw.arr === 'side' ? 'side' : 'stack',
    pinned: raw.arr === 'side' && raw.pinned === true,
    filesHidden: raw.filesHidden === true,
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
    touchArr: raw.touchArr === 'stack' ? 'stack' : 'side',
    touchSide: {
      tw: width(ts.tw, SIZES.treeMinW, SIZES.treeMaxW, d.touchSide.tw),
      fw: width(ts.fw, SIZES.filesMinW, SIZES.filesMaxW, d.touchSide.fw),
      tBottom: bottom(ts.tBottom, ['hug', 'full'], EDGE + SIZES.treeMinH, d.touchSide.tBottom),
      fBottom: bottom(ts.fBottom, ['full'], EDGE + SIZES.filesMinH, d.touchSide.fBottom),
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
// side-by-side sidebar a drag leaves (it stacks below that); side by side the
// button keeps needs only the narrowest two cards. Narrower, the files go
// under the clusters.
export const SIDE_LEAST = EDGE + SIZES.treeMinW + EDGE + SIZES.filesMinW;
export const SIDE_FITS_QUERY = `(min-width: ${SIZES.room + SIZES.sideMinFootprint}px)`;
export const KEPT_FITS_QUERY = `(min-width: ${SIZES.room + SIDE_LEAST}px)`;

// The arrangement in force. `fit`: { coarse (a touch screen: its own
// arrangement and side-by-side sizes, touchArr and touchSide), roomy
// (SIDE_FITS_QUERY matches), snug (KEPT_FITS_QUERY matches) }.
export const arrangementOf = (layout, { coarse = false, roomy = true, snug = true } = {}) => (coarse
  ? (roomy && layout?.touchArr !== 'stack' ? 'side' : 'stack')
  : (layout?.arr === 'side' && (roomy || (snug && !!layout.pinned)) ? 'side' : 'stack'));
// Where the side-by-side sizes in force live: a touch screen keeps its own.
export const sideKey = (fit) => (fit?.coarse ? 'touchSide' : 'side');
const sideSizes = (l, fit) => l[sideKey(fit)] || LAYOUT_DEFAULT[sideKey(fit)];
// What the cards show: the arrangement in force, or 'hidden' while the files'
// card is folded to its heading under the clusters' card (which keeps the
// width it has in the arrangement in force).
export const shownArrangement = (layout, fit) => (layout?.filesHidden ? 'hidden' : arrangementOf(layout, fit));
// The files hidden (Hide, ⌘\) or back (Show); every size stays as it was.
export const withFilesHidden = (layout, hidden) => ({ ...sanitizeLayout(layout), filesHidden: !!hidden });

// The sidebar's column: the cards and their margin. The window may cut it
// shorter (clusterSidebar.css keeps SIZES.room for the board).
export function sidebarFootprint(layout, fit = {}) {
  const l = layout || LAYOUT_DEFAULT;
  const arr = arrangementOf(l, fit);
  const sd = sideSizes(l, fit);
  if (l.filesHidden) return EDGE + (arr === 'side' ? sd : l.stack).tw;
  if (arr === 'side') return EDGE + sd.tw + EDGE + sd.fw;
  return EDGE + Math.max(l.stack.tw, l.stack.fw);
}

// What clusterSidebar.css lays the cards out by, as custom properties on
// .sbf-frame.
export function frameVars(layout, fit = {}) {
  const l = layout || LAYOUT_DEFAULT;
  if (l.filesHidden) {
    // The clusters' card as tall as its list (as much of the window as that
    // takes), the folded files under it at its width.
    const tw = `${(arrangementOf(l, fit) === 'side' ? sideSizes(l, fit) : l.stack).tw}px`;
    return { '--sbf-tw': tw, '--sbf-fw': tw, '--sbf-th': 'auto', '--sbf-fh': 'auto', '--sbf-frame-h': '100%', '--sbf-nav-max': 'none' };
  }
  if (arrangementOf(l, fit) === 'side') {
    const s = sideSizes(l, fit);
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

// The arrangement the button switches to from the one `shown` (which a narrow
// window can make stacked when side by side was chosen), each with its own
// sizes. Side by side from the button stays put (pinned) until the button
// stacks them. A touch screen switches its own arrangement only.
export function toggledLayout(layout, shown = layout?.arr, { coarse = false } = {}) {
  const arr = shown === 'side' ? 'stack' : 'side';
  if (coarse) return { ...sanitizeLayout(layout), touchArr: arr };
  return { ...sanitizeLayout(layout), arr, pinned: arr === 'side' };
}

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
  // The files hidden: only the clusters' card's width.
  hidden: [['treeRight', 'v']],
};
// The handles an arrangement has (or 'hidden'), in the order they render.
export const handleList = (arr) => HANDLES[arr === 'side' || arr === 'hidden' ? arr : 'stack']
  .map(([id, kind]) => ({ id, kind, label: LABELS[id], focus: kind !== 'corner' }));
export function handleSpecs(arr, { t, f }, { coarse = false } = {}) {
  const z = coarse ? 16 : ZONE;
  const R = RADIUS;
  const at = {};
  const put = (id, x, y, w, h) => { at[id] = { x, y, w: Math.max(0, w), h: Math.max(0, h) }; };
  // A corner square, a little bigger under a finger, and then reaching into
  // the card no further than an edge does: further, it took the taps meant for
  // the account button in the files' corner.
  const c = coarse ? 32 : 24;
  const inside = coarse ? z / 2 : c - 6;
  const corner = (id, r) => put(id, r.x + r.w - inside, r.y + r.h - inside, c, c);
  if (arr === 'hidden') {
    put('treeRight', t.x + t.w - z / 2, t.y + R, z, t.h - 2 * R);
  } else if (arr === 'side') {
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
// `start`: the drag's beginning, measured — { layout, arr ('hidden' with the
// files hidden), under (then, the arrangement in force), t, f (the cards'
// viewport rects), top (the sidebar's top, viewport y), full (a full-height
// card's bottom, viewport y), hug (the clusters' card as tall as what's in it,
// px), x (the pointer), vw, coarse, flips (false: never change the
// arrangement) }. Returns the layout the pointer asks for
// `dx`, `dy` from where it started, `align` (a viewport y the two bottoms
// snapped together at, for a guide), `alignX` (a viewport x the two right
// edges snapped together at, stacked) and `flip` (the handle the drag carries
// on with when it changed the arrangement).
const SNAP_FULL = 20;
const SNAP = 10;
export function dragLayout(start, id, dx, dy) {
  const { t, f, top, full, hug, vw, coarse } = start;
  const canFlip = !coarse && start.flips !== false;
  const layout = sanitizeLayout(start.layout);
  const sk = sideKey({ coarse });
  const ys = (y) => Math.round(y - top);                  // viewport y → a stored bottom
  const fullB = ys(full);
  const left = t.x - EDGE;                                 // the sidebar's left edge
  const widest = vw - SIZES.room - left;                   // the most the sidebar's column gets
  const px = start.x + dx;                                 // the pointer now
  let align = null;
  let alignX = null;
  if (start.arr === 'hidden') {
    // The files hidden: the clusters' card's width in the arrangement in
    // force, and nothing changes the arrangement.
    const under = start.under === 'side' ? sk : 'stack';
    const most = under === 'stack' ? SIZES.stackMaxW : SIZES.treeMaxW;
    if (id === 'treeRight') {
      layout[under].tw = Math.round(clamp(t.w + dx, SIZES.treeMinW, Math.max(SIZES.treeMinW, Math.min(most, widest - EDGE))));
    }
    return { layout, align, alignX, flip: null };
  }
  const yBottom = (y, lo) => {
    const v = clamp(Math.round(y), lo, full);
    return { v, full: full - v <= SNAP_FULL };
  };

  if (start.arr === 'side') {
    const s = layout[sk];
    if (id === 'split' || id === 'treeCorner') {
      const sum = t.w + f.w;
      const tw = Math.round(clamp(t.w + dx, SIZES.treeMinW, Math.min(SIZES.treeMaxW, sum - SIZES.filesMinW)));
      s.tw = tw;
      s.fw = Math.round(clamp(sum - tw, SIZES.filesMinW, SIZES.filesMaxW));
    }
    if (id === 'right' || id === 'corner') {
      const want = f.w + dx;
      if (canFlip && !layout.pinned && EDGE + t.w + EDGE + want < SIZES.sideMinFootprint) {
        // Narrow enough to stack (unless the button keeps them side by side):
        // the files go under the clusters, their right edge under the pointer.
        const st = layout.stack;
        st.fw = Math.round(clamp(px - left - EDGE, SIZES.filesMinW, Math.max(SIZES.filesMinW, Math.min(SIZES.stackMaxW, widest - EDGE))));
        return { layout: { ...layout, arr: 'stack', pinned: false }, align: null, alignX: null, flip: id === 'corner' ? 'corner' : 'filesRight' };
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
    return { layout, align, alignX, flip: null };
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
      return { layout: { ...layout, arr: 'side', pinned: false }, align: null, alignX: null, flip: id === 'corner' ? 'corner' : 'right' };
    }
    const cap = Math.max(SIZES.filesMinW, Math.min(SIZES.stackMaxW, widest - EDGE));
    const card = id === 'treeRight' ? t : f;
    const lo = id === 'treeRight' ? SIZES.treeMinW : SIZES.filesMinW;
    let nw = Math.round(clamp(w, lo, cap));
    // Lined up with the other card's right edge, it meets it, and a guide
    // shows where. Judged on the width asked for, not the one clamped to the
    // card's least or most, or a meeting point near either would hold the
    // card off it.
    const other = id === 'treeRight' ? f : t;
    const meet = Math.round(other.x + other.w - card.x);
    if (Math.abs(w - meet) <= SNAP && meet >= lo && meet <= cap) { nw = meet; alignX = other.x + other.w; }
    if (id === 'treeRight') s.tw = nw;
    else s.fw = nw;
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
  return { layout, align, alignX, flip: null };
}

// A handle double-clicked: what it sizes goes back to how it started.
// `under`: with the files hidden ('hidden'), the arrangement in force.
// `fit.coarse`: a touch screen, whose side-by-side sizes are its own.
export function resetLayout(layout, arr, id, under = 'stack', fit = {}) {
  const l = sanitizeLayout(layout);
  const d = defaultLayout();
  const sk = sideKey(fit);
  if (arr === 'hidden') {
    const k = under === 'side' ? sk : 'stack';
    if (id === 'treeRight') l[k].tw = d[k].tw;
    return l;
  }
  if (arr === 'side') {
    const s = l[sk];
    if (id === 'split' || id === 'treeCorner') { s.tw = d[sk].tw; s.fw = d[sk].fw; }
    if (id === 'right' || id === 'corner') s.fw = d[sk].fw;
    if (id === 'bottom' || id === 'corner') s.fBottom = d[sk].fBottom;
    if (id === 'treeBottom' || id === 'treeCorner') s.tBottom = d[sk].tBottom;
    return l;
  }
  if (id === 'treeRight') l.stack.tw = d.stack.tw;
  if (id === 'filesRight' || id === 'corner') l.stack.fw = d.stack.fw;
  if (id === 'divider') l.stack.th = 'hug';
  if (id === 'bottom' || id === 'corner') l.stack.bottom = 'full';
  return l;
}

// Every size of the arrangement in force back to how it started, the
// arrangement itself kept: what "Reset sizes" does, for a touch screen that has
// no double-click to do it a handle at a time.
export function resetAllSizes(layout, fit = {}) {
  const l = sanitizeLayout(layout);
  const d = defaultLayout();
  if (arrangementOf(l, fit) === 'side') { const sk = sideKey(fit); l[sk] = d[sk]; }
  else l.stack = d.stack;
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
