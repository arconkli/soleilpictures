// Where a key moves the focus in a menu (the WAI-ARIA menu's keys), for
// components/toolbar/Menu.jsx. Pure: the menu hands over its rows.

// ↓ ↑ to the next and the previous row, round from the last to the first;
// Home and End to either end. `index` is the focused row's, -1 for the menu
// itself (just opened from a press), from where ↓ is the first row and ↑ the
// last. Any other key isn't the menu's: null.
export function menuMove(key, index, count) {
  if (!count) return null;
  switch (key) {
    case 'ArrowDown': return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

// A letter: the next row, after the focused one and round from the end, whose
// words start with it.
export function menuTypeahead(ch, labels, index) {
  const c = String(ch || '').toLowerCase();
  if (!c.trim()) return null;
  const n = labels.length;
  for (let k = 1; k <= n; k++) {
    const j = (Math.max(index, -1) + k) % n;
    if (String(labels[j] || '').trim().toLowerCase().startsWith(c)) return j;
  }
  return null;
}
