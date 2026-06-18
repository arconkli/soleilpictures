// Screenplay autocomplete. Context-aware by element:
//   character → cast names already used, then character extensions (V.O./O.S./
//               CONT'D) once a name + space is typed
//   scene     → INT./EXT. prefixes, then locations already used, then time-of-day
//   transition→ common transitions (CUT TO:, DISSOLVE TO:, …)
// Self-contained (plain-DOM popup + one ProseMirror plugin); priority 1001 so
// its handleKeyDown runs before ScreenplayKeymap's Tab/Enter while the popup is
// open (the keymap also defers via the `.sp-autocomplete.is-open` check).

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import {
  collectCharacterNames, collectLocations, SCENE_PREFIXES, TIMES_OF_DAY,
} from './screenplayFlow.js';

const TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'FADE TO:', 'FADE OUT.', 'INTERCUT WITH:'];
const EXTENSIONS = ['(V.O.)', '(O.S.)', "(CONT'D)"];
const SCENE_PREFIX_RE = /^(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)\s+/i;
const startsWithCI = (s, q) => s.toUpperCase().startsWith(q.toUpperCase());

// Returns { items, from } where `from` is the char offset within the line at
// which a chosen item replaces the rest of the line, or null for no suggestion.
function suggestForLine(element, text, docJSON) {
  if (element === 'character') {
    // Extension stage: typing inside a '(' …
    const paren = text.lastIndexOf('(');
    if (paren >= 0 && !/\)/.test(text.slice(paren))) {
      const typed = text.slice(paren + 1);
      const items = EXTENSIONS.filter(e => startsWithCI(e.slice(1), typed));
      return items.length ? { items, from: paren } : null;
    }
    // … or a name followed by a trailing space → offer to append an extension.
    if (/\S\s+$/.test(text)) return { items: EXTENSIONS, from: text.length };
    // Otherwise: cast names.
    const q = text.trim().toUpperCase();
    if (!q) return null;
    const names = collectCharacterNames(docJSON).filter(n => n !== q && n.startsWith(q));
    return names.length ? { items: names, from: text.length - text.trimStart().length } : null;
  }

  if (element === 'scene') {
    const m = text.match(SCENE_PREFIX_RE);
    if (!m) {
      // No prefix yet → suggest INT./EXT./…
      const items = SCENE_PREFIXES.filter(p => startsWithCI(p, text));
      return items.length ? { items, from: 0 } : null;
    }
    const afterPrefix = m[0].length;
    const dash = text.indexOf(' - ', afterPrefix);
    if (dash < 0) {
      // Between prefix and " - " → suggest locations.
      const partial = text.slice(afterPrefix).toUpperCase();
      const items = collectLocations(docJSON).filter(l => l.startsWith(partial) && l !== partial);
      return items.length ? { items, from: afterPrefix } : null;
    }
    // After " - " → suggest time of day.
    const tFrom = dash + 3;
    const partial = text.slice(tFrom).toUpperCase();
    const items = TIMES_OF_DAY.filter(t => t.startsWith(partial) && t !== partial);
    return items.length ? { items, from: tFrom } : null;
  }

  if (element === 'transition') {
    const items = TRANSITIONS.filter(t => startsWithCI(t, text) && t.toUpperCase() !== text.toUpperCase());
    return items.length ? { items, from: 0 } : null;
  }

  return null;
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
      const element = node.attrs.element || 'action';
      const text = node.textContent;
      const lineStart = $from.start(depth);
      const lineEnd = $from.end(depth);
      const res = suggestForLine(element, text, state.doc.toJSON());
      if (!res || !res.items.length) return close();
      ctrl.items = res.items;
      ctrl.active = Math.min(ctrl.active, res.items.length - 1);
      ctrl.from = lineStart + res.from;
      ctrl.to = lineEnd;
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
