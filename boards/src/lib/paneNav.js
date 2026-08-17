// Per-pane board navigation — the stack math behind "each side of a split
// navigates itself".
//
// The workspace can show two board surfaces at once (App.jsx renderSurface).
// The main pane has always had a real breadcrumb stack; the split pane used to
// hold a single board id, which meant it had nowhere to navigate TO — so every
// in-pane open (double-click a nested cluster, a list row, a context-menu
// "Open cluster") pushed onto the MAIN pane's stack and the split silently
// showed the wrong thing.
//
// Both panes now run the same three verbs, and they live here rather than as
// inline setState callbacks because the split feature is unreachable from the
// Playwright harness (?local=1 loads LocalBoardsApp, which has no split at
// all). Pure functions are the only part of it a test can actually hold.
//
// Every verb returns the SAME array reference when nothing changed, so a
// `setStack(s => pushPane(s, id))` that is a no-op doesn't re-render the pane.

// Open `id` one level deeper. Re-opening the board already on top is a no-op —
// otherwise a double-fired click (touch tap + synthesized mouse click) would
// stack the same board twice and leave a duplicate breadcrumb to climb back
// through.
export function pushPane(stack, id) {
  if (!id) return stack;
  const s = Array.isArray(stack) ? stack : [];
  if (s.length && s[s.length - 1] === id) return s;
  return [...s, id];
}

// Climb to breadcrumb `index` (0 = the pane's root). Out-of-range indexes
// leave the stack alone rather than emptying it — an empty split stack means
// "no split", and a stray click must never close the pane.
export function climbPane(stack, index) {
  const s = Array.isArray(stack) ? stack : [];
  if (!Number.isInteger(index) || index < 0 || index >= s.length) return s;
  if (index === s.length - 1) return s;
  return s.slice(0, index + 1);
}

// Drop frames whose board no longer exists. Catches cascaded deletes (delete a
// parent while you're inside a descendant) the same way the main pane's
// existence filter does. Unlike the main pane there is no root to fall back
// to: an empty result closes the split, which is the honest outcome when every
// board it was showing is gone.
export function prunePane(stack, exists) {
  const s = Array.isArray(stack) ? stack : [];
  const filtered = s.filter((id) => exists(id));
  return filtered.length === s.length ? s : filtered;
}

// Read the split stack out of the persisted session blob. Sessions written
// before the split pane had a stack carry a scalar `splitId`; they restore as
// a one-frame stack so an in-flight split survives the upgrade.
export function restorePaneStack(session) {
  const saved = session?.splitStack;
  if (Array.isArray(saved) && saved.length) return saved.filter(Boolean);
  return session?.splitId ? [session.splitId] : [];
}
