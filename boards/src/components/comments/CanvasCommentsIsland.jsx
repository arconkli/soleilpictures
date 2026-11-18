import { useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { MessageCircle, MessageCircleOff } from '../../lib/icons.js';
import { tlTip } from '../../lib/looks.js';
import { openCommentTally, openCommentsLabel } from '../../lib/commentCanvas.js';
import { CanvasCommentsList, preloadCommentParts } from './canvasPartsLazy.jsx';
import { t as tr } from '@lingui/core/macro';

// The comments island at the canvas's top left: how many conversations are
// open here and whether any is unread. Pressing it opens the list of them
// all (CanvasCommentsList.jsx), which arrives with the other comment parts
// the first time it is wanted and is asked for as soon as the island is
// pointed at. The list hangs over the canvas, so its arriving moves nothing.
//
// The island is part of the canvas's own download, so it counts from the
// rows themselves (lib/commentCanvas.js openCommentTally); the conversations
// are built by the list, when it opens.
//
//   comments, currentUser, viewsByRootId   the rows, me, when I last looked
//   ui            the comment UI store (listOpen, tab, hoverId, openId)
//   cards, groupBox, groupById, boardId, workspaceId   to name what each is on
//   visible, onVisibleChange(bool)   my "Show comments on the canvas" switch
//   onGoTo(anchor)   bring a conversation's place into view
//   sheet            on a phone: the list is a sheet from the bottom
//   slot             the top bar's element for the button on a phone or upright
//                    iPad (App.jsx .tb-comments-slot): the button is drawn there
//                    as a top-bar icon (.is-in-bar) instead of over the canvas
//   failed           the comments could not be fetched, after every try: the list says so
export function CanvasCommentsIsland({
  comments, currentUser, viewsByRootId, ui, cards, groupBox, groupById, boards, boardId, workspaceId,
  visible = true, onVisibleChange, onGoTo, sheet = false, slot = null, failed = false,
}) {
  const listOpen = useSyncExternalStore(ui.subscribe, () => !!ui.get().listOpen);
  const btnRef = useRef(null);
  const meId = currentUser?.id || null;

  const { open: openCount, unread } = useMemo(() => {
    const ids = new Set();
    for (const c of cards || []) if (c && c.id != null) ids.add(c.id);
    return openCommentTally(comments, { hasCard: (id) => ids.has(id), groupBox }, meId, viewsByRootId);
  }, [comments, cards, groupBox, meId, viewsByRootId]);
  const open = openCount;
  const label = openCommentsLabel(open, unread);

  const button = (
      <button ref={btnRef} type="button"
              className={`cnv-comments-eye${slot ? ' tb-icon is-in-bar' : ''}${visible ? '' : ' is-muted'}${listOpen ? ' is-on' : ''}`}
              {...(listOpen ? {} : tlTip(tr`Comments`))}
              aria-label={label}
              aria-haspopup="dialog"
              aria-expanded={listOpen}
              onPointerEnter={preloadCommentParts}
              onFocus={preloadCommentParts}
              onPointerDown={(e) => { e.stopPropagation(); preloadCommentParts(); }}
              onClick={() => ui.set({ listOpen: !listOpen, hoverId: null })}>
        <Icon as={visible ? MessageCircle : MessageCircleOff} size={16} weight={slot ? undefined : 'regular'} />
        {openCount > 0 && !slot && <span className="cnv-comments-eye-count">{openCount}</span>}
        {unread && <span className="cnv-comments-eye-dot" aria-hidden="true" />}
      </button>
  );

  return (
    <>
      {slot ? createPortal(button, slot) : button}
      {listOpen && (
        <CanvasCommentsList
          ui={ui} btnRef={btnRef}
          comments={comments} currentUser={currentUser} viewsByRootId={viewsByRootId}
          cards={cards} groupBox={groupBox} groupById={groupById} boards={boards}
          boardId={boardId} workspaceId={workspaceId}
          visible={visible} onVisibleChange={onVisibleChange} onGoTo={onGoTo} sheet={sheet} failed={failed}
        />
      )}
    </>
  );
}
