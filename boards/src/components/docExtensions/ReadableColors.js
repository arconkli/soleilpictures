// Keep user-chosen text colors readable inside a LIVE Tiptap editor, in either
// theme, without ever touching the stored content (Yjs stays pristine).
//
// Mechanism — a scoped stylesheet, NOT decorations. ProseMirror renders inline
// decorations OUTSIDE mark spans, so a decoration's color is only *inherited* by
// the mark span and loses to the mark's own inline `color`. An author
// `!important` rule, however, beats a non-important inline style on the SAME
// element. The Color/Highlight marks keep their literal value in the style
// attribute (`style="color: rgb(…)"`), so an attribute selector targets the
// mark span directly. We compute the readable override per surface (the page
// sheet / note bg, read from the rendered DOM) and re-run on edits + theme flips.
//
// Implemented as a ProseMirror plugin `view()` (same idiom as DocPagination) so
// it's tied to the real EditorView lifecycle — created/destroyed with the view,
// robust to editor recreation + React StrictMode double-mounts (no stale
// stylesheets). Pairs with lib/readableColor.js (the math) and remapHtmlColors
// (the read-only note path). Presentation-only.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { parseColor, buildColorOverrideCss } from '../../lib/readableColor.js';

const key = new PluginKey('readableColors');
let scopeSeq = 0;

// Walk up to the first ancestor with an opaque background — the surface the text
// visually sits on. Works for notes (.note) and docs (.doc-paper / body).
function effectiveBg(dom) {
  let el = dom;
  while (el && el.nodeType === 1) {
    let bg;
    try { bg = getComputedStyle(el).backgroundColor; } catch (_) { bg = null; }
    if (bg && parseColor(bg)) return bg;
    el = el.parentElement;
  }
  try { return getComputedStyle(document.body).backgroundColor || '#ffffff'; }
  catch (_) { return '#ffffff'; }
}

export const ReadableColors = Extension.create({
  name: 'readableColors',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        view(view) {
          if (typeof document === 'undefined') return {};
          const scope = `rc-scope-${scopeSeq++}`;
          view.dom.classList.add(scope);
          const styleEl = document.createElement('style');
          styleEl.setAttribute('data-readable-colors', scope);
          document.head.appendChild(styleEl);

          let raf = 0;
          let lastCss = '';
          const measure = () => {
            raf = 0;
            let css = '';
            try { css = buildColorOverrideCss(view.dom, effectiveBg(view.dom), `.${scope}`); }
            catch (_) { return; }
            if (css === lastCss) return;     // converged — no style-recalc churn
            lastCss = css;
            styleEl.textContent = css;
          };
          const schedule = () => {
            if (typeof requestAnimationFrame === 'undefined') { measure(); return; }
            if (!raf) raf = requestAnimationFrame(measure);
          };

          // Re-evaluate when the app theme flips (the surface bg changes under
          // the same colors). Edits come through the plugin update() below.
          let mo = null;
          try {
            mo = new MutationObserver(schedule);
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
          } catch (_) { /* noop */ }

          schedule();
          return {
            update: (_v, prev) => { if (!prev || prev.doc !== view.state.doc) schedule(); },
            destroy: () => {
              if (raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(raf);
              try { mo && mo.disconnect(); } catch (_) { /* noop */ }
              try { styleEl.remove(); } catch (_) { /* noop */ }
              try { view.dom.classList.remove(scope); } catch (_) { /* noop */ }
            },
          };
        },
      }),
    ];
  },
});
