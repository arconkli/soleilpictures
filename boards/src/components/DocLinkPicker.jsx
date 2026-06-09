// Modal for setting / editing a link on the active selection. Two modes:
//
//   URL       — plain http(s) / mailto link
//   Bookmark  — pick a doc + bookmark; encoded as `soleil://bookmark/{boardId}/{bookmarkId}`
//               so the host can intercept clicks and jump there.
//
// Bookmark mode lazily fetches each doc's snapshot via loadBoardSnapshot +
// readBookmarks (cached in module memory for the modal's lifetime).

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { loadBoardSnapshot } from '../lib/boardsApi.js';
import { b64ToBytes } from '../lib/yhelpers.js';
import { readBookmarks, readPages } from '../lib/docState.js';
import { Spinner } from './Spinner.jsx';

const cache = new Map(); // boardId -> { pages, bookmarks } | null

async function loadDocBookmarks(boardId) {
  if (cache.has(boardId)) return cache.get(boardId);
  try {
    const b64 = await loadBoardSnapshot(boardId);
    if (!b64) { cache.set(boardId, { pages: [], bookmarks: [] }); return cache.get(boardId); }
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, b64ToBytes(b64));
    const data = { pages: readPages(ydoc), bookmarks: readBookmarks(ydoc) };
    ydoc.destroy();
    cache.set(boardId, data);
    return data;
  } catch (e) {
    console.warn('loadDocBookmarks failed', e);
    cache.set(boardId, { pages: [], bookmarks: [] });
    return cache.get(boardId);
  }
}

export function DocLinkPicker({ initialUrl = '', boards = {}, currentBoardId, onPick, onRemove, onClose }) {
  const [mode, setMode] = useState(() => initialUrl.startsWith('soleil://') ? 'bookmark' : 'url');
  const [url, setUrl] = useState(initialUrl.startsWith('soleil://') ? '' : initialUrl);
  const [docId, setDocId] = useState(null);
  const [docFilter, setDocFilter] = useState('');
  const [docData, setDocData] = useState({ pages: [], bookmarks: [] });
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Eagerly load bookmarks for the picked doc. docLoading drives a spinner
  // so the empty column reads "loading", not "no bookmarks".
  const [docLoading, setDocLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!docId) { setDocData({ pages: [], bookmarks: [] }); return; }
    setDocLoading(true);
    loadDocBookmarks(docId).then((d) => {
      if (cancelled) return;
      setDocData(d);
      setDocLoading(false);
    });
    return () => { cancelled = true; };
  }, [docId]);

  const docList = useMemo(() => {
    const arr = Object.values(boards || {})
      .filter(b => b && b.id && (b.view === 'doc'))
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    if (!docFilter.trim()) return arr.slice(0, 50);
    const f = docFilter.toLowerCase();
    return arr.filter(b => b.name.toLowerCase().includes(f)).slice(0, 50);
  }, [boards, docFilter]);

  const pageById = (() => { const m = {}; docData.pages.forEach(p => { m[p.id] = p; }); return m; })();

  const submitUrl = () => {
    const u = url.trim();
    if (!u) onRemove?.();
    else onPick?.(u);
    onClose();
  };
  const pickBookmark = (b) => {
    onPick?.(`soleil://bookmark/${docId}/${b.id}`);
    onClose();
  };

  return (
    <div className="doc-tplbg" onClick={onClose}>
      <div className="doc-link-picker" ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="doc-tpl-head">
          <div>
            <div className="doc-tpl-kicker">Link</div>
            <div className="doc-tpl-title">{initialUrl ? 'Edit link' : 'Add a link'}</div>
          </div>
          <button className="doc-tpl-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {/* Bookmark tab hidden until cross-doc-card bookmark linking
            ships — the original implementation filtered the workspace
            board list to view='doc' which always returns empty now
            that doc boards are gone. URL linking still works fully. */}
        <div className="doc-link-tabs" style={{ display: 'none' }}>
          <button className={`doc-link-tab ${mode === 'url' ? 'is-active' : ''}`}
                  onClick={() => setMode('url')}>URL</button>
          <button className={`doc-link-tab ${mode === 'bookmark' ? 'is-active' : ''}`}
                  onClick={() => setMode('bookmark')}>Bookmark</button>
        </div>
        {mode === 'url' && (
          <div className="doc-link-pane">
            <input autoFocus
                   className="doc-embed-search"
                   style={{ margin: '12px 20px' }}
                   placeholder="https://example.com"
                   value={url}
                   onChange={(e) => setUrl(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitUrl(); } }} />
            <div className="doc-link-actions">
              {initialUrl && <button className="doc-link-btn-secondary" onClick={() => { onRemove?.(); onClose(); }}>Remove link</button>}
              <span style={{ flex: 1 }} />
              <button className="doc-link-btn-primary" onClick={submitUrl}>Save</button>
            </div>
          </div>
        )}
        {mode === 'bookmark' && (
          <div className="doc-link-pane">
            <div className="doc-link-cols">
              <div className="doc-link-col">
                <div className="doc-link-col-head">Doc</div>
                <input className="doc-link-search"
                       placeholder="Search docs…"
                       value={docFilter}
                       onChange={(e) => setDocFilter(e.target.value)} />
                <div className="doc-link-list">
                  {docList.length === 0 && <div className="doc-link-empty">No docs in this workspace yet.</div>}
                  {docList.map(d => (
                    <button key={d.id}
                            className={`doc-link-row ${docId === d.id ? 'is-active' : ''}`}
                            onClick={() => setDocId(d.id)}>
                      {d.name}{d.id === currentBoardId && <span className="doc-link-row-tag">CURRENT</span>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="doc-link-col">
                <div className="doc-link-col-head">Bookmark</div>
                <div className="doc-link-list">
                  {!docId && <div className="doc-link-empty">Pick a doc on the left.</div>}
                  {docId && docLoading && (
                    <div className="doc-link-empty"><Spinner size={14} label="Loading bookmarks" /></div>
                  )}
                  {docId && !docLoading && docData.bookmarks.length === 0 && (
                    <div className="doc-link-empty">No bookmarks in this doc.</div>
                  )}
                  {docId && !docLoading && docData.bookmarks.map(b => (
                    <button key={b.id} className="doc-link-row" onClick={() => pickBookmark(b)}>
                      <span className="doc-link-row-star">★</span>
                      <span className="doc-link-row-name">{b.name || 'Bookmark'}</span>
                      <span className="doc-link-row-page">{pageById[b.pageId]?.name || ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {initialUrl && (
              <div className="doc-link-actions">
                <button className="doc-link-btn-secondary" onClick={() => { onRemove?.(); onClose(); }}>Remove link</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
