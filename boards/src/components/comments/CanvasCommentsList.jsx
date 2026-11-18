import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { MessageCircle, MessageCircleOff, CheckCircle, X } from '../../lib/icons.js';
import { threadSummaryLine } from '../../lib/commentTime.js';
import { commentTimeWords } from '../../lib/commentTime.js';
import { subscribeMinute, minuteNow } from '../../lib/minuteTick.js';
import { threadAnchor, threadForMe } from '../../lib/commentPins.js';
import { tabForKey } from '../../lib/commentCardPlace.js';
import { useCanvasThreads, useAnchorBoxes } from './canvasThreads.js';
import { useBackLayer } from '../../hooks/useBackLayer.js';
import { describeAnchor } from './CommentAbout.jsx';
import { CommentFace } from './CommentFace.jsx';
import { shownAuthor } from '../../lib/commentAuthor.js';
import { t as tr, msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';
import './canvasComments.css';

// Module scope, so message descriptors: each is read with tr(…) as it is drawn.
const TABS = [
  { id: 'open', label: msg({ message: 'Open', context: 'status' }) },
  { id: 'resolved', label: msg`Resolved` },
  { id: 'mine', label: msg`For you` },
];
const EMPTY = {
  open: [msg`No open comments`, msg`Right-click a card or the canvas to add one.`, msg`Press and hold a card or the canvas to add one.`],
  resolved: [msg`Nothing resolved yet`, msg`Conversations you resolve are kept here.`],
  mine: [msg`Nothing waiting on you`, msg`Mentions and replies to you show up here.`],
};

// The list behind the comments island (CanvasCommentsIsland.jsx, which draws
// the island itself and mounts this while the list is open): every
// conversation on this cluster, by Open / Resolved / For you. Pointing at a
// row lights its card; pressing one goes to it and opens it. The switch at
// the bottom only changes what this person sees (their browser remembers it).
// It arrives with the other comment parts (commentParts.js).
//
//   ui            the comment UI store (listOpen, tab, hoverId, openId)
//   comments, currentUser, viewsByRootId   the rows, me, when I last looked
//   btnRef        the island's button: the list sits under it, and focus
//                 goes back to it
//   cards, groupBox, groupById, boards, boardId, workspaceId   to name what
//                 each conversation is on
//   visible, onVisibleChange(bool)   my "Show comments on the canvas" switch
//   onGoTo(anchor)   bring a conversation's place into view
//   sheet            on a phone: the list is a sheet from the bottom
export function CanvasCommentsList({
  ui, comments, currentUser, viewsByRootId, btnRef, cards, groupBox, groupById, boards, boardId, workspaceId,
  visible = true, onVisibleChange, onGoTo, sheet = false, failed = false,
}) {
  const threads = useCanvasThreads({ comments, currentUser, viewsByRootId });
  const { byId, resolvers } = useAnchorBoxes(cards, groupBox);
  const meId = currentUser?.id || null;
  // { open, resolved, mine }, newest first. The island's count is the length
  // of `open` (lib/commentCanvas.js openCommentTally counts the same rows).
  const lists = useMemo(() => {
    // a conversation whose card is gone has nowhere to be: it is not listed
    const here = threads.filter((t) => threadAnchor(t, resolvers));
    const newest = (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
    const open = here.filter((t) => !t.resolved).sort(newest);
    return {
      open,
      resolved: here.filter((t) => t.resolved).sort(newest),
      mine: open.filter((t) => threadForMe(t, meId)),
    };
  }, [threads, resolvers, meId]);
  const state = useSyncExternalStore(ui.subscribe, ui.get, ui.get);
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
  const popRef = useRef(null);
  const [at, setAt] = useState(null);
  const tabsId = useId();
  const tab = TABS.some((t) => t.id === state.tab) ? state.tab : 'open';
  const rows = lists[tab];
  const listOpen = true;   // mounted only while the list is open

  // under the island, wherever the layout has put it
  useLayoutEffect(() => {
    if (!listOpen || sheet) return undefined;
    const fit = () => {
      const b = btnRef.current;
      if (b) setAt({ left: b.offsetLeft, top: b.offsetTop + b.offsetHeight + 8 });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [listOpen, sheet]);
  // focus goes into the list once it is placed (a hidden box cannot take it),
  // so keys typed after opening it land in the list, not on the canvas
  const placed = sheet || !!at;
  useEffect(() => {
    if (listOpen && placed) popRef.current?.focus({ preventScroll: true });
  }, [listOpen, placed]);
  useEffect(() => {
    if (!listOpen) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.cmt-list, .cmt-list-scrim, .cnv-comments-eye, .cmt-canvas-card, .cmt-sheet-host, .cmt-sheet-scrim, .cmt-pop, .cmt-pin, .toast, .modal-bg, .modal')) return;
      ui.set({ listOpen: false, hoverId: null });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [listOpen, ui]);
  // a wheel over the list scrolls the list, not the canvas under it
  useEffect(() => {
    const el = popRef.current;
    if (!listOpen || !el) return undefined;
    // Ctrl-wheel / a trackpad pinch would zoom the whole browser page here
    // (the canvas never sees it), so it is cancelled; plain wheel scrolls as before.
    const keep = (e) => { e.stopPropagation(); if (e.ctrlKey) e.preventDefault(); };
    el.addEventListener('wheel', keep, { passive: false });
    return () => el.removeEventListener('wheel', keep);
  }, [listOpen, at, sheet]);

  const closeList = (refocus) => {
    ui.set({ listOpen: false, hoverId: null });
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  };
  // As a sheet it lies over the screen: the phone's Back closes it and the
  // cluster stays (hooks/useBackLayer). Under the island it is not a layer.
  useBackLayer(listOpen && sheet, () => closeList(false));
  const stop = {
    onPointerDown: (e) => e.stopPropagation(),
    onDoubleClick: (e) => e.stopPropagation(),
    onContextMenu: (e) => e.stopPropagation(),
  };
  // on a phone: a sheet over a scrim, outside the canvas (so nothing clips it)
  const wrap = (node) => (sheet
    ? createPortal(<><div className="cmt-list-scrim" {...stop} onClick={() => closeList(false)} />{node}</>, document.body)
    : node);

  return wrap(
        <div ref={popRef} className={`cmt-list${sheet ? ' cmt-list--sheet' : ''}`} role="dialog" aria-label={tr`Comments`} tabIndex={-1}
             aria-modal={sheet || undefined}
             style={sheet ? undefined : (at ? { left: at.left, top: at.top } : { visibility: 'hidden' })}
             {...stop}
             onKeyDown={(e) => {
               if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); closeList(true); }
             }}>
          {sheet && <div className="cmt-grab" aria-hidden="true" />}
          <div className="cmt-list-head">
            <h2 className="cmt-list-title"><Trans>Comments</Trans></h2>
            <button type="button" className="cmt-ib" aria-label={tr`Close`} onClick={() => closeList(true)}>
              <Icon as={X} size={16} weight="regular" />
            </button>
          </div>
          <div className="cmt-list-tabs" role="tablist" aria-label={tr`Which comments`}>
            {/* The tabs pattern: one tab stop (the chosen tab); Left / Right /
                Home / End move along and choose; each tab names the panel. */}
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" className="cmt-list-tab"
                      id={`${tabsId}-tab-${t.id}`}
                      aria-selected={tab === t.id}
                      aria-controls={`${tabsId}-panel`}
                      tabIndex={tab === t.id ? 0 : -1}
                      onKeyDown={(e) => {
                        const to = tabForKey(TABS.map((x) => x.id), t.id, e.key);
                        if (!to) return;
                        e.preventDefault();
                        e.stopPropagation();
                        ui.set({ tab: to, hoverId: null });
                        document.getElementById(`${tabsId}-tab-${to}`)?.focus({ preventScroll: true });
                      }}
                      onClick={() => ui.set({ tab: t.id, hoverId: null })}>
                {tr(t.label)} <span className="cmt-list-tab-n">{lists[t.id].length}</span>
              </button>
            ))}
          </div>
          <div className="cmt-list-rows" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${tab}`}>
            {/* the comments could not be fetched: not "No open comments" */}
            {rows.length === 0 && failed && (
              <div className="cmt-list-empty" role="status">
                <Icon as={MessageCircle} size={22} weight="regular" />
                <span style={{ display: 'block', marginTop: 8 }}>{tr`Comments couldn't load. Check your connection.`}</span>
              </div>
            )}
            {rows.length === 0 && !failed && (
              <div className="cmt-list-empty">
                <Icon as={tab === 'resolved' ? CheckCircle : MessageCircle} size={22} weight="regular" />
                <b>{tr(EMPTY[tab][0])}</b>
                {tr((sheet && EMPTY[tab][2]) || EMPTY[tab][1])}
              </div>
            )}
            {rows.map((t) => {
              const about = describeAnchor(t.root.meta, { cardById: byId, groupById, boardId, workspaceId, boards });
              const replies = t.replies.some((r) => !r.deleted);
              const where = about.place || about.title;
              return (
                <button key={t.id} type="button"
                        className={`cmt-list-row${state.openId === t.id ? ' is-open' : ''}`}
                        onPointerEnter={(e) => { if (e.pointerType === 'mouse') ui.set({ hoverId: t.id }); }}
                        onPointerLeave={() => ui.set({ hoverId: null })}
                        onFocus={() => ui.set({ hoverId: t.id })}
                        onBlur={() => ui.set({ hoverId: null })}
                        onClick={() => {
                          onGoTo?.(threadAnchor(t, resolvers));
                          // on a phone the conversation takes the list's place
                          ui.set({ openId: t.id, draft: null, hoverId: null, flashRowId: null, ...(sheet ? { listOpen: false } : null) });
                        }}>
                  <span className="cmt-list-thumb" aria-hidden="true">{about.thumb}</span>
                  <span style={{ minWidth: 0, display: 'block' }}>
                    <span className="cmt-list-top">
                      <CommentFace name={shownAuthor(t.root.authorName)} userId={t.root.authorId} color={t.root.authorColor} size={16} />
                      <span className="cmt-list-who">{shownAuthor(t.root.authorName)}</span>
                      {t.root.createdAt != null && <span className="cmt-list-when">{commentTimeWords(t.root.createdAt, now)}</span>}
                      {t.unread && <span className="cmt-list-new" role="img" aria-label={tr`Unread`} />}
                    </span>
                    <span className="cmt-list-text">{t.root.deleted ? tr`This comment was deleted.` : t.root.body}</span>
                    <span className="cmt-list-foot" style={{ display: 'block' }}>
                      {replies ? `${where} · ${threadSummaryLine(t, now)}` : where}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <label className="cmt-list-switch">
            <Icon as={visible ? MessageCircle : MessageCircleOff} size={16} weight="regular" />
            <span>
              <Trans>Show comments on the canvas</Trans>
              <small><Trans>Only changes what you see</Trans></small>
            </span>
            <button type="button" role="switch" className="cmt-sw" aria-checked={visible}
                    aria-label={tr`Show comments on the canvas`}
                    onClick={() => onVisibleChange?.(!visible)} />
          </label>
        </div>,
  );
}
