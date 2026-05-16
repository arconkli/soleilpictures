// Reactive view of a doc — pages + bookmarks + comments. Works for both
// root-scoped docs (view='doc' boards) and card-scoped docs (doc cards on
// a canvas). The Tiptap editor binds DIRECTLY to the page Y.XmlFragment via
// the Collaboration extension, so we don't observe content here.
//
// Pass `scope` for card-mode (returned by cardScope(cardYMap)). Omit for
// root-mode (the legacy view='doc' boards).

import { useEffect, useState } from 'react';
import {
  pagesArray, bookmarksMap, commentsMap, pageSheetsMap,
  readPages, readBookmarks, readComments, getPageSheetIds,
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

// Reactive list of sheet IDs for one page. Always includes the implicit
// primary sheet (id === pageId) followed by any extra sheets in their stored
// order. Observes the page's Y.Array of sheets so adding/removing sheets
// re-renders consumers.
export function usePageSheets(ydoc, pageId, scope) {
  const [ids, setIds] = useState(() => (ydoc && pageId ? getPageSheetIds(ydoc, pageId, scope) : []));

  useEffect(() => {
    if (!ydoc || !pageId) {
      setIds(pageId ? [pageId] : []);
      return;
    }
    const refresh = () => setIds(getPageSheetIds(ydoc, pageId, scope));
    refresh();
    const sm = pageSheetsMap(ydoc, scope);
    if (!sm) return;
    // Two layers to observe: (a) the per-page Y.Array of sheets so insert/
    // delete fire, and (b) the parent map so we catch the case where the
    // array is first created (Y.Map set after this hook runs).
    const mapObserver = () => {
      refresh();
      const arr = sm.get(pageId);
      if (arr && !arrayObservers.has(arr)) {
        arr.observe(refresh);
        arrayObservers.set(arr, refresh);
      }
    };
    sm.observe(mapObserver);
    const arrayObservers = new Map();
    const initialArr = sm.get(pageId);
    if (initialArr) {
      initialArr.observe(refresh);
      arrayObservers.set(initialArr, refresh);
    }
    return () => {
      sm.unobserve(mapObserver);
      for (const [arr, cb] of arrayObservers) {
        try { arr.unobserve(cb); } catch (_) {}
      }
    };
  }, [ydoc, pageId, scope]);

  return ids;
}
