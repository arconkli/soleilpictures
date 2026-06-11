// Helpers for working with the doc Y.Doc shape.
//
// Two modes:
//   ROOT mode (legacy view='doc' boards): types live directly on the per-board
//     Y.Doc — ydoc.getArray('docPages'), ydoc.getMap('docPageContent'), etc.
//   CARD mode (doc cards on a canvas): each card's YMap holds its own
//     'docPages' Y.Array, 'docPageContent' Y.Map, 'docBookmarks' Y.Map,
//     'docComments' Y.Map. Multiple doc cards on the same board live side by
//     side, each with its own state.
//
// Every helper accepts an optional `scope` arg. Pass null/omit for ROOT mode;
// pass `cardScope(cardYMap)` for CARD mode. Internals look the same for both.

import * as Y from 'yjs';

// ── Scope plumbing ───────────────────────────────────────────────────────────
// A "scope" is just a bag of Y types — pages / content / bookmarks / comments.
// Helpers read from / write to the scope without caring whether it's rooted on
// the per-board Y.Doc or on an individual card's Y.Map.
export function rootScope(ydoc) {
  return {
    pages: ydoc.getArray('docPages'),
    content: ydoc.getMap('docPageContent'),
    bookmarks: ydoc.getMap('docBookmarks'),
    comments: ydoc.getMap('docComments'),
    // Multi-sheet support: a page can have N stacked sheets. Sheet 0 (the
    // "primary") uses the existing pageContentMap entry keyed by pageId so
    // pre-existing data keeps working untouched. Extra sheets (sheet 1 +)
    // live in these new maps and are referenced by their own sheet ID.
    pageSheets: ydoc.getMap('docPageSheets'),       // pageId → Y.Array<{ id }>
    sheetContent: ydoc.getMap('docSheetContent'),   // sheetId → Y.XmlFragment
  };
}
export function cardScope(cardYMap) {
  return {
    pages: cardYMap.get('docPages'),
    content: cardYMap.get('docPageContent'),
    bookmarks: cardYMap.get('docBookmarks'),
    comments: cardYMap.get('docComments'),
    pageSheets: cardYMap.get('docPageSheets'),
    sheetContent: cardYMap.get('docSheetContent'),
  };
}
// Initialize the Y types on a fresh card YMap so cardScope(...) returns
// real values. Call once when a new doc card is created.
export function initCardDocStore(ydoc, cardYMap) {
  ydoc.transact(() => {
    if (!cardYMap.get('docPages'))         cardYMap.set('docPages', new Y.Array());
    if (!cardYMap.get('docPageContent'))   cardYMap.set('docPageContent', new Y.Map());
    if (!cardYMap.get('docBookmarks'))     cardYMap.set('docBookmarks', new Y.Map());
    if (!cardYMap.get('docComments'))      cardYMap.set('docComments', new Y.Map());
    if (!cardYMap.get('docPageSheets'))    cardYMap.set('docPageSheets', new Y.Map());
    if (!cardYMap.get('docSheetContent'))  cardYMap.set('docSheetContent', new Y.Map());
  }, 'local');
}

const S = (ydoc, scope) => scope || rootScope(ydoc);

export function pagesArray(ydoc, scope)        { return S(ydoc, scope).pages; }
export function pageContentMap(ydoc, scope)    { return S(ydoc, scope).content; }
export function bookmarksMap(ydoc, scope)      { return S(ydoc, scope).bookmarks; }
export function commentsMap(ydoc, scope)       { return S(ydoc, scope).comments; }
export function pageSheetsMap(ydoc, scope)     { return S(ydoc, scope).pageSheets; }
export function sheetContentMap(ydoc, scope)   { return S(ydoc, scope).sheetContent; }

export function readPages(ydoc, scope) {
  const arr = pagesArray(ydoc, scope);
  if (!arr) return [];
  return arr.toArray().map(p => (p && p.toJSON) ? p.toJSON() : p);
}

export function readBookmarks(ydoc, scope) {
  const out = [];
  const map = bookmarksMap(ydoc, scope);
  if (!map) return out;
  map.forEach((v, k) => { out.push({ id: k, ...v }); });
  return out;
}

export function readComments(ydoc, scope) {
  const out = [];
  const map = commentsMap(ydoc, scope);
  if (!map) return out;
  map.forEach((v, k) => { out.push({ id: k, ...v }); });
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

// Extract plain text of a single page's Y.XmlFragment. Used by the
// doc_page_index sync to project page text into Postgres for the
// universal "Appears in" hover lookup. Reads the fragment's DOM
// representation and returns trimmed textContent.
export function readPageText(ydoc, pageId, scope) {
  const map = pageContentMap(ydoc, scope);
  if (!map) return '';
  const frag = map.get(pageId);
  if (!frag) return '';
  try {
    if (typeof frag.toDOM === 'function' && typeof document !== 'undefined') {
      const dom = frag.toDOM(document);
      return (dom?.textContent || '').replace(/\s+/g, ' ').trim();
    }
    // Fallback: strip XML tags from the string form.
    const xml = frag.toString ? frag.toString() : '';
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

// Read every page (from this scope) along with its plain text body.
// One call returns the shape syncDocPageIndex expects.
export function readPagesWithText(ydoc, scope) {
  const pages = readPages(ydoc, scope);
  return pages.map(p => ({
    id: p.id,
    name: p.name || '',
    text: readPageText(ydoc, p.id, scope),
  }));
}

// Get-or-create the Y.XmlFragment for a page.
export function getOrCreatePageContent(ydoc, pageId, scope) {
  const map = pageContentMap(ydoc, scope);
  if (!map) return null;
  let frag = map.get(pageId);
  if (!frag) {
    frag = new Y.XmlFragment();
    ydoc.transact(() => { map.set(pageId, frag); }, 'local');
  }
  return frag;
}

// ── Sheets ───────────────────────────────────────────────────────────────────
// A "sheet" is one of N stacked page-sheets within a single doc page. Every
// page has an implicit primary sheet (id = pageId) whose content lives in
// pageContentMap — this keeps legacy data untouched. Additional sheets live
// in pageSheetsMap (pageId → Y.Array of {id}) and their content lives in
// sheetContentMap (sheetId → Y.XmlFragment).

function nextSheetId() {
  return 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// Return the ordered list of sheet IDs for a page. Always starts with the
// primary (= pageId) and is followed by any extra sheets in their stored
// order. Reactive consumers should observe pageSheetsMap(scope).get(pageId)
// to know when the list changes.
export function getPageSheetIds(ydoc, pageId, scope) {
  const out = [pageId];
  if (!pageId) return out;
  const sm = pageSheetsMap(ydoc, scope);
  const arr = sm?.get(pageId);
  if (arr && typeof arr.toArray === 'function') {
    for (const entry of arr.toArray()) {
      if (entry?.id) out.push(entry.id);
    }
  }
  return out;
}

// Resolve a sheet's content fragment. Sheet 0 (id === pageId) uses the
// existing pageContentMap entry so legacy pages render unchanged.
export function getOrCreateSheetContent(ydoc, pageId, sheetId, scope) {
  if (!pageId || !sheetId) return null;
  if (sheetId === pageId) return getOrCreatePageContent(ydoc, pageId, scope);
  const map = sheetContentMap(ydoc, scope);
  if (!map) return null;
  let frag = map.get(sheetId);
  if (!frag) {
    frag = new Y.XmlFragment();
    ydoc.transact(() => { map.set(sheetId, frag); }, 'local');
  }
  return frag;
}

// Add a new sheet to a page. Returns the new sheet id. By default the sheet
// is appended at the end of the stack. Pass `afterSheetId` to insert it
// right after a specific sheet (useful when the user clicks "+ New page"
// from the middle of the stack).
export function addPageSheet(ydoc, pageId, scope, opts = {}) {
  const { afterSheetId = null } = opts;
  if (!pageId) return null;
  const sm = pageSheetsMap(ydoc, scope);
  const sc = sheetContentMap(ydoc, scope);
  if (!sm || !sc) return null;
  const id = nextSheetId();
  ydoc.transact(() => {
    let arr = sm.get(pageId);
    if (!arr) {
      arr = new Y.Array();
      sm.set(pageId, arr);
    }
    let insertIdx = arr.length;
    if (afterSheetId) {
      if (afterSheetId === pageId) {
        // Right after the implicit primary = beginning of extras.
        insertIdx = 0;
      } else {
        const cur = arr.toArray();
        const idx = cur.findIndex(s => s?.id === afterSheetId);
        if (idx >= 0) insertIdx = idx + 1;
      }
    }
    arr.insert(insertIdx, [{ id }]);
    sc.set(id, new Y.XmlFragment());
  }, 'local');
  return id;
}

// Delete a non-primary sheet. The primary (id === pageId) can't be deleted
// via this helper — use deletePage for that.
export function deletePageSheet(ydoc, pageId, sheetId, scope) {
  if (!pageId || !sheetId || sheetId === pageId) return;
  const sm = pageSheetsMap(ydoc, scope);
  const sc = sheetContentMap(ydoc, scope);
  if (!sm || !sc) return;
  ydoc.transact(() => {
    const arr = sm.get(pageId);
    if (arr) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr.get(i)?.id === sheetId) arr.delete(i, 1);
      }
    }
    sc.delete(sheetId);
  }, 'local');
}

function nextPageId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function addPage(ydoc, opts = {}) {
  const { name = 'Untitled', parent_id = null, scope } = opts;
  const id = nextPageId();
  const arr = pagesArray(ydoc, scope);
  const content = pageContentMap(ydoc, scope);
  if (!arr || !content) return id;
  ydoc.transact(() => {
    const siblings = arr.toArray().filter(p => p.parent_id === parent_id);
    const order = siblings.length > 0
      ? Math.max(...siblings.map(p => p.order ?? 0)) + 1
      : 0;
    arr.push([{ id, name, parent_id, order, expanded: true }]);
    content.set(id, new Y.XmlFragment());
  }, 'local');
  return id;
}

export function renamePage(ydoc, id, name, scope) {
  const arr = pagesArray(ydoc, scope); if (!arr) return;
  ydoc.transact(() => {
    for (let i = 0; i < arr.length; i++) {
      const p = arr.get(i);
      if (p.id === id) { arr.delete(i, 1); arr.insert(i, [{ ...p, name }]); return; }
    }
  }, 'local');
}

export function setPageExpanded(ydoc, id, expanded, scope) {
  const arr = pagesArray(ydoc, scope); if (!arr) return;
  ydoc.transact(() => {
    for (let i = 0; i < arr.length; i++) {
      const p = arr.get(i);
      if (p.id === id) { arr.delete(i, 1); arr.insert(i, [{ ...p, expanded }]); return; }
    }
  }, 'local');
}

export function deletePage(ydoc, id, scope) {
  const arr = pagesArray(ydoc, scope);
  const content = pageContentMap(ydoc, scope);
  const bookmarks = bookmarksMap(ydoc, scope);
  const sheets = pageSheetsMap(ydoc, scope);
  const sContent = sheetContentMap(ydoc, scope);
  const comments = commentsMap(ydoc, scope);
  if (!arr || !content || !bookmarks) return;
  ydoc.transact(() => {
    const all = arr.toArray();
    const toRemove = new Set();
    const collect = (pid) => {
      toRemove.add(pid);
      all.forEach(p => { if (p.parent_id === pid) collect(p.id); });
    };
    collect(id);
    for (let i = arr.length - 1; i >= 0; i--) {
      if (toRemove.has(arr.get(i).id)) arr.delete(i, 1);
    }
    toRemove.forEach(pid => {
      content.delete(pid);
      const sheetList = sheets?.get(pid);
      if (sheetList && typeof sheetList.toArray === 'function') {
        for (const s of sheetList.toArray()) {
          if (s?.id) sContent?.delete(s.id);
        }
      }
      sheets?.delete(pid);
    });
    bookmarks.forEach((v, k) => { if (toRemove.has(v.pageId)) bookmarks.delete(k); });
    // Drop comment threads anchored to removed pages so they don't orphan.
    comments?.forEach((v, k) => { if (toRemove.has(v.pageId)) comments.delete(k); });
  }, 'local');
}

export function movePage(ydoc, id, newParentId, newIndex, scope) {
  const arr = pagesArray(ydoc, scope); if (!arr) return;
  ydoc.transact(() => {
    const all = arr.toArray();
    const moving = all.find(p => p.id === id);
    if (!moving) return;
    const isDescendantOf = (target, ancestor) => {
      if (target === ancestor) return true;
      const t = all.find(p => p.id === target);
      if (!t || t.parent_id == null) return false;
      return isDescendantOf(t.parent_id, ancestor);
    };
    if (newParentId && isDescendantOf(newParentId, id)) return;
    const siblings = all
      .filter(p => p.parent_id === newParentId && p.id !== id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    siblings.splice(Math.max(0, Math.min(newIndex, siblings.length)), 0, { ...moving, parent_id: newParentId });
    const renumbered = new Map();
    siblings.forEach((p, i) => renumbered.set(p.id, { ...p, order: i }));
    const changedIds = new Set([...renumbered.keys()]);
    for (let i = arr.length - 1; i >= 0; i--) {
      if (changedIds.has(arr.get(i).id)) arr.delete(i, 1);
    }
    renumbered.forEach(p => arr.push([p]));
  }, 'local');
}

// Comments ──────────────────────────────────────────────────────────────────
export function addCommentThread(ydoc, opts) {
  const { pageId, body, author, authorColor, scope } = opts;
  const id = 'cm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const map = commentsMap(ydoc, scope); if (!map) return id;
  ydoc.transact(() => {
    map.set(id, {
      pageId, ts: Date.now(),
      author: author || 'Someone',
      authorColor: authorColor || '#4f8df8',
      body: String(body || '').slice(0, 4000),
      replies: [], resolved: false,
    });
  }, 'local');
  return id;
}

export function addCommentReply(ydoc, id, opts) {
  const { body, author, authorColor, scope } = opts;
  const map = commentsMap(ydoc, scope);
  const cur = map?.get(id); if (!cur) return;
  const reply = {
    id: 'cr_' + Math.random().toString(36).slice(2, 8),
    ts: Date.now(),
    author: author || 'Someone',
    authorColor: authorColor || '#4f8df8',
    body: String(body || '').slice(0, 4000),
  };
  ydoc.transact(() => { map.set(id, { ...cur, replies: [...(cur.replies || []), reply] }); }, 'local');
}

export function resolveComment(ydoc, id, resolved = true, scope) {
  const map = commentsMap(ydoc, scope);
  const cur = map?.get(id); if (!cur) return;
  ydoc.transact(() => { map.set(id, { ...cur, resolved }); }, 'local');
}

export function deleteCommentThread(ydoc, id, scope) {
  const map = commentsMap(ydoc, scope); if (!map) return;
  ydoc.transact(() => { map.delete(id); }, 'local');
}

// Bookmarks ─────────────────────────────────────────────────────────────────
export function addBookmark(ydoc, opts) {
  const { name, pageId, anchor, relAnchor = null, scope } = opts;
  const id = 'bm_' + Math.random().toString(36).slice(2, 10);
  const map = bookmarksMap(ydoc, scope); if (!map) return id;
  // `anchor` is the legacy raw int position (kept as a fallback). `relAnchor`
  // is a durable Yjs relative position (base64) that survives edits — see
  // bookmarkRelPos.js. Resolution prefers relAnchor and falls back to anchor.
  ydoc.transact(() => { map.set(id, { name, pageId, anchor, relAnchor }); }, 'local');
  return id;
}

export function deleteBookmark(ydoc, id, scope) {
  const map = bookmarksMap(ydoc, scope); if (!map) return;
  ydoc.transact(() => { map.delete(id); }, 'local');
}

export function renameBookmark(ydoc, id, name, scope) {
  const map = bookmarksMap(ydoc, scope);
  const cur = map?.get(id); if (!cur) return;
  ydoc.transact(() => { map.set(id, { ...cur, name }); }, 'local');
}

// Walk a Y.XmlFragment / Y.XmlElement tree and pull out plain text. Used for
// doc previews on canvas thumbnails (we have no Tiptap editor mounted at
// preview time — just the raw Yjs structure).
export function pageFragmentToText(fragment, max = 240) {
  if (!fragment) return '';
  let out = '';
  const walk = (node) => {
    if (!node || out.length >= max) return;
    // Text leaf = has toDelta (Y.Text/Y.XmlText) but no toArray (which
    // XmlElement/XmlFragment have). DUCK-TYPED on purpose: the old
    // `constructor?.name === 'YXmlText'` check silently broke in any
    // bundled build — vite's dev pre-bundle renames the class to
    // `_YXmlText` and prod minification mangles it entirely — so canvas
    // doc previews rendered title-only with no body text. (Its fallback
    // clause compared `parentSub === undefined`, but yjs uses null for
    // array content, so it never matched either.)
    if (typeof node.toDelta === 'function' && typeof node.toArray !== 'function') {
      try { out += node.toString(); } catch (_) {}
      return;
    }
    if (typeof node.toArray === 'function') {
      const kids = node.toArray();
      for (const k of kids) {
        walk(k);
        if (out.length >= max) break;
      }
      const tag = node.nodeName;
      if (tag && /^(paragraph|heading|listItem|blockquote|codeBlock|hardBreak)$/i.test(tag)) {
        if (!out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
      }
    } else if (typeof node.forEach === 'function') {
      node.forEach(walk);
    }
  };
  try { walk(fragment); } catch (_) {}
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

export function readDocSummary(ydoc, max = 240, scope) {
  const pages = readPages(ydoc, scope).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const firstPage = pages.find(p => p.parent_id == null) || pages[0];
  let firstText = '';
  if (firstPage) {
    const frag = pageContentMap(ydoc, scope)?.get(firstPage.id);
    firstText = pageFragmentToText(frag, max);
  }
  return { pages, firstText, firstPageName: firstPage?.name || '' };
}

export function buildPageTree(pages) {
  const byParent = new Map();
  for (const p of pages) {
    const k = p.parent_id || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(p);
  }
  byParent.forEach(arr => arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
  const attach = (node) => ({ ...node, children: (byParent.get(node.id) || []).map(attach) });
  return (byParent.get(null) || []).map(attach);
}
