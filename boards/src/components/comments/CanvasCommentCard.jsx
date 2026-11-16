import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useFeedback } from '../AppFeedback.jsx';
import { useKeyboardInset } from '../../hooks/useKeyboardInset.js';
import { useBackLayer } from '../../hooks/useBackLayer.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { addComment, updateComment, deleteComment, restoreComment, getCommentState } from '../../lib/commentsApi.js';
import { commentLinkUrl } from '../../lib/commentLinkUrl.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { undoToast } from '../../lib/undoToast.js';
import { commentPowers, stayedResolved, REPLY_NOT_REOPENED } from '../../lib/commentRules.js';
import { useCommentPeople } from './commentPeople.js';
import { commentDraftKey } from '../../lib/commentDraft.js';
import {
  threadAnchor, draftTargetId, draftThread, threadNewestMs,
} from '../../lib/commentPins.js';
import {
  anchorScreenRect, placeBeside, pinScreenRect,
} from '../../lib/commentCardPlace.js';
import { rescanParked } from '../../lib/commentParked.js';
import { useCanvasThreads, useAnchorBoxes } from './canvasThreads.js';
import { describeAnchor } from './CommentAbout.jsx';
import { CommentCard } from './CommentCard.jsx';
import { shownError } from '../../lib/errorWords.js';
import { openProfile } from '../../lib/openProfile.js';
import { t as tr } from '@lingui/core/macro';
import './commentsLook.css';
import './canvasComments.css';

// The open conversation on the canvas. It arrives with the other comment
// parts the first time one is needed (commentParts.js, through
// commentPartsLazy.jsx); the canvas itself carries only the pins.

// Who "@" offers (commentPeople.js): one list for the canvas, a doc and a
// note, asked for once per workspace, cluster and role.
export { useCommentPeople };

// ── The open conversation ───────────────────────────────────────────────────
// One card, beside what it is about: to its right, to its left when the right
// has no room, always inside the canvas view. It follows the canvas as it
// moves through `view` (left / top written straight to the element). On a
// phone or under a finger it is a sheet from the bottom.
//
//   sheet         true on a phone / coarse pointer
//   canEdit       may edit the cluster (so may resolve and delete others')
//   upsertLocally(row), removeLocally(id)   useCanvasComments' own
//   markViewed(rootId, newestMs)
//   loaded        this cluster's comments have come back
//   peopleWorkspaceId   the workspace this cluster lives in (who "@" offers)
export function CanvasCommentCard({
  comments, currentUser, viewsByRootId, ui, cards, groupBox, groupById, boards, view,
  boardId, workspaceId, peopleWorkspaceId = null, userId, canEdit = false, sheet = false,
  upsertLocally, removeLocally, markViewed, loaded = false,
}) {
  const feedback = useFeedback();
  const state = useSyncExternalStore(ui.subscribe, ui.get, ui.get);
  const threads = useCanvasThreads({ comments, currentUser, viewsByRootId });
  const { byId, resolvers } = useAnchorBoxes(cards, groupBox);
  const hostRef = useRef(null);
  const inset = useKeyboardInset(sheet && (!!state.openId || !!state.draft));

  const draft = state.draft;
  const found = !draft && state.openId ? threads.find((t) => t.id === state.openId) || null : null;
  const openKey = draft ? draftTargetId(draft.anchor) : (found ? found.id : null);
  const people = useCommentPeople({
    workspaceId: peopleWorkspaceId || workspaceId, boardId, comments, meId: userId, canEdit, enabled: !!openKey,
  });

  // A comment left with words in it keeps a pin where it was started; the
  // box keeps its words a moment after the last key and on its way out.
  // (lib/commentParked.js: the pins look too, as they arrive and as a
  // comment is put down)
  const rescanSoon = useCallback(() => {
    const rescan = () => rescanParked(ui, userId, boardId);
    rescan(); setTimeout(rescan, 0); setTimeout(rescan, 150);
  }, [ui, userId, boardId]);

  // The dot inside the card marks what was new when it opened; opening it is
  // looking at it, and so is a reply that arrives while it is open.
  const unreadAtOpen = useRef({ id: null, unread: false });
  if (found && unreadAtOpen.current.id !== found.id) unreadAtOpen.current = { id: found.id, unread: !!found.unread };
  if (!found && !draft) unreadAtOpen.current = { id: null, unread: false };
  const rowCount = found ? 1 + found.replies.length : 0;
  const foundId = found?.id || null;
  // dated no earlier than its newest row (a device clock may run slow)
  const newestMs = found ? threadNewestMs(found) : null;
  useEffect(() => {
    if (foundId && userId) markViewed?.(foundId, newestMs);
  }, [foundId, rowCount, newestMs, userId, markViewed]);

  // Opened from the keyboard: its card takes the caret as it shows
  // (CommentCard's takeFocus), once.
  const focusCard = state.focusCard;
  useEffect(() => {
    if (focusCard && (foundId === focusCard || state.openId !== focusCard)) ui.set({ focusCard: null });
  }, [focusCard, foundId, state.openId, ui]);

  // The open conversation is gone (someone else deleted it, or its rows left
  // on a refetch): it is no longer open, so it does not spring back open if
  // the row returns. A moment's grace, for a row just written here that the
  // list has not taken in yet.
  const openId = state.openId;
  const openMissing = !!openId && loaded && !threads.some((t) => t.id === openId);
  useEffect(() => {
    if (!openMissing) return undefined;
    const t = setTimeout(() => {
      ui.set((s) => (s.openId === openId ? { openId: null, flashRowId: null } : null));
    }, 600);
    return () => clearTimeout(t);
  }, [openMissing, openId, ui]);

  const thread = found ? { ...found, unread: unreadAtOpen.current.unread } : null;
  const anchor = threadAnchor(thread || draftThread(draft?.anchor), resolvers);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const listOpenRef = useRef(state.listOpen);
  listOpenRef.current = state.listOpen;

  const place = useCallback(() => {
    const el = hostRef.current;
    const v = view?.get?.();
    if (!el || !v) return;
    const rect = anchorScreenRect(anchorRef.current, v.pan, v.zoom);
    const p = placeBeside({
      rect, w: el.offsetWidth, h: el.offsetHeight, vw: v.w, vh: v.h, margin: 12,
      // the pin pokes 20px out of its card's corner: stand clear of it
      gapRight: rect?.pin ? 10 : 28, gapLeft: rect?.pin ? 10 : 14,
      fallback: { left: listOpenRef.current ? 368 : 14, top: 58 },
      // kept inside the view it must not land on its own pin (or the pin of
      // the comment being started): the other side, then below, then above
      avoid: pinScreenRect(ui.get().openPin, v.pan, v.zoom),
    });
    el.style.left = `${Math.round(p.left)}px`;
    el.style.top = `${Math.round(p.top)}px`;
    el.classList.remove('is-placing');
  }, [view, ui]);
  const showing = !!openKey && !sheet;
  useLayoutEffect(() => { if (showing) place(); });
  useEffect(() => {
    if (!showing) return undefined;
    const off = view?.subscribe?.(place);
    const el = hostRef.current;
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(place) : null;
    ro?.observe(el);
    window.addEventListener('resize', place);
    // a wheel over the card scrolls the card, not the canvas under it
    const keep = (e) => e.stopPropagation();
    el?.addEventListener('wheel', keep, { passive: true });
    return () => { off?.(); ro?.disconnect(); window.removeEventListener('resize', place); el?.removeEventListener('wheel', keep); };
  }, [showing, openKey, place, view]);

  // `back`: the caret returns to the pin (Esc and the close button; not a
  // press somewhere else, which has its own target).
  const close = useCallback((back) => {
    const was = ui.get();
    ui.set({ openId: null, draft: null, flashRowId: null, focusCard: null });
    if (was.draft) rescanSoon();
    if (back === true && was.openId) {
      requestAnimationFrame(() => {
        const pin = [...document.querySelectorAll('[data-cmt-pin]')].find((el) => el.getAttribute('data-cmt-pin') === was.openId);
        pin?.focus({ preventScroll: true });
      });
    }
  }, [ui, rescanSoon]);
  const closeBack = useCallback(() => close(true), [close]);

  // A reply a link pointed at is brought into view and lit for a moment.
  const flashId = state.flashRowId;
  useEffect(() => {
    if (!flashId || !foundId) return undefined;
    const host = sheet ? document.querySelector('.cmt-sheet-host') : hostRef.current;
    const el = [...(host?.querySelectorAll('[data-cmt-row]') || [])].find((n) => n.getAttribute('data-cmt-row') === flashId);
    if (!el) return undefined;
    const box = el.closest('.cmt-scroll');
    if (box) box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 8);
    el.classList.add('is-flash');
    const t = setTimeout(() => { el.classList.remove('is-flash'); ui.set({ flashRowId: null }); }, 2000);
    return () => { clearTimeout(t); el.classList.remove('is-flash'); };
  }, [flashId, foundId, sheet, ui]);
  // A press anywhere else puts the card away (unsent words are kept), and so
  // does Esc when the caret is not in the card (the card hears its own).
  useEffect(() => {
    if (!openKey) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.cmt-canvas-card, .cmt-sheet-host, .cmt-sheet-scrim, .cmt-pop, .cmt-pin, .cmt-list, .cnv-comments-eye, .toast, .modal-bg, .modal')) return;
      close();
    };
    const onKey = (e) => {
      if (isComposingKey(e)) return;
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, [contenteditable="true"], .cmt-pop, .modal')) return;
      close(true);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [openKey, close]);
  // The sheet lies over the whole screen: under a finger the phone's Back
  // closes it and the cluster stays (hooks/useBackLayer). One layer for the
  // sheet, whichever conversation or new comment it holds; unsent words are
  // kept, as on any close. The card beside its pin is not a layer.
  useBackLayer(sheet && !!openKey && (!!thread || !!draft), close);

  if (!openKey || (!thread && !draft)) return null;

  const me = userId ? { id: userId, name: currentUser?.name || 'You' } : null;
  const meta = thread ? thread.root.meta : draftThread(draft.anchor).root.meta;
  const about = describeAnchor(meta, { cardById: byId, groupById, boardId, workspaceId, boards });
  const powers = (row) => commentPowers({ me, row, thread, canRead: !!userId, canWrite: !!canEdit });

  const anchorOf = (m) => {
    if (m.anchorKind === 'point') return { kind: 'point', x: m.anchorX, y: m.anchorY };
    if (m.anchorKind === 'board') return { kind: 'board' };
    return { kind: m.anchorKind === 'group' ? 'group' : 'card', id: m.anchorId };
  };

  const onStart = async ({ body, mentions }) => {
    const row = await addComment({ workspaceId, boardId, author: userId, body, mentions, anchor: draft.anchor });
    upsertLocally?.(row);   // shown now, not after the realtime refetch
    // the draft's pin becomes the comment's own, in the same place
    ui.set({ draft: null, openId: row.id });
    rescanSoon();
  };
  const onReply = async ({ body, mentions }) => {
    // A reply reopens it. Whoever may reopen (an editor, or its starter) does
    // so here; for anyone else the database refuses that write, so it is not
    // tried: their reply is sent, and the database reopens the conversation
    // for everyone when a reply lands on a resolved one (once that is in).
    const rootId = thread.id;
    const mayReopen = !!powers(null).reopen;
    const wasResolved = !!thread.resolved;
    let reopened = false;
    if (wasResolved && mayReopen) {
      try {
        const back = await updateComment(rootId, { resolved: false, hidden: false });
        upsertLocally?.(back || { id: rootId, resolved: false, hidden: false });
        reopened = true;
      } catch (_) { /* not reopened here: checked after the reply, below */ }
    }
    const row = await addComment({ workspaceId, boardId, author: userId, body, mentions, anchor: anchorOf(thread.root.meta), replyTo: rootId });
    upsertLocally?.(row);
    // A reply to a resolved one that this person did not reopen: they may not,
    // or their reopen write failed. Whether the reply reopened it is the
    // database's to say (it does, once its reply rule is in and on, inside
    // the reply's own write): read it once. Still put away: say so, since the
    // reply is sent but the conversation stays where it was. A read that
    // fails says nothing.
    if (wasResolved && !reopened) {
      getCommentState(rootId).then((now) => {
        // someone who may reopen it is told their reopen failed, not that they may not
        if (stayedResolved(now)) feedback.toast({ type: 'info', message: mayReopen ? tr`Sent, but it couldn't be reopened. Try again.` : tr(REPLY_NOT_REOPENED) });
        else if (now) upsertLocally?.({ id: rootId, resolved: false, hidden: false });
      }, () => { /* not known: nothing said */ });
    }
  };
  // Only the author changes their words (the card offers Edit to no one else).
  const onEdit = async (rowId, { body, mentions }) => {
    const row = await updateComment(rowId, { body, mentions });
    upsertLocally?.(row || { id: rowId, body });
  };
  const onCopyLink = async (rowId) => {
    try {
      const url = commentLinkUrl(window.location.href, { surface: 'canvas', boardId, commentId: rowId });
      if (!url) throw new Error('no link');
      await navigator.clipboard.writeText(url);
      feedback.toast({ type: 'success', message: tr`Link copied` });
    } catch (_) {
      feedback.toast({ type: 'error', code: 'link_copy_failed', message: tr`Could not copy link` });
    }
  };
  const setResolved = async (id, next) => {
    try {
      const row = await updateComment(id, next ? { resolved: true } : { resolved: false, hidden: false });
      upsertLocally?.(row || (next ? { id, resolved: true } : { id, resolved: false, hidden: false }));
      try { logEvent(EV.COMMENT_RESOLVE, { board_id: boardId, resolved: next }); } catch (_) { /* telemetry never blocks */ }
    } catch (err) {
      const why = shownError(err);
      feedback.toast({ type: 'error', code: 'comment_update_failed', message: next ? tr`Couldn't resolve: ${why}` : tr`Couldn't reopen: ${why}` });
      throw err;
    }
  };
  // Resolved: it leaves the canvas for the Resolved tab, with a way back.
  const onResolve = async () => {
    const id = thread.id;
    await setResolved(id, true);
    close();
    undoToast(feedback, {
      message: tr`Comment resolved`,
      onUndo: () => { setResolved(id, false).then(null, () => { /* said in its own toast */ }); },
    });
  };
  const remove = async (id, { message, whole }) => {
    // what leaves the canvas with it, kept so Undo can put it back at once
    const gone = (comments || []).filter((r) => r.id === id || r.reply_to === id);
    try {
      await deleteComment(id);
      removeLocally?.(id);
      if (whole) close();
      undoToast(feedback, {
        message,
        onUndo: async () => {
          try {
            await restoreComment(id);
            gone.forEach((r) => upsertLocally?.(r));   // shown now, not after the realtime refetch
          }
          catch (err) { const why = shownError(err); feedback.toast({ type: 'error', code: 'comment_restore_failed', message: tr`Couldn't bring it back: ${why}` }); }
        },
      });
    } catch (err) {
      const why = shownError(err);
      feedback.toast({ type: 'error', code: 'comment_delete_failed', message: tr`Couldn't delete: ${why}` });
    }
  };
  // The house way: no question first, an Undo toast after. Its replies go
  // with it and come back with it.
  const onDeleteThread = () => remove(thread.id, { message: tr`Comment deleted`, whole: true });
  const onDelete = (rowId) => (rowId === thread.id ? onDeleteThread() : remove(rowId, { message: tr`Reply deleted`, whole: false }));

  const card = (
    <CommentCard
      thread={thread}
      me={me}
      powers={powers}
      title={about.title}
      thumb={about.thumb}
      variant={sheet ? 'sheet' : 'float'}
      people={people}
      draftKey={commentDraftKey({ userId, surface: 'canvas', scope: boardId, targetId: openKey })}
      onStart={draft ? onStart : undefined}
      onReply={thread ? onReply : undefined}
      onEdit={thread ? onEdit : undefined}
      onDelete={thread ? onDelete : undefined}
      onDeleteThread={thread ? onDeleteThread : undefined}
      onResolve={thread ? onResolve : undefined}
      onReopen={thread ? () => setResolved(thread.id, false) : undefined}
      onCopyLink={thread ? onCopyLink : undefined}
      onClose={closeBack}
      // Your own face opens Settings on Profile. The sheet lies over the
      // whole app, Settings included, so it is put away first (unsent words
      // are kept, as on any close); the card on the canvas is under Settings
      // and stays where it is.
      onOwnFace={userId ? () => { if (sheet) close(); openProfile('comment'); } : null}
      takeFocus={!sheet && !!thread && state.focusCard === thread.id}
    />
  );
  const stop = {
    onPointerDown: (e) => e.stopPropagation(),
    onDoubleClick: (e) => e.stopPropagation(),
    onContextMenu: (e) => e.stopPropagation(),
  };
  if (sheet) {
    // On the body, but React still hands its events up to the canvas: a tap,
    // a double tap, a long press or a drop in the sheet is the sheet's alone
    // (no quick add, no canvas menu, no file dropped on the cluster behind).
    const own = {
      ...stop,
      onMouseDown: (e) => e.stopPropagation(),
      onClick: (e) => e.stopPropagation(),
      onDragOver: (e) => e.stopPropagation(),
      onDrop: (e) => e.stopPropagation(),
    };
    return createPortal(
      <>
        <div className="cmt-sheet-scrim" {...own} onClick={(e) => { e.stopPropagation(); close(); }} />
        {/* is-lifted: on the keyboard, so no room is kept for the home bar */}
        <div className={`cmt-sheet-host${inset > 0 ? ' is-lifted' : ''}`} style={inset > 0 ? { bottom: inset } : undefined} {...own}>{card}</div>
      </>,
      document.body,
    );
  }
  return (
    <div ref={hostRef} className="cmt-canvas-card is-placing" {...stop}>{card}</div>
  );
}
