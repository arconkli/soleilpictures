// Reactive view of a doc — pages + bookmarks + comments. Works for both
// root-scoped docs (view='doc' boards) and card-scoped docs (doc cards on
// a canvas). The Tiptap editor binds DIRECTLY to the page Y.XmlFragment via
// the Collaboration extension, so we don't observe content here.
//
// Pass `scope` for card-mode (returned by cardScope(cardYMap)). Omit for
// root-mode (the legacy view='doc' boards).

import { useEffect, useState } from 'react';
import {
  pagesArray, bookmarksMap, commentsMap,
  readPages, readBookmarks, readComments,
} from '../lib/docState.js';

export function useDocBoard(ydoc, scope) {
  const [snapshot, setSnapshot] = useState(() => ({
    pages: ydoc ? readPages(ydoc, scope) : [],
    bookmarks: ydoc ? readBookmarks(ydoc, scope) : [],
    comments: ydoc ? readComments(ydoc, scope) : [],
  }));

  useEffect(() => {
    if (!ydoc) {
      setSnapshot({ pages: [], bookmarks: [], comments: [] });
      return;
    }
    const pages = pagesArray(ydoc, scope);
    const bookmarks = bookmarksMap(ydoc, scope);
    const comments = commentsMap(ydoc, scope);
    if (!pages || !bookmarks || !comments) {
      // Card scope hasn't been initialized yet — bail gracefully.
      setSnapshot({ pages: [], bookmarks: [], comments: [] });
      return;
    }
    const refresh = () => {
      setSnapshot({
        pages: readPages(ydoc, scope),
        bookmarks: readBookmarks(ydoc, scope),
        comments: readComments(ydoc, scope),
      });
    };
    refresh();
    pages.observeDeep(refresh);
    bookmarks.observeDeep(refresh);
    comments.observeDeep(refresh);
    return () => {
      pages.unobserveDeep(refresh);
      bookmarks.unobserveDeep(refresh);
      comments.unobserveDeep(refresh);
    };
  }, [ydoc, scope]);

  return snapshot;
}
