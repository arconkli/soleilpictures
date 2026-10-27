// A tag's actions, or a tagged item's, on a phone (the owner's direction A):
// there is no right-click under a finger, and iOS never raises contextmenu,
// so a ⋯ (or a long press) opens them here, finger-sized, in the app's sheet.
import { Sheet } from './shell/Sheet.jsx';

export function TagActionSheet({ title, sub, actions, onClose }) {
  return (
    <Sheet open onClose={onClose} className="tag-sheet">
      <div className="tag-sheet-head">
        <div className="tag-sheet-title">{title}</div>
        {sub && <div className="tag-sheet-sub">{sub}</div>}
      </div>
      <div className="tag-sheet-actions">
        {actions.filter(Boolean).map(a => (
          <button key={a.id} type="button" className={a.danger ? 'is-danger' : ''}
                  onClick={() => { onClose(); a.run(); }}>
            <span className="tag-sheet-label">{a.label}</span>
            {a.value && <span className="tag-sheet-value">{a.value}</span>}
          </button>
        ))}
        <button type="button" className="tag-sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}

// True under a finger (no hover): the sheet, not the pointer menu.
export function prefersSheet() {
  try { return window.matchMedia('(hover: none)').matches; } catch (_) { return false; }
}
