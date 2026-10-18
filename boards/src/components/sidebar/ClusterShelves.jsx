// One unfolded cluster's contents in the sidebar: shelf headers, the photo
// mosaic, rows for everything else, the folded Links · More line, "+N more".
//
// lib/sidebarRows.js turns the shelves into fixed-height rows; this draws them.
// A short block renders whole (most clusters, and every peek). A long one —
// a shelf expanded in place to thousands — renders only the rows near the
// sidebar's viewport, against a spacer as tall as the whole block, so the
// sidebar scrolls the same either way.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { KindIcon } from '../cards.jsx';
import { humanSize, extOf, iconForFile } from '../cards/FileCard.jsx';
import { contentRows, layoutRows, visibleRange, mosaicPerLine } from '../../lib/sidebarRows.js';

const WINDOW_AFTER = 80;
const INDENT = 14;

function clock(sec) {
  const s = Math.round(Number(sec) || 0);
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// What sits at the right of a row: a length for time-based media, a size for
// a stored file, nothing for the rest.
function rowMeta(item) {
  if (item.kind === 'video' || item.kind === 'audio') return clock(item.meta?.duration);
  if (item.kind === 'file' || item.kind === 'pdf') return item.sizeBytes ? humanSize(item.sizeBytes) : '';
  return '';
}

function thumbSrc(item) {
  const m = item.meta || {};
  if (item.kind === 'image') return m.src || null;
  if (item.kind === 'video') return m.poster || null;
  if (item.kind === 'pdf') return m.src || null;     // a PDF's src is its page-1 raster
  return null;
}

function ItemGlyph({ item }) {
  const src = thumbSrc(item);
  if (src) {
    return <span className="sbf-file-thumb"><R2Image src={src} alt="" /></span>;
  }
  if (item.kind === 'file') {
    const IconComp = iconForFile(extOf(item.meta?.fileName, item.meta?.ext), item.meta?.mime);
    return <span className="sbf-file-icon"><Icon as={IconComp} size={13} /></span>;
  }
  return <span className="sbf-file-icon"><KindIcon kind={item.kind} size={13} /></span>;
}

// One item as a row: its thumbnail or icon, its name, the stored-off-the-board
// mark, a star, and its length or size. Shelves, Starred and Recent all draw
// items with it, so an item looks the same wherever the sidebar lists it.
export function SidebarItemRow({ item, depth = 0, onClick, onOpen, starred = false, where = '' }) {
  const meta = rowMeta(item);
  return (
    <button type="button"
            className={`sbf-file${item.unplaced ? ' is-stored' : ''}`}
            style={{ paddingLeft: 10 + depth * INDENT }}
            role="treeitem" aria-level={depth + 1}
            data-sb-item={item.key}
            title={`${item.name}${where ? ` · ${where}` : ''}${item.unplaced ? ' · not on the board' : ''}`}
            onClick={(e) => onClick?.(item, e)}
            onDoubleClick={() => onOpen?.(item)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen?.(item); } }}>
      <ItemGlyph item={item} />
      <span className="sbf-file-name">{item.name}</span>
      {where && <span className="sbf-file-where">{where}</span>}
      {item.unplaced && <span className="sbf-stored-dot" aria-label="not on the board" />}
      {starred && <span className="sbf-star-mark" aria-label="starred">★</span>}
      {meta && <span className="sbf-file-meta">{meta}</span>}
    </button>
  );
}

// One item as a tile: the photo mosaic's square, used by Recent too.
export function SidebarTile({ item, depth = 0, starred = false, where = '', onClick, onOpen }) {
  const src = thumbSrc(item);
  return (
    <button type="button"
            className={`sbf-tile${item.unplaced ? ' is-stored' : ''}${starred ? ' is-starred' : ''}`}
            role="treeitem" aria-level={depth + 1} aria-label={item.name}
            title={`${item.name}${where ? ` · ${where}` : ''}${item.unplaced ? ' · not on the board' : ''}`}
            data-sb-item={item.key}
            onClick={(e) => onClick?.(item, e)}
            onDoubleClick={() => onOpen?.(item)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onOpen?.(item); } }}>
      {src
        ? <R2Image src={src} alt="" />
        : <span className="sbf-tile-glyph"><KindIcon kind={item.kind} size={14} /></span>}
      {item.kind === 'video' && <span className="sbf-tile-play" aria-hidden="true">▶</span>}
    </button>
  );
}

// Rows of the windowed block are positioned by offset; rows of a short block
// sit in normal flow. The same row component draws both.
function Row({ row, depth, ctx }) {
  const pad = { paddingLeft: 10 + depth * INDENT };
  const { onItem, onItemOpen, onMore, onFold, onOpenShelf, foldOpen, starred } = ctx;

  if (row.type === 'shelf') {
    return (
      <div className="sbf-shelf" style={pad}>
        <span className="sbf-shelf-label">{row.label || row.shelfId}</span>
        <span className="sbf-shelf-count">{row.count}</span>
        {onOpenShelf && (
          <button type="button" className="sbf-shelf-open" tabIndex={-1}
                  title="Open in Files" aria-label={`Open ${row.label || row.shelfId} in Files`}
                  onClick={(e) => { e.stopPropagation(); onOpenShelf(row.boardId, row.shelfId); }}>
            ⤢
          </button>
        )}
      </div>
    );
  }
  if (row.type === 'mosaic') {
    return (
      <div className="sbf-mosaic" style={pad}>
        {row.items.map((item) => (
          <SidebarTile key={item.key} item={item} depth={depth} starred={starred(item)}
                       onClick={(it, e) => onItem(it, row, e)} onOpen={onItemOpen} />
        ))}
      </div>
    );
  }
  if (row.type === 'file') {
    return (
      <SidebarItemRow item={row.item} depth={depth} starred={starred(row.item)}
                      onClick={(item, e) => onItem(item, row, e)} onOpen={onItemOpen} />
    );
  }
  if (row.type === 'more') {
    return (
      <button type="button" className="sbf-more" style={pad} tabIndex={-1}
              onClick={() => onMore(row)}>
        +{row.count} more
      </button>
    );
  }
  if (row.type === 'fold') {
    return (
      <div className="sbf-fold" style={pad}>
        {row.parts.map((p, i) => (
          <span key={p.shelfId} className="sbf-fold-part">
            {i > 0 && <span className="sbf-fold-sep" aria-hidden="true">·</span>}
            <button type="button" tabIndex={-1}
                    className={`sbf-fold-btn${foldOpen(row.boardId, p.shelfId) ? ' is-open' : ''}`}
                    aria-expanded={foldOpen(row.boardId, p.shelfId)}
                    onClick={() => onFold(row.boardId, p.shelfId)}>
              {p.label || p.shelfId} {p.count}
            </button>
          </span>
        ))}
      </div>
    );
  }
  if (row.type === 'loading') {
    return <div className="sbf-note" style={pad} aria-busy="true">Loading…</div>;
  }
  if (row.type === 'empty') {
    return <div className="sbf-note" style={pad}>Nothing here yet</div>;
  }
  return null;
}

// The rows of a long block that touch the sidebar's viewport, recomputed on
// scroll and resize (one rAF per frame at most).
function useWindow(scrollRef, blockRef, layout, active) {
  const [range, setRange] = useState({ start: 0, end: Math.min(layout.offsets.length, 60) });
  useLayoutEffect(() => {
    if (!active) return undefined;
    const scroller = scrollRef?.current;
    const block = blockRef.current;
    if (!scroller || !block) return undefined;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const top = block.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const next = visibleRange(layout, -top, scroller.clientHeight, 400);
      setRange((r) => (r.start === next.start && r.end === next.end ? r : next));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, blockRef, layout, active]);
  return range;
}

export function ClusterShelves({
  boardId, depth, contents, hasChildren = false, width = 300, coarse = false,
  shelfState, onToggleShelf, onLoadMore, canLoadMore,
  onItem, onItemOpen, onOpenShelf, isStarred, scrollRef,
}) {
  // As many tiles as fit beside this block's own indent (the sidebar's
  // padding, the row's 10px, 14px a level, and room for the scrollbar).
  const perLine = mosaicPerLine(width, {
    thumb: coarse ? 52 : 40, gap: coarse ? 5 : 4, inset: 16 + 10 + depth * INDENT + 8,
  });
  const rows = useMemo(() => contentRows(boardId, depth, {
    contents, shelfState: (b, s) => shelfState?.(b, s) || {}, perLine, coarse, hasChildren,
  }), [boardId, depth, contents, shelfState, perLine, coarse, hasChildren]);
  const layout = useMemo(() => layoutRows(rows), [rows]);
  const windowed = rows.length > WINDOW_AFTER;
  const blockRef = useRef(null);
  const range = useWindow(scrollRef, blockRef, layout, windowed);

  const ctx = {
    // Quick look steps through the whole shelf as loaded, not just the peek
    // on screen: ← and → should reach the photo after the twelfth.
    onItem: (item, row, e) => {
      const shelf = contents?.shelves?.find((s) => s.id === row.shelfId);
      onItem?.(item, shelf?.items?.length ? shelf.items : [item], e);
    },
    onItemOpen: (item) => onItemOpen?.(item),
    onMore: (row) => {
      if (!row.expanded) { onToggleShelf?.(boardId, row.shelfId, 'expanded'); return; }
      if (canLoadMore?.(boardId, row.shelfId)) onLoadMore?.(boardId, row.shelfId);
    },
    onFold: (b, shelfId) => onToggleShelf?.(b, shelfId, 'open'),
    foldOpen: (b, shelfId) => !!shelfState?.(b, shelfId)?.open,
    onOpenShelf,
    starred: (item) => !!isStarred?.(item.boardId, item.cardId),
  };

  if (!windowed) {
    return (
      <div className="sbf-block" role="group">
        {rows.map((row) => <Row key={row.key} row={row} depth={row.depth} ctx={ctx} />)}
      </div>
    );
  }
  const slice = rows.slice(range.start, range.end);
  return (
    <div className="sbf-block is-windowed" role="group" ref={blockRef}
         style={{ height: layout.total }}
         aria-rowcount={rows.length}>
      {slice.map((row, i) => (
        <div key={row.key} className="sbf-slot"
             style={{ top: layout.offsets[range.start + i], height: row.height }}>
          <Row row={row} depth={row.depth} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}
