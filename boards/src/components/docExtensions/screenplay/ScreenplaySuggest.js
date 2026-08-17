// Screenplay autocomplete. Context-aware by element:
//   character → cast names already used, then character extensions (V.O./O.S./
//               CONT'D) once a name + space is typed
//   scene     → INT./EXT. prefixes, then locations already used, then time-of-day
//   transition→ common transitions (CUT TO:, DISSOLVE TO:, …)
// Self-contained (plain-DOM popup + one ProseMirror plugin); priority 1001 so
// its handleKeyDown runs before ScreenplayKeymap's Tab/Enter while the popup is
// open (the keymap also defers via the `.sp-autocomplete.is-open` check).
//
// Completion only ever runs with the caret at the END of its line — accepting a
// suggestion replaces token→line-end, which mid-line would eat the rest of the
// line. Enter/Tab on an empty "browse" line stay with the element flow (the
// popup there is a hint), and Escape keeps the popup dismissed until the line's
// text changes.

import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import {
  collectCharacterNamesByFrequency, collectLocations,
  SCENE_PREFIXES, TIMES_OF_DAY, TRANSITIONS, EXTENSIONS,
} from './screenplayFlow.js';

const SCENE_PREFIX_RE = /^(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E\.?)\s+/i;
const startsWithCI = (s, q) => s.toUpperCase().startsWith(q.toUpperCase());

// Returns { items, from } where `from` is the char offset within the line at
// which a chosen item replaces the rest of the line, or null for no suggestion.
function suggestForLine(element, text, docJSON) {
  if (element === 'character') {
    // Extensions already on the cue — never offer one twice ("(V.O.) (V.O.)").
    const present = new Set((text.match(/\([^)]*\)/g) || []).map(s => s.toUpperCase()));
    // Extension stage: typing inside an unclosed '(' → offer the not-yet-present ones.
    const paren = text.lastIndexOf('(');
    if (paren >= 0 && !/\)/.test(text.slice(paren))) {
      const typed = text.slice(paren + 1);
      const items = EXTENSIONS.filter(e => startsWithCI(e.slice(1), typed) && !present.has(e.toUpperCase()));
      return items.length ? { items, from: paren } : null;
    }
    // … or a name + trailing space → offer an extension, but ONLY if the cue
    // doesn't already carry one (no reason to add a second).
    if (!present.size && /\S\s+$/.test(text)) return { items: EXTENSIONS, from: text.length };
    // Otherwise: cast names, MOST-USED first. On an EMPTY cue, proactively offer
    // the whole cast (pick the next speaker); once typing, prefix-match it.
    const q = text.trim().toUpperCase();
    const all = collectCharacterNamesByFrequency(docJSON);
    if (!q) return all.length ? { items: all, from: 0 } : null;
    const names = all.filter(n => n !== q && n.startsWith(q));
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
    // `browse` = the line is empty so the popup is just a hint (Enter/Tab should
    // run the element flow, not accept). `navigated` = the user arrowed to a
    // choice (so Enter/Tab then DO accept even in browse mode). `dismissed` =
    // the line signature Escape was pressed on — the popup stays closed until
    // the line's text changes.
    const ctrl = {
      open: false, items: [], active: 0, from: 0, to: 0, el: null,
      browse: false, navigated: false, sig: null, itemsSig: null, dismissed: null,
    };

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
      // Anchor at the START of the token being completed so the popup lines up
      // under the cue / element column rather than drifting to the line end.
      let coords;
      try { coords = view.coordsAtPos(ctrl.from); } catch (_) { coords = null; }
      if (coords) {
        // Make it measurable before clamping (position:fixed + display:none
        // reports a zero rect).
        el.style.display = 'block';
        el.style.left = '0px';
        el.style.top = '0px';
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const w = el.offsetWidth || 160;
        const h = el.offsetHeight || 0;
        const MARGIN = 8;
        // Phone: the cue column sits ~22ch in, so an unclamped popup routinely
        // hangs off the right edge (and, near the fold, off the bottom).
        const left = Math.max(MARGIN, Math.min(coords.left, vw - w - MARGIN));
        const below = coords.bottom + 4;
        const top = (below + h + MARGIN > vh && coords.top - h - 4 > MARGIN)
          ? coords.top - h - 4          // flip above the caret
          : Math.max(MARGIN, Math.min(below, vh - h - MARGIN));
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(top)}px`;
      } else {
        el.style.display = 'block';
      }
      el.classList.add('is-open');
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
      // Never open (or keep) a popup over an unfocused editor.
      if (!view.hasFocus()) return close();
      const $from = sel.$from;
      let depth = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'screenplayBlock') { depth = d; break; }
      }
      if (depth == null) return close();
      const node = $from.node(depth);
      const element = node.attrs.element || 'action';
      // Only these three elements ever produce suggestions — bail before the
      // doc serialization below so ordinary action/dialogue typing pays nothing.
      if (element !== 'character' && element !== 'scene' && element !== 'transition') return close();
      const text = node.textContent;
      const lineStart = $from.start(depth);
      const lineEnd = $from.end(depth);
      // Completion is a typing-forward affair: anywhere but line end, accepting
      // would clobber the text after the caret.
      if (sel.from !== lineEnd) return close();
      const sig = `${lineStart}:${element}:${text}`;
      if (ctrl.dismissed === sig) return close();   // Escape holds until the text changes
      ctrl.dismissed = null;
      ctrl.sig = sig;
      const docJSON = element === 'transition' ? null : state.doc.toJSON();
      const res = suggestForLine(element, text, docJSON);
      if (!res || !res.items.length) return close();
      const itemsSig = res.items.join('\n');
      if (itemsSig !== ctrl.itemsSig) ctrl.active = 0;   // fresh list → top item
      ctrl.itemsSig = itemsSig;
      ctrl.items = res.items;
      ctrl.active = Math.min(ctrl.active, res.items.length - 1);
      ctrl.from = lineStart + res.from;
      ctrl.to = lineEnd;
      ctrl.browse = !text.trim();   // empty line → hint mode; Enter escalates
      ctrl.navigated = false;        // reset until the user arrows to a choice
      render(view);
    };

    return [
      new Plugin({
        view(view) {
          // The popup is position:fixed — keep it glued to the caret on scroll,
          // and close it when the interaction moves elsewhere (outside click /
          // focus loss), so it can never float over unrelated UI while
          // suggestionOpen() steals the keymap's Enter/Tab.
          const onScroll = () => { if (ctrl.open) render(view); };
          const onPointerDown = (e) => {
            if (!ctrl.open) return;
            if (ctrl.el && ctrl.el.contains(e.target)) return;   // accepting a row
            if (view.dom.contains(e.target)) return;             // caret move → recompute decides
            close();
          };
          const onBlur = () => close();
          window.addEventListener('scroll', onScroll, true);
          document.addEventListener('pointerdown', onPointerDown, true);
          view.dom.addEventListener('blur', onBlur);
          return {
            update: (v) => recompute(v),
            destroy: () => {
              window.removeEventListener('scroll', onScroll, true);
              document.removeEventListener('pointerdown', onPointerDown, true);
              view.dom.removeEventListener('blur', onBlur);
              close();
              if (ctrl.el) { ctrl.el.remove(); ctrl.el = null; }
            },
          };
        },
        props: {
          handleKeyDown(view, event) {
            if (!ctrl.open) return false;
            if (event.key === 'ArrowDown') { ctrl.navigated = true; ctrl.active = (ctrl.active + 1) % ctrl.items.length; render(view); return true; }
            if (event.key === 'ArrowUp') { ctrl.navigated = true; ctrl.active = (ctrl.active - 1 + ctrl.items.length) % ctrl.items.length; render(view); return true; }
            // Tab/Enter pick the highlighted item — EXCEPT on an empty "browse"
            // line the user hasn't navigated: there the popup is only a hint, so
            // both defer to ScreenplayKeymap (Tab cycles the element, Enter runs
            // the element flow — its `.sp-autocomplete.is-open` guard sees the
            // popup closed). Shift-Tab NEVER accepts — it's the backward cycle.
            if (event.key === 'Tab') {
              if (event.shiftKey || (ctrl.browse && !ctrl.navigated)) { close(); return false; }
              accept(view, ctrl.active); return true;
            }
            if (event.key === 'Enter') {
              if (ctrl.browse && !ctrl.navigated) { close(); return false; }
              accept(view, ctrl.active); return true;
            }
            if (event.key === 'Escape') {
              // Dismiss AND stay dismissed for this line content — without the
              // marker the next transaction would immediately reopen it.
              ctrl.dismissed = ctrl.sig;
              close();
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
