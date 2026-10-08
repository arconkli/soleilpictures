// The Files grid: justified rows (lib/justifiedGrid.js). Each picture keeps its
// shape, every row fills the width, and the tile size (S / M / L) is this
// device's choice. Replaced a CSS grid of fixed 4:3 boxes, which cropped
// portraits to slivers and letterboxed everything else.
//
// Same props as the table, so ListSurface stays view-agnostic. Linked-grid
// FAMILIES arrive as group nodes: a stacked tile with a count, its members
// flowing after it when expanded. Tiles render in item order — the order the
// keyboard walks — and past VIRTUALIZE_ABOVE items only the ones near the
// scrolled viewport are mounted.

import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react';
import { ClusterTile } from './ClusterTile.jsx';
import { CardPreview } from './CardPreview.jsx';
import { aspectOfItem, layoutGallery, visibleRange, TILE_SIZES, DEFAULT_TILE_SIZE } from '../../lib/justifiedGrid.js';

const VIRTUALIZE_ABOVE = 400;

export function JustifiedGallery({
  items, selectedCards, peerMap, onRowClick, onRowDoubleClick, recentlyAddedIds,
  expandedGroups, selectedGroupId, onGroupClick,
  onDownload = null, onAudition = null, playingId = null, draggableItems = false, onBoardIds = null,
  tileSize = DEFAULT_TILE_SIZE,
  // Keyboard cursor (ListSurface owns it): the tile it's on, a ref per tile so
  // it can be scrolled into view, and the laid-out rows for ↑/↓.
  activeId = null, registerRow = null, onLayout = null,
}) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (Number.isFinite(w)) setWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const entries = useMemo(() => {
    const out = [];
    for (const it of items || []) {
      if (it.isGroup) {
        out.push({ id: it.id, group: it, aspect: aspectOfItem(it) });
        if (expandedGroups?.has?.(it.id)) {
          for (const m of it.members || []) out.push({ id: m.id, item: m, member: true, aspect: aspectOfItem(m) });
        }
      } else {
        out.push({ id: it.id, item: it, aspect: aspectOfItem(it) });
      }
    }
    return out;
  }, [items, expandedGroups]);

  const { tiles, height } = useMemo(
    () => layoutGallery(entries, { width, rowHeight: TILE_SIZES[tileSize] || TILE_SIZES[DEFAULT_TILE_SIZE] }),
    [entries, width, tileSize]);

  useEffect(() => { onLayout?.({ tiles, ids: entries.map((e) => e.id) }); }, [tiles, entries, onLayout]);

  // Past VIRTUALIZE_ABOVE, mount only what's near the viewport of the list's
  // scroller (.list-wrap).
  const virtual = entries.length > VIRTUALIZE_ABOVE;
  const [range, setRange] = useState([0, VIRTUALIZE_ABOVE]);
  useEffect(() => {
    if (!virtual) return undefined;
    const el = ref.current;
    const scroller = el?.closest?.('.list-wrap');
    if (!el || !scroller) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      const top = scroller.getBoundingClientRect().top - el.getBoundingClientRect().top;
      const next = visibleRange(tiles, top, top + scroller.clientHeight);
      setRange((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [virtual, tiles]);

  const [start, end] = virtual ? range : [0, tiles.length];

  // The cursor moving onto a tile that isn't mounted: scroll its row into view
  // (a mounted tile is scrolled by ListSurface through its ref).
  useEffect(() => {
    if (!virtual || !activeId) return;
    const i = entries.findIndex((e) => e.id === activeId);
    if (i < 0 || (i >= start && i < end) || !tiles[i]) return;
    const el = ref.current;
    const scroller = el?.closest?.('.list-wrap');
    if (!el || !scroller) return;
    const offset = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTop = Math.max(0, offset + tiles[i].y - scroller.clientHeight / 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);
  const shown = [];
  for (let i = start; i < end && i < tiles.length; i++) {
    const t = tiles[i];
    const e = entries[i];
    const style = { position: 'absolute', left: t.x, top: t.y, width: t.w, height: t.h };
    if (e.group) {
      const g = e.group;
      const expanded = expandedGroups?.has?.(g.id);
      shown.push(
        <div key={g.id} style={{ ...style, '--jg-h': `${t.previewH}px` }}
             ref={registerRow ? registerRow(g.id) : null} data-item-id={g.id}
             className={`ct-tile ct-group-tile${activeId === g.id ? ' is-active' : ''}${selectedGroupId === g.id ? ' is-selected' : ''}${expanded ? ' is-open' : ''}`}
             onClick={(ev) => onGroupClick(ev, g.id)}>
          <div className="ct-tile-preview">
            <CardPreview item={g} size="tile" px={t.w} />
            <span className="ct-group-badge">{g.count}</span>
          </div>
          <div className="ct-tile-meta">
            <div className="ct-tile-name" title={g.name}>{g.name}</div>
          </div>
        </div>,
      );
    } else {
      const it = e.item;
      shown.push(
        <ClusterTile
          key={it.id} item={it} member={!!e.member}
          style={style} previewH={t.previewH} px={t.w}
          active={activeId === it.id} tileRef={registerRow ? registerRow(it.id) : null}
          selected={selectedCards.has(it.id)}
          isNew={recentlyAddedIds?.has?.(it.id)}
          peers={peerMap?.get(it.id)}
          onDownload={onDownload} onAudition={onAudition} playing={playingId === it.id}
          draggable={draggableItems} onBoard={!!onBoardIds?.has?.(it.id)}
          onClick={(ev) => onRowClick(ev, it.id)}
          onDoubleClick={(ev) => onRowDoubleClick(ev, it.id)}
        />,
      );
    }
  }

  return (
    <div className="ct-gallery ct-jg" ref={ref} style={{ height }} data-tile-size={tileSize}>
      {width > 0 && shown}
    </div>
  );
}
