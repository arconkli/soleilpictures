import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../Icon.jsx';
import { ChevronRight } from '../../lib/icons.js';
import { useFeedback } from '../AppFeedback.jsx';
import { fromDocThread } from '../../lib/commentModel.js';
import { commentDraftKey } from '../../lib/commentDraft.js';
import { commentTimeWords, threadSummaryLine } from '../../lib/commentTime.js';
import { subscribeMinute, minuteNow } from '../../lib/minuteTick.js';
import { useCommentPeople } from './commentPeople.js';
import { useCommentSeen } from './useCommentSeen.js';
import { docThreadOps, READ_ONLY_LINE } from './docThreadOps.js';
import { CommentCard } from './CommentCard.jsx';
import { CommentFace } from './CommentFace.jsx';
import { openProfile } from '../../lib/openProfile.js';
import { shownAuthor, commentBy, resolvedCommentBy } from '../../lib/commentAuthor.js';
import { t as tr, msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';
import './canvasComments.css';

// A doc's or a note's threads as the comment parts read them (lib/commentModel.js
// Thread), with who "@" offers and what is unread.
//   entries   the threads as docState.readComments hands them over
export function useDocThreads({ entries, currentUser, canEdit, workspaceId, boardId, cardId, enabled = true }) {
  const meId = currentUser?.id || null;
  const authors = useMemo(() => {
    const out = [];
    for (const t of entries || []) {
      out.push({ author: t.authorId });
      for (const r of t.replies || []) out.push({ author: r.authorId });
    }
    return out;
  }, [entries]);
  const listed = useCommentPeople({ workspaceId, boardId, comments: authors, meId, canEdit: !!canEdit, enabled: enabled && !!workspaceId && !!boardId });
  // …and whoever has written here under the name they wrote with, when the
  // lists do not have them (someone since removed, a list that did not load).
  const people = useMemo(() => {
    const have = new Set(listed.map((p) => p.id));
    const more = [];
    const add = (r) => {
      const name = typeof r?.author === 'string' ? r.author.trim() : '';
      if (!r?.authorId || r.authorId === meId || have.has(r.authorId) || !name) return;
      have.add(r.authorId);
      more.push({ id: r.authorId, name, avatar: null, color: typeof r.authorColor === 'string' ? r.authorColor : null });
    };
    for (const t of entries || []) { add(t); (t.replies || []).forEach(add); }
    return more.length ? [...listed, ...more].sort((a, b) => a.name.localeCompare(b.name)) : listed;
  }, [listed, entries, meId]);
  const { unread, seen } = useCommentSeen({ userId: meId, boardId, cardId });
  const threads = useMemo(() => {
    const names = meId ? [...people, { id: meId, name: currentUser?.name || null, color: currentUser?.color || null }] : people;
    return (entries || []).map((e) => fromDocThread(e, names)).filter(Boolean).map((t) => ({ ...t, unread: unread(t) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, people, unread, meId, currentUser?.name, currentUser?.color]);
  return { threads, people, seen };
}

// Opening a thread is reading it, and so is a reply that arrives while it is
// open. The dot inside the card marks what was new when it opened.
export function useOpenThreadRead(thread, seen) {
  const atOpen = useRef({ id: null, unread: false });
  if (thread && atOpen.current.id !== thread.id) atOpen.current = { id: thread.id, unread: !!thread.unread };
  if (!thread) atOpen.current = { id: null, unread: false };
  const id = thread?.id || null;
  const count = thread ? 1 + thread.replies.length : 0;
  const ref = useRef(thread);
  ref.current = thread;
  useEffect(() => { if (id) seen(ref.current); }, [id, count, seen]);
  return thread ? { ...thread, unread: atOpen.current.unread } : null;
}

// A link pointed at one reply: it is brought into view and lit for a moment.
export function useFlashRow(hostRef, rowId, threadId) {
  useEffect(() => {
    if (!rowId || !threadId) return undefined;
    const el = [...(hostRef.current?.querySelectorAll('[data-cmt-row]') || [])].find((n) => n.getAttribute('data-cmt-row') === rowId);
    if (!el) return undefined;
    const box = el.closest('.cmt-scroll');
    if (box) box.scrollTop = Math.max(0, el.offsetTop - box.offsetTop - 8);
    el.classList.add('is-flash');
    const t = setTimeout(() => el.classList.remove('is-flash'), 2000);
    return () => { clearTimeout(t); el.classList.remove('is-flash'); };
  }, [hostRef, rowId, threadId]);
}

// One thread that is not the open one: who started it, the first words, and
// how much was said since. The whole row opens it.
export function ThreadRow({ thread, where, now, open = false, onOpen }) {
  const replies = thread.replies.some((r) => !r.deleted);
  const first = thread.root.deleted ? tr`This comment was deleted.` : thread.root.body;
  const words = String(first).slice(0, 60);
  // whose it is, as a phrase of its own (a real name only; lib/commentAuthor.js),
  // then one message around it
  const whose = thread.resolved ? resolvedCommentBy(thread.root.authorName) : commentBy(thread.root.authorName);
  const rowLabel = thread.unread ? tr`${whose}: ${words} (unread)` : tr`${whose}: ${words}`;
  return (
    <button type="button" className={`cmt-list-row cmt-list-row--plain${open ? ' is-open' : ''}`} data-thread={thread.id}
            aria-label={rowLabel}
            onClick={onOpen}>
      <span style={{ minWidth: 0, display: 'block' }}>
        <span className="cmt-list-top">
          <CommentFace name={shownAuthor(thread.root.authorName)} userId={thread.root.authorId} color={thread.root.authorColor} size={16} />
          <span className="cmt-list-who">{shownAuthor(thread.root.authorName)}</span>
          {thread.root.createdAt != null && <span className="cmt-list-when">{commentTimeWords(thread.root.createdAt, now)}</span>}
          {thread.unread && <span className="cmt-list-new" role="img" aria-label={tr`Unread`} />}
        </span>
        <span className="cmt-list-text">{first}</span>
        <span className="cmt-list-foot" style={{ display: 'block' }}>
          {[where, replies ? threadSummaryLine(thread, now) : null].filter(Boolean).join(' · ') || tr`No replies yet`}
        </span>
      </span>
    </button>
  );
}

// Module scope, so a message descriptor: read with tr(GONE_WORDS) as it is drawn.
export const GONE_WORDS = msg`Its words were removed`;

// The Comments tab of a doc's side panel: every thread in the doc's order.
// Each is a short row; the open one is the whole conversation with the box
// to reply in, and the one gold bar. Resolved ones wait in a section at the
// bottom that opens on a press.
//
//   entries      the doc's threads (docState.readComments)
//   anchors      Map id → { order, quote, pageId } for threads whose words are in the doc
//   selectedId   the open thread; onSelect(id | null), onJump(id, pageId)
//   flashRowId   a reply a link pointed at
//   focusId      the thread opened from the keyboard: its card takes the caret
//   sheet        the panel is a phone's sheet, over the words: opening a
//                thread reads it there, and its title is the way to its words
export function DocThreadsPanel({
  ydoc, scope, entries = [], anchors, currentUser = null, canEdit = true, guest = false,
  workspaceId = null, boardId = null, cardId = null,
  selectedId = null, onSelect, onJump, flashRowId = null, focusId = null, shortcut = null, sheet = false,
}) {
  const feedback = useFeedback();
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
  const hostRef = useRef(null);
  const { threads, people, seen } = useDocThreads({ entries, currentUser, canEdit, workspaceId, boardId, cardId });
  const ops = docThreadOps({ ydoc, scope, surface: 'doc', currentUser, canEdit, guest, workspaceId, boardId, cardId, feedback });

  // In the doc's order; a thread whose words are gone after those.
  const ordered = useMemo(() => {
    const has = (t) => !!anchors?.has(t.id);
    const placed = threads.filter(has).sort((a, b) => anchors.get(a.id).order - anchors.get(b.id).order);
    return [...placed, ...threads.filter((t) => !has(t))];
  }, [threads, anchors]);
  const open = ordered.filter((t) => !t.resolved);
  const resolved = ordered.filter((t) => t.resolved);
  const picked = ordered.find((t) => t.id === selectedId) || null;
  const shown = useOpenThreadRead(picked, seen);

  // The Resolved section opens for a resolved thread that was picked (from a
  // link, or reopened and resolved again), and stays as the person left it.
  const [showResolved, setShowResolved] = useState(false);
  const pickedResolved = !!picked?.resolved;
  useEffect(() => { if (pickedResolved) setShowResolved(true); }, [pickedResolved, selectedId]);

  // The open thread is kept in view.
  useEffect(() => {
    if (!selectedId) return;
    requestAnimationFrame(() => {
      const el = [...(hostRef.current?.querySelectorAll('[data-thread]') || [])].find((n) => n.getAttribute('data-thread') === selectedId);
      el?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [selectedId, showResolved]);
  useFlashRow(hostRef, flashRowId, shown?.id || null);

  const quoteOf = (t) => anchors?.get(t.id)?.quote || '';
  const show = (t) => onJump?.(t.id, anchors?.get(t.id)?.pageId || t.root.meta?.pageId || null);
  const go = (t) => { onSelect?.(t.id); if (!sheet) show(t); };
  // Closing the open thread leaves the caret on its row (what a key opened
  // it from may be gone: the margin's dots step aside while the panel shows).
  const shut = (id) => {
    onSelect?.(null);
    requestAnimationFrame(() => {
      const el = [...(hostRef.current?.querySelectorAll('button[data-thread]') || [])].find((n) => n.getAttribute('data-thread') === id);
      el?.focus({ preventScroll: true });
    });
  };
  const draw = (t) => {
    const quote = quoteOf(t);
    if (!shown || t.id !== shown.id) {
      return <li key={t.id}><ThreadRow thread={t} now={now} where={quote ? tr`“${quote}”` : tr(GONE_WORDS)} onOpen={() => go(t)} /></li>;
    }
    return (
      <li key={t.id} className="cmt-thread is-open" data-thread={t.id}>
        <CommentCard
          thread={shown}
          me={ops.me}
          powers={ops.powers(shown)}
          // no "@" in a doc shared on its own (see NewDocComment)
          people={guest ? null : people}
          variant="panel"
          title={quote ? tr`“${quote}”` : tr(GONE_WORDS)}
          onTitle={quote ? () => show(t) : null}
          draftKey={commentDraftKey({ userId: ops.me?.id, surface: 'doc', scope: cardId, targetId: t.id })}
          readOnlyNote={tr(READ_ONLY_LINE.doc)}
          takeFocus={focusId === t.id}
          onClose={() => shut(t.id)}
          // Your own face opens your profile: in the app only (a doc shared
          // on its own has no Settings), and from the side panel, which
          // Settings covers. A phone's sheet lies over Settings, so there a
          // face is only a face.
          onOwnFace={!guest && !sheet && ops.me?.id ? () => openProfile('comment') : null}
          {...ops.handlers(shown, { onGone: () => onSelect?.(null) })}
        />
      </li>
    );
  };

  return (
    <div ref={hostRef} className="cmt-panel">
      {ordered.length === 0 && (
        <div className="cmt-list-empty">
          <b><Trans>No comments yet</Trans></b>
          {canEdit ? <><Trans>Select some words, then Comment</Trans>{shortcut ? <> {shortcut}</> : null}</> : tr`Comments on this doc show up here.`}
        </div>
      )}
      {ordered.length > 0 && open.length === 0 && (
        <div className="cmt-list-empty"><b><Trans>Nothing open</Trans></b><Trans>Every comment is resolved.</Trans></div>
      )}
      {open.length > 0 && <ul className="cmt-threads" aria-label={tr`Open comments`}>{open.map(draw)}</ul>}
      {resolved.length > 0 && (
        <>
          <button type="button" className="cmt-fold" aria-expanded={showResolved} onClick={() => setShowResolved((v) => !v)}>
            <Icon as={ChevronRight} size={14} weight="regular" />
            {tr`Resolved`} <span className="cmt-list-tab-n">{resolved.length}</span>
          </button>
          {showResolved && <ul className="cmt-threads" aria-label={tr`Resolved comments`}>{resolved.map(draw)}</ul>}
        </>
      )}
    </div>
  );
}
