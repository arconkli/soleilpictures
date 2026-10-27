// The parts every bar in the toolbar look uses: a shortcut's keys as caps,
// and a control's tooltip. The bars and the doc editor have one look each, so
// nothing asks which: main.jsx marks <html> data-tb="a" and
// data-doc-look="a" before anything renders, and the CSS keys on the marks.

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

// A right-click menu row's shortcut as the menu writes it for the eye, the
// platform's way ("⌘⇧D", "Ctrl+Shift+D", "⌫", "F2"): its keys, each for a cap
// of its own; and the same in aria-keyshortcuts' words, which the row carries
// so that a screen reader reads its name without them.
const GLYPH_MODS = '⌘⌃⌥⇧';
const ARIA_OF = {
  '⌘': 'Meta', '⌃': 'Control', Ctrl: 'Control', '⌥': 'Alt', '⇧': 'Shift',
  '⌫': 'Backspace', '⌦': 'Delete', Del: 'Delete', '↩': 'Enter', '⇥': 'Tab', Esc: 'Escape',
};

export function shortcutCaps(written) {
  const s = String(written || '').trim();
  // The words' way, "+" between the keys ("Ctrl++" is Ctrl and +); a Mac's
  // glyphs come one after another.
  if (!GLYPH_MODS.includes(s[0]) && s.indexOf('+') > 0) {
    return s.endsWith('++') ? [...s.slice(0, -2).split('+'), '+'] : s.split('+');
  }
  const caps = [];
  let rest = s;
  while (rest.length > 1 && GLYPH_MODS.includes(rest[0])) { caps.push(rest[0]); rest = rest.slice(1); }
  return rest ? [...caps, rest] : caps;
}

export function shortcutAria(written) {
  return shortcutCaps(written).map((k) => ARIA_OF[k] || k).join('+');
}

// A control's tooltip: the one host's (components/toolbar/tipHost.js), with
// its words and the shortcut's keys in caps, on the side it asks for (the
// rail's go right).
export function tlTip(label, keys, side) {
  const a = { 'data-tl-tip': label };
  if (keys) a['data-tl-keys'] = keys;
  if (side) a['data-tl-tip-side'] = side;
  return a;
}
