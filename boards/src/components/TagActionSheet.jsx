// A tag's actions, or a tagged item's, on a phone (the owner's direction A):
// there is no right-click under a finger, and iOS never raises contextmenu,
// so a ⋯ (or a long press) opens them here, finger-sized, in the app's sheet.
// The mockup's rows: an icon, the words, and on the right what the row holds
// now (a colour, a type) with › when it opens another sheet; the red row sits
// under a rule, and Cancel is a button of its own. Loaded on demand (the
// sidebar lazy-loads it; the tag page is lazy itself).
import { Sheet } from './shell/Sheet.jsx';
import { Icon } from './Icon.jsx';
import { Check, ChevronRight, Drop, Edit, GitMerge, Shapes, Trash2, X } from '../lib/icons.js';

// By the action's id, so the callers import no icons of their own (the
// sidebar loads with the app; these load with the sheet).
const ICONS = {
  rename: Edit, recolor: Drop, merge: GitMerge, type: Shapes, delete: Trash2,
  confirm: Check, remove: X,
};

// actions: [{ id, label, run, danger?, value?, swatch?, more? }], with
// nulls skipped. lead: what stands before the title (a tag's dot, an item's
// picture); sub may be a node (an item's tag chip).
export function TagActionSheet({ title, sub, lead = null, actions, onClose }) {
  const list = actions.filter(Boolean);
  const plain = list.filter(a => !a.danger);
  const danger = list.filter(a => a.danger);
  const row = (a) => {
    const icon = ICONS[a.id];
    return (
      <button key={a.id} type="button" className={`tag-sheet-act${a.danger ? ' is-danger' : ''}`}
              onClick={() => { onClose(); a.run(); }}>
        {icon && <Icon as={icon} size={18} weight="regular" className="tag-sheet-icon" />}
        <span className="tag-sheet-label">{a.label}</span>
        {(a.value || a.swatch || a.more) && (
          <span className="tag-sheet-value">
            {a.swatch && <span className="tag-sheet-swatch" style={{ background: a.swatch }} />}
            {a.value}
            {a.more && <Icon as={ChevronRight} size={16} weight="regular" />}
          </span>
        )}
      </button>
    );
  };
  return (
    <Sheet open onClose={onClose} className="tag-sheet">
      <div className="tag-sheet-head">
        {lead}
        <div className="tag-sheet-titles">
          <div className="tag-sheet-title">{title}</div>
          {sub && <div className="tag-sheet-sub">{sub}</div>}
        </div>
      </div>
      <div className="tag-sheet-actions">
        {plain.map(row)}
        {plain.length > 0 && danger.length > 0 && <div className="tag-sheet-rule" />}
        {danger.map(row)}
      </div>
      <div className="tag-sheet-foot">
        <button type="button" className="tag-sheet-cancel" onClick={onClose}>Cancel</button>
      </div>
    </Sheet>
  );
}
