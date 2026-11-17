import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../Icon.jsx';
import { Edit } from '../../lib/icons.js';
import { useFeedback } from '../AppFeedback.jsx';
import { updateComment, deleteComment, restoreComment } from '../../lib/commentsApi.js';
import { commentLinkUrl } from '../../lib/commentLinkUrl.js';
import { undoToast } from '../../lib/undoToast.js';
import { commentPinMenu } from '../../lib/menus/index.js';
import { commentPowers } from '../../lib/commentRules.js';
import { rescanParked } from '../../lib/commentParked.js';
import {
  threadAnchor, layoutPins, threadsBounds,
  pinLabel, draftTargetId, draftThread,
  PIN_SIZE,
} from '../../lib/commentPins.js';
import { CommentFace } from './CommentFace.jsx';
import { useCanvasThreads, useAnchorBoxes } from './canvasThreads.js';
import { PinPreview, preloadCommentParts } from './canvasPartsLazy.jsx';
import { NoteCommentsLayer } from './NoteCommentsLayer.jsx';
import { shownError } from '../../lib/errorWords.js';
import { shownAuthor } from '../../lib/commentAuthor.js';
import { t as tr, plural } from '@lingui/core/macro';

// Comments on the canvas: each open
// conversation is a small pin on what it is about, and opens as the shared
// CommentCard beside it. The list of them all is CanvasCommentsList.jsx.
//
// Three parts read the same rows and the same little store (`ui`,
// lib/commentCanvas.js createCommentUi), each on its own, so opening a pin or
// pointing at a row never re-renders the canvas:
//   CanvasCommentPins   inside the canvas transform: the pins and the rings
//   CanvasCommentCard   over the canvas: the open conversation (or a new one)
//   CanvasCommentsIsland  the island and, behind it, the list
//
// Only the island is part of the canvas's own download. The pins are a chunk
// of their own, asked for as the canvas mounts (canvasPartsLazy.jsx): they
// come with the comments, which the canvas does not wait for either. What a
// press opens (the conversation, the list, the look-ahead) arrives together
// the first time one is wanted, and is asked for as soon as a pin or the
// island is pointed at. Each is drawn inside its own small error boundary
// there, so a part that cannot load shows nothing and the canvas stays. The
// pins' own styles are commentPins.css.

const PREVIEW_W = 272;
const HOVER_MS = 250;

// What a count says to a screen reader: how many are gathered here, how many
// of them are this person's unsent comments, whether any is unread.
function countLabel(n, unsent, unread) {
  if (unsent) {
    return unread
      ? plural(n, { one: `# comment here, ${unsent} unsent, some unread. Zoom in`, other: `# comments here, ${unsent} unsent, some unread. Zoom in` })
      : plural(n, { one: `# comment here, ${unsent} unsent. Zoom in`, other: `# comments here, ${unsent} unsent. Zoom in` });
  }
  return unread
    ? plural(n, { one: '# conversation here, some unread. Zoom in', other: '# conversations here, some unread. Zoom in' })
    : plural(n, { one: '# conversation here. Zoom in', other: '# conversations here. Zoom in' });
}

// ── The pins ────────────────────────────────────────────────────────────────
//   comments, currentUser, viewsByRootId   the rows, me, when I last looked
//   ui            the comment UI store
//   zoom          the settled zoom (pins gather by it; not read per frame)
//   cards         the canvas's cards; groupBox(id) a group's world box
//   visible       my "Show comments on the canvas" switch
//   view          { get() → { pan, zoom, w, h }, subscribe(fn) } the live camera
//   onZoomTo(box) zoom to fit a world box; false when it can go no closer
//   canEdit       may edit the cluster (so may move anyone's point comment)
//   upsertLocally(row)   useCanvasComments' own, for a moved point comment
//   boardId       the cluster: where this person's unsent comments are filed
//   ydoc, workspaceId   for the comments on the words of its notes (NoteCommentsLayer.jsx)
//   removeLocally(id)   useCanvasComments' own, for a pin's Delete
//   onPinMenu({ x, y, menu })   a right-click on a pin: the menu to show there (commentPinMenu's), the canvas draws it
export const CanvasCommentPins = memo(function CanvasCommentPins({
  comments, currentUser, viewsByRootId, ui, zoom = 1, cards, groupBox, visible = true, view, onZoomTo,
  canEdit = false, upsertLocally, removeLocally, boardId, ydoc = null, workspaceId = null, onPinMenu,
}) {
  const feedback = useFeedback();
  // Comments started here and left with words in them each keep a pin where
  // they were started (lib/commentParked.js): looked for at once, since
  // their pins show with the rest.
  const userId = currentUser?.id || null;
  useEffect(() => { rescanParked(ui, userId, boardId); }, [ui, userId, boardId]);
  // A comment being started is left by more than its own close button: a
  // press on another pin, on a row of the list, a comment link. Whatever
  // changes `draft`, look again: now, and once the box has kept its words
  // (it does a moment after the last key, and on its way out).
  useEffect(() => {
    let last = ui.get().draft;
    let timer = null;
    const off = ui.subscribe(() => {
      const d = ui.get().draft;
      if (d === last) return;
      last = d;
      rescanParked(ui, userId, boardId);
      clearTimeout(timer);
      timer = setTimeout(() => rescanParked(ui, userId, boardId), 150);
    });
    return () => { off(); clearTimeout(timer); };
  }, [ui, userId, boardId]);
  const state = useSyncExternalStore(ui.subscribe, ui.get, ui.get);
  const threads = useCanvasThreads({ comments, currentUser, viewsByRootId });
  const { resolvers } = useAnchorBoxes(cards, groupBox);
  const layerRef = useRef(null);
  const [hover, setHover] = useState(null);   // { key, left, up }
  const hoverTimer = useRef(null);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // The canvas moves without React during a gesture: follow its zoom here.
  useLayoutEffect(() => {
    const apply = () => {
      const z = view?.get?.().zoom;
      if (layerRef.current && z > 0) layerRef.current.style.setProperty('--cmt-inv', String(1 / z));
    };
    apply();
    return view?.subscribe?.(apply);
  }, [view]);

  const openId = state.openId;
  const shown = useMemo(
    () => threads.filter((t) => !t.resolved && (visible || t.id === openId)),
    [threads, visible, openId],
  );
  // A comment being started has its own pin, after the ones already on its
  // card: the one being written now (ringed), and any left with words in them
  // (pressing one brings its words back). They are laid out with the rest, so
  // one takes the next free place in its card's row and gathers into a count
  // when the row does.
  const draftNow = state.draft;
  const parked = state.parked;
  const drafts = useMemo(() => {
    const nowId = draftNow ? draftTargetId(draftNow.anchor) : null;
    const list = draftNow ? [{ id: nowId, anchor: draftNow.anchor, active: true }] : [];
    if (visible) {
      for (const a of parked || []) {
        const id = draftTargetId(a);
        if (id !== nowId) list.push({ id, anchor: a, active: false });
      }
    }
    return list;
  }, [draftNow, parked, visible]);
  const pins = useMemo(() => layoutPins(shown, resolvers, zoom, { drafts }), [shown, resolvers, zoom, drafts]);

  const openThread = openId ? threads.find((t) => t.id === openId) : null;
  const drafting = state.draft ? draftThread(state.draft.anchor) : null;
  const openAnchor = drafting ? threadAnchor(drafting, resolvers) : (openThread ? threadAnchor(openThread, resolvers) : null);
  const lookThread = state.hoverId && state.hoverId !== openId ? threads.find((t) => t.id === state.hoverId) : null;
  const lookAnchor = lookThread ? threadAnchor(lookThread, resolvers) : null;

  // Where the open conversation's own pin is (or the count it is gathered
  // into), for the card beside it to stand clear of (CanvasCommentCard).
  const openKey = draftNow ? draftTargetId(draftNow.anchor) : openId;
  const openPin = useMemo(() => {
    if (!openKey) return null;
    const p = pins.find((q) => (q.type === 'count'
      ? q.threads.some((t) => t.id === openKey) || q.drafts.some((d) => d.id === openKey)
      : q.key === openKey));
    return p ? { wx: p.wx, wy: p.wy, dx: p.dx, dy: p.dy } : null;
  }, [pins, openKey]);
  useLayoutEffect(() => {
    ui.set((s) => {
      const a = s.openPin; const b = openPin;
      const same = a === b || (!!a && !!b && a.wx === b.wx && a.wy === b.wy && a.dx === b.dx && a.dy === b.dy);
      return same ? null : { openPin };
    });
  }, [ui, openPin]);

  // A comment on a point of the canvas can be picked up and put somewhere
  // else, by whoever may delete it (its author, or an editor). Pins on cards
  // and groups follow what they are on.
  const meId = currentUser?.id || null;
  const movable = (t) => t.root.meta?.anchorKind === 'point'
    && commentPowers({ me: meId ? { id: meId } : null, row: t.root, thread: t, canRead: true, canWrite: !!canEdit }).delete;
  // Right-click a pin: Open, Resolve / Reopen, Copy link, Delete, each only
  // where the comment's powers allow (lib/commentRules.js), each doing what the
  // open conversation's own buttons do (CanvasCommentCard.jsx).
  const pinMenu = (e, t) => {
    if (!onPinMenu) return;
    const powers = commentPowers({ me: meId ? { id: meId } : null, row: t.root, thread: t, canRead: true, canWrite: !!canEdit });
    const setResolved = async (next) => {
      try {
        const row = await updateComment(t.id, next ? { resolved: true } : { resolved: false, hidden: false });
        upsertLocally?.(row || (next ? { id: t.id, resolved: true } : { id: t.id, resolved: false, hidden: false }));
        return true;
      } catch (err) {
        const why = shownError(err);
        feedback.toast({ type: 'error', code: 'comment_update_failed', message: next ? tr`Couldn't resolve: ${why}` : tr`Couldn't reopen: ${why}` });
        return false;
      }
    };
    const acts = {
      'open-comment': () => ui.set({ openId: t.id, draft: null, flashRowId: null }),
      ...(powers.resolve ? { resolve: async () => {
        if (!await setResolved(true)) return;
        undoToast(feedback, {
          message: tr`Comment resolved`,
          onUndo: () => { setResolved(false); },
        });
      } } : {}),
      ...(powers.reopen ? { reopen: () => { setResolved(false); } } : {}),
      ...(powers.copyLink ? { 'copy-comment-link': async () => {
        try {
          const url = commentLinkUrl(window.location.href, { surface: 'canvas', boardId, commentId: t.id });
          if (!url) throw new Error('no link');
          await navigator.clipboard.writeText(url);
          feedback.toast({ type: 'success', message: tr`Link copied` });
        } catch (_) {
          feedback.toast({ type: 'error', code: 'link_copy_failed', message: tr`Could not copy link` });
        }
      } } : {}),
      ...(powers.delete ? { 'delete-comment': async () => {
        // what leaves the canvas with it, kept so Undo can put it back at once
        const gone = (comments || []).filter((r) => r.id === t.id || r.reply_to === t.id);
        try {
          await deleteComment(t.id);
          removeLocally?.(t.id);
          undoToast(feedback, {
            message: tr`Comment deleted`,
            onUndo: async () => {
              try {
                await restoreComment(t.id);
                gone.forEach((r) => upsertLocally?.(r));
              } catch (err) { const why = shownError(err); feedback.toast({ type: 'error', code: 'comment_restore_failed', message: tr`Couldn't bring it back: ${why}` }); }
            },
          });
        } catch (err) {
          const why = shownError(err);
          feedback.toast({ type: 'error', code: 'comment_delete_failed', message: tr`Couldn't delete: ${why}` });
        }
      } } : {}),
    };
    onPinMenu({ x: e.clientX, y: e.clientY, menu: commentPinMenu({}, acts) });
  };
  const drag = useRef(null);
  const dragged = useRef(null);
  const putBack = (d) => { d.at.style.left = `${d.wx}px`; d.at.style.top = `${d.wy}px`; d.at.classList.remove('is-dragging'); };
  // the press that ends a move is not a press on the pin
  const notAPress = (id) => {
    dragged.current = id;
    setTimeout(() => { if (dragged.current === id) dragged.current = null; }, 300);
  };
  const onPinDown = (e, p) => {
    e.stopPropagation();
    endHover();
    preloadCommentParts();
    if (e.button !== 0 || !movable(p.thread)) return;
    drag.current = { id: p.thread.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, wx: p.wx, wy: p.wy, x: p.wx, y: p.wy, at: e.currentTarget.parentElement, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* the press still tracks on the pin */ }
    // A second finger is a pinch (CanvasSurface's two-finger camera), and a
    // pinch drops whatever the first finger had started: the pin goes back
    // where it was and nothing is written.
    if (e.pointerType === 'touch') {
      const d = drag.current;
      const pinEl = e.currentTarget;
      const second = (ev) => {
        if (ev.pointerType !== 'touch' || ev.pointerId === d.pid) return;
        d.off();
        if (drag.current !== d) return;
        drag.current = null;
        putBack(d);
        if (d.moved) notAPress(d.id);
        try { pinEl.releasePointerCapture(d.pid); } catch (_) { /* already let go */ }
      };
      d.off = () => window.removeEventListener('pointerdown', second, true);
      window.addEventListener('pointerdown', second, true);
    }
  };
  useEffect(() => () => { drag.current?.off?.(); }, []);
  const onPinMove = (e) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    const dx = e.clientX - d.sx; const dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    const z = view?.get?.().zoom || zoom || 1;
    d.x = d.wx + dx / z; d.y = d.wy + dy / z;
    d.at.style.left = `${d.x}px`; d.at.style.top = `${d.y}px`;
    d.at.classList.add('is-dragging');
  };
  const onPinUp = (e, cancelled) => {
    const d = drag.current;
    if (!d || d.pid !== e.pointerId) return;
    drag.current = null;
    d.off?.();
    if (!d.moved) return;
    if (cancelled) { putBack(d); return; }
    d.at.classList.remove('is-dragging');
    notAPress(d.id);
    const x = Math.round(d.x); const y = Math.round(d.y);
    upsertLocally?.({ id: d.id, anchor_x: x, anchor_y: y });
    updateComment(d.id, { anchor_x: x, anchor_y: y }).then(null, (err) => {
      upsertLocally?.({ id: d.id, anchor_x: d.wx, anchor_y: d.wy });
      putBack(d);
      const why = shownError(err);
      feedback.toast({ type: 'error', code: 'comment_move_failed', message: tr`Couldn't move the comment: ${why}` });
    });
  };

  // The look-ahead is for a resting mouse: not one with a button held (a
  // selection box or a card being dragged across a pin), and not while a
  // conversation or a new comment is open, whose card it would draw over.
  const startHover = (e, p) => {
    preloadCommentParts();   // pointed at: what a press opens is on its way
    if (e.pointerType !== 'mouse' || e.buttons !== 0) return;
    const s = ui.get();
    if (s.openId || s.draft) return;
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      const v = view?.get?.();
      let left = false; let up = false;
      if (v) {
        const sx = v.pan.x + p.wx * v.zoom + p.dx;
        const sy = v.pan.y + p.wy * v.zoom + p.dy;
        left = sx + PIN_SIZE + 8 + PREVIEW_W > v.w - 8 && sx - 8 - PREVIEW_W >= 8;
        up = sy + 150 > v.h;
      }
      setHover({ key: p.key, left, up });
    }, HOVER_MS);
  };
  const endHover = () => { clearTimeout(hoverTimer.current); setHover(null); };
  // a press anywhere ends it, and the wait for it
  useEffect(() => {
    const onDown = () => { clearTimeout(hoverTimer.current); setHover(null); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);
  // …and so does a conversation or a new comment opening
  const busy = !!openId || !!draftNow;
  useEffect(() => { if (busy) { clearTimeout(hoverTimer.current); setHover(null); } }, [busy]);
  const quiet = {
    onPointerDown: (e) => { e.stopPropagation(); endHover(); preloadCommentParts(); },
    onPointerEnter: preloadCommentParts,
    onFocus: preloadCommentParts,
    onDoubleClick: (e) => e.stopPropagation(),
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); },
  };

  const ring = (a, cls) => (a?.box ? (
    <div className={`cmt-hl${cls}`} aria-hidden="true"
         style={{ left: a.box.x, top: a.box.y, width: a.box.w, height: a.box.h, transform: a.box.rot ? `rotate(${a.box.rot}deg)` : undefined }} />
  ) : null);

  return (
    <div ref={layerRef} className="cmt-pins canvas-comment-layer" style={{ '--cmt-inv': 1 / (zoom > 0 ? zoom : 1) }}>
      {ydoc && <NoteCommentsLayer ydoc={ydoc} boardId={boardId} workspaceId={workspaceId} currentUser={currentUser} canEdit={canEdit} />}
      {ring(lookAnchor, ' is-look')}
      {ring(openAnchor, '')}
      {pins.map((p) => {
        if (p.type === 'count') {
          const on = p.active || (!!openId && p.threads.some((t) => t.id === openId));
          const unsent = p.drafts.length;
          return (
            <div key={p.key} className={`cmt-pin-at${on ? ' is-open' : ''}`} style={{ left: p.wx, top: p.wy }}>
              <button type="button" className={`cmt-pin cmt-pin--count${on ? ' is-open' : ''}`}
                      style={{ left: p.dx, top: p.dy - PIN_SIZE }}
                      aria-label={countLabel(p.n, unsent, !!p.unread)}
                      {...quiet}
                      onClick={(e) => {
                        e.stopPropagation();
                        const went = onZoomTo?.(threadsBounds([...p.threads, ...p.drafts.map((d) => draftThread(d.anchor))], resolvers));
                        if (went === false) ui.set({ listOpen: true, tab: 'open' });
                      }}>
                <span className="cmt-pin-n">{p.n}</span>
                {p.unread && <span className="cmt-pin-dot" aria-hidden="true" />}
              </button>
            </div>
          );
        }
        if (p.type === 'draft') {
          const face = (
            <>
              <CommentFace name={currentUser?.name || tr`You`} userId={currentUser?.id || null} color={currentUser?.color || null} size={24} />
              <span className="cmt-pin-pencil"><Icon as={Edit} size={9} weight="bold" /></span>
            </>
          );
          return (
            <div key={p.key} className={`cmt-pin-at${p.active ? ' is-open' : ''}`} style={{ left: p.wx, top: p.wy }}>
              {p.active ? (
                <span className="cmt-pin cmt-pin--draft is-open" style={{ left: p.dx, top: p.dy - PIN_SIZE }} data-cmt-draft={p.id} aria-hidden="true">
                  {face}
                </span>
              ) : (
                <button type="button" className="cmt-pin cmt-pin--draft" style={{ left: p.dx, top: p.dy - PIN_SIZE }}
                        data-cmt-draft={p.id}
                        aria-label={tr`Your unsent comment. Open it`}
                        {...quiet}
                        onClick={(e) => {
                          e.stopPropagation();
                          ui.set({ draft: { anchor: p.draftAnchor }, openId: null, hoverId: null, flashRowId: null });
                        }}>
                  {face}
                </button>
              )}
            </div>
          );
        }
        const t = p.thread;
        const on = t.id === openId;
        const hov = hover?.key === p.key && !on;
        return (
          <div key={p.key} className={`cmt-pin-at${on ? ' is-open' : ''}${hov ? ' is-hover' : ''}`} style={{ left: p.wx, top: p.wy }}>
            <button type="button" className={`cmt-pin${on ? ' is-open' : ''}`}
                    style={{ left: p.dx, top: p.dy - PIN_SIZE, ...(t.root.meta?.anchorKind === 'point' ? { touchAction: 'none' } : null) }}
                    data-cmt-pin={t.id}
                    aria-label={pinLabel(t, meId)}
                    aria-expanded={on}
                    {...quiet}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); endHover(); pinMenu(e, t); }}
                    onPointerDown={(e) => onPinDown(e, p)}
                    onPointerMove={onPinMove}
                    onPointerUp={(e) => onPinUp(e, false)}
                    onPointerCancel={(e) => onPinUp(e, true)}
                    onPointerEnter={(e) => startHover(e, p)}
                    onPointerLeave={endHover}
                    onClick={(e) => {
                      e.stopPropagation();
                      endHover();
                      if (dragged.current === t.id) { dragged.current = null; return; }
                      // opened from the keyboard (a click with no pointer
                      // behind it): the caret goes into the conversation,
                      // and Esc brings it back to this pin
                      ui.set({ openId: on ? null : t.id, draft: null, flashRowId: null, focusCard: !on && e.detail === 0 ? t.id : null });
                    }}>
              <CommentFace name={shownAuthor(t.root.authorName)} userId={t.root.authorId} color={t.root.authorColor} size={24} />
              {t.unread && <span className="cmt-pin-dot" aria-hidden="true" />}
            </button>
            {hov && (
              <PinPreview thread={t}
                          style={{
                            left: hover.left ? p.dx - 8 - PREVIEW_W : p.dx + PIN_SIZE + 8,
                            ...(hover.up ? { bottom: -p.dy } : { top: p.dy - PIN_SIZE + 8 }),
                          }} />
            )}
          </div>
        );
      })}
    </div>
  );
});
