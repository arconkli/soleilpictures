// Catch-all stream of incoming things. Search, scroll, drag onto any board.

import { useMemo } from 'react';
import { ImagePlaceholder } from './primitives.jsx';
import { EmptyState } from './EmptyState.jsx';
import { Inbox as InboxIcon } from '../lib/icons.js';
import { INBOX_MIME } from '../lib/inbox.js';

export function InboxPanel({ items, query, onQuery, onClose }) {
  const filtered = useMemo(() => {
    const q = (query || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter(it => {
      const hay = [it.from, it.source, it.when, it.label, it.title, it.body, it.url, it.kind]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [items, query]);

  const startDrag = (e, item) => {
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(INBOX_MIME, JSON.stringify(item));
    e.dataTransfer.setData('text/plain', item.label || item.title || item.body || item.id);
  };

  return (
    <div className="inbox">
      <div className="inbox-hd">
        <span className="inbox-title">Inbox</span>
        <span className="inbox-count">{items.length}</span>
        <div className="inbox-hd-spacer" />
        <button className="inbox-close" onClick={onClose} title="Hide inbox" aria-label="Hide inbox">✕</button>
      </div>
      <div className="inbox-search">
        <svg width="11" height="11" viewBox="0 0 13 13" fill="none">
          <circle cx="5.5" cy="5.5" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
          <path d="M8.5 8.5 L11.5 11.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
        <input
          value={query || ''}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search inbox…"
        />
        {query && <button className="inbox-search-x" onClick={() => onQuery('')} aria-label="Clear">✕</button>}
      </div>
      <div className="inbox-body">
        {filtered.length === 0 ? (
          items.length === 0 ? (
            <EmptyState icon={InboxIcon} title="Inbox is clear" body="Drop files or paste links here." />
          ) : (
            <div className="inbox-empty">No items match.</div>
          )
        ) : filtered.map((it) => (
          <div key={it.id} className={`inbox-item kind-${it.kind}`}
               draggable
               onDragStart={(e) => startDrag(e, it)}
               title="Drag onto a board">
            <div className="inbox-item-thumb">
              {it.kind === 'image' && <ImagePlaceholder tone={it.tone} aspect="1/1" />}
              {it.kind === 'link'  && (
                <div className="inbox-glyph" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M5 9 L9 5 M3.5 6.5 L2.5 7.5 A2 2 0 0 0 5.5 10.5 L6.5 9.5 M9.5 4.5 L10.5 3.5 A2 2 0 0 0 7.5 .5 L6.5 1.5"
                          stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                  </svg>
                </div>
              )}
              {it.kind === 'note'  && (
                <div className="inbox-glyph" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 3 H11 M3 6 H11 M3 9 H8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </div>
              )}
              {it.kind === 'doc'   && (
                <div className="inbox-glyph" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M3 1.5 H8 L11 4.5 V12.5 H3 Z" stroke="currentColor" strokeWidth="1.1" fill="none"/>
                    <path d="M8 1.5 V4.5 H11" stroke="currentColor" strokeWidth="1.1" fill="none"/>
                  </svg>
                </div>
              )}
            </div>
            <div className="inbox-item-meta">
              <div className="inbox-item-row1">
                <span className="inbox-item-from">{it.from}</span>
                {it.source && <span className="inbox-item-source">· {it.source}</span>}
              </div>
              <div className="inbox-item-prev">
                {it.label || it.title || it.body || (it.kind || '').toUpperCase()}
              </div>
              <div className="inbox-item-time">{it.when}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="inbox-ft">
        <span className="inbox-ft-hint">drag onto canvas →</span>
      </div>
    </div>
  );
}
