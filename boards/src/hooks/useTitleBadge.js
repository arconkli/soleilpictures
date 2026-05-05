import { useEffect } from 'react';

// Prepends "(N)" or "(@N)" to document.title when there are unread
// messages or @-mentions. Restores the original title on unmount.
export function useTitleBadge({ total = 0, mentions = 0 }) {
  useEffect(() => {
    const original = document.title.replace(/^\(@?\d+\)\s+/, '');
    if (total === 0 && mentions === 0) {
      document.title = original;
      return;
    }
    const badge = mentions > 0 ? `(@${mentions}) ` : `(${total}) `;
    document.title = badge + original;
    return () => { document.title = original; };
  }, [total, mentions]);
}
