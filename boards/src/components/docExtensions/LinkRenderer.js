import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { getLink } from '../../lib/links.js';

const KEY = new PluginKey('linkRenderer');

// Decorates each `link`-marked range based on its live target list in the
// per-doc Y.Map. Adds class names for kind+count and an inline count badge
// widget for multi-target links. `getYdoc()` is a function so the plugin
// works even before the editor's initial Y.Doc binding finishes.
export function makeLinkRendererPlugin({ getYdoc }) {
  return new Plugin({
    key: KEY,
    state: {
      init() { return DecorationSet.empty; },
      apply(_tr, _old, _oldState, newState) {
        const ydoc = getYdoc?.();
        if (!ydoc) return DecorationSet.empty;
        const decos = [];
        newState.doc.descendants((node, pos) => {
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
        return DecorationSet.create(newState.doc, decos);
      },
    },
    props: {
      decorations(state) { return this.getState(state); },
    },
  });
}
