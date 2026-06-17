// Card right-click menu — supports flat items, dividers, and nested submenus
// (item.submenu = [...]). Hover an item with a submenu to expand.
//
// Submenus render through a body portal so position:fixed actually pins to
// the viewport — the parent .ctx-menu has a CSS transform (open animation),
// which would otherwise turn it into the containing block for any fixed
// descendant and send the submenu somewhere off-screen.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase.js';
import { tagFallbackColor } from '../lib/tagColor.js';

export function CardContextMenu({ open, x, y, items, onClose, workspaceId, boardId, card }) {
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

  // WAI-ARIA menu keyboard pattern: Arrow keys walk the items, Home/End
  // jump. role="menu" was already declared but the keys did nothing.
  const onMenuKeyDown = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    const items = Array.from(e.currentTarget.querySelectorAll('button.ctx-item:not(:disabled)'));
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    let next;
    if (e.key === 'Home') next = items[0];
    else if (e.key === 'End') next = items[items.length - 1];
    else if (e.key === 'ArrowDown') next = items[(idx + 1 + items.length) % items.length];
    else next = items[(idx - 1 + items.length) % items.length];
    next?.focus();
  };
  // Tags currently applied to this card. Shown at the top of the menu
  // so the user knows what concepts the system has attached before they
  // pick an action.
  const [appliedTags, setAppliedTags] = useState([]);

  useEffect(() => {
    if (!supabase || !workspaceId || !boardId || !card?.id) return;
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
  }, [workspaceId, boardId, card?.id, card?.title, card?.name]);

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

  if (!open) return null;
  const w = 220, hEst = items.length * 30 + 8;
  const px = Math.min(x, window.innerWidth  - w  - 8);
  const py = Math.min(y, window.innerHeight - hEst - 8);

  return (
    <div className="ctx-menu" style={{ left: px, top: py }} role="menu" onKeyDown={onMenuKeyDown}>
      {card?.id && appliedTags.length > 0 && (
        <>
          <div className="ctx-tags-head">TAGS</div>
          <div className="ctx-tags-row">
            {appliedTags.map(t => (
              <button key={t.id}
                      className="ctx-tag-chip"
                      title={`Open tag "${t.name}"${t.source && t.source !== 'user' ? ' · ' + t.source : ''}`}
                      onClick={() => openTag(t.id)}>
                <span className="ctx-tag-dot" style={{ background: t.color }} />
                <span className="ctx-tag-name">{t.name}</span>
              </button>
            ))}
          </div>
          <div className="ctx-divider" />
        </>
      )}
      {items.map((it, i) => {
        if (it.divider) return <div key={`d-${i}`} className="ctx-divider" />;
        if (it.submenu) return <SubmenuItem key={it.id || i} item={it} onClose={onClose} claimFire={claimFire} />;
        return (
          <button
            key={it.id || i}
            className={`ctx-item ${it.danger ? 'danger' : ''}`}
            disabled={it.disabled}
            onClick={async () => { if (!claimFire()) return; onClose(); it.run && await it.run(); }}
            role="menuitem"
          >
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        );
      })}
      {card?.id && (
        <>
          {items.length > 0 && items[items.length - 1].divider !== true && <div className="ctx-divider" />}
          <button className="ctx-item" onClick={() => {
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
        </>
      )}
    </div>
  );
}

function SubmenuItem({ item, onClose, claimFire = () => true }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null); // {left, top, maxHeight}
  const wrapRef = useRef(null);
  const closeTimerRef = useRef(null);

  const computePos = () => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const itemRect = wrap.getBoundingClientRect();
    // Submenu opens off the parent MENU's right edge (not the item's), so
    // hovering items deep into the menu doesn't cause the gap to widen and
    // the "open to the left" branch to misfire on items past the menu's
    // right edge.
    const menu = wrap.closest('.ctx-menu');
    const menuRect = menu ? menu.getBoundingClientRect() : itemRect;
    const SUB_W = 204;
    const PAD = 8;
    const itemCount = item.submenu.length;
    const estH = Math.min(itemCount * 30 + 8, window.innerHeight - 2 * PAD);
    const opensOffRight = menuRect.right + SUB_W > window.innerWidth - PAD;
    const hasRoomLeft = menuRect.left - SUB_W >= PAD;
    const left = (opensOffRight && hasRoomLeft) ? menuRect.left - SUB_W - 2 : menuRect.right + 2;
    let top = itemRect.top - 4;
    if (top + estH > window.innerHeight - PAD) top = Math.max(PAD, window.innerHeight - PAD - estH);
    return { left, top, maxHeight: window.innerHeight - top - PAD };
  };

  const handleEnter = () => {
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
    setPos(computePos());
    setOpen(true);
  };
  const handleLeave = () => {
    closeTimerRef.current = setTimeout(() => setOpen(false), 140);
  };

  return (
    <div ref={wrapRef} className="ctx-submenu-wrap" onMouseEnter={handleEnter} onMouseLeave={handleLeave}>
      {/* Tap also toggles — hover-only submenus are unreachable on touch. */}
      <button className={`ctx-item ctx-has-submenu ${item.danger ? 'danger' : ''}`} disabled={item.disabled}
              aria-haspopup="menu" aria-expanded={open}
              onClick={() => { if (open) { setOpen(false); } else { setPos(computePos()); setOpen(true); } }}>
        <span className="ctx-label">{item.label}</span>
        <span className="ctx-chevron" aria-hidden="true">›</span>
      </button>
      {open && pos && createPortal(
        <div className="ctx-menu ctx-submenu"
             role="menu"
             style={{ position: 'fixed', left: pos.left, top: pos.top, maxHeight: pos.maxHeight, overflowY: 'auto' }}
             onMouseEnter={handleEnter}
             onMouseLeave={handleLeave}>
          {item.submenu.map((sub, j) => {
            if (sub.divider) return <div key={`sd-${j}`} className="ctx-divider" />;
            if (sub.swatch) {
              return (
                <button key={sub.id || j}
                        className="ctx-item ctx-swatch-row"
                        disabled={sub.disabled}
                        onClick={async () => { if (!claimFire()) return; onClose(); sub.run && await sub.run(); }}>
                  <span className="ctx-swatch-dot" style={{
                    background: sub.swatch === 'transparent'
                      ? 'repeating-linear-gradient(45deg,#222 0 4px,#444 4px 8px)'
                      : sub.swatch
                  }} />
                  <span className="ctx-label">{sub.label}</span>
                </button>
              );
            }
            return (
              <button key={sub.id || j}
                      className={`ctx-item ${sub.danger ? 'danger' : ''}`}
                      disabled={sub.disabled}
                      onClick={() => { if (!claimFire()) return; onClose(); sub.run && sub.run(); }}>
                <span className="ctx-label">{sub.label}</span>
                {sub.shortcut && <span className="ctx-shortcut">{sub.shortcut}</span>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
