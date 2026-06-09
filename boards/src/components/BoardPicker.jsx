import React, { useState, useEffect, useRef } from 'react';
import { prefetchBoard } from '../lib/prefetchKinds.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';

// Folder-style board browser: one column at a time, breadcrumb to jump back,
// search to flatten when needed. Pick any board to link.
//
// Hierarchy comes from postgres `parent_board_id`, not Y.Doc card positions.
// `rootId` is the workspace's root board id (the one with parent_board_id = null).
export function BoardPicker({ open, onPick, onClose, excludeIds = [], boards, rootId }) {
  const [q, setQ] = useState('');
  const [path, setPath] = useState([rootId]);

  useEffect(() => {
    if (open) { setPath([rootId]); setQ(''); }
  }, [open, rootId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Intent signal: fire once per open when the user actually types a query
  // (debounced — "ran a search", not per keystroke). has_results from a live count.
  const searchedRef = useRef(false);
  useEffect(() => { if (open) searchedRef.current = false; }, [open]);
  useEffect(() => {
    if (!open || !q.trim() || searchedRef.current) return;
    const t = setTimeout(() => {
      searchedRef.current = true;
      const needle = q.toLowerCase();
      const hits = Object.values(boards || {}).filter(
        (b) => b.id !== rootId && !excludeIds.includes(b.id) && b.name?.toLowerCase().includes(needle)
      ).length;
      logEvent(EV.SEARCH_RUN, { has_results: hits > 0 });
    }, 600);
    return () => clearTimeout(t);
  }, [open, q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const currentId = path[path.length - 1];
  const current = boards[currentId];

  const childBoards = Object.values(boards)
    .filter(b => b.parent_board_id === currentId && !excludeIds.includes(b.id));

  const allBoards = Object.values(boards).filter(b => b.id !== rootId && !excludeIds.includes(b.id));
  const searchHits = q
    ? allBoards.filter(b => b.name.toLowerCase().includes(q.toLowerCase()))
    : null;

  const breadcrumb = path.map(id => boards[id]).filter(Boolean);
  const canPickCurrent = currentId !== rootId && !excludeIds.includes(currentId);

  // Search flattens the hierarchy — show each hit's parent chain so two
  // boards with the same name are distinguishable.
  const parentPathLabel = (b) => {
    const names = [];
    let cur = boards?.[b.parent_board_id];
    let guard = 0;
    while (cur && cur.id !== rootId && guard++ < 8) {
      names.unshift(cur.name || 'Untitled');
      cur = boards[cur.parent_board_id];
    }
    return names.join(' › ');
  };

  const enterBoard = (id) => setPath(p => [...p, id]);
  const goTo = (idx) => setPath(p => p.slice(0, idx + 1));
  const goBack = () => setPath(p => p.length > 1 ? p.slice(0, -1) : p);

  const rowsToShow = searchHits || childBoards;

  return (
    <div className="picker-bg" onClick={onClose}>
      <div className="picker picker-folder" onClick={(e) => e.stopPropagation()}>
        <div className="picker-hd">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
            <path d="M8.5 8.5 L11.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <input
            autoFocus
            placeholder={searchHits ? 'Search all boards…' : `Search in ${current?.name || 'tree'}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="picker-esc">esc</span>
        </div>

        {!searchHits && (
          <div className="picker-crumbs">
            <button
              className="picker-back"
              onClick={goBack}
              disabled={path.length <= 1}
              aria-label="Back"
            >‹</button>
            <div className="picker-crumb-trail">
              {breadcrumb.map((b, i) => (
                <React.Fragment key={b.id}>
                  {i > 0 && <span className="picker-crumb-sep">/</span>}
                  <button
                    className={`picker-crumb ${i === breadcrumb.length - 1 ? 'is-current' : ''}`}
                    onClick={() => goTo(i)}
                  >
                    {b.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        <div className="picker-list">
          {rowsToShow.length === 0 && (
            <div className="picker-empty">
              {searchHits ? 'No boards match.' : 'This board is empty.'}
            </div>
          )}
          {rowsToShow.map(b => {
            const subChildCount = Object.values(boards).filter(x => x.parent_board_id === b.id).length;
            const hasChildren = subChildCount > 0;
            const isList = b.view === 'list';
            return (
              <div
                key={b.id}
                className="picker-row"
                onMouseEnter={() => prefetchBoard(b.id)}
                onClick={() => { onPick(b); onClose(); }}
              >
                <div className="picker-row-icon">
                  <span className={`picker-dot ${isList ? 'list' : 'canvas'}`} />
                </div>
                <div className="picker-row-meta">
                  <div className="picker-row-name">{b.name}</div>
                  <div className="picker-row-sub">
                    {searchHits
                      ? (parentPathLabel(b) || 'Top level')
                      : (isList
                        ? `List · ${subChildCount} ${subChildCount === 1 ? 'board' : 'boards'}`
                        : (b.meta || 'Canvas board'))}
                  </div>
                </div>
                {hasChildren && !searchHits && (
                  <button
                    className="picker-row-into"
                    onClick={(e) => { e.stopPropagation(); enterBoard(b.id); }}
                    title="Open folder"
                  >›</button>
                )}
                <span className="picker-row-arrow">↵</span>
              </div>
            );
          })}
        </div>

        {!searchHits && (
          <div className="picker-ft">
            <span className="picker-ft-hint">
              {canPickCurrent ? 'or link the folder itself' : 'Browse into a folder to pick'}
            </span>
            <button
              className="picker-ft-pick"
              disabled={!canPickCurrent}
              onClick={() => { if (canPickCurrent) { onPick(current); onClose(); } }}
            >Link “{current?.name}”</button>
          </div>
        )}
      </div>
    </div>
  );
}
