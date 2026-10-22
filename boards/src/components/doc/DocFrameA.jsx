import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon, IconWeightContext } from '../Icon.jsx';
import { Btn } from '../toolbar/Toolbar.jsx';
import { MenuButton, MenuItem, MenuSep } from '../toolbar/Menu.jsx';
import { Avatar } from '../primitives.jsx';
import { FileShareButton } from '../fileShare/FileShareButton.jsx';
import { useMessagesUi } from '../../hooks/useOpenDm.js';
import { useDocFrame } from '../../hooks/useDocFrame.js';
import { useDocStatus } from '../../hooks/useDocStatus.js';
import { useKeyboardInset } from '../../hooks/useKeyboardInset.js';
import { docSharesAllowed } from '../../lib/appHost.js';
import { isShareableDoc } from '../../lib/fileShares.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import {
  SidebarSimple, Sidebar, ChevronRight, Eye, ChatCircleText, ChatsCircle, CornersOut, X,
  CloudCheck, CloudArrowUp, CloudSlash, CloudWarning,
} from '../../lib/icons.js';
import './docLook.css';

// The one row of tools and the side panel's tabs come in the same chunk.
export { DocBarA } from './DocBarA.jsx';
export { DocCommentsTab } from './DocCommentsTab.jsx';

// The doc editor's frame in the doc look (the owner's pick of 2026-10-21:
// direction A, with C's side panel; mockups dx Main, A-dock, AC-comments,
// G-viewer): the window's header, the side panel beside the page and the
// footer under both. Lazy, like DocSurface: only the look ever loads it, so the
// doc as it is downloads none of it (DocCard.jsx, DocSurface.jsx).

// The header. The page list's toggle and the side panel's change what the
// surface under it owns, through the frame (lib/docFrame.js); the rest is the
// window's own, as in the header it replaces (DocCard.jsx DocCardOverlay).
export function DocHeadA({
  frame, card, scope, boards, canEdit = true, isPublic = false, mode, titleInputRef, focusTitle = false,
  onUpdate, onSetMode, onClose, peersOnCard = [], onJumpToPeer,
}) {
  const f = useDocFrame(frame);
  const cluster = (scope?.boardId && boards?.[scope.boardId]?.name) || null;
  const titleRef = useRef(null);
  const setTitle = (el) => {
    titleRef.current = el;
    // The window hands the focus back from here when it closes.
    if (titleInputRef) titleInputRef.current = el;
  };
  // A brand-new (untitled) doc opens with the caret in its title, as before;
  // this header comes in a beat after the window, so it does that itself.
  useEffect(() => {
    if (!focusTitle) return;
    titleRef.current?.focus();
    titleRef.current?.select?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = f.openComments;
  return (
    <IconWeightContext.Provider value="regular">
      <div className="dl-head">
        <Btn icon={SidebarSimple} label={f.railOpen ? 'Hide pages' : 'Show pages'}
             aria-expanded={f.railOpen} disabled={!f.ready}
             onClick={() => frame?.act.toggleRail()} />
        <div className="dl-crumb">
          {/* One box, so a narrow window drops both (Icon's inline display
              would outrank a class's). */}
          {cluster && (
            <span className="dl-crumb-c">
              <span className="dl-crumb-p">{cluster}</span>
              <Icon as={ChevronRight} size={12} className="dl-crumb-s" />
            </span>
          )}
          <input className="doc-card-title-input dl-title"
                 ref={setTitle}
                 aria-label="Document title"
                 value={card.title || ''}
                 placeholder="Untitled doc"
                 readOnly={!canEdit}
                 onChange={(e) => { if (canEdit) onUpdate?.({ title: e.target.value }); }} />
        </div>
        {!canEdit && (
          <span className="dl-chip"><Icon as={Eye} size={14} />View only</span>
        )}
        {peersOnCard.length > 0 && (
          <div className="dl-faces doc-card-peers">
            {peersOnCard.slice(0, 4).map((p) => (
              <button key={p.tabId || p.user?.id} type="button"
                      className="doc-card-peer"
                      aria-label={`${p.user?.name || 'Someone'}: go to where they are`}
                      title={`${p.user?.name || 'Someone'} — click to jump to their view`}
                      onClick={() => onJumpToPeer?.(p.location)}>
                <Avatar name={p.user?.name || '?'} color={p.user?.color || '#4f8df8'} size={24} />
              </button>
            ))}
            {peersOnCard.length > 4 && (
              <span className="doc-card-peers-overflow">+{peersOnCard.length - 4}</span>
            )}
          </div>
        )}
        {/* Share this doc on its own (held: docSharesAllowed), as before. */}
        {!isPublic && canEdit && scope?.boardId && docSharesAllowed() && isShareableDoc(card) && (
          <FileShareButton variant="doc" surface="doc" boardId={scope.boardId} cardId={card.id}
                           card={{ id: card.id, kind: 'doc', title: card.title || 'Untitled doc' }} />
        )}
        {!isPublic && (
          <Btn icon={ChatCircleText} label={open > 0 ? `Comments, ${open} open` : 'Comments'}
               toggle on={f.panelOpen} disabled={!f.ready}
               onClick={() => frame?.act.togglePanel('comments')} />
        )}
        {!isPublic && <MessagesBtn />}
        {/* Hidden on public: the side dock assumes the workspace around it. */}
        {isPublic ? null : mode === 'full' ? (
          <Btn icon={Sidebar} className="dl-flip" label="Dock beside the canvas" onClick={() => onSetMode('side')} />
        ) : (
          <Btn icon={CornersOut} label="Open fullscreen" onClick={() => onSetMode('full')} />
        )}
        <Btn icon={X} label="Close document" onClick={onClose} />
      </div>
    </IconWeightContext.Provider>
  );
}

// Messages, as the header before this had it (DocCard.jsx
// DocCardMessagesButton): the workspace's unread as a dot, the panel's open
// state as the button's. Nothing outside a provider (the /share viewer).
function MessagesBtn() {
  const messagesUi = useMessagesUi();
  if (!messagesUi) return null;
  const { unread = 0, open = false, toggle } = messagesUi;
  return (
    <Btn icon={ChatsCircle} label="Messages" tip={unread > 0 ? `Messages, ${unread} unread` : 'Messages'}
         toggle on={open} className="dl-msgs" onClick={() => toggle?.()}>
      {unread > 0 && <span className="dl-dot" aria-hidden="true" />}
    </Btn>
  );
}

// C's side panel, at the page's right: its tabs, a segmented pair (Elements
// first for a screenplay). What each tab holds is the surface's (`children`,
// by tab: a node, or a function of whether its tab is the one showing). A
// tab once shown stays in the page while another shows, so what was typed in
// it (a reply, a search) is there to come back to. Escape in the panel goes
// back to the text (`onEscape`) and leaves the panel open.
//
// On a phone it is a sheet from the bottom (`sheet`; mockup C-phone2), over
// the doc, which dims: a tap on the doc, its grab, a drag down or Escape puts
// it away (`onClose`). It sits above the on-screen keyboard, and takes the
// focus when it opens, since it covers what had it. It lies in the window
// (`host`), over the header too, since the surface is a layer of its own.
const TAB_NAMES = { elements: 'Elements', comments: 'Comments', find: 'Find' };

export function DocSidePanel({ tab, onTab, screenplay = false, openComments = 0, onEscape, sheet = false, host = null, onClose, children }) {
  const id = useId();
  const tabs = screenplay ? ['elements', 'comments', 'find'] : ['comments', 'find'];
  const current = tabs.includes(tab) ? tab : 'comments';
  const listRef = useRef(null);
  const asideRef = useRef(null);
  const seen = useRef(new Set()).current;
  seen.add(current);
  const kb = useKeyboardInset(sheet);
  const grab = useSheetGrab(asideRef, onClose);
  useEffect(() => {
    if (sheet) listRef.current?.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [sheet]);
  // The tabs' keys (WAI-ARIA tabs): ← → between them, Home and End to either
  // end; the one landed on is picked.
  const onKeyDown = (e) => {
    const at = tabs.indexOf(current);
    const to = e.key === 'ArrowRight' ? (at + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (at - 1 + tabs.length) % tabs.length
        : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (to == null) return;
    e.preventDefault();
    onTab(tabs[to]);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-tab="${tabs[to]}"]`)?.focus());
  };
  // Not a key from the mention picker or another layer portaled out of here,
  // whose own Escape is theirs.
  const onPanelKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || isComposingKey(e)) return;
    if (!e.currentTarget.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (sheet) onClose?.();
    onEscape?.();
  };
  const panel = (
    <aside ref={asideRef} className={`dl-panel${sheet ? ' is-sheet' : ''}`} aria-label="Comments and find"
           style={sheet ? { '--dl-kb': `${kb}px` } : undefined} onKeyDown={onPanelKey}>
      {sheet && (
        <button type="button" className="dl-sheet-grab" aria-label="Close panel" {...grab}>
          <span aria-hidden="true" />
        </button>
      )}
      <div className="dl-tabs">
        <div ref={listRef} className="dl-seg" role="tablist" aria-label="Side panel" onKeyDown={onKeyDown}>
          {tabs.map((t) => (
            <button key={t} type="button" role="tab" data-tab={t}
                    id={`${id}-${t}-tab`} aria-controls={`${id}-${t}`}
                    aria-selected={t === current} tabIndex={t === current ? 0 : -1}
                    onClick={() => onTab(t)}>
              {TAB_NAMES[t]}
              {t === 'comments' && openComments > 0 && <span className="dl-cnt">{openComments}</span>}
            </button>
          ))}
        </div>
      </div>
      {tabs.filter((t) => seen.has(t)).map((t) => {
        const body = children?.[t];
        return (
          <div key={t} className={`dl-panel-body dl-panel-${t}`} role="tabpanel" id={`${id}-${t}`}
               aria-labelledby={`${id}-${t}-tab`} hidden={t !== current}>
            {typeof body === 'function' ? body(t === current) : body ?? null}
          </div>
        );
      })}
    </aside>
  );
  if (!sheet) return panel;
  const over = (
    <>
      <div className="dl-sheet-scrim" aria-hidden="true" onClick={() => onClose?.()} />
      {panel}
    </>
  );
  return host ? createPortal(over, host) : over;
}

// A sheet's grab: a tap puts the sheet away, and a drag down takes the sheet
// with it, putting it away past 64px and back up short of that.
function useSheetGrab(sheetRef, onClose) {
  const drag = useRef(null);
  const follow = (dy) => {
    const el = sheetRef.current;
    if (!el) return;
    el.style.transform = dy ? `translateY(${dy}px)` : '';
    el.style.transition = dy ? 'none' : '';
  };
  return {
    onPointerDown: (e) => {
      drag.current = { id: e.pointerId, y: e.clientY, dy: 0 };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      d.dy = Math.max(0, e.clientY - d.y);
      follow(d.dy);
    },
    onPointerUp: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      follow(0);
      drag.current = d.dy > 6 ? { moved: true } : null;
      if (d.dy > 64) onClose?.();
    },
    onPointerCancel: () => { drag.current = null; follow(0); },
    // The click a drag ends with isn't a tap.
    onClick: () => {
      const moved = drag.current?.moved;
      drag.current = null;
      if (!moved) onClose?.();
    },
  };
}

// The footer, across the window under the page list, the page and the panel:
// the save state with its cloud, the words, and the zoom as a menu.
const ZOOMS = [50, 75, 100, 125, 150, 200];

export function DocFootA({
  editor, boardId = null, showSave = true,
  zoom = 1, fitMode = false, fitEligible = false, onZoom, onZoomIn, onZoomOut, onZoomReset,
}) {
  const { words, online, saving, saveError, savedLabel } = useDocStatus({ editor, boardId });
  const cloud = !online ? CloudSlash : saveError ? CloudWarning : saving ? CloudArrowUp : CloudCheck;
  const tone = !online ? ' is-offline' : saveError ? ' is-error' : saving ? ' is-saving' : '';
  const pct = Math.round(zoom * 100);
  return (
    <IconWeightContext.Provider value="regular">
      <div className="dl-foot">
        {showSave && (
          <span className={`dl-foot-status${tone}`}><Icon as={cloud} size={15} />{savedLabel}</span>
        )}
        <span className="dl-sp" />
        <span className="dl-foot-words">{words.toLocaleString()} {words === 1 ? 'word' : 'words'}</span>
        <MenuButton text={`${pct}%`} label={`Zoom, ${pct}%`} menuLabel="Zoom" caret
                    className="dl-foot-zoom" side="above" align="end">
          <MenuItem label="Zoom in" keys="Mod+=" onSelect={onZoomIn} />
          <MenuItem label="Zoom out" keys="Mod+-" onSelect={onZoomOut} />
          {fitEligible ? (
            <MenuItem label="Fit to width" keys="Mod+0" checked={fitMode} onSelect={onZoomReset} />
          ) : (
            <MenuItem label="Actual size" keys="Mod+0" onSelect={onZoomReset} />
          )}
          <MenuSep />
          {ZOOMS.map((z) => (
            <MenuItem key={z} label={`${z}%`} radio checked={!fitMode && pct === z} onSelect={() => onZoom(z / 100)} />
          ))}
        </MenuButton>
      </div>
    </IconWeightContext.Provider>
  );
}
