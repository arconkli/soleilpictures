// Character-name autocomplete for screenplay mode. When the caret is in a
// `character` line with a partial name, a popup offers names already used in the
// script (so a screenwriter never re-types a cast member). Self-contained
// (plain-DOM popup + a single ProseMirror plugin) so it doesn't pull in extra
// deps; priority 1001 so its handleKeyDown runs before ScreenplayKeymap's
// Tab/Enter cycling while the popup is open (which also defers via the
// `.sp-autocomplete.is-open` check).

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

function baseName(text) {
  return String(text || '').split('(')[0].trim().toUpperCase();
}

function collectNames(doc) {
  const set = new Set();
  doc.descendants((node) => {
    if (node.type.name === 'screenplayBlock' && node.attrs.element === 'character') {
      const n = baseName(node.textContent);
      if (n) set.add(n);
    }
    return true;
  });
  return [...set].sort();
}

export const ScreenplaySuggest = Extension.create({
  name: 'screenplaySuggest',
  priority: 1001,

  addProseMirrorPlugins() {
    const ctrl = { open: false, items: [], active: 0, from: 0, to: 0, el: null };

    const ensureEl = () => {
      if (ctrl.el) return ctrl.el;
      const el = document.createElement('div');
      el.className = 'sp-autocomplete';
      document.body.appendChild(el);
      ctrl.el = el;
      return el;
    };
    const close = () => {
      ctrl.open = false;
      if (ctrl.el) { ctrl.el.classList.remove('is-open'); ctrl.el.style.display = 'none'; }
    };
    const render = (view) => {
      const el = ensureEl();
      el.innerHTML = '';
      ctrl.items.forEach((name, i) => {
        const row = document.createElement('div');
        row.className = `sp-autocomplete-item${i === ctrl.active ? ' is-active' : ''}`;
        row.textContent = name;
        row.addEventListener('mousedown', (e) => { e.preventDefault(); accept(view, i); });
        el.appendChild(row);
      });
      // Position under the caret line.
      let coords;
      try { coords = view.coordsAtPos(ctrl.to); } catch (_) { coords = null; }
      if (coords) {
        el.style.left = `${Math.round(coords.left)}px`;
        el.style.top = `${Math.round(coords.bottom + 4)}px`;
      }
      el.classList.add('is-open');
      el.style.display = 'block';
      ctrl.open = true;
    };
    const accept = (view, idx) => {
      const name = ctrl.items[idx];
      if (name == null) return;
      view.dispatch(view.state.tr.insertText(name, ctrl.from, ctrl.to));
      close();
      view.focus();
    };
    const recompute = (view) => {
      const { state } = view;
      const sel = state.selection;
      if (!sel.empty) return close();
      const $from = sel.$from;
      let depth = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'screenplayBlock') { depth = d; break; }
      }
      if (depth == null) return close();
      const node = $from.node(depth);
      if (node.attrs.element !== 'character') return close();
      const text = node.textContent;
      const q = text.trim().toUpperCase();
      if (!q) return close();
      const names = collectNames(state.doc).filter(n => n !== q && n.startsWith(q));
      if (!names.length) return close();
      ctrl.items = names;
      ctrl.active = Math.min(ctrl.active, names.length - 1);
      ctrl.from = $from.start(depth);
      ctrl.to = $from.end(depth);
      render(view);
    };

    return [
      new Plugin({
        view() {
          return {
            update: (view) => recompute(view),
            destroy: () => { close(); if (ctrl.el) { ctrl.el.remove(); ctrl.el = null; } },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (!ctrl.open) return false;
            if (event.key === 'ArrowDown') { ctrl.active = (ctrl.active + 1) % ctrl.items.length; render(view); return true; }
            if (event.key === 'ArrowUp') { ctrl.active = (ctrl.active - 1 + ctrl.items.length) % ctrl.items.length; render(view); return true; }
            if (event.key === 'Enter' || event.key === 'Tab') { accept(view, ctrl.active); return true; }
            if (event.key === 'Escape') { close(); return true; }
            return false;
          },
        },
      }),
    ];
  },
});
