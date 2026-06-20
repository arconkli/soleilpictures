// Measurement-based pagination for PROSE docs — true reflow across real
// 8.5×11 pages (text flows, and a paragraph SPLITS line-level across a page
// boundary, like Word / Google Docs print layout). A ProseMirror decoration
// plugin in the same idiom as screenplay/ScreenplayPagination.js, but because
// prose has variable fonts/sizes/images it must MEASURE the rendered DOM
// instead of counting lines.
//
// Two presentational layers, both LOCAL-ONLY (never written into the Yjs doc):
//   1. Gap widgets (here) — a spacer inserted at each computed page boundary
//      that fills the rest of the current page + the inter-page gutter, so the
//      following content lands at the next page's top margin.
//   2. White page sheets behind the text — rendered by DocPageEditor from the
//      page count this plugin reports via the onPages() callback.
//
// Convergence (the anti-flicker trick): inserting a gap shifts every absolute
// position below it, which would feed back into the next measurement. We avoid
// that by computing each line/block's NATURAL offset = its on-screen top minus
// the gap heights already placed above it. Natural offsets don't depend on the
// gaps, so the computed breaks are stable: same content → same breaks → no
// re-dispatch. We only dispatch a new DecorationSet when the break list
// actually changes.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('docPagination');

// US-Letter at 96dpi (layout px; CSS `zoom` on the wrap scales the whole thing
// uniformly, so all math here is in unscaled layout px). Keep these in lockstep
// with the .doc-page-sheet / .doc-editor-wrap geometry in styles.css.
export const PAGE_W = 816;          // 8.5in
export const PAGE_H = 1056;         // 11in
export const PAGE_MARGIN = 96;      // 1in
export const CONTENT_H = PAGE_H - 2 * PAGE_MARGIN; // 864 = 9in printable height
export const PAGE_GUTTER = 28;      // dark gap drawn between stacked sheets
export const PAGE_STRIDE = PAGE_H + PAGE_GUTTER;   // top-to-top distance, 1084
const EPS = 1;                      // tolerance so a line that *just* fits stays

// Blocks we split line-by-line. Everything else is moved whole (kept-together).
const SPLITTABLE = new Set(['paragraph', 'heading']);

function makeGapEl(gapPx) {
  const el = document.createElement('div');
  el.className = 'doc-page-gap';
  el.contentEditable = 'false';
  el.style.height = Math.max(0, Math.round(gapPx)) + 'px';
  return el;
}

// Line boxes of a block element, merged so inline-mark fragments on the same
// visual line collapse into one rect.
function lineRects(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const out = [];
    for (const r of range.getClientRects()) {
      if (r.height === 0 && r.width === 0) continue;
      const last = out[out.length - 1];
      if (last && Math.abs(r.top - last.top) < 2) {
        last.height = Math.max(last.height, r.height);
        last.bottom = Math.max(last.bottom, r.bottom);
      } else {
        out.push({ top: r.top, left: r.left, height: r.height, bottom: r.bottom });
      }
    }
    return out;
  } catch (_) { return []; }
}

// Compute the page-break list from the live DOM. Returns { breaks, pages }.
// breaks: [{ pos, gap }] in document order; pages: total page count.
function computeBreaks(view, zoom) {
  const z = zoom > 0 ? zoom : 1;
  const doc = view.state.doc;
  const root = view.dom;
  if (!root || !doc.content.size) return { breaks: [], pages: 1 };
  const rootTop = root.getBoundingClientRect().top;

  // Gap heights already in the DOM, by client top — used to recover the
  // gap-independent "natural" position of every item below them.
  const gapEls = Array.from(root.querySelectorAll('.doc-page-gap')).map(g => {
    const r = g.getBoundingClientRect();
    return { top: r.top, h: r.height / z };
  }).sort((a, b) => a.top - b.top);
  const gapAbove = (clientTop) => {
    let s = 0;
    for (const g of gapEls) { if (g.top < clientTop - 1) s += g.h; else break; }
    return s;
  };
  // Natural offset (layout px, gap-independent) of a client-space top.
  const natural = (clientTop) => (clientTop - rootTop) / z - gapAbove(clientTop);

  // Build the ordered list of break "items" (a line, or a whole atomic block).
  const items = []; // { pos, top, bottom }  (natural layout px)
  doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!dom || dom.nodeType !== 1) return;
    if (SPLITTABLE.has(node.type.name) && node.content.size > 0) {
      const rects = lineRects(dom);
      if (!rects.length) {
        const r = dom.getBoundingClientRect();
        items.push({ pos: offset, top: natural(r.top), bottom: natural(r.top) + r.height / z });
        return;
      }
      for (const ln of rects) {
        const top = natural(ln.top);
        let pos = offset; // fallback: before the block
        try {
          const at = view.posAtCoords({ left: ln.left + 2, top: ln.top + ln.height / 2 });
          if (at && typeof at.pos === 'number') pos = at.pos;
        } catch (_) {}
        items.push({ pos, top, bottom: top + ln.height / z });
      }
    } else {
      const r = dom.getBoundingClientRect();
      const top = natural(r.top);
      items.push({ pos: offset, top, bottom: top + r.height / z });
    }
  });
  if (!items.length) return { breaks: [], pages: 1 };

  // Paginate by natural offset. A page holds CONTENT_H of natural content.
  const breaks = [];
  let pageStart = items[0].top; // natural top of the first content (the top margin)
  let pages = 1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    // First item on a page never breaks (avoids an empty page before a block
    // that's taller than the page).
    const isFirstOnPage = it.top <= pageStart + EPS;
    if (!isFirstOnPage && it.bottom > pageStart + CONTENT_H + EPS) {
      const used = Math.max(0, it.top - pageStart);
      breaks.push({ pos: it.pos, gap: Math.max(PAGE_GUTTER, PAGE_STRIDE - used) });
      pageStart = it.top;
      pages++;
    }
    // A single item taller than a page spans; advance the page baseline past it
    // so the gutters/page-count stay sane (it visually crosses with no gutter).
    while (it.bottom > pageStart + CONTENT_H + EPS) { pageStart += CONTENT_H; pages++; }
  }
  return { breaks, pages };
}

function decosFromBreaks(doc, breaks) {
  if (!breaks.length) return DecorationSet.empty;
  const decos = breaks.map(b => {
    const pos = Math.max(0, Math.min(b.pos, doc.content.size));
    return Decoration.widget(pos, () => makeGapEl(b.gap), { side: -1, key: `pg-${pos}-${Math.round(b.gap)}` });
  });
  return DecorationSet.create(doc, decos);
}

// Stable signature so we only re-render when pagination actually changes.
function sig(breaks, pages) {
  return pages + '|' + breaks.map(b => b.pos + ':' + Math.round(b.gap)).join(',');
}

export const DocPagination = Extension.create({
  name: 'docPagination',
  addOptions() {
    return { getZoom: () => 1, onPages: () => {} };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin({
        key,
        state: {
          init: () => ({ decos: DecorationSet.empty, sig: '' }),
          apply(tr, prev) {
            const meta = tr.getMeta(key);
            if (meta) return meta;
            // Keep decorations mapped through edits until the next measure.
            return tr.docChanged ? { decos: prev.decos.map(tr.mapping, tr.doc), sig: prev.sig } : prev;
          },
        },
        props: {
          decorations(state) { return key.getState(state).decos; },
        },
        view(view) {
          let raf = 0;
          let destroyed = false;
          const measure = () => {
            raf = 0;
            if (destroyed || !view.editable && false) { /* still measure read-only */ }
            let res;
            try { res = computeBreaks(view, opts.getZoom() || 1); }
            catch (_) { return; }
            const s = sig(res.breaks, res.pages);
            const cur = key.getState(view.state);
            if (s === cur.sig) return; // converged — nothing changed
            try { opts.onPages(res.pages); } catch (_) {}
            const decos = decosFromBreaks(view.state.doc, res.breaks);
            view.dispatch(view.state.tr.setMeta(key, { decos, sig: s }).setMeta('addToHistory', false));
          };
          const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
          // Re-measure on size changes (zoom, width, content reflow, font load).
          const ro = new ResizeObserver(schedule);
          ro.observe(view.dom);
          if (view.dom.parentElement) ro.observe(view.dom.parentElement);
          schedule();
          return {
            update: (_v, prevState) => { if (prevState.doc !== view.state.doc) schedule(); },
            destroy: () => { destroyed = true; if (raf) cancelAnimationFrame(raf); ro.disconnect(); },
          };
        },
      }),
    ];
  },
});
