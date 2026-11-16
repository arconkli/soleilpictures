import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../Icon.jsx';
import { ChevronRight } from '../../lib/icons.js';
import { fromFileRows } from '../../lib/commentModel.js';
import { commentPowers, stayedResolved, REPLY_NOT_REOPENED } from '../../lib/commentRules.js';
import { commentDraftKey } from '../../lib/commentDraft.js';
import { commentLinkUrl } from '../../lib/commentLinkUrl.js';
import { commentTimeWords, threadSummaryLine } from '../../lib/commentTime.js';
import { subscribeMinute, minuteNow } from '../../lib/minuteTick.js';
import { shownAuthor, commentBy, resolvedCommentBy } from '../../lib/commentAuthor.js';
import { FILE_COMMENT_MAX_CHARS, formatAt } from '../../lib/fileShares.js';
import { friendlyShareError } from '../../lib/fileSharesWords.js';
import { undoToast } from '../../lib/undoToast.js';
import { logEvent } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { CommentCard } from './CommentCard.jsx';
import { CommentComposer } from './CommentComposer.jsx';
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import './commentsLook.css';

const TIMED = new Set(['video', 'audio']);
const NARROW = '(max-width: 899px)';

// The rail stacks under the file at this width (fileShare.css): the box you
// write in then sits right under the player.
const subscribeNarrow = (cb) => {
  const mq = window.matchMedia?.(NARROW);
  if (!mq) return () => {};
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};
const isNarrow = () => !!window.matchMedia?.(NARROW)?.matches;

// Along the file: by time or page, then by when it was written; a comment on
// the whole file after those.
const place = (t) => t.root.meta.atMs ?? t.root.meta.page ?? Infinity;
const byPlace = (a, b) => (place(a) - place(b)) || ((a.root.createdAt || 0) - (b.root.createdAt || 0));

function chipWords(meta) {
  if (meta.atMs != null) return formatAt(meta.atMs);
  if (meta.page != null) { const page = meta.page; return tr`p. ${page}`; }
  return null;
}

// Where a comment sits: its time or its page. Neutral; gold only on the
// active one. One made on an earlier version of the file is muted and says
// why: its time is not a time in what is playing now.
function Chip({ meta, active = false, onGo = null }) {
  const words = chipWords(meta);
  if (!words) return null;
  const old = !meta.onCurrent;
  const cls = `fsr-chip${active && !old ? ' is-active' : ''}${old ? ' is-old' : ''}`;
  if (old) {
    const why = meta.atMs != null ? tr`Time on an earlier version` : tr`Page on an earlier version`;
    return <span className={cls} title={why}>{words}</span>;
  }
  if (!onGo) return <span className={cls}>{words}</span>;
  return <button type="button" className={cls} aria-label={tr`Go to ${words}`} onClick={onGo}>{words}</button>;
}

// One conversation that is not the active one: where, who, the first words,
// and how much was said since. The whole row makes it the active one.
function FileRow({ thread, now, open = false, onOpen }) {
  const root = thread.root;
  const first = root.deleted ? tr`Comment deleted` : root.body;
  const words = String(first).slice(0, 60);
  const whose = thread.resolved ? resolvedCommentBy(root.authorName, root.meta.mine) : commentBy(root.authorName, root.meta.mine);
  return (
    <button
      type="button"
      className={`cmt-list-row fsr-row${open ? ' is-open' : ''}`}
      data-thread={thread.id}
      aria-label={root.deleted ? first : tr`${whose}: ${words}`}
      aria-current={open || undefined}
      onClick={(e) => onOpen(e.detail === 0)}
    >
      <span className="fsr-chipcol"><Chip meta={root.meta} active={open} /></span>
      <span className="fsr-rowmain">
        <span className="cmt-list-top">
          {!root.deleted && <span className="cmt-list-who">{shownAuthor(root.authorName)}</span>}
          {root.createdAt != null && <span className="cmt-list-when">{commentTimeWords(root.createdAt, now)}</span>}
        </span>
        <span className={`cmt-list-text${root.deleted ? ' fsr-gone' : ''}`}>{first}</span>
        <span className="cmt-list-foot" style={{ display: 'block' }}>{threadSummaryLine(thread, now)}</span>
      </span>
    </button>
  );
}

// The box a new comment is written in, with the moment it will sit at: the
// time the player is on, or the page. Pressing the moment takes it off (a
// comment on the whole file) or puts it back.
function NewBox({ token, kind, api, feedback, reload, getAnchor, currentPage, onFocusCompose, focusRequest, userKey }) {
  const timed = TIMED.has(kind);
  const paged = kind === 'pdf';
  const [pinned, setPinned] = useState(timed || paged);
  const [atMs, setAtMs] = useState(null);
  const hostRef = useRef(null);

  useEffect(() => {
    if (!timed) return undefined;
    const read = () => {
      const a = getAnchor?.();
      if (a && Number.isFinite(a.atMs)) setAtMs(Math.max(0, Math.round(a.atMs)));
    };
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [timed, getAnchor]);

  // Only a request made while this box is up takes the caret: the box is
  // drawn again when the rail moves under the player (a phone turned, a
  // conversation closed), and an old request must not open the keyboard.
  const handled = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === handled.current) return;
    handled.current = focusRequest;
    if (focusRequest) hostRef.current?.querySelector('.cmt-input')?.focus();
  }, [focusRequest]);

  const send = async ({ body }) => {
    const args = { body, replyTo: null, atMs: null, page: null };
    if (timed && pinned && atMs != null) args.atMs = atMs;
    if (paged && pinned && currentPage) args.page = currentPage;
    const { error } = (await api.addFileComment(token, args)) || {};
    if (error) {
      feedback?.toast?.({ type: 'error', code: 'file_comment_add_failed', message: friendlyShareError(error) });
      throw new Error('file comment not sent');
    }
    logEvent(EV.FILE_COMMENT_ADD, { kind, reply: false, pinned: args.atMs != null ? 'time' : args.page != null ? 'page' : null });
    await reload();
  };

  const meta = { atMs: timed ? atMs : null, page: paged ? (currentPage || 1) : null, onCurrent: true };
  const chip = pinned ? chipWords(meta) : null;
  return (
    <div
      ref={hostRef}
      className="fsr-new"
      onFocus={(e) => { if (timed && e.target?.matches?.('.cmt-input')) onFocusCompose?.(); }}
    >
      {(timed || paged) && (
        <button type="button" className={`fsr-moment${pinned ? ' is-on' : ''}`} aria-pressed={pinned} onClick={() => setPinned((p) => !p)}>
          {chip && <span className="fsr-chip is-at">{chip}</span>}
          <span className="fsr-moment-words">
            {!pinned ? tr`Comment on the whole file` : timed ? tr`Comment at this moment` : tr`Comment on this page`}
          </span>
        </button>
      )}
      <CommentComposer
        mode="new"
        draftKey={commentDraftKey({ userId: userKey, surface: 'file', scope: token, targetId: 'new' })}
        maxLength={FILE_COMMENT_MAX_CHARS}
        placeholder={tr`Add a comment…`}
        onSubmit={send}
        onCancel={() => { const a = document.activeElement; if (hostRef.current?.contains(a)) a.blur?.(); }}
      />
    </div>
  );
}

// A shared file's conversations (the rail on /f/<token> and in the app's
// shared-file view): a short row each, the active one open as the whole
// conversation with the box to reply in and the one gold bar. Resolved ones
// and the ones made on an earlier version of the file wait in sections at
// the bottom that open on a press.
//
//   rows          the comments as get_file_comments answers them
//   reload()      reads them again; resolves the new rows, or null
//   activeId      the active conversation's id (the page keeps it: the
//                 timeline's markers light with it)
//   onActivate(id | null), onSeek({ at_ms, page })
//   linkedId      a comment the address asked for; onLinkDone() once it was
//                 opened (or found gone)
//   composeSlot   an element right under the player: at narrow widths the box
//                 (the open conversation, or a new comment) is drawn there
//   holdRef       .current is true while unsent words are in the open card
export function FileThreads({
  token, rows, kind, signedIn = false, canComment = false, api, feedback = null, reload,
  getAnchor, currentPage = null, onSeek, onFocusCompose, activeId = null, onActivate,
  focusRequest = 0, linkedId = null, onLinkDone, composeSlot = null, holdRef = null, userId = null,
}) {
  const now = useSyncExternalStore(subscribeMinute, minuteNow, minuteNow);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  const hostRef = useRef(null);
  const [showResolved, setShowResolved] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const [focusId, setFocusId] = useState(null);
  const [flashRowId, setFlashRowId] = useState(null);
  const bring = useRef(false);   // a link opened it: bring it into view, wherever it is

  const threads = useMemo(() => fromFileRows(rows).sort(byPlace), [rows]);
  const current = threads.filter((t) => t.root.meta.onCurrent);
  const open = current.filter((t) => !t.resolved);
  const resolved = current.filter((t) => t.resolved);
  const old = threads.filter((t) => !t.root.meta.onCurrent);
  const active = activeId ? threads.find((t) => t.id === activeId) || null : null;

  const canCompose = signedIn && canComment;
  // A shared file never says who its viewer is, only which rows are theirs.
  const me = signedIn ? { id: 'me' } : null;
  // Unsent words are kept under the person's own id (the page reads it from
  // the session), so two people on one browser never see each other's.
  const userKey = signedIn ? (userId || 'me') : null;
  const powersOf = (thread) => (row) => commentPowers({ me, row, thread, canRead: canCompose, canWrite: false });
  // Each failure names its own code beside type: 'error' (lib/errorToastContract.test.mjs).
  const say = (toast, error) => feedback?.toast?.({ ...toast, message: friendlyShareError(error) });

  // The active conversation is gone (deleted here or by someone else).
  const missing = !!activeId && !active;
  useEffect(() => { if (missing) onActivate?.(null); }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Its section opens for an active conversation that sits in one.
  const inResolved = !!active && active.resolved && active.root.meta.onCurrent;
  const inOld = !!active && !active.root.meta.onCurrent;
  useEffect(() => { if (inResolved) setShowResolved(true); }, [inResolved, activeId]);
  useEffect(() => { if (inOld) setShowOld(true); }, [inOld, activeId]);

  // …and it is kept in view. At narrow widths the list is under the file, so
  // only a link's own conversation scrolls the page down to it.
  useEffect(() => {
    if (!activeId || (narrow && !bring.current)) return;
    bring.current = false;
    requestAnimationFrame(() => {
      const el = [...(hostRef.current?.querySelectorAll('[data-thread]') || [])].find((n) => n.getAttribute('data-thread') === activeId);
      el?.scrollIntoView?.({ block: 'nearest' });
    });
  }, [activeId, showResolved, showOld, narrow]);

  // A link pointed at one reply: it is lit for a moment.
  useEffect(() => {
    if (!flashRowId || !activeId) return undefined;
    let el = null;
    const raf = requestAnimationFrame(() => {
      el = [...document.querySelectorAll('.fsp [data-cmt-row]')].find((n) => n.getAttribute('data-cmt-row') === flashRowId) || null;
      el?.classList.add('is-flash');
    });
    const timer = setTimeout(() => { el?.classList.remove('is-flash'); setFlashRowId(null); }, 2000);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); el?.classList.remove('is-flash'); };
  }, [flashRowId, activeId]);

  // → what onSeek answers: for a video, a promise that settles once the
  // player is at the time (it may still be on its way down)
  const go = (t) => (t.root.meta.onCurrent ? onSeek?.({ at_ms: t.root.meta.atMs, page: t.root.meta.page }) : undefined);
  const pick = (t, byKey = false) => {
    setFocusId(byKey ? t.id : null);
    onActivate?.(t.id);
    return go(t);
  };
  // Closing the active one leaves the caret on its row.
  const shut = (id) => {
    onActivate?.(null);
    if (holdRef) holdRef.current = false;
    requestAnimationFrame(() => {
      const el = [...(hostRef.current?.querySelectorAll('button[data-thread]') || [])].find((n) => n.getAttribute('data-thread') === id);
      el?.focus({ preventScroll: true });
    });
  };

  // The address asked for one comment: once the list is in, its conversation
  // is the active one.
  const linked = useRef(false);
  useEffect(() => {
    if (!linkedId || linked.current) return;
    linked.current = true;
    const t = threads.find((x) => x.id === linkedId || x.replies.some((r) => r.id === linkedId));
    const row = t ? [t.root, ...t.replies].find((r) => r.id === linkedId) : null;
    if (!t || !row || (row.deleted && row.id !== t.id)) {
      feedback?.toast?.({ type: 'info', message: tr`That comment isn't here any more` });
      onLinkDone?.();
      return;
    }
    bring.current = true;
    setFlashRowId(row.id !== t.id ? row.id : null);
    // The address keeps the comment until the file is at its time: a page
    // loaded again before then asks for it again.
    Promise.resolve(pick(t)).then(() => onLinkDone?.(), () => onLinkDone?.());
  }, [linkedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- what the card asks for ------------------------------------------
  const handlers = (thread) => {
    const top = powersOf(thread)(null);
    return {
      // A reply to a resolved conversation reopens it for someone who may;
      // from anyone else it is sent and the conversation stays put away
      // (until the database reopens it itself), and they are told.
      // The reply goes first: one that could not be sent leaves the
      // conversation as it was.
      onReply: async ({ body }) => {
        const wasResolved = !!thread.resolved;
        const mayReopen = wasResolved && !!top.reopen;
        const { error } = (await api.addFileComment(token, { body, replyTo: thread.id, atMs: null, page: null })) || {};
        if (error) { say({ type: 'error', code: 'file_comment_add_failed' }, error); throw new Error('file reply not sent'); }
        logEvent(EV.FILE_COMMENT_ADD, { kind, reply: true, pinned: null });
        // its answer is not trusted: what the comments say next is
        if (mayReopen) { try { await api.resolveFileComment(thread.id, false); } catch (_) { /* read below */ } }
        const fresh = await reload();
        if (wasResolved && stayedResolved((fresh || []).find((r) => r.id === thread.id) || null)) {
          // someone who may reopen it is told their reopen failed, not that they may not
          feedback?.toast?.({ type: 'info', message: mayReopen ? tr`Sent, but it couldn't be reopened. Try again.` : tr(REPLY_NOT_REOPENED) });
        }
      },
      // The function arrives with the comments migration: until then the call
      // answers "no such function", and the words stay in the box.
      onEdit: async (rowId, { body }) => {
        const res = typeof api.editFileComment === 'function' ? await api.editFileComment(rowId, body) : { error: { code: 'PGRST202' } };
        const error = res?.error;
        if (error) {
          const absent = error.code === 'PGRST202' || error.status === 404 || /could not find the function/i.test(String(error.message || ''));
          if (absent) feedback?.toast?.({ type: 'info', code: 'file_comment_edit_unavailable', message: tr`Editing isn't available yet.` });
          else say({ type: 'error', code: 'file_comment_edit_failed' }, error);
          throw new Error('file comment not changed');
        }
        await reload();
      },
      onDelete: async (rowId) => {
        const { error } = (await api.deleteFileComment(rowId)) || {};
        if (error) { say({ type: 'error', code: 'file_comment_delete_failed' }, error); return; }
        reload();
        undoToast(feedback, {
          message: rowId === thread.id ? tr`Comment deleted` : tr`Reply deleted`,
          onUndo: async () => {
            const r = await api.restoreFileComment(rowId);
            if (r?.error) say({ type: 'error', code: 'file_comment_restore_failed' }, r.error);
            reload();
          },
        });
      },
      onResolve: async () => {
        const { error } = (await api.resolveFileComment(thread.id, true)) || {};
        if (error) { say({ type: 'error', code: 'file_comment_resolve_failed' }, error); throw new Error('file comment not resolved'); }
        await reload();
        // As on the canvas: it is put away under Resolved, with a way back.
        undoToast(feedback, {
          message: tr`Comment resolved`,
          onUndo: async () => {
            const r = await api.resolveFileComment(thread.id, false);
            if (r?.error) say({ type: 'error', code: 'file_comment_resolve_failed' }, r.error);
            reload();
          },
        });
      },
      onReopen: async () => {
        const { error } = (await api.resolveFileComment(thread.id, false)) || {};
        if (error) { say({ type: 'error', code: 'file_comment_resolve_failed' }, error); throw new Error('file comment not reopened'); }
        await reload();
      },
      onCopyLink: async (rowId) => {
        const url = commentLinkUrl(window.location.href, { surface: 'file', token, commentId: rowId });
        try {
          if (!url) throw new Error('no link');
          await navigator.clipboard.writeText(url);
          feedback?.toast?.({ type: 'success', message: tr`Link copied` });
        } catch (_) {
          feedback?.toast?.({ type: 'error', code: 'link_copy_failed', message: tr`Could not copy link` });
        }
      },
    };
  };

  const card = (t) => (
    <CommentCard
      thread={t}
      me={me}
      powers={powersOf(t)}
      variant="dark"
      draftKey={commentDraftKey({ userId: userKey, surface: 'file', scope: token, targetId: t.id })}
      maxLength={FILE_COMMENT_MAX_CHARS}
      headerExtra={chipWords(t.root.meta) ? <Chip meta={t.root.meta} active onGo={() => { go(t); }} /> : null}
      takeFocus={focusId === t.id}
      onClose={() => shut(t.id)}
      onDirtyChange={(on) => { if (holdRef) holdRef.current = !!on; }}
      {...handlers(t)}
    />
  );
  // At narrow widths the open conversation is under the player, and its row
  // stays in the list with the gold bar.
  const inSlot = narrow && !!composeSlot;
  const draw = (t) => {
    if (t.id !== activeId || inSlot) {
      return <li key={t.id}><FileRow thread={t} now={now} open={t.id === activeId} onOpen={(byKey) => pick(t, byKey)} /></li>;
    }
    return <li key={t.id} className="cmt-thread is-open" data-thread={t.id}>{card(t)}</li>;
  };

  const box = canCompose ? (
    <NewBox token={token} kind={kind} api={api} feedback={feedback} reload={reload} getAnchor={getAnchor}
            currentPage={currentPage} onFocusCompose={onFocusCompose} focusRequest={focusRequest} userKey={userKey} />
  ) : null;
  const under = inSlot && active ? <div className="fsr-under" data-thread-open={active.id}>{card(active)}</div> : box;

  return (
    <div ref={hostRef} className="fsr">
      <div
        className="fsr-list"
        onClick={(e) => {
          // a press on the empty rail: nothing is active
          if (activeId && !e.target.closest?.('[data-thread], button, a, .cmt-card, .cmt-composer')) shut(activeId);
        }}
      >
        {threads.length === 0 && (
          <p className="fsr-note">
            {canCompose && TIMED.has(kind) ? tr`No comments yet. Pause anywhere and leave the first one.` : tr`No comments yet.`}
          </p>
        )}
        {current.length > 0 && open.length === 0 && (
          <div className="cmt-list-empty"><b><Trans>Nothing open</Trans></b><Trans>Every comment is resolved.</Trans></div>
        )}
        {open.length > 0 && <ul className="cmt-threads" aria-label={tr`Open comments`}>{open.map(draw)}</ul>}
        {resolved.length > 0 && (
          <>
            <button type="button" className="cmt-fold" data-fold="resolved" aria-expanded={showResolved} onClick={() => setShowResolved((v) => !v)}>
              <Icon as={ChevronRight} size={14} weight="regular" />
              {tr`Resolved`} <span className="cmt-list-tab-n">{resolved.length}</span>
            </button>
            {showResolved && <ul className="cmt-threads" aria-label={tr`Resolved comments`}>{resolved.map(draw)}</ul>}
          </>
        )}
        {old.length > 0 && (
          <>
            <button type="button" className="cmt-fold" data-fold="earlier" aria-expanded={showOld} onClick={() => setShowOld((v) => !v)}>
              <Icon as={ChevronRight} size={14} weight="regular" />
              {tr`On an earlier version`} <span className="cmt-list-tab-n">{old.length}</span>
            </button>
            {showOld && <ul className="cmt-threads" aria-label={tr`Comments on an earlier version`}>{old.map(draw)}</ul>}
          </>
        )}
      </div>
      {inSlot ? (under ? createPortal(under, composeSlot) : null) : (box && <div className="fsr-foot">{box}</div>)}
    </div>
  );
}
