// A control's shortcut in aria-keyshortcuts' words. The tooltip shows it for
// the eye (Bold (⌘B)); the attribute tells a screen reader, which reads the
// name without it. "Mod" is ⌘ on a Mac and Ctrl elsewhere, as the editors'
// keymaps read it; several shortcuts go space-separated.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '');

export function ariaKeys(spec, mac = MAC) {
  return String(spec || '').split(' ')
    .map((one) => one.split('+').map((k) => (k === 'Mod' ? (mac ? 'Meta' : 'Control') : k)).join('+'))
    .join(' ');
}
