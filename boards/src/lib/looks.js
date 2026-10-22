// Which look the toolbars and the doc editor wear, while each is held
// (lib/appHost.js toolbarLookAllowed, docLookAllowed). main.jsx asks the
// switches once, before anything renders, and marks <html>: data-tb="a" for
// the toolbars, data-doc-look="a" for the doc editor. The CSS keys on the
// marks and markup that differs asks here, so no component asks a switch, and
// the markup and the CSS can't disagree.
const mark = (name) => (typeof document !== 'undefined' && document.documentElement?.dataset?.[name]) || null;

export const toolbarLook = () => mark('tb') === 'a';
export const docLook = () => mark('docLook') === 'a';

// A shortcut as the keys a tooltip or a menu shows, each in its own cap:
// "Mod+Shift+Z" is ⌘ ⇧ Z on a Mac and Ctrl Shift Z elsewhere. The spec is
// aria-keyshortcuts' (lib/ariaKeys.js), and of several, the first is shown.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');
const MODS_MAC = { Mod: '⌘', Meta: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' };
const MODS_PC = { Mod: 'Ctrl', Meta: 'Win', Control: 'Ctrl', Ctrl: 'Ctrl', Alt: 'Alt', Shift: 'Shift' };
const NAMED = {
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
  Escape: 'Esc', ' ': 'Space', Space: 'Space', '=': '+', '-': '−',
};
const NAMED_MAC = { Enter: '↩', Backspace: '⌫', Delete: '⌦', Tab: '⇥' };

export function keyCaps(spec, mac = MAC) {
  const first = String(spec || '').trim().split(' ')[0];
  if (!first) return [];
  const mods = mac ? MODS_MAC : MODS_PC;
  return first.split('+').map((k) => mods[k] || (mac && NAMED_MAC[k]) || NAMED[k]
    || (k.length === 1 ? k.toUpperCase() : k));
}

// The tooltip a control asks for in the new look: the one host's
// (components/toolbar/tipHost.js), with its words and the shortcut's keys in
// caps, on the side it asks for (the rail's go right).
export function tlTip(label, keys, side) {
  const a = { 'data-tl-tip': label };
  if (keys) a['data-tl-keys'] = keys;
  if (side) a['data-tl-tip-side'] = side;
  return a;
}

// The same, for a control that is in both looks: in the look before the new
// one it keeps the browser's tooltip it always had (`legacy`, its old title;
// null if it had none), so nothing changes there.
export function tip(label, keys, legacy, look = toolbarLook()) {
  if (look) return tlTip(label, keys);
  if (legacy === null) return {};
  return { title: legacy ?? label };
}
