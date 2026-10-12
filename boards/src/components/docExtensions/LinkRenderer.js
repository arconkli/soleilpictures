import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getLink, linksMap } from '../../lib/links.js';

export const LINK_RENDERER_KEY = new PluginKey('linkRenderer');
const KEY = LINK_RENDERER_KEY;

// Decorates each `link`-marked range based on its live target list in the
// per-doc Y.Map. Adds class names for kind+count and an inline count badge
// widget for multi-target links. `getYdoc()` is a function so the plugin
// works even before the editor's initial Y.Doc binding finishes.
export function makeLinkRendererPlugin({ getYdoc }) {
  const build = (doc) => {
    const ydoc = getYdoc?.();
    if (!ydoc) return DecorationSet.empty;
    const decos = [];
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      for (const m of node.marks) {
        if (m.type.name !== 'link') continue;
        const id = m.attrs.linkId;
        const link = id ? getLink(ydoc, id) : null;
        const targets = link?.targets || [];
        // Universal hairline visual: `tt-link tt-link-manual` is the
        // single class for explicitly-inserted links. `tt-link-broken`
        // overrides for dead targets so they read as muted. Multi-
        // target links still get an inline count badge.
        const broken = targets.length === 0;
        const cls = ['tt-link', 'tt-link-manual',
                     broken ? 'tt-link-broken' : '',
                     targets.length > 1 ? 'tt-link-multi' : ''].filter(Boolean).join(' ');
        decos.push(Decoration.inline(pos, pos + node.text.length, {
          class: cls,
          ...(id ? { 'data-link-id': id } : {}),
        }));
        if (targets.length > 1) {
          const badge = document.createElement('sup');
          badge.className = 'tt-link-badge';
          badge.textContent = String(targets.length);
          if (id) badge.dataset.linkId = id;
          decos.push(Decoration.widget(pos + node.text.length, () => badge, { side: 1 }));
        }
      }
      return true;
    });
    return DecorationSet.create(doc, decos);
  };

  return new Plugin({
    key: KEY,
    state: {
      init(_config, state) { return build(state.doc); },
      apply(tr, old, _oldState, newState) {
        // Rebuild only when the doc changed or a link's targets did (the
        // view below dispatches this key's meta). Selection-only
        // transactions used to rebuild every badge widget per caret move.
        if (!tr.docChanged && !tr.getMeta(KEY)) return old;
        return build(newState.doc);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
    // Targets live in the doc's links Y.Map, outside the ProseMirror doc, so a
    // retarget (here or by a peer) has to ask for a rebuild explicitly.
    view(view) {
      const ydoc = getYdoc?.();
      const map = ydoc ? linksMap(ydoc) : null;
      if (!map) return {};
      let raf = 0;
      let destroyed = false;
      const refresh = () => {
        raf = 0;
        if (destroyed || view.isDestroyed) return;
        try { view.dispatch(view.state.tr.setMeta(KEY, true).setMeta('addToHistory', false)); } catch (_) {}
      };
      const onChange = () => { if (!raf) raf = requestAnimationFrame(refresh); };
      map.observeDeep(onChange);
      return {
        destroy() {
          destroyed = true;
          if (raf) cancelAnimationFrame(raf);
          map.unobserveDeep(onChange);
        },
      };
    },
  });
}
