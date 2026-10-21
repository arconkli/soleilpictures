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
import { cloneYXmlNode } from './yhelpers.js';
import { fragmentText } from './docText.js';
import {
  mergePageEntries, holdsWholePage, pageStamp, pageOrder, byPageOrder, placeStrays,
} from './docPageEntries.js';
import {
  commentReplyKey, commentStateKey, parseCommentKey, isPlainEntry, isFiledReply, isFiledState,
} from './commentKeys.js';
import { convertFragmentDocMode } from '../components/docExtensions/screenplay/screenplayModeSwitch.js';

// Origin for doc STRUCTURAL ops (add/rename/delete page·sheet·bookmark·comment,
// mode). Deliberately NOT 'local' so the board-level Y.UndoManager (which
// tracks origin 'local' over the cards/doc maps) does NOT capture them — that
// caused a split-brain ⌘Z where undoing in the doc could revert an unrelated
// canvas card (and vice-versa). Still broadcast to peers (ySupabase only skips
// 'remote') and still persisted (yboard persists every non-snapshot origin).
// When called inside a canvas 'local' transaction (e.g. addCard's afterInsert
// running initCardDocStore), Yjs transact is reentrant so the OUTER 'local'
// origin wins and the doc-store init stays part of that one canvas undo step.
const DOC_ORIGIN = 'doc-struct';
export { DOC_ORIGIN };

// ── Doc STRUCTURAL undo ──────────────────────────────────────────────────────
// One Y.UndoManager per doc scope, tracking DOC_ORIGIN over that scope's own
// types. This is what makes page delete/move/rename, sheets, bookmarks,
// comment threads and scene-number/layout flips reversible (the Screenplay
// switch is NOT — see DOC_MODE_ORIGIN): deletePage cascades an entire
// subtree (pages + content + sheets + bookmarks + comments) in ONE DOC_ORIGIN
// transaction, so one undo() reverses the whole cascade atomically —
// including nested Y.XmlFragment contents.
//
// Deliberately separate from both the board UndoManager ('local' — the
// split-brain ⌘Z rationale above) and the text editor's y-undo (per-fragment,
// ySync origin): text undo and structure undo are different stacks by design.
// Reentrant DOC_ORIGIN transacts inside a canvas 'local' transaction (e.g.
// initCardDocStore in addCard's afterInsert) keep the OUTER origin, so card
// creation stays one canvas step and is never double-captured here.
//
// Cached per scope (WeakMap on scope.pages — a stable Y type) so the manager
// and its history survive closing and reopening the doc overlay; entries die
// with the board's Y.Doc. Per-card scopes are disjoint type sets, so two doc
// cards' managers can never capture each other's edits.
const docUndoManagers = new WeakMap();
export function getDocUndoManager(ydoc, scope) {
  const s = scope || (ydoc ? rootScope(ydoc) : null);
  if (!s || !s.pages) return null;
  let um = docUndoManagers.get(s.pages);
  if (!um) {
    const types = [s.pages, s.content, s.bookmarks, s.comments, s.pageSheets, s.sheetContent, s.meta].filter(Boolean);
    um = new Y.UndoManager(types, {
      trackedOrigins: new Set([DOC_ORIGIN]),
      captureTimeout: 500,
    });
    docUndoManagers.set(s.pages, um);
  }
  return um;
}

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
    meta: ydoc.getMap('docMeta'),                   // doc-level settings (e.g. mode)
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
    meta: cardYMap.get('docMeta'),
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
    if (!cardYMap.get('docMeta'))          cardYMap.set('docMeta', new Y.Map());
  }, DOC_ORIGIN);
  // Collapse any legacy stacked sheets into the single content fragment so the
  // continuous-reflow paginator (DocPagination) has one fragment per page.
  // Idempotent (gated by docMeta.contentModel) and a no-op for fresh cards.
  try { migrateSheetsToSingleFragment(ydoc, cardScope(cardYMap)); } catch (_) {}
}

// Deep-clone a Y.Xml node into a BRAND-NEW node so it can be inserted into a
// different fragment — Yjs types can't be re-parented. Lives in yhelpers now:
// the same rule governs copying a whole card (cardToYMap), and one
// implementation is better than two that can drift.
const cloneYXml = cloneYXmlNode;

// One-time, idempotent migration: collapse a page's stacked SHEETS into the
// single primary content fragment. Sheets are now a pure PRESENTATION concept —
// the DocPagination plugin paginates one continuous fragment, so a paragraph
// can flow (and split) across page boundaries. Appends each extra sheet's
// blocks, in order, to the end of the primary fragment, then drops the sheet
// maps. Gated by docMeta.contentModel='flow' so it runs once per doc.
//
// Collab notes: the primary fragment KEEPS its identity (bookmarks anchored in
// it still resolve); only bookmarks pinned to an extra sheet lose their exact
// spot (their sheetId is cleared so they fall back to the single fragment) —
// rare, since you'd have to bookmark text on page 2+. The single known edge is
// two clients migrating the SAME multi-sheet doc while BOTH are offline
// pre-migration (double-append) — vanishingly rare; most docs are single-sheet.
export function migrateSheetsToSingleFragment(ydoc, scope) {
  const meta = metaMap(ydoc, scope);
  if (!meta) return false;
  if (meta.get('contentModel') === 'flow') return false; // already migrated
  const content = pageContentMap(ydoc, scope);
  const sheets = pageSheetsMap(ydoc, scope);
  const sContent = sheetContentMap(ydoc, scope);
  if (!content) return false;
  let changed = false;
  ydoc.transact(() => {
    const pages = readPages(ydoc, scope);
    for (const p of pages) {
      const extra = sheets?.get(p.id);
      const extraIds = (extra && typeof extra.toArray === 'function')
        ? extra.toArray().map(s => s?.id).filter(Boolean) : [];
      if (extraIds.length) {
        const primary = content.get(p.id);
        if (primary && typeof primary.insert === 'function') {
          for (const sid of extraIds) {
            const frag = sContent?.get(sid);
            if (frag && typeof frag.toArray === 'function') {
              const clones = frag.toArray().map(cloneYXml).filter(Boolean);
              if (clones.length) primary.insert(primary.length, clones);
            }
            sContent?.delete(sid);
          }
          changed = true;
        }
      }
      if (sheets?.has(p.id)) sheets.delete(p.id);
    }
    // Drop sheetId pins → bookmarks resolve against the single page fragment.
    const bm = bookmarksMap(ydoc, scope);
    bm?.forEach((v, k) => {
      if (v && v.sheetId && v.sheetId !== v.pageId) bm.set(k, { ...v, sheetId: null });
    });
    meta.set('contentModel', 'flow');
  }, DOC_ORIGIN);
  return changed;
}

const S = (ydoc, scope) => scope || rootScope(ydoc);

export function pagesArray(ydoc, scope)        { return S(ydoc, scope).pages; }
export function pageContentMap(ydoc, scope)    { return S(ydoc, scope).content; }
export function bookmarksMap(ydoc, scope)      { return S(ydoc, scope).bookmarks; }
export function commentsMap(ydoc, scope)       { return S(ydoc, scope).comments; }
export function pageSheetsMap(ydoc, scope)     { return S(ydoc, scope).pageSheets; }
export function sheetContentMap(ydoc, scope)   { return S(ydoc, scope).sheetContent; }
export function metaMap(ydoc, scope)           { return S(ydoc, scope).meta; }

// Doc-level mode: 'doc' (default) | 'screenplay'. Stored in the per-scope
// docMeta map so it persists with the board snapshot + collaborates.
export function getDocMode(ydoc, scope) {
  const m = metaMap(ydoc, scope);
  return (m && m.get('mode')) || 'doc';
}
export function setDocMode(ydoc, scope, mode) {
  const m = metaMap(ydoc, scope);
  if (!m) return;
  ydoc.transact(() => { m.set('mode', mode === 'screenplay' ? 'screenplay' : 'doc'); }, DOC_ORIGIN);
}

// The person-facing mode switch (the Screenplay pill, enabling a title page):
// flips the mode AND converts every page's content, in ONE transaction. One
// writer — only the client that flipped converts, so peers' editors never race
// each other into duplicating the doc — and one update, so a peer never sees
// the new mode over unconverted content. setDocMode stays the raw setter for
// content that is already in the right shape (a dropped script's body).
//
// Deliberately NOT a doc-structure undo step, so it runs under its own origin
// that getDocUndoManager doesn't track. The conversion deletes every top-level
// block and inserts a clone; undoing that at the Yjs level deletes the clones
// — and with them every word typed into them since, by you or a peer — and
// restores the old blocks under the new mode, where nothing converts them.
// The pill itself is the lossless inverse. Still persisted, broadcast and
// counted as your own save (yboard treats this origin as local).
export const DOC_MODE_ORIGIN = 'doc-mode';
export function switchDocMode(ydoc, scope, mode) {
  const m = metaMap(ydoc, scope);
  if (!m) return;
  const next = mode === 'screenplay' ? 'screenplay' : 'doc';
  ydoc.transact(() => {
    convertAllFragments(ydoc, scope, next);
    m.set('mode', next);
  }, DOC_MODE_ORIGIN);
}

function convertAllFragments(ydoc, scope, mode) {
  let changed = false;
  for (const map of [pageContentMap(ydoc, scope), sheetContentMap(ydoc, scope)]) {
    if (!map || typeof map.forEach !== 'function') continue;
    map.forEach((frag) => { if (convertFragmentDocMode(frag, mode)) changed = true; });
  }
  return changed;
}

// Bring content that arrived in the other mode's shape into line with the
// current mode — a page restored by a structural undo, a peer's Enter that
// raced the flip, an old bundle mid-rollout. Editors used to convert on every
// mount; that is what duplicated docs, so DocSurface calls this from ONE
// client only (see its heal effect). Idempotent: a doc already in shape writes
// nothing at all.
export function healDocMode(ydoc, scope) {
  const m = metaMap(ydoc, scope);
  if (!m) return false;
  let changed = false;
  ydoc.transact(() => { changed = convertAllFragments(ydoc, scope, getDocMode(ydoc, scope)); }, DOC_MODE_ORIGIN);
  return changed;
}

// Screenplay scene-number visibility (the lock state itself lives on the scene
// blocks' sceneNumber attr). Defaults ON — a real script shows scene numbers at
// each heading; the "Scene #" toolbar pill can turn them Off (which persists).
export function getSceneNumbersShow(ydoc, scope) {
  const m = metaMap(ydoc, scope);
  const v = m && m.get('sceneNumbersShow');
  return v === undefined ? true : !!v;
}
export function setSceneNumbersShow(ydoc, scope, show) {
  const m = metaMap(ydoc, scope);
  if (!m) return;
  ydoc.transact(() => { m.set('sceneNumbersShow', !!show); }, DOC_ORIGIN);
}

// Prose page layout: pageless (one continuous sheet) vs paged (real 8.5×11
// pages with breaks). Collaborative — stored in docMeta like the mode, so every
// collaborator sees the same layout. Defaults to PAGELESS: most writing reads
// better as a continuous flow, and a doc with no stored preference (incl. all
// existing docs) opens pageless. The "Pages" toolbar pill opts a doc into real
// pages. Screenplay mode ignores this (it has its own page model).
export function getPageless(ydoc, scope) {
  const m = metaMap(ydoc, scope);
  const v = m && m.get('pageless');
  return v === undefined ? true : !!v;
}
export function setPageless(ydoc, scope, on) {
  const m = metaMap(ydoc, scope);
  if (!m) return;
  ydoc.transact(() => { m.set('pageless', !!on); }, DOC_ORIGIN);
}

// Screenplay title page. Stored as a nested Y.Map under docMeta so individual
// fields merge independently across collaborators (per-field last-write-wins)
// instead of one whole-object clobber. Rendered on-screen (ScreenplayTitlePage),
// in the print/PDF shell, and round-tripped through Fountain/FDX.
export const TITLE_PAGE_FIELDS = ['title', 'credit', 'authors', 'source', 'draftDate', 'contact', 'copyright', 'notes'];
const TITLE_PAGE_DEFAULTS = {
  enabled: false,
  title: '',
  credit: 'Written by',
  authors: '',
  source: '',
  draftDate: '',
  contact: '',
  copyright: '',
  notes: '',
};
export function getTitlePage(ydoc, scope) {
  const m = metaMap(ydoc, scope);
  const out = { ...TITLE_PAGE_DEFAULTS };
  const tp = m && m.get('titlePage');
  if (tp && typeof tp.get === 'function') {            // nested Y.Map (current)
    if (tp.get('enabled') !== undefined) out.enabled = !!tp.get('enabled');
    for (const k of TITLE_PAGE_FIELDS) { const v = tp.get(k); if (v !== undefined) out[k] = v; }
  } else if (tp && typeof tp === 'object') {           // plain-object (legacy/forward-compat)
    Object.assign(out, tp);
  }
  return out;
}
// patch is a partial of { enabled, ...TITLE_PAGE_FIELDS }.
export function setTitlePage(ydoc, scope, patch) {
  const m = metaMap(ydoc, scope);
  if (!m || !patch) return;
  ydoc.transact(() => {
    let tp = m.get('titlePage');
    if (!tp || typeof tp.get !== 'function') {
      const seed = (tp && typeof tp === 'object') ? tp : {};
      tp = new Y.Map();
      m.set('titlePage', tp);
      if (seed.enabled !== undefined) tp.set('enabled', !!seed.enabled);
      for (const k of TITLE_PAGE_FIELDS) { if (seed[k] !== undefined) tp.set(k, seed[k]); }
    }
    if (patch.enabled !== undefined) tp.set('enabled', !!patch.enabled);
    for (const k of TITLE_PAGE_FIELDS) { if (patch[k] !== undefined) tp.set(k, patch[k]); }
  }, DOC_ORIGIN);
}

// An entry may be a Y.Map rather than a plain object.
const entryOf = (v) => ((v && typeof v.toJSON === 'function') ? v.toJSON() : v);

// The page list as people see it: each page once, however many entries edits
// that met have left it, and a page whose place is gone where placeStrays puts
// it (lib/docPageEntries.js). Every reader of docPages goes through this.
export function readPages(ydoc, scope) {
  const arr = pagesArray(ydoc, scope);
  if (!arr) return [];
  const content = pageContentMap(ydoc, scope);
  return placeStrays(mergePageEntries(arr.toArray().map(entryOf)),
    content ? (id) => content.has(id) : () => true);
}

export function readBookmarks(ydoc, scope) {
  const out = [];
  const map = bookmarksMap(ydoc, scope);
  if (!map) return out;
  map.forEach((v, k) => { out.push({ id: k, ...v }); });
  return out;
}

// Every thread as people should see it (see readThread), newest first.
export function readComments(ydoc, scope) {
  const map = commentsMap(ydoc, scope);
  if (!map) return [];
  return gatherThreads(map).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// One thread as people should see it: as it was started, with its replies —
// the ones written into it by builds from before and the ones filed beside
// it, each once, oldest first — and whether it is resolved. Null when there
// is no such thread (or what is there is not one).
export function readThread(ydoc, threadId, scope) {
  const map = commentsMap(ydoc, scope);
  if (!map || !threadId) return null;
  return gatherThreads(map, threadId)[0] || null;
}

// One pass over the map: the threads (or the one asked for), each with what
// is filed under it. An entry whose thread is gone is left alone, unread: an
// undo of that delete brings the thread back and the entry with it.
function gatherThreads(map, only = null) {
  const heads = new Map();
  const replies = new Map();
  const states = new Map();
  map.forEach((v, k) => {
    const p = parseCommentKey(k);
    if (!p || (only && p.threadId !== only)) return;
    if (p.kind === 'thread') { if (isPlainEntry(v)) heads.set(k, v); }
    else if (p.kind === 'reply') {
      if (isFiledReply(k, v)) {
        if (!replies.has(p.threadId)) replies.set(p.threadId, []);
        replies.get(p.threadId).push(v);
      }
    } else if (isFiledState(k, v)) states.set(p.threadId, v);
  });
  const out = [];
  heads.forEach((head, id) => out.push(composeThread(id, head, replies.get(id) || [], states.get(id) || null)));
  return out;
}

function composeThread(id, head, filed, state) {
  const { replies: written, resolved: headResolved, ...rest } = head;
  const seen = new Set();
  const replies = [];
  for (const r of [...(Array.isArray(written) ? written : []), ...filed]) {
    if (!isPlainEntry(r)) continue;
    if (r.id) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
    }
    const { kind, threadId, ...reply } = r;
    replies.push(reply);
  }
  const order = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
  replies.sort((a, b) => (a.ts || 0) - (b.ts || 0) || order(String(a.id || ''), String(b.id || '')));
  // The state entry speaks for the thread unless a build that writes resolves
  // into the thread changed it after that entry was written (it records the
  // thread's own flag as it saw it). A tab on such a build that toggles twice
  // in a row ends where the entry saw it and loses the second toggle; those
  // tabs are made to reload before entries are written (COMMENT_LOG_WRITES).
  const own = !!headResolved;
  const resolved = state && own === !!state.headerSeen ? state.resolved : own;
  return { id, ...rest, replies, resolved };
}

// Extract plain text of a single page's Y.XmlFragment. Used by the
// doc_page_index sync to project page text into Postgres for the universal
// "Appears in" hover lookup and for search inside documents. Shares
// docText.fragmentText with the board-save indexer, so both write the same
// text — with block boundaries as word boundaries, which the old DOM
// textContent path glued together ("Exterior.Night.").
export function readPageText(ydoc, pageId, scope) {
  const map = pageContentMap(ydoc, scope);
  if (!map) return '';
  try { return fragmentText(map.get(pageId)); } catch (_) { return ''; }
}

// The text of each block on a page, in order, or null when the doc has no such
// page: what lib/docResets.js compares across a reload, to tell whether the
// reload took anything off the page.
export function readPageBlocks(ydoc, pageId, scope) {
  if (!readPages(ydoc, scope).some((p) => p.id === pageId)) return null;
  const frag = pageContentMap(ydoc, scope)?.get(pageId);
  try { return frag && typeof frag.toArray === 'function' ? frag.toArray().map(fragmentText) : []; } catch (_) { return []; }
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
// Lazy creation is only for a LIVE page (or sheet) that predates its content
// entry. An editor still rendering a page that was just deleted — or a sheet
// id that hasn't caught up with a page switch — used to recreate the deleted
// fragment as a DOC_ORIGIN write: an orphan in the doc, and a fresh undo step
// on top of the delete, so the delete toast's Undo could only report that
// "the board changed since".
// Live means listed: what a delete left behind is not, so opening it can't
// bring it back.
function pageIsLive(ydoc, pageId, scope) {
  return readPages(ydoc, scope).some((p) => p.id === pageId);
}

export function getOrCreatePageContent(ydoc, pageId, scope) {
  const map = pageContentMap(ydoc, scope);
  if (!map) return null;
  let frag = map.get(pageId);
  if (!frag) {
    if (!pageIsLive(ydoc, pageId, scope)) return null;
    frag = new Y.XmlFragment();
    ydoc.transact(() => { map.set(pageId, frag); }, DOC_ORIGIN);
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
    const listed = pageSheetsMap(ydoc, scope)?.get(pageId);
    if (!listed?.toArray?.().some(s => s?.id === sheetId)) return null;
    frag = new Y.XmlFragment();
    ydoc.transact(() => { map.set(sheetId, frag); }, DOC_ORIGIN);
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
  }, DOC_ORIGIN);
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
  }, DOC_ORIGIN);
}

// (detachPageSheet / reattachPageSheet / purgeSheetContent are gone: the
// sheet-delete Undo toast now reverses deletePageSheet via the DOC_ORIGIN
// UndoManager, so nothing needs to park content in limbo behind a timer.)

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
    const siblings = readPages(ydoc, scope).filter(p => (p.parent_id ?? null) === parent_id);
    const order = siblings.length > 0 ? Math.max(...siblings.map(pageOrder)) + 1 : 0;
    // `expanded` is only where the page starts out folded or not, for tabs
    // from before folding stayed on the device (hooks/useDocTreeExpansion).
    arr.push([{ id, name, parent_id, order, expanded: true }]);
    content.set(id, new Y.XmlFragment());
  }, DOC_ORIGIN);
  return id;
}

// Every edit to a page goes through here: it takes out every entry the page
// has and puts back one, the page as it shows with `patch(page)` over it,
// where its first entry was. So an edit also clears what earlier edits that
// met left behind, and the stamp an edit bumps (nameV for the name, posV for
// where it sits) is one past the highest the page has.
function rewritePage(arr, id, patch) {
  const at = [];
  const copies = [];
  arr.toArray().forEach((v, i) => {
    const e = entryOf(v);
    if (e?.id === id) { at.push(i); copies.push(e); }
  });
  if (!at.length) return false;
  const [page] = mergePageEntries(copies);
  for (let i = at.length - 1; i >= 0; i--) arr.delete(at[i], 1);
  arr.insert(at[0], [{ ...page, ...patch(page) }]);
  return true;
}

export function renamePage(ydoc, id, name, scope) {
  const arr = pagesArray(ydoc, scope); if (!arr) return;
  if (readPages(ydoc, scope).find(p => p.id === id)?.name === name) return;
  ydoc.transact(() => {
    rewritePage(arr, id, (page) => ({ name, nameV: pageStamp(page.nameV) + 1 }));
  }, DOC_ORIGIN);
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
    // The page and what shows under it, then every entry any of them has.
    const kids = new Map();
    for (const p of readPages(ydoc, scope)) {
      const k = p.parent_id ?? null;
      if (!kids.has(k)) kids.set(k, []);
      kids.get(k).push(p.id);
    }
    const toRemove = new Set();
    for (const stack = [id]; stack.length;) {
      const pid = stack.pop();
      if (toRemove.has(pid)) continue;
      toRemove.add(pid);
      stack.push(...(kids.get(pid) || []));
    }
    const all = arr.toArray().map(entryOf);
    for (let i = all.length - 1; i >= 0; i--) {
      if (toRemove.has(all[i]?.id)) arr.delete(i, 1);
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
    // Drop comment threads anchored to removed pages, and what is filed under
    // them, so they don't orphan.
    if (comments) {
      const threads = new Set();
      comments.forEach((v, k) => { if (parseCommentKey(k)?.kind === 'thread' && toRemove.has(v?.pageId)) threads.add(k); });
      for (const k of [...comments.keys()]) if (threads.has(parseCommentKey(k)?.threadId)) comments.delete(k);
    }
  }, DOC_ORIGIN);
}

// Closer than this, two neighbours leave no room between them, and the row is
// numbered again.
const ORDER_ROOM = 1e-9;

// Moves a page to `newIndex` among `newParentId`'s pages (as the list shows
// them, without the page itself). Only the moved page is written: it takes an
// order halfway between its new neighbours. Writing every sibling, as this did
// before, turned two moves at once into copies of whole branches.
export function movePage(ydoc, id, newParentId, newIndex, scope) {
  const arr = pagesArray(ydoc, scope); if (!arr) return;
  const parent = newParentId ?? null;
  ydoc.transact(() => {
    const pages = readPages(ydoc, scope);
    const moving = pages.find(p => p.id === id);
    if (!moving) return;
    if (parent != null) {
      // Into a page that shows, never into itself or a page under it.
      if (!pages.some(p => p.id === parent)) return;
      const up = new Map(pages.map(p => [p.id, p.parent_id ?? null]));
      for (let at = parent, hops = 0; at != null && hops <= pages.length; at = up.get(at) ?? null, hops++) {
        if (at === id) return;
      }
    }
    const siblings = pages
      .filter(p => (p.parent_id ?? null) === parent && p.id !== id)
      .sort(byPageOrder);
    const at = Math.max(0, Math.min(newIndex, siblings.length));
    const lo = at > 0 ? pageOrder(siblings[at - 1]) : null;
    const hi = at < siblings.length ? pageOrder(siblings[at]) : null;
    const here = pageOrder(moving);
    if ((moving.parent_id ?? null) === parent && (lo == null || lo < here) && (hi == null || here < hi)) return;
    const place = (order) => (page) => ({ parent_id: parent, order, posV: pageStamp(page.posV) + 1 });
    if (lo != null && hi != null && !(hi - lo > ORDER_ROOM)) {
      const row = [...siblings];
      row.splice(at, 0, moving);
      row.forEach((p, i) => { if (p.id === id || pageOrder(p) !== i) rewritePage(arr, p.id, place(i)); });
      return;
    }
    const order = lo == null && hi == null ? 0 : lo == null ? hi - 1 : hi == null ? lo + 1 : (lo + hi) / 2;
    rewritePage(arr, id, place(order));
  }, DOC_ORIGIN);
}

// Clearing the extra entries a page is left with when two edits to it meet,
// or when tabs from before readPages merged them rewrote it. Out of both undo
// stacks (neither tracks this origin): it changes nothing anyone sees.
export const DOC_HEAL_ORIGIN = 'doc-heal';

// Deletes only, and only where a page's LAST entry already holds the whole
// page as it shows: two devices healing at once, even each with entries the
// other hasn't seen yet, can never between them delete every entry a page
// has, because neither ever deletes the last one it sees. Where the last entry
// doesn't hold the whole page, the entries stay until the page's next edit
// (rewritePage) folds them into one. Returns how many entries went.
export function healPages(ydoc, scope) {
  const arr = pagesArray(ydoc, scope); if (!arr) return 0;
  const all = arr.toArray().map(entryOf);
  const at = new Map();
  all.forEach((e, i) => {
    if (!e || typeof e !== 'object' || !e.id) return;
    if (!at.has(e.id)) at.set(e.id, []);
    at.get(e.id).push(i);
  });
  const drop = [];
  for (const idx of at.values()) {
    if (idx.length < 2) continue;
    const [page] = mergePageEntries(idx.map(i => all[i]));
    if (holdsWholePage(all[idx[idx.length - 1]], page)) drop.push(...idx.slice(0, -1));
  }
  if (!drop.length) return 0;
  drop.sort((a, b) => b - a);
  ydoc.transact(() => { for (const i of drop) arr.delete(i, 1); }, DOC_HEAL_ORIGIN);
  return drop.length;
}

// Comments ──────────────────────────────────────────────────────────────────
// `authorId` is the real auth.users id. `author` (a display string) is kept as
// the render fallback for threads written before identity was stored and for
// peers whose profile hasn't resolved yet — never drop it. `mentions` is the
// set of user ids @-named in the body; notification is the caller's job (see
// lib/commentMentions.js), this only records who was named.
//
// How they are filed is lib/commentKeys.js: a reply and a resolve are each an
// entry beside the thread, so two people writing at once both keep theirs.
// Every build since these readers reads both that and the old shape (a reply
// or a resolve rewriting the whole thread), but builds from before read only
// the old one, and preview and production tabs share every room. So filing
// beside the thread ships in two promotes: these readers first, writing the
// old way; then this flag on, with the Worker's MIN_CLIENT_BUILD raised past
// the readers' production build so no tab without them is still open
// (docState.concurrency.test holds the two together).
export const COMMENT_LOG_WRITES = false;

export function addCommentThread(ydoc, opts) {
  const { pageId, body, author, authorId, authorColor, mentions, scope } = opts;
  const id = 'cm_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
  const map = commentsMap(ydoc, scope); if (!map) return id;
  ydoc.transact(() => {
    map.set(id, {
      pageId, ts: Date.now(),
      author: author || 'Someone',
      authorId: authorId || null,
      authorColor: authorColor || '#4f8df8',
      body: String(body || '').slice(0, 4000),
      mentions: Array.isArray(mentions) ? mentions : [],
      replies: [], resolved: false,
    });
  }, DOC_ORIGIN);
  return id;
}

// `log` is how it is written: filed beside the thread, or into it the old way
// (see COMMENT_LOG_WRITES). Returns the reply's id.
export function addCommentReply(ydoc, id, opts) {
  const { body, author, authorId, authorColor, mentions, scope, log = COMMENT_LOG_WRITES } = opts;
  const map = commentsMap(ydoc, scope);
  const cur = map?.get(id); if (!isPlainEntry(cur)) return null;
  const reply = {
    id: 'cr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3),
    ts: Date.now(),
    author: author || 'Someone',
    authorId: authorId || null,
    authorColor: authorColor || '#4f8df8',
    body: String(body || '').slice(0, 4000),
    mentions: Array.isArray(mentions) ? mentions : [],
  };
  ydoc.transact(() => {
    if (log) map.set(commentReplyKey(id, reply.id), { kind: 'reply', threadId: id, ...reply });
    else map.set(id, { ...cur, replies: [...(cur.replies || []), reply] });
  }, DOC_ORIGIN);
  return reply.id;
}

// `by` is who resolved or reopened it (their auth.users id).
export function resolveComment(ydoc, id, resolved = true, scope, { by = null, log = COMMENT_LOG_WRITES } = {}) {
  const map = commentsMap(ydoc, scope);
  const cur = map?.get(id); if (!isPlainEntry(cur)) return;
  const key = commentStateKey(id);
  const file = (headerSeen) => map.set(key, { kind: 'state', threadId: id, resolved: !!resolved, by, ts: Date.now(), headerSeen });
  ydoc.transact(() => {
    if (log) { file(!!cur.resolved); return; }
    map.set(id, { ...cur, resolved });
    // A newer build may have filed a state for it already, which would
    // outrank the thread's own flag: say the same there.
    if (map.has(key)) file(!!resolved);
  }, DOC_ORIGIN);
}

// The thread and everything filed under it, in one step (one undo).
export function deleteCommentThread(ydoc, id, scope) {
  const map = commentsMap(ydoc, scope); if (!map || !id) return;
  ydoc.transact(() => { for (const k of threadKeys(map, id)) map.delete(k); }, DOC_ORIGIN);
}

function threadKeys(map, id) {
  return [...map.keys()].filter((k) => parseCommentKey(k)?.threadId === id);
}

// For a scope with no structural undo (a note's comments): what a delete's
// Undo puts back. restoreThread puts back every entry that isn't there.
export function snapshotThread(ydoc, id, scope) {
  const map = commentsMap(ydoc, scope);
  if (!map || !id) return null;
  return { id, entries: threadKeys(map, id).map((k) => [k, map.get(k)]) };
}

export function restoreThread(ydoc, snapshot, scope) {
  const map = commentsMap(ydoc, scope);
  if (!map || !snapshot?.entries?.length) return;
  ydoc.transact(() => {
    for (const [k, v] of snapshot.entries) if (!map.has(k)) map.set(k, v);
  }, DOC_ORIGIN);
}

// Bookmarks ─────────────────────────────────────────────────────────────────
export function addBookmark(ydoc, opts) {
  const { name, pageId, sheetId = null, anchor, relAnchor = null, scope } = opts;
  const id = 'bm_' + Math.random().toString(36).slice(2, 10);
  const map = bookmarksMap(ydoc, scope); if (!map) return id;
  // `anchor` is the legacy raw int position (kept as a fallback). `relAnchor`
  // is a durable Yjs relative position (base64) that survives edits — see
  // bookmarkRelPos.js. Resolution prefers relAnchor and falls back to anchor.
  // sheetId pins the bookmark to the exact sheet it was made in — the relAnchor
  // resolves against ONE Y.XmlFragment, so a multi-sheet page must resolve it
  // against that sheet's editor (not whichever is focused).
  ydoc.transact(() => { map.set(id, { name, pageId, sheetId, anchor, relAnchor }); }, DOC_ORIGIN);
  return id;
}

export function deleteBookmark(ydoc, id, scope) {
  const map = bookmarksMap(ydoc, scope); if (!map) return;
  ydoc.transact(() => { map.delete(id); }, DOC_ORIGIN);
}

export function renameBookmark(ydoc, id, name, scope) {
  const map = bookmarksMap(ydoc, scope);
  const cur = map?.get(id); if (!cur) return;
  ydoc.transact(() => { map.set(id, { ...cur, name }); }, DOC_ORIGIN);
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
      // NOT toString(): Y.XmlText serializes formatting marks as XML-ish tags
      // (<textStyle color="…">…</textStyle>, <bold>…</bold>), which leaked
      // raw markup into card previews for any styled text. The delta stream's
      // string inserts are the plain text.
      try {
        for (const d of node.toDelta()) {
          if (typeof d.insert === 'string') out += d.insert;
          if (out.length >= max) break;
        }
      } catch (_) {}
      return;
    }
    if (typeof node.toArray === 'function') {
      const kids = node.toArray();
      for (const k of kids) {
        walk(k);
        if (out.length >= max) break;
      }
      const tag = node.nodeName;
      if (tag && /^(paragraph|heading|listItem|blockquote|codeBlock|hardBreak|screenplayBlock)$/i.test(tag)) {
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
  const pages = readPages(ydoc, scope).sort(byPageOrder);
  const firstPage = pages.find(p => p.parent_id == null) || pages[0];
  let firstText = '';
  if (firstPage) {
    const frag = pageContentMap(ydoc, scope)?.get(firstPage.id);
    firstText = pageFragmentToText(frag, max);
  }
  return { pages, firstText, firstPageName: firstPage?.name || '' };
}

// ── The first page follows the card's title ─────────────────────────────────
// …while it still "tracks" it: its name is the previous title or a seeded
// default. The moment the person names the page themselves it stops, so a card
// rename never clobbers an intentional page name. One rule for the open doc
// (DocSurface) and the closed card's title field (DocCard): a script dropped and
// renamed before its first open kept the file's title on its page for good.
const TRACKING_DEFAULT_NAMES = new Set(['', 'Untitled', 'Untitled doc']);
export function followTitle(ydoc, scope, prevTitle, nextTitle) {
  if (!nextTitle || nextTitle === prevTitle) return false;
  const primary = readPages(ydoc, scope)
    .filter((p) => p.parent_id == null)
    .sort(byPageOrder)[0];
  if (!primary) return false;
  const tracking = primary.name === prevTitle || TRACKING_DEFAULT_NAMES.has(primary.name || '');
  if (tracking) renamePage(ydoc, primary.id, nextTitle, scope);
  return tracking;
}

// ── A dropped script's body, written when its card is made ──────────────────
// A screenplay dropped or pasted onto a board (lib/scriptImport.js) has its
// first page and its whole body written inside the card's own creation
// transaction, with no editor involved — so the script is in the shared doc
// from the first moment: on every device, for view-only readers and the public
// page, in previews and exports, and one canvas undo takes the whole import
// back.
//
// It used to wait for the card's first editor. A new doc card doesn't open by
// itself, and the list view has no editor at all, so a body waiting in page
// memory came back empty after a reload; waiting in docMeta instead, two
// devices opening the new card together each imported the whole script.
//
// `docJSON` is ProseMirror JSON (screenplayIO.blocksToDocJSON): top-level
// block nodes, each carrying plain unmarked text. They are written as the very
// tree y-prosemirror's binding writes for them — one Y.XmlElement per node,
// named by node type, every non-null attribute set, the node's text as one
// Y.XmlText. scriptImport.test.mjs reads the result back through y-prosemirror
// against the doc schema: a block that would not validate there would be
// DELETED by the editor's binding on first render, so it fails a test instead.
export function writeScriptBody(ydoc, scope, docJSON, { name = 'Untitled' } = {}) {
  const nodes = (docJSON && Array.isArray(docJSON.content)) ? docJSON.content.map(scriptNodeToYXml).filter(Boolean) : [];
  if (!nodes.length) return null;
  let pageId = null;
  ydoc.transact(() => {
    pageId = addPage(ydoc, { name, scope });
    const frag = pageContentMap(ydoc, scope)?.get(pageId);
    if (frag) frag.insert(0, nodes);
  }, DOC_ORIGIN);
  return pageId;
}

function scriptNodeToYXml(node) {
  if (!node || typeof node.type !== 'string' || node.type === 'text') return null;
  const el = new Y.XmlElement(node.type);
  for (const [k, v] of Object.entries(node.attrs || {})) {
    if (v !== null && v !== undefined) el.setAttribute(k, v);
  }
  const text = (node.content || [])
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  if (text) {
    const t = new Y.XmlText();
    t.insert(0, text);
    el.insert(0, [t]);
  }
  return el;
}

export function buildPageTree(pages) {
  const byParent = new Map();
  for (const p of pages) {
    const k = p.parent_id || null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(p);
  }
  byParent.forEach(arr => arr.sort(byPageOrder));
  const attach = (node) => ({ ...node, children: (byParent.get(node.id) || []).map(attach) });
  return (byParent.get(null) || []).map(attach);
}
