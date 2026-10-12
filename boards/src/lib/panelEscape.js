// Does this Escape close a side panel (Messages, Schedule)? Pure, so
// node --test can pin it.
//
// Escape closes the nearest layer only. A control inside the panel that
// handled the key — an edit box, a rename field, a menu, the emoji palette —
// claims it with preventDefault, and the panel must not close on the same
// press (COMMS-10). The panel owns Escape only while focus is inside it, so a
// press meant for the canvas or another surface is left alone; and a field
// that holds words keeps the panel open, because a slip would cost the
// reader their place.

function isTextField(t) {
  if (!t) return false;
  if (t.isContentEditable) return true;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
}

// e — the keydown event; selector — the panel's root class (".msg-panel").
export function escapeClosesPanel(e, selector) {
  if (!e || e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return false;
  const t = e.target;
  if (!t?.closest?.(selector)) return false;
  if (isTextField(t) && String(t.value ?? t.textContent ?? '').trim()) return false;
  return true;
}
