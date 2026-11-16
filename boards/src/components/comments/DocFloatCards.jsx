import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { List, X, MessageCircle, CheckCircle } from '../../lib/icons.js';
import { useFeedback } from '../AppFeedback.jsx';
import { useKeyboardInset } from '../../hooks/useKeyboardInset.js';
import { useBackLayer } from '../../hooks/useBackLayer.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { commentDraftKey } from '../../lib/commentDraft.js';
import { placeBeside, tabForKey } from '../../lib/commentCardPlace.js';
import { subscribeMinute, minuteNow } from '../../lib/minuteTick.js';
import { docThreadOps, READ_ONLY_LINE } from './docThreadOps.js';
import { useDocThreads, useOpenThreadRead, useFlashRow, ThreadRow, GONE_WORDS } from './DocThreadsPanel.jsx';
import { CommentCard } from './CommentCard.jsx';
import { openProfile } from '../../lib/openProfile.js';
import { t as tr, msg, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';
import './canvasComments.css';

// The comment cards a doc and a note float over their words: the card a new
// comment is written in (both), and a note's open conversation with its list
// of threads. On a phone or under a finger each is a sheet from the bottom.

export function wantsSheet() {
  try { return !!window.matchMedia?.('(pointer: coarse), (max-width: 640px)')?.matches; } catch (_) { return false; }
}

const stop = {
  onPointerDown: (e) => e.stopPropagation(),
  onMouseDown: (e) => e.stopPropagation(),
  onClick: (e) => e.stopPropagation(),
  onDoubleClick: (e) => e.stopPropagation(),
  onContextMenu: (e) => e.stopPropagation(),
  onKeyDown: (e) => e.stopPropagation(),
  onKeyUp: (e) => e.stopPropagation(),
};
// What a press may land on without the card being put away.
const OWN = '.cmt-float-host, .cmt-sheet-host, .cmt-sheet-scrim, .cmt-list-scrim, .cmt-list, .cmt-pop, .toast, .modal-bg, .modal';

// A card (or the list) kept beside what it is about. `getRect()` answers
// where that is on screen now, or null when it is out of sight: the card is
// then hidden until it is back. It follows a scroll, a pan and a zoom by
// asking again each frame while it is open, and stays inside the window.
//   label     for the sheet's scrim
//   onAway()  a press somewhere else, or Esc with the caret elsewhere
export function FloatHost({ getRect, sheet = false, onAway, children }) {
  const hostRef = useRef(null);
  const getRef = useRef(getRect);
  getRef.current = getRect;
  const awayRef = useRef(onAway);
  awayRef.current = onAway;
  const inset = useKeyboardInset(sheet);
  // The sheet lies over the whole screen: under a finger the phone's Back
  // closes it (hooks/useBackLayer), not the doc or the cluster under it. A
  // doc's own layer closes the doc; this one sits on top of it. One layer for
  // the sheet, whether it shows a conversation or a note's list.
  useBackLayer(sheet, () => awayRef.current?.());

  useEffect(() => {
    if (sheet) return undefined;
    let raf = 0;
    let last = '';
    const put = () => {
      raf = requestAnimationFrame(put);
      const el = hostRef.current;
      if (!el) return;
      const rect = getRef.current?.() || null;
      if (!rect) {
        if (last !== 'hidden') { el.style.visibility = 'hidden'; last = 'hidden'; }
        return;
      }
      const p = placeBeside({
        rect, w: el.offsetWidth, h: el.offsetHeight, vw: window.innerWidth, vh: window.innerHeight,
        margin: 12, gapRight: 14, gapLeft: 14,
      });
      const key = `${Math.round(p.left)},${Math.round(p.top)}`;
      if (key === last) return;
      last = key;
      el.style.transform = `translate(${Math.round(p.left)}px, ${Math.round(p.top)}px)`;
      el.style.visibility = '';
    };
    put();
    const el = hostRef.current;
    // a wheel over the card scrolls the card, not what is under it
    const keep = (e) => e.stopPropagation();
    el?.addEventListener('wheel', keep, { passive: true });
    return () => { cancelAnimationFrame(raf); el?.removeEventListener('wheel', keep); };
  }, [sheet]);

  useEffect(() => {
    const onDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest(OWN)) return;
      awayRef.current?.(e);
    };
    const onKey = (e) => {
      if (isComposingKey(e) || e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && t.closest('.cmt-float-host, .cmt-sheet-host, .cmt-pop, .modal')) return;
      awayRef.current?.(e);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, []);

  if (sheet) {
    return createPortal(
      <>
        <div className="cmt-sheet-scrim" {...stop} onClick={(e) => { e.stopPropagation(); awayRef.current?.(e); }} />
        <div className={`cmt-sheet-host${inset > 0 ? ' is-lifted' : ''}`} style={inset > 0 ? { bottom: inset } : undefined} {...stop}>{children}</div>
      </>,
      document.body,
    );
  }
  return createPortal(
    <div ref={hostRef} className="cmt-float-host" style={{ visibility: 'hidden' }} {...stop}>{children}</div>,
    document.body,
  );
}

// ── A new comment on the selected words (a doc and a note) ─────────────────
//   getRect()     where the words are on screen now (null: scrolled away)
//   surface       'doc' | 'note'
//   draftTarget   what the unsent words are kept under (the page, or the note)
//   onPost(id)    the thread was made: mark its words and show it
//   onClose()
export function NewDocComment({
  ydoc, scope, surface = 'doc', entries = [], pageId = null, getRect, currentUser = null, canEdit = true, guest = false,
  workspaceId = null, boardId = null, cardId = null, draftTarget = 'new', onPost, onClose,
}) {
  const feedback = useFeedback();
  const sheet = useRef(wantsSheet()).current;
  const { people } = useDocThreads({ entries, currentUser, canEdit, workspaceId, boardId, cardId });
  const ops = docThreadOps({ ydoc, scope, surface, currentUser, canEdit, guest, workspaceId, boardId, cardId, feedback });
  return (
    <FloatHost getRect={getRect} sheet={sheet} onAway={() => onClose?.()}>
      <CommentCard
        thread={null}
        me={ops.me}
        powers={ops.powers(null)}
        // a doc shared on its own has no "@": its guests are outside the
        // workspace, and a name picked there would tell nobody
        people={guest ? null : people}
        variant={sheet ? 'sheet' : 'float'}
        title={tr`New comment`}
        label={tr`New comment`}
        draftKey={commentDraftKey({ userId: ops.me?.id, surface, scope: cardId, targetId: draftTarget })}
        onStart={({ body, mentions }) => {
          const id = ops.start({ body, mentions, pageId });
          if (id) onPost?.(id);
        }}
        onClose={() => onClose?.(true)}
      />
    </FloatHost>
  );
}

// ── A note's comments: the open conversation, and the list ─────────────────
const TABS = [{ id: 'open', label: msg({ message: 'Open', context: 'status' }) }, { id: 'resolved', label: msg`Resolved` }];

//   entries       the note's threads (docState.readComments on its scope)
//   openId        the open thread, or null;  listOpen: the list is showing
//   getRect()     where the note is on screen now
//   hasWords(id)  the thread's words are still in the note
//   onOpen(id | null), onList(bool)
//   flashRowId    a reply a link pointed at;  takeFocus: opened from the keyboard
export function NoteThreadCard({
  ydoc, scope, entries = [], openId = null, listOpen = false, getRect, hasWords,
  currentUser = null, canEdit = false, workspaceId = null, boardId = null, cardId = null,
  onOpen, onList, flashRowId = null, takeFocus = false,
}) {
  const feedback = useFeedback();
  const sheet = useRef(wantsSheet()).current;
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
  const hostRef = useRef(null);
  const tabsId = useId();
  const [tab, setTab] = useState('open');
  const { threads, people, seen } = useDocThreads({ entries, currentUser, canEdit, workspaceId, boardId, cardId });
  const ops = docThreadOps({ ydoc, scope, surface: 'note', currentUser, canEdit, workspaceId, boardId, cardId, feedback });
  const found = openId ? threads.find((t) => t.id === openId) || null : null;
  const thread = useOpenThreadRead(found, seen);
  useFlashRow(hostRef, flashRowId, thread?.id || null);

  // The open thread is gone (deleted here or by someone else): nothing is open.
  const missing = !!openId && !found;
  useEffect(() => {
    if (!missing) return undefined;
    const t = setTimeout(() => onOpen?.(null), 400);
    return () => clearTimeout(t);
  }, [missing, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!thread && !listOpen) return null;
  const gone = (t) => !!hasWords && !hasWords(t.id);
  const more = threads.length > 1 || threads.some((t) => t.resolved || gone(t));
  const lists = { open: threads.filter((t) => !t.resolved), resolved: threads.filter((t) => t.resolved) };
  const rows = lists[tab];
  const count = threads.length;

  const body = thread && !listOpen ? (
    <CommentCard
      thread={thread}
      me={ops.me}
      powers={ops.powers(thread)}
      people={people}
      variant={sheet ? 'sheet' : 'float'}
      title={gone(thread) ? tr(GONE_WORDS) : tr`Comment`}
      label={tr`Comments on this note`}
      headerExtra={more ? (
        <button type="button" className="cmt-ib" aria-label={plural(count, { one: 'All comments on this note (#)', other: 'All comments on this note (#)' })} onClick={() => onList?.(true)}>
          <Icon as={List} size={sheet ? 20 : 18} weight="regular" />
        </button>
      ) : null}
      draftKey={commentDraftKey({ userId: ops.me?.id, surface: 'note', scope: cardId, targetId: thread.id })}
      readOnlyNote={tr(READ_ONLY_LINE.note)}
      takeFocus={takeFocus}
      onClose={() => onOpen?.(null, true)}
      // The card floats over the whole page, Settings included: it is put
      // away (unsent words are kept) before your profile opens.
      onOwnFace={ops.me?.id ? () => { onOpen?.(null); openProfile('comment'); } : null}
      {...ops.handlers(thread, { onGone: () => onOpen?.(null) })}
    />
  ) : (
    <div className={`cmt-list cmt-list--in${sheet ? ' cmt-list--insheet' : ''}`} role="dialog" aria-label={tr`Comments on this note`} tabIndex={-1}
         onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); onList?.(false); } }}>
      {sheet && <div className="cmt-grab" aria-hidden="true" />}
      <div className="cmt-list-head">
        <h2 className="cmt-list-title"><Trans>Comments</Trans></h2>
        <button type="button" className="cmt-ib" aria-label={tr`Close`} onClick={() => onList?.(false)}>
          <Icon as={X} size={16} weight="regular" />
        </button>
      </div>
      <div className="cmt-list-tabs" role="tablist" aria-label={tr`Which comments`}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="cmt-list-tab" id={`${tabsId}-tab-${t.id}`}
                  aria-selected={tab === t.id} aria-controls={`${tabsId}-panel`} tabIndex={tab === t.id ? 0 : -1}
                  onKeyDown={(e) => {
                    const to = tabForKey(TABS.map((x) => x.id), t.id, e.key);
                    if (!to) return;
                    e.preventDefault();
                    setTab(to);
                    document.getElementById(`${tabsId}-tab-${to}`)?.focus({ preventScroll: true });
                  }}
                  onClick={() => setTab(t.id)}>
            {tr(t.label)} <span className="cmt-list-tab-n">{lists[t.id].length}</span>
          </button>
        ))}
      </div>
      <div className="cmt-list-rows" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${tab}`}>
        {rows.length === 0 && (
          <div className="cmt-list-empty">
            <Icon as={tab === 'resolved' ? CheckCircle : MessageCircle} size={22} weight="regular" />
            <b>{tab === 'resolved' ? tr`Nothing resolved yet` : tr`No open comments`}</b>
            {tab === 'resolved' ? tr`Conversations you resolve are kept here.` : tr`Select some words in the note to add one.`}
          </div>
        )}
        {rows.map((t) => (
          <ThreadRow key={t.id} thread={t} now={now} open={t.id === openId} where={gone(t) ? tr(GONE_WORDS) : null}
                     onOpen={() => { onOpen?.(t.id); onList?.(false); }} />
        ))}
      </div>
    </div>
  );

  return (
    <FloatHost getRect={getRect} sheet={sheet} onAway={() => { onOpen?.(null); onList?.(false); }}>
      <div ref={hostRef}>{body}</div>
    </FloatHost>
  );
}
