// The doc's bookmarks, listed under the page tree. "Bookmark this spot" in the
// toolbar wrote a durable anchor that nothing ever showed (the right rail that
// listed them was removed), so a saved bookmark went nowhere. Click a row to
// jump to it; editors can remove one, with the house Undo toast.

import { deleteBookmark, getDocUndoManager } from '../lib/docState.js';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';

export function DocBookmarkList({ ydoc, scope, bookmarks = [], pages = [], onJump, canEdit = true }) {
  const feedback = useFeedback();
  if (!bookmarks.length) return null;
  const pageName = (id) => pages.find(p => p.id === id)?.name || 'Untitled';
  const remove = (b) => {
    const um = getDocUndoManager(ydoc, scope);
    um?.stopCapturing();
    deleteBookmark(ydoc, b.id, scope);
    const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
    um?.stopCapturing();
    undoToast(feedback, {
      message: 'Bookmark removed',
      undoManager: um,
      stackItem: item,
      onUndo: () => { try { um?.undo(); } catch (_) {} },
    });
  };
  return (
    <div className="doc-bookmarks">
      <div className="doc-bookmarks-head t-eyebrow">Bookmarks</div>
      {bookmarks.map(b => (
        <div key={b.id} className="doc-bookmarks-row">
          <button type="button" className="doc-bookmarks-item"
                  title={`${b.name || 'Bookmark'} — ${pageName(b.pageId)}`}
                  onClick={() => onJump?.(b.id)}>
            {b.name || 'Bookmark'}
          </button>
          {canEdit && (
            <button type="button" className="doc-bookmarks-x"
                    title="Remove bookmark" aria-label={`Remove bookmark ${b.name || ''}`.trim()}
                    onClick={() => remove(b)}>×</button>
          )}
        </div>
      ))}
    </div>
  );
}
