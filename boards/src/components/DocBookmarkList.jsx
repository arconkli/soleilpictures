// The doc's bookmarks, listed under the page tree. "Bookmark this spot" in the
// toolbar wrote a durable anchor that nothing ever showed (the right rail that
// listed them was removed), so a saved bookmark went nowhere. Click a row to
// jump to it; editors can remove one, with the house Undo toast.

import { deleteBookmark, getDocUndoManager } from '../lib/docState.js';
import { useFeedback } from './AppFeedback.jsx';
import { undoToast } from '../lib/undoToast.js';
import { Icon } from './Icon.jsx';
import { BookmarkSimple, X } from '../lib/icons.js';
import { t, ph } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

export function DocBookmarkList({ ydoc, scope, bookmarks = [], pages = [], onJump, canEdit = true }) {
  const feedback = useFeedback();
  if (!bookmarks.length) return null;
  const pageName = (id) => pages.find(p => p.id === id)?.name || t`Untitled`;
  const shownName = (b) => b.name || t`Bookmark`;
  const remove = (b) => {
    const um = getDocUndoManager(ydoc, scope);
    um?.stopCapturing();
    deleteBookmark(ydoc, b.id, scope);
    const item = um?.undoStack?.length ? um.undoStack[um.undoStack.length - 1] : null;
    um?.stopCapturing();
    undoToast(feedback, {
      message: t`Bookmark removed`,
      undoManager: um,
      stackItem: item,
      onUndo: () => { try { um?.undo(); } catch (_) {} },
    });
  };
  return (
    <div className="doc-bookmarks">
      <div className="doc-bookmarks-head t-eyebrow"><Trans>Bookmarks</Trans></div>
      {bookmarks.map(b => (
        <div key={b.id} className="doc-bookmarks-row">
          <Icon as={BookmarkSimple} size={16} />
          <button type="button" className="doc-bookmarks-item"
                  title={t`${ph({ name: shownName(b) })} — ${ph({ page: pageName(b.pageId) })}`}
                  onClick={() => onJump?.(b.id)}>
            {shownName(b)}
          </button>
          {canEdit && (
            <button type="button" className="doc-bookmarks-x"
                    title={t`Remove bookmark`} aria-label={t`Remove bookmark ${ph({ name: b.name || '' })}`.trim()}
                    onClick={() => remove(b)}><Icon as={X} size={12} /></button>
          )}
        </div>
      ))}
    </div>
  );
}
