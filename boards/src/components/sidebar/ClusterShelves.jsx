// One unfolded cluster's contents in the sidebar: shelf headers, the photo
// mosaic, rows for everything else, the folded Links · More line, "Show N
// more". They sit in a soft panel, indented under the cluster's name — files
// live in panels and clusters never do, which is what tells them apart at a
// glance — and when sub-clusters come between the name and the panel, the
// panel opens with a line saying whose files these are (folded, it is only
// that line).
//
// lib/sidebarRows.js turns the shelves into fixed-height rows; this draws them.
// A short block renders whole (most clusters, and every peek). A long one —
// a shelf expanded in place to thousands — renders only the rows near the
// sidebar's viewport, against a spacer as tall as the whole block, so the
// sidebar scrolls the same either way.

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLongPress } from '../../hooks/useLongPress.js';
import { Icon } from '../Icon.jsx';
import { R2Image } from '../R2Image.jsx';
import { KindIcon } from '../cards.jsx';
import { humanSize, extOf, iconForFile } from '../cards/FileCard.jsx';
import { contentRows, layoutRows, visibleRange, mosaicPerLine, INDENT } from '../../lib/sidebarRows.js';

const WINDOW_AFTER = 80;
// Inside a panel every row starts here; the panel itself carries the indent.
const PANEL_PAD = 8;

// "Feature film's files", "Locations' files".
function possessive(name) {
  const n = (name || 'Untitled').trim();
  return /s$/i.test(n) ? `${n}’` : `${n}’s`;
}

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

// Touch has no right-click: holding a file opens its menu, and the tap that
// ends the hold is swallowed so Quick look doesn't open under the menu. Only
// THAT tap: the flag belongs to one gesture and the next pointerdown clears
// it, because Android ends a long press with contextmenu and no click at all,
// and a flag waiting for a click would eat the next real tap. The contextmenu
// that a hold raises is the same request, not a second one.
function useHoldForMenu(item, onMenu) {
  const ref = useRef(null);
  const held = useRef(false);
  useLongPress(ref, (x, y) => {
    if (!onMenu) return;
    held.current = true;
    onMenu(item, x, y);
  }, { ms: 480, tolerance: 8, pointerType: 'touch' });
  const swallow = () => {
    if (!held.current) return false;
    held.current = false;
    return true;
  };
  const onPointerDown = () => { held.current = false; };
  const heldNow = () => held.current;
  return { ref, swallow, onPointerDown, heldNow };
}

// One item as a row: its thumbnail or icon, its name, the stored-off-the-board
// mark, a star, and its length or size. Shelves, Starred and Recent all draw
// items with it, so an item looks the same wherever the sidebar lists it.
export function SidebarItemRow({ item, depth = 0, indent = null, onClick, onOpen, starred = false, where = '', selected = false, onDragStart = null, onMenu = null }) {
  const meta = rowMeta(item);
  const hold = useHoldForMenu(item, onMenu);
  return (
    <button type="button" ref={hold.ref}
            className={`sbf-file${item.unplaced ? ' is-stored' : ''}${selected ? ' is-selected' : ''}`}
            aria-selected={selected || undefined}
            draggable={!!onDragStart}
            onDragStart={onDragStart ? (e) => onDragStart(item, e) : undefined}
            style={{ paddingLeft: indent ?? 10 + depth * INDENT }}
            role="treeitem" aria-level={depth + 1}
            data-sb-item={item.key}
            title={`${item.name}${where ? ` · ${where}` : ''}${item.unplaced ? ' · not on the board' : ''}`}
            onClick={(e) => { if (!hold.swallow()) onClick?.(item, e); }}
            onDoubleClick={() => onOpen?.(item)}
            onPointerDown={hold.onPointerDown}
            onContextMenu={onMenu ? (e) => { e.preventDefault(); if (!hold.heldNow()) onMenu(item, e.clientX, e.clientY); } : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onOpen?.(item); }
              if (onMenu && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(item, r.left + 24, r.bottom);
              }
            }}>
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
export function SidebarTile({ item, depth = 0, starred = false, where = '', onClick, onOpen, selected = false, onDragStart = null, onMenu = null }) {
  const src = thumbSrc(item);
  const hold = useHoldForMenu(item, onMenu);
  return (
    <button type="button" ref={hold.ref}
            className={`sbf-tile${item.unplaced ? ' is-stored' : ''}${starred ? ' is-starred' : ''}${selected ? ' is-selected' : ''}`}
            aria-selected={selected || undefined}
            draggable={!!onDragStart}
            onDragStart={onDragStart ? (e) => onDragStart(item, e) : undefined}
            role="treeitem" aria-level={depth + 1} aria-label={item.name}
            title={`${item.name}${where ? ` · ${where}` : ''}${item.unplaced ? ' · not on the board' : ''}`}
            data-sb-item={item.key}
            onClick={(e) => { if (!hold.swallow()) onClick?.(item, e); }}
            onDoubleClick={() => onOpen?.(item)}
            onPointerDown={hold.onPointerDown}
            onContextMenu={onMenu ? (e) => { e.preventDefault(); if (!hold.heldNow()) onMenu(item, e.clientX, e.clientY); } : undefined}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onOpen?.(item); }
              if (onMenu && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) {
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                onMenu(item, r.left + 24, r.bottom);
              }
            }}>
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
  const pad = { paddingLeft: PANEL_PAD };
  const { onItem, onItemOpen, onMore, onLess, onFold, onOpenShelf, foldOpen, starred, selected, onDragItem, onItemMenu, onToggleOwn, tileGap } = ctx;

  if (row.type === 'own') {
    return (
      <button type="button" className={`sbf-own${row.open ? ' is-open' : ''}`} style={pad}
              role="treeitem" aria-level={depth + 1} aria-expanded={row.open}
              title={row.open ? 'Fold these away' : 'Show these files'}
              onClick={() => onToggleOwn?.()}>
        <span className="sbf-own-chev" aria-hidden="true">▸</span>
        <span className="sbf-own-name">{possessive(row.name)} files</span>
        <span className="sbf-own-count">{row.count}</span>
      </button>
    );
  }

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
      <div className="sbf-mosaic" style={{ ...pad, gap: tileGap }}>
        {row.items.map((item) => (
          <SidebarTile key={item.key} item={item} depth={depth} starred={starred(item)}
                       selected={selected(item)} onDragStart={onDragItem}
                       onMenu={onItemMenu ? (it, x, y) => onItemMenu(it, row, x, y) : null}
                       onClick={(it, e) => onItem(it, row, e)} onOpen={onItemOpen} />
        ))}
      </div>
    );
  }
  if (row.type === 'file') {
    return (
      <SidebarItemRow item={row.item} depth={depth} indent={PANEL_PAD} starred={starred(row.item)}
                      selected={selected(row.item)} onDragStart={onDragItem}
                      onMenu={onItemMenu ? (it, x, y) => onItemMenu(it, row, x, y) : null}
                      onClick={(item, e) => onItem(item, row, e)} onOpen={onItemOpen} />
    );
  }
  if (row.type === 'more') {
    return (
      <div className="sbf-more" style={pad}>
        {row.count > 0 && (
          <button type="button" className="sbf-more-btn" tabIndex={-1} onClick={() => onMore(row)}>
            Show {row.count} more
          </button>
        )}
        {row.expanded && (
          <button type="button" className="sbf-more-btn is-less" tabIndex={-1} onClick={() => onLess(row)}>
            Show less
          </button>
        )}
      </div>
    );
  }
  if (row.type === 'fold') {
    return (
      <div className="sbf-fold" style={pad}>
        {row.parts.map((p) => (
          <button type="button" key={p.shelfId} tabIndex={-1}
                  className={`sbf-fold-btn${foldOpen(row.boardId, p.shelfId) ? ' is-open' : ''}`}
                  aria-expanded={foldOpen(row.boardId, p.shelfId)}
                  onClick={() => onFold(row.boardId, p.shelfId)}>
            {p.label || p.shelfId} <span className="sbf-fold-count">{p.count}</span>
          </button>
        ))}
      </div>
    );
  }
  if (row.type === 'loading') {
    return <div className="sbf-note" style={pad} aria-busy="true">Loading…</div>;
  }
  if (row.type === 'empty') {
    return <div className="sbf-note" style={pad}>No files yet — drop some here</div>;
  }
  return null;
}

// The rows of a long block that touch the sidebar's viewport, recomputed on
// scroll and resize (one rAF per frame at most). The row holding focus is
// rendered wherever it is (see `pinned` below): unmounting it would drop focus
// to the page, and ↑/↓ walk the rows that are in the DOM.
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
  own = null, onToggleOwn = null,
  shelfState, onToggleShelf, onLoadMore, canLoadMore,
  onItem, onItemOpen, onOpenShelf, isStarred, scrollRef,
  isSelected = null, onDragItem = null, onItemMenu = null,
}) {
  // The panel sits under the cluster's name: indented a level past it, 6px
  // short of the edge.
  const panelLeft = 6 + depth * INDENT;
  // As many tiles as fit inside the panel (the sidebar's own padding, the
  // panel's indent and edges, the row's padding, room for the scrollbar).
  const thumb = coarse ? 52 : 40;
  const minGap = coarse ? 5 : 4;
  const inset = 16 + panelLeft + 6 + 8 + PANEL_PAD + 6;
  const perLine = mosaicPerLine(width, { thumb, gap: minGap, inset });
  // The room left over spreads between the tiles (up to a point), so a line
  // of photos spans the panel instead of bunching at its left.
  const tileGap = perLine > 1
    ? Math.max(minGap, Math.min(12, Math.floor((width - inset - perLine * thumb) / (perLine - 1))))
    : minGap;
  const ownKey = own ? `${own.name}|${own.count}|${own.open}` : '';
  const rows = useMemo(() => contentRows(boardId, depth, {
    contents, shelfState: (b, s) => shelfState?.(b, s) || {}, perLine, coarse, hasChildren, own,
  }), [boardId, depth, contents, shelfState, perLine, coarse, hasChildren, ownKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useMemo(() => layoutRows(rows), [rows]);
  const windowed = rows.length > WINDOW_AFTER;
  const blockRef = useRef(null);
  const range = useWindow(scrollRef, blockRef, layout, windowed);
  const [pinned, setPinned] = useState(null);

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
    onLess: (row) => onToggleShelf?.(boardId, row.shelfId, 'expanded'),
    onToggleOwn,
    tileGap,
    onFold: (b, shelfId) => onToggleShelf?.(b, shelfId, 'open'),
    foldOpen: (b, shelfId) => !!shelfState?.(b, shelfId)?.open,
    onOpenShelf,
    starred: (item) => !!isStarred?.(item.boardId, item.cardId),
    selected: (item) => !!isSelected?.(item),
    onDragItem,
    onItemMenu: onItemMenu ? (item, row, x, y) => {
      const shelf = contents?.shelves?.find((s) => s.id === row.shelfId);
      onItemMenu(item, shelf?.items || [item], x, y);
    } : null,
  };

  if (!rows.length) return null;
  const folded = !!own && !own.open;
  const panel = (block) => (
    <div className={`sbf-panel${folded ? ' is-folded' : ''}`} style={{ marginLeft: panelLeft }}>{block}</div>
  );
  if (!windowed) {
    return panel(
      <div className="sbf-block" role="group">
        {rows.map((row) => <Row key={row.key} row={row} depth={row.depth} ctx={ctx} />)}
      </div>,
    );
  }
  const shown = [];
  for (let i = range.start; i < range.end; i++) shown.push(i);
  if (pinned != null && (pinned < range.start || pinned >= range.end)) {
    for (let i = Math.max(0, pinned - 1); i <= Math.min(rows.length - 1, pinned + 1); i++) {
      if (i < range.start || i >= range.end) shown.push(i);
    }
    shown.sort((a, b) => a - b);
  }
  return panel(
    <div className="sbf-block is-windowed" role="group" ref={blockRef}
         style={{ height: layout.total }}
         aria-rowcount={rows.length}
         onFocus={(e) => {
           const i = Number(e.target.closest?.('[data-slot]')?.dataset.slot);
           if (Number.isFinite(i)) setPinned(i);
         }}
         onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setPinned(null); }}>
      {shown.map((i) => {
        const row = rows[i];
        return (
          <div key={row.key} className="sbf-slot" data-slot={i}
               style={{ top: layout.offsets[i], height: row.height }}>
            <Row row={row} depth={row.depth} ctx={ctx} />
          </div>
        );
      })}
    </div>,
  );
}
