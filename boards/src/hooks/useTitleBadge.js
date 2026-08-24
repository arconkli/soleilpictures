import { useEffect } from 'react';
import { setTitleBadge } from '../lib/documentTitle.js';

// Prepends "(N)" or "(@N)" to the tab title when there are unread messages or
// @-mentions.
//
// It no longer writes document.title itself. It used to recover its own base by
// reading the title back and regexing its prefix off, which was fine while it
// was the only writer and became a race the moment the cluster name became the
// other one. lib/documentTitle.js owns the composition now — see its header.
export function useTitleBadge({ total = 0, mentions = 0 }) {
  useEffect(() => {
    const badge = mentions > 0 ? `(@${mentions}) ` : (total > 0 ? `(${total}) ` : '');
    setTitleBadge(badge);
    return () => setTitleBadge('');
  }, [total, mentions]);
}
