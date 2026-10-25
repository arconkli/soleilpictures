// The comment rail on a shared file (/f/<token>). Comments come from 0421's
// get_file_comments; every name and every body is rendered as TEXT (React
// children, white-space: pre-wrap), never as HTML.
//
// Video and audio comments pin to a time, pdf comments to a page: focusing the
// composer pauses the player and pins where it is, with a toggle to unpin.
// Delete is a soft delete with the house undo toast (restore_file_comment).
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FILE_COMMENT_MAX_CHARS, formatAt, groupComments, friendlyShareError,
} from '../../lib/fileShares.js';
import { relativeTimeShort } from '../../lib/relativeTime.js';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import { undoToast } from '../../lib/undoToast.js';

const POLL_MS = 15000;
const COUNTER_FROM = 1800;
const TIMED = new Set(['video', 'audio']);

const safeAvatar = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

export function Avatar({ name, url, color, size = 24 }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : safeAvatar(url);
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="fsc-avatar" style={{ width: size, height: size, ...(safeColor(color) ? { background: safeColor(color) } : {}) }} aria-hidden="true">
      {src
        ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initial}
    </span>
  );
}

function anchorLabel(c) {
  if (c.at_ms != null) return formatAt(c.at_ms);
  if (c.page != null) return `p. ${c.page}`;
  return null;
}

// A composer: the main one at the bottom of the rail, or a reply under a comment.
function Composer({ kind, reply = null, getAnchor, currentPage, onFocusCompose, onSend, onCancel, autoFocus = false, focusRequest = 0 }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timed = !reply && TIMED.has(kind);
  const paged = !reply && kind === 'pdf';
  const [pinned, setPinned] = useState(timed || paged);
  const [atMs, setAtMs] = useState(null);
  const ref = useRef(null);

  useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (focusRequest) ref.current?.focus(); }, [focusRequest]);

  const capture = () => {
    const a = getAnchor?.();
    if (a && Number.isFinite(a.atMs)) setAtMs(Math.max(0, Math.round(a.atMs)));
  };
  const onFocus = () => {
    if (timed) { onFocusCompose?.(); if (pinned) capture(); }
  };
  const togglePin = () => {
    setPinned((p) => {
      const next = !p;
      if (next && timed) capture();
      return next;
    });
  };

  const trimmed = body.trim();
  const send = async () => {
    if (!trimmed || busy) return;
    setBusy(true); setErr('');
    const args = { body: trimmed, replyTo: reply || null, atMs: null, page: null };
    if (timed && pinned && atMs != null) args.atMs = atMs;
    if (paged && pinned && currentPage) args.page = currentPage;
    const { error } = await onSend(args);
    setBusy(false);
    if (error) { setErr(friendlyShareError(error)); return; }
    setBody('');
    logEvent(EV.FILE_COMMENT_ADD, {
      kind, reply: !!reply,
      pinned: args.atMs != null ? 'time' : args.page != null ? 'page' : null,
    });
    if (reply) onCancel?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    else if (e.key === 'Escape' && reply) { e.preventDefault(); onCancel?.(); }
  };

  // A time pin appears once the composer has read the playhead (on focus).
  const pinText = timed ? (atMs != null ? `at ${formatAt(atMs)}` : null)
    : paged ? `on page ${currentPage || 1}` : null;

  return (
    <div className={`fsc-composer${reply ? ' is-reply' : ''}`}>
      <textarea
        ref={ref}
        className="fsc-input"
        value={body}
        maxLength={FILE_COMMENT_MAX_CHARS}
        rows={reply ? 2 : 3}
        placeholder={reply ? 'Reply…' : 'Add a comment…'}
        aria-label={reply ? 'Reply' : 'Add a comment'}
        onChange={(e) => { setBody(e.target.value); if (err) setErr(''); }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      {err && <p className="fsc-err" role="alert">{err}</p>}
      <div className="fsc-composer-row">
        {pinText && (
          <button type="button" className={`fsc-pin${pinned ? ' is-on' : ''}`} aria-pressed={pinned}
                  onClick={togglePin} title={pinned ? 'Unpin from this moment' : 'Pin to this moment'}>
            {pinned ? pinText : 'Not pinned'}
          </button>
        )}
        <span className="fsc-spacer" />
        {body.length >= COUNTER_FROM && (
          <span className="fsc-count" aria-live="polite">{body.length} / {FILE_COMMENT_MAX_CHARS}</span>
        )}
        {reply && <button type="button" className="fsc-btn" onClick={onCancel}>Cancel</button>}
        <button type="button" className="fsc-btn fsc-btn--send" disabled={!trimmed || busy} onClick={send}
                title="Send (⌘↵)">
          {reply ? 'Reply' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

function CommentRow({ c, isReply = false, activeId, canCompose, replying, onReply, onSeek, onResolve, onDelete }) {
  const ref = useRef(null);
  const active = activeId && activeId === c.id;
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [active]);
  const anchor = anchorLabel(c);
  const name = c.author?.name || 'Someone';
  return (
    <div ref={ref} className={`fsc-row${isReply ? ' is-reply' : ''}${active ? ' is-active' : ''}${c.deleted ? ' is-deleted' : ''}`}
         data-comment-id={c.id}>
      <div className="fsc-row-head">
        <Avatar name={name} url={c.author?.avatar_url} color={c.author?.color} size={isReply ? 20 : 24} />
        <span className="fsc-name">{c.deleted ? '' : name}</span>
        <span className="fsc-time" title={c.created_at || ''}>{relativeTimeShort(c.created_at)}</span>
      </div>
      {c.deleted ? (
        <p className="fsc-body fsc-body--deleted">Comment deleted</p>
      ) : (
        <>
          {(anchor || c.on_current === false) && (
            <div className="fsc-meta">
              {anchor && (
                <button type="button" className="fsc-chip" onClick={() => onSeek(c)}
                        aria-label={c.at_ms != null ? `Go to ${anchor}` : `Go to page ${c.page}`}>
                  {anchor}
                </button>
              )}
              {c.on_current === false && <span className="fsc-old">on an earlier version</span>}
            </div>
          )}
          <p className="fsc-body">{c.body}</p>
          <div className="fsc-actions">
            {!isReply && canCompose && !replying && (
              <button type="button" className="fsc-link" onClick={() => onReply(c.id)}>Reply</button>
            )}
            {!isReply && c.can_resolve && (
              <button type="button" className="fsc-link" onClick={() => onResolve(c)}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
            )}
            {c.can_delete && (
              <button type="button" className="fsc-link" onClick={() => onDelete(c)}>Delete</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function FileComments({
  token, access, signedIn, canComment = signedIn, kind, getAnchor, currentPage = null,
  onSeek, onFocusCompose, onComments, activeId = null, onActivate, signInHref,
  initialCount = null, focusRequest = 0, api,
}) {
  const feedback = useOptionalFeedback();
  const [list, setList] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [showResolved, setShowResolved] = useState(false);
  const onCommentsRef = useRef(onComments);
  onCommentsRef.current = onComments;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const { data, error } = await api.listFileComments(token);
    if (!alive.current) return;
    if (error || !data || data.status !== 'ok') { setLoadErr(true); return; }
    const rows = Array.isArray(data.comments) ? data.comments : [];
    setLoadErr(false);
    setList(rows);
    onCommentsRef.current?.(rows);
  }, [api, token]);

  // Poll while the tab is visible, and catch up the moment it comes back.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const send = async (args) => {
    const res = await api.addFileComment(token, args);
    if (!res?.error) load();
    return res || {};
  };

  const seek = (c) => { onActivate?.(c.id); onSeek?.(c); };

  const resolve = async (c) => {
    const { error } = await api.resolveFileComment(c.id, !c.resolved);
    if (error) feedback?.toast?.({ type: 'error', code: 'file_comment_resolve_failed', message: friendlyShareError(error) });
    load();
  };

  const remove = async (c) => {
    const { error } = await api.deleteFileComment(c.id);
    if (error) { feedback?.toast?.({ type: 'error', code: 'file_comment_delete_failed', message: friendlyShareError(error) }); return; }
    load();
    undoToast(feedback, {
      message: 'Comment deleted',
      onUndo: async () => {
        const r = await api.restoreFileComment(c.id);
        if (r?.error) feedback?.toast?.({ type: 'error', code: 'file_comment_restore_failed', message: friendlyShareError(r.error) });
        load();
      },
    });
  };

  const groups = groupComments(list || []);
  const total = list ? list.filter((c) => !c.deleted).length : initialCount;
  const canCompose = signedIn && canComment;

  const renderThread = (c) => (
    <li key={c.id} className="fsc-thread">
      <CommentRow c={c} activeId={activeId} canCompose={canCompose} replying={replyTo === c.id}
                  onReply={setReplyTo} onSeek={seek} onResolve={resolve} onDelete={remove} />
      {c.replies.length > 0 && (
        <ul className="fsc-replies">
          {c.replies.map((r) => (
            <li key={r.id}>
              <CommentRow c={r} isReply activeId={activeId} canCompose={canCompose}
                          onSeek={seek} onResolve={resolve} onDelete={remove} />
            </li>
          ))}
        </ul>
      )}
      {replyTo === c.id && canCompose && (
        <Composer kind={kind} reply={c.id} autoFocus onSend={send} onCancel={() => setReplyTo(null)} />
      )}
    </li>
  );

  return (
    <section className="fsc" aria-label="Comments">
      <header className="fsc-head">
        <h2 className="fsc-title">Comments</h2>
        {total != null && total > 0 && <span className="fsc-total">{total}</span>}
      </header>
      <div className="fsc-list" aria-live="polite">
        {list === null && !loadErr && <p className="fsc-empty">Loading comments…</p>}
        {loadErr && list === null && (
          <p className="fsc-empty">Couldn't load comments. <button type="button" className="fsc-link" onClick={load}>Try again</button></p>
        )}
        {list && groups.open.length === 0 && groups.resolved.length === 0 && (
          <p className="fsc-empty">{canCompose
            ? (TIMED.has(kind) ? 'No comments yet. Pause anywhere and leave the first one.' : 'No comments yet.')
            : 'No comments yet.'}</p>
        )}
        {groups.open.length > 0 && <ul className="fsc-threads">{groups.open.map(renderThread)}</ul>}
        {groups.resolved.length > 0 && (
          <div className="fsc-resolved">
            <button type="button" className="fsc-link fsc-resolved-toggle" aria-expanded={showResolved}
                    onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? 'Hide resolved' : `Show ${groups.resolved.length} resolved`}
            </button>
            {showResolved && <ul className="fsc-threads is-resolved">{groups.resolved.map(renderThread)}</ul>}
          </div>
        )}
      </div>
      <footer className="fsc-foot">
        {canCompose ? (
          <Composer kind={kind} getAnchor={getAnchor} currentPage={currentPage} onFocusCompose={onFocusCompose}
                    onSend={send} focusRequest={focusRequest} />
        ) : !signedIn ? (
          <a className="fsc-signin" href={signInHref}
             onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'comments' })}>
            Sign in to comment
          </a>
        ) : (
          <p className="fsc-empty">You can read comments on this file, but not add them.</p>
        )}
      </footer>
    </section>
  );
}

export default FileComments;
