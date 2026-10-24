// Card right-click menu — supports flat items, dividers, and nested submenus
// (item.submenu = [...]). Hover an item with a submenu to expand.
//
// Submenus render through a body portal so position:fixed actually pins to
// the viewport — the parent .ctx-menu has a CSS transform (open animation),
// which would otherwise turn it into the containing block for any fixed
// descendant and send the submenu somewhere off-screen.

import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { tagFallbackColor } from '../lib/tagColor.js';
import { useFitMenuToViewport } from '../lib/ctxMenuFit.js';
import { CtxShortcut, CtxSubmenu, rowKeys, walkMenu } from './ctxMenuParts.jsx';

export function CardContextMenu({ open, x, y, above = false, items, onClose, workspaceId, boardId, card }) {
  // Single-flight guard: one action per menu open. The menu closes on the
  // first click, but a double-click can land two events before unmount —
  // which used to double-fire async actions (double delete/duplicate).
  const firedRef = useRef(false);
  useEffect(() => { if (open) firedRef.current = false; }, [open]);
  const claimFire = () => {
    if (firedRef.current) return false;
    firedRef.current = true;
    return true;
  };
  // Combined count from BOTH manual entity_links targeting the card
  // AND text occurrences of the card's name across docs / messages /
  // other cards. Drives the "Linked from N places" menu label so the
  // user sees how rich the backlinks panel will be before opening it.
  const [refCount, setRefCount] = useState(null);

  // Tags currently applied to this card. Shown at the top of the menu
  // so the user knows what concepts the system has attached before they
  // pick an action.
  const [appliedTags, setAppliedTags] = useState([]);

  // A different card's menu must not show the last card's count and tags
  // while its own load.
  useEffect(() => { setRefCount(null); setAppliedTags([]); }, [card?.id]);
  // Fetched when the menu OPENS (and fresh on every open), not whenever a card
  // was once right-clicked — the menu stays mounted and these ran on mount and
  // on every card/title change for a menu that may never be shown.
  useEffect(() => {
    if (!open || !supabase || !workspaceId || !boardId || !card?.id) return;
    let cancelled = false;
    (async () => {
      let n = 0;
      try {
        const { count } = await supabase.from('entity_links')
          .select('*', { count: 'exact', head: true })
          .eq('target_kind', 'card')
          .eq('target_board_id', boardId)
          .eq('target_card_id', card.id);
        n += count || 0;
      } catch (_) {}
      // Text mentions of the card's title across the workspace.
      const term = (card.title || card.name || '').trim();
      if (term && term.length >= 4) {
        try {
          const { data } = await supabase.rpc('get_entity_mentions', {
            p_term: term, p_workspace: workspaceId, p_limit: 1,
          });
          n += (data?.total_appears || 0);
        } catch (_) {}
      }
      if (!cancelled) setRefCount(n);

      // Tags applied directly to this card. Hydrate color + name.
      try {
        const { data: links } = await supabase.from('entity_links')
          .select('target_id, source')
          .eq('source_kind', 'card')
          .eq('source_id', String(card.id))
          .eq('source_board_id', boardId)
          .eq('target_kind', 'tag')
          .eq('link_kind', 'applied');
        const tagIds = Array.from(new Set((links || []).map(r => r.target_id).filter(Boolean)));
        if (tagIds.length === 0) {
          if (!cancelled) setAppliedTags([]);
          return;
        }
        const { data: tags } = await supabase.from('tags')
          .select('id, name, color')
          .in('id', tagIds);
        const sourceById = new Map((links || []).map(r => [r.target_id, r.source]));
        const hydrated = (tags || []).map(t => ({
          id: t.id,
          name: t.name || 'Tag',
          color: t.color || tagFallbackColor(t.name || t.id),
          source: sourceById.get(t.id) || 'user',
        }));
        if (!cancelled) setAppliedTags(hydrated);
      } catch (_) { if (!cancelled) setAppliedTags([]); }
    })();
    return () => { cancelled = true; };
  }, [open, workspaceId, boardId, card?.id, card?.title, card?.name]);

  const openTag = (tagId) => {
    onClose();
    document.dispatchEvent(new CustomEvent('soleil-open-tag', { detail: { tagId } }));
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e) => {
      // Submenus portal to <body> with the same .ctx-menu class, so a class
      // check (not a ref contains) keeps a submenu tap from closing the menu.
      const inside = e.target.closest?.('.ctx-menu');
      if (!inside) onClose();
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

  // The TAGS block (head + chip row + divider) is ~44px on top of the rows.
  // Reserved whenever the tags fetch runs, not once tags arrive: they load
  // after the menu opens, and a menu near the bottom jumped up 44px then.
  const canHaveTags = !!(supabase && workspaceId && boardId && card?.id);
  const tagReserve = canHaveTags && appliedTags.length === 0 ? 44 : 0;
  // The row-count guess below only seeds the first render; this measures the
  // rendered menu and re-fits it before paint (see lib/ctxMenuFit.js).
  const menuRef = useRef(null);
  // `above`: opened from the selection bar's ⋯, it ends at `y`, over the bar.
  useFitMenuToViewport(menuRef, open, y, tagReserve, above);

  if (!open) return null;
  const w = 220, hEst = items.length * 30 + 8 + (canHaveTags ? 44 : 0);
  const px = Math.max(8, Math.min(x, window.innerWidth  - w  - 8));
  // Floored at the top edge: on a short window (a landscape phone, or an image
  // card's ~20 rows) this went negative and the first rows started above the
  // viewport. A menu taller than the window scrolls instead (.is-scrollable).
  const py = above ? Math.max(8, y - hEst) : Math.max(8, Math.min(y, window.innerHeight - hEst - 8));

  // "Linked from N places" row. Callers can position it explicitly by placing a
  // { backlinks: true } item in their menu (preferred — keeps Delete last); if
  // none is present we fall back to auto-appending it at the very bottom.
  const backlinksButton = (key) => (
    <button key={key} className="ctx-item" role="menuitem" onClick={() => {
      onClose();
      document.dispatchEvent(new CustomEvent('soleil-open-backlinks', {
        detail: {
          ref: { kind: 'card', boardId, cardId: card.id },
          name: card.title || card.name || null,
        },
      }));
    }}>
      <span className="ctx-label">
        {refCount === null ? 'Linked from…' : refCount === 0 ? 'Not linked anywhere' : `Linked from ${refCount} ${refCount === 1 ? 'place' : 'places'}`}
      </span>
    </button>
  );
  const hasBacklinksPlaceholder = items.some(it => it.backlinks);

  return (
    <div ref={menuRef} className="ctx-menu is-scrollable" style={{ left: px, top: py }} role="menu" onKeyDown={walkMenu}>
      {card?.id && appliedTags.length > 0 && (
        <>
          <div className="ctx-tags-head">TAGS</div>
          <div className="ctx-tags-row">
            {appliedTags.map(t => (
              <button key={t.id}
                      className={`ctx-tag-chip ${t.source && t.source !== 'user' ? 'is-' + t.source : ''}`}
                      style={{ '--tag-c': t.color }}
                      title={`Open tag "${t.name}"${t.source && t.source !== 'user' ? ' · ' + t.source : ''}`}
                      onClick={() => openTag(t.id)}>
                <span className="ctx-tag-dot" aria-hidden="true" />
                <span className="ctx-tag-name">{t.name}</span>
              </button>
            ))}
          </div>
          <div className="ctx-divider" />
        </>
      )}
      {items.map((it, i) => {
        if (it.divider) return <div key={`d-${i}`} className="ctx-divider" />;
        if (it.header) return <div key={`h-${i}`} className="ctx-header" aria-hidden="true">{it.header}</div>;
        if (it.backlinks) return card?.id ? backlinksButton(it.id || `bl-${i}`) : null;
        if (it.submenu) return <CtxSubmenu key={it.id || i} item={it} onClose={onClose} claimFire={claimFire} />;
        return (
          <button
            key={it.id || i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={async () => { if (!claimFire()) return; onClose(); it.run && await it.run(); }}
            role="menuitem"
            {...rowKeys(it.shortcut)}
          >
            <span className="ctx-label">{it.label}</span>
            <CtxShortcut keys={it.shortcut} />
          </button>
        );
      })}
      {card?.id && !hasBacklinksPlaceholder && (
        <>
          {items.length > 0 && items[items.length - 1].divider !== true && <div className="ctx-divider" />}
          {backlinksButton('backlinks-fallback')}
        </>
      )}
    </div>
  );
}
