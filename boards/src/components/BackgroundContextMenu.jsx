// Background right-click menu — supports nested submenus via item.submenu = [...]
// (ctxMenuParts.jsx CtxSubmenu: hover, a tap or the keys open one).

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useFitMenuToViewport } from '../lib/ctxMenuFit.js';
import { CtxShortcut, CtxSubmenu, rowKeys, walkMenu } from './ctxMenuParts.jsx';

export function BackgroundContextMenu({ open, x, y, items, onClose, workspaceId, boardId, boardName }) {
  // Combined count from BOTH manual entity_links targeting the board
  // AND text occurrences of the board's name across the workspace.
  const [refCount, setRefCount] = useState(null);

  // Fetched when the menu OPENS (fresh each time). The menu is always mounted,
  // so this used to fire an entity_links count and a get_entity_mentions RPC
  // on every board open, for a menu that usually never opens.
  useEffect(() => {
    if (!open || !supabase || !workspaceId || !boardId) return;
    let cancelled = false;
    (async () => {
      let n = 0;
      try {
        const { count } = await supabase.from('entity_links')
          .select('*', { count: 'exact', head: true })
          .eq('target_kind', 'board')
          .eq('target_board_id', boardId);
        n += count || 0;
      } catch (_) {}
      const term = (boardName || '').trim();
      if (term && term.length >= 4) {
        try {
          const { data } = await supabase.rpc('get_entity_mentions', {
            p_term: term, p_workspace: workspaceId, p_limit: 1,
          });
          n += (data?.total_appears || 0);
        } catch (_) {}
      }
      if (!cancelled) setRefCount(n);
    })();
    return () => { cancelled = true; };
  }, [open, workspaceId, boardId, boardName]);
  // Another board's count must not show while this one's loads.
  useEffect(() => { setRefCount(null); }, [boardId]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      if (!e.target.closest?.('.ctx-menu')) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    // Capture phase + both pointer and mouse so a card's stopPropagation can't
    // swallow the outside-tap on touch (pointerdown fires before mousedown).
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  // The row-count guess below only seeds the first render (it counted headers
  // and dividers as 30px rows; real rows are 33px): this measures the rendered
  // menu and re-fits it before paint (see lib/ctxMenuFit.js).
  const menuRef = useRef(null);
  useFitMenuToViewport(menuRef, open, y);

  if (!open) return null;
  const w = 240, hEst = items.length * 30 + 8;
  const px = Math.max(8, Math.min(x, window.innerWidth  - w  - 8));
  // Floored at the top edge — see CardContextMenu: a menu taller than a short
  // window scrolls (.is-scrollable) instead of starting above the viewport.
  const py = Math.max(8, Math.min(y, window.innerHeight - hEst - 8));

  return (
    <div ref={menuRef} className="ctx-menu is-scrollable" style={{ left: px, top: py }} role="menu" onKeyDown={walkMenu}>
      {items.map((it, i) => {
        if (it.divider) return <div key={`d-${i}`} className="ctx-divider" />;
        if (it.header) return <div key={`h-${i}`} className="ctx-header" aria-hidden="true">{it.header}</div>;
        if (it.submenu) return <CtxSubmenu key={it.id || i} item={it} onClose={onClose} />;
        return (
          <button
            key={it.id || i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { onClose(); it.run && it.run(); }}
            role="menuitem"
            {...rowKeys(it.shortcut)}
          >
            <span className="ctx-label">{it.label}</span>
            <CtxShortcut keys={it.shortcut} />
          </button>
        );
      })}
      {boardId && (
        <>
          {items.length > 0 && items[items.length - 1].divider !== true && <div className="ctx-divider" />}
          <button className="ctx-item" role="menuitem" onClick={() => {
            onClose();
            document.dispatchEvent(new CustomEvent('soleil-open-backlinks', {
              detail: {
                ref: { kind: 'board', id: boardId },
                name: boardName || null,
              },
            }));
          }}>
            <span className="ctx-label">
              {refCount === null ? 'Linked from…' : refCount === 0 ? 'Not linked anywhere' : `Linked from ${refCount} ${refCount === 1 ? 'place' : 'places'}`}
            </span>
          </button>
        </>
      )}
    </div>
  );
}
