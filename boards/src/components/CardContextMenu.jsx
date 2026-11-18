// The one right-click menu (a card's, the canvas's, a cluster's...): rows with
// icons, hints, asides, shortcuts and checks, dividers, a quick row of icon
// buttons, and nested submenus (item.submenu = [...]) that fly out beside it.
// BackgroundContextMenu.jsx is a thin wrapper over this. The row shape and the
// props are written up in ctxMenuParts.jsx and the step-2 spec.
//
// On a phone's shell it is a bottom sheet instead (shell/Sheet.jsx): a header
// from `preview`, the quick row as labelled tiles, the list in a .ctx-menu.is-sheet
// whose submenus step in.
//
// Flyouts render through a body portal so position:fixed actually pins to the
// viewport: the parent .ctx-menu has a CSS transform (open animation), which
// would otherwise turn it into the containing block for any fixed descendant.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase.js';
import { useMenuPlacement, useMoreBelow } from '../lib/ctxMenuFit.js';
import {
  CtxContext, CtxList, CtxQuick, CtxSheetHeader, CtxStepRow, CtxStepView, CtxSubmenu,
  handleMenuKeys, menuHasIcons, useCtxStep,
} from './ctxMenuParts.jsx';
import { Sheet } from './shell/Sheet.jsx';
import { isComposingKey } from '../lib/composerKeys.js';
import { haptic } from '../lib/haptics.js';
import { useBackLayer } from '../hooks/useBackLayer.js';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { shellOf } from '../lib/deviceShell.js';
import { t, plural } from '@lingui/core/macro';

// "Linked from N" counts, per card, for 60 s: a reopen shows the row at once.
const LINKED_TTL = 60000;
const linkedCache = new Map(); // `${boardId}:${cardId}` -> { n, at }
function linkedCached(key) {
  const hit = key && linkedCache.get(key);
  return hit && Date.now() - hit.at < LINKED_TTL ? hit.n : null;
}

export function CardContextMenu({
  open, x, y, above = false, items, onClose, workspaceId, boardId, card,
  title, quick, label, preview, root = 'card', byKey = false, returnFocus, anchor,
}) {
  const { mobileShell } = shellOf(useBreakpoint());
  const sheet = mobileShell;
  // Single-flight guard: one action per menu open. The menu closes on the
  // first click, but a double-click can land two events before unmount —
  // which used to double-fire async actions (double delete/duplicate).
  const firedRef = useRef(false);
  useEffect(() => { if (open) firedRef.current = false; }, [open]);
  // Under a finger, the phone's Back closes the popover (a sheet has its own layer).
  useBackLayer(open && !sheet, onClose);
  const claimFire = () => {
    if (firedRef.current) return false;
    firedRef.current = true;
    return true;
  };

  // Where the focus goes back to on Esc, Tab and a chosen row.
  const returnRef = useRef(null);
  const refocus = () => {
    const el = returnRef.current;
    if (el && el.isConnected) { try { el.focus({ preventScroll: true }); } catch (_) { /* noop */ } }
  };
  const closeAll = () => { refocus(); onClose(); };
  const choose = (row) => {
    if (row.disabled) return;
    if (!claimFire()) return;
    if (row.danger) haptic('delete');
    refocus();
    onClose();
    row.run && row.run();
  };

  // Count from BOTH manual entity_links targeting the card AND text
  // occurrences of its name across docs / messages / other cards. Drives the
  // "Linked from N places" row, shown only when N > 0.
  const linkKey = card?.id && boardId ? `${boardId}:${card.id}` : null;
  const [linked, setLinked] = useState(null); // { key, n }
  const cachedN = linkedCached(linkKey);
  const linkedN = linked && linked.key === linkKey ? linked.n : cachedN;
  // Fetched when the menu OPENS, not whenever a card was once right-clicked
  // (the menu stays mounted); skipped while the card's last count is fresh.
  useEffect(() => {
    if (!open || !supabase || !workspaceId || !boardId || !card?.id) return;
    if (linkedCached(linkKey) != null) return;
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
      linkedCache.set(linkKey, { n, at: Date.now() });
      if (!cancelled) setLinked({ key: linkKey, n });
    })();
    return () => { cancelled = true; };
  }, [open, workspaceId, boardId, card?.id, card?.title, card?.name, linkKey]);

  // The list: the caller's rows, then "Linked from N places" as the last row
  // when N > 0 (a caller's { backlinks: true } marker is only a marker).
  // Icons or not is the caller's rows' call; the Linked row arriving late
  // must not shift every label.
  const iconsOn = menuHasIcons(items);
  const linkedRow = card?.id && linkedN > 0 ? {
    id: '__linked',
    icon: iconsOn ? 'ArrowBendUpLeft' : undefined,
    label: plural(linkedN, { one: 'Linked from # place', other: 'Linked from # places' }),
    run: () => {
      document.dispatchEvent(new CustomEvent('soleil-open-backlinks', {
        detail: {
          ref: { kind: 'card', boardId, cardId: card.id },
          name: card.title || card.name || null,
        },
      }));
    },
  } : null;
  const listItems = [...(items || []).filter((it) => it && !it.backlinks), ...(linkedRow ? [linkedRow] : [])];

  // A submenu stepped into the menu's own box (a phone's sheet, or no room beside).
  const menuRef = useRef(null);
  const step = useCtxStep(open, listItems, menuRef);
  const stepBackRef = useRef(step.back);
  stepBackRef.current = step.back;
  const closeAllRef = useRef(closeAll);
  closeAllRef.current = closeAll;
  // The control that opened the menu, when its own click toggles it: a press
  // on it isn't outside (closing there made that click open it again).
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;

  useEffect(() => {
    if (!open) return;
    // A sheet's scrim, grip and header are Sheet's: it closes itself.
    const onDocDown = (e) => {
      // Flyouts portal to <body> with the same .ctx-menu class, so a class
      // check (not a ref contains) keeps a flyout tap from closing the menu.
      const inside = e.target.closest?.('.ctx-menu, .ctx-quick-tip');
      if (!inside && !anchorRef.current?.contains?.(e.target)) onClose();
    };
    // Escape: a search field with text clears first (its own handler); in a
    // stepped-in submenu it goes back a level first; then it closes the whole
    // menu, every flyout with it, the focus going back to where it was.
    const onKey = (e) => {
      if (isComposingKey(e) || e.key !== 'Escape') return;
      const tgt = e.target;
      if (tgt?.tagName === 'INPUT' && tgt.value && tgt.closest?.('.ctx-menu')) return;
      if (stepBackRef.current()) { e.preventDefault(); e.stopPropagation(); return; }
      // Claimed, so a layer below that checks defaultPrevented (a doc, the Messages panel) stays open.
      if (!sheet) { e.preventDefault(); closeAllRef.current(); }
    };
    // Capture phase + both pointer and mouse so a card's stopPropagation can't
    // swallow the outside-tap on touch (pointerdown fires before mousedown).
    if (!sheet) {
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('mousedown', onDocDown, true);
    }
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('mousedown', onDocDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose, sheet]);

  // Measured and placed after every render (lib/ctxMenuFit.js), hidden until
  // placed. `above`: opened from the selection bar's ⋯, it ends at `y`.
  // Stepped in, the submenu starts where the menu did.
  const stepped = !!step.item;
  useMenuPlacement(menuRef, open && !sheet, {
    x: stepped ? step.left : x,
    y: stepped && !above ? step.top : y,
    above,
  });

  // Focus: from the keys the first stop, else the menu itself (↓ → first stop,
  // ↑ → last row). The opener is remembered for the way back.
  useLayoutEffect(() => {
    if (!open) { returnRef.current = null; return; }
    const a = document.activeElement;
    // returnFocus false: it goes back nowhere (a click opened the menu from a
    // control that must not keep the focus).
    returnRef.current = returnFocus === false ? null : (returnFocus
      || (a && a !== document.body && !a.closest?.('.ctx-menu') && a.isConnected ? a : null));
    const el = menuRef.current;
    if (!el) return;
    const place = () => {
      if (byKey) (el.querySelector('button.ctx-quick-btn, button.ctx-item') || el).focus({ preventScroll: true });
      else el.focus({ preventScroll: true });
    };
    if (!sheet) { place(); return undefined; }
    // The sheet puts the focus on its first control in the next frame; ours is
    // queued first, so the list itself holds it and no row looks focused.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useMoreBelow(menuRef, open && sheet);

  if (!open) return null;

  const rows = stepped ? step.item.submenu : items;
  const noIcons = !menuHasIcons(rows);
  const ariaLabel = stepped ? step.item.label : (label || card?.title || card?.name || t`Menu`);
  const hasQuick = !!quick && quick.length > 0;
  const ctx = { choose, closeAll: sheet ? null : closeAll, stepIn: step.stepIn, root };
  const stepView = stepped
    ? <CtxStepView item={step.item} parent={step.parent} root={root} onBack={step.back} />
    : null;
  const keyDown = (e) => handleMenuKeys(e, { closeAll: sheet ? null : closeAll, back: step.back });

  if (sheet) {
    const nest = (sub, key, icons) => <CtxStepRow key={key} it={sub} hasIcons={icons} />;
    return (
      <Sheet open onClose={onClose} className="ctx-sheet-root">
        <CtxContext.Provider value={ctx}>
          <div className="ctx-sheet-wrap" onKeyDown={keyDown}>
            {!stepped && <CtxSheetHeader preview={preview} title={title} />}
            {!stepped && hasQuick && <CtxQuick quick={quick} tiles />}
            <div ref={menuRef} className={`ctx-menu is-sheet${noIcons ? ' no-icons' : ''}${stepped ? ' is-step' : ' is-scrollable'}`}
                 role="menu" aria-label={ariaLabel} tabIndex={-1}>
              {stepView || <CtxList rows={listItems} hasIcons={iconsOn} nest={nest} />}
            </div>
          </div>
        </CtxContext.Provider>
      </Sheet>
    );
  }

  const nest = (sub, key, icons) => <CtxSubmenu key={key} item={sub} hasIcons={icons} canStep />;
  const cls = `ctx-menu ${stepped ? 'is-step' : 'is-scrollable'}${noIcons ? ' no-icons' : ''}${hasQuick && !stepped ? ' has-quick' : ''}`;
  return (
    <CtxContext.Provider value={ctx}>
      <div ref={menuRef} className={cls} role="menu" aria-label={ariaLabel} tabIndex={-1}
           style={stepped ? { width: step.width } : undefined}
           onKeyDown={keyDown}>
        {stepView || (
          <>
            {title && <div className="ctx-title">{title}</div>}
            {hasQuick && (
              <>
                <CtxQuick quick={quick} />
                {listItems.length > 0 && <div className="ctx-divider" role="separator" />}
              </>
            )}
            <CtxList rows={listItems} hasIcons={iconsOn} nest={nest} />
          </>
        )}
      </div>
    </CtxContext.Provider>
  );
}
