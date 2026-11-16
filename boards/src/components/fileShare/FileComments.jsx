// The comment rail on a shared file (/f/<token>, and the same view inside
// the app). Comments come from get_file_comments; every name and every body
// is rendered as TEXT (React children), never as HTML.
//
// This file is the rail's frame: it reads the comments (every 15 seconds
// while the tab is looked at), counts them in its header and says when a
// read failed. The conversations themselves are the shared comment parts
// (components/comments/FileThreads.jsx over CommentCard), which arrive as
// a chunk of their own (fileCommentParts.js: no canvas or doc code) behind
// the boundary every comment surface uses
// (commentPartsLazy.jsx). If that chunk cannot be had, the rail says so and
// offers to try again; the file above it is untouched.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { readCommentLink, withoutCommentLink } from '../../lib/commentLink.js';
import { logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { useOptionalFeedback } from '../AppFeedback.jsx';
import { fileCommentPart, CommentPartsBoundary } from '../comments/commentPartsLazy.jsx';
import { initialOf } from '../../lib/graphemes.js';
import { t, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const POLL_MS = 15000;
const FileThreads = fileCommentPart('FileThreads');

const safeAvatar = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);
const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : null);

export function Avatar({ name, url, color, size = 24 }) {
  const [broken, setBroken] = useState(false);
  const src = broken ? null : safeAvatar(url);
  const initial = initialOf(name);
  return (
    <span className="fsc-avatar" style={{ width: size, height: size, ...(safeColor(color) ? { background: safeColor(color) } : {}) }} aria-hidden="true">
      {src
        ? <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : initial}
    </span>
  );
}

// The comment this address asks for (/f/<token>?comment=<id>), or null.
function linkedComment(token) {
  if (typeof window === 'undefined') return null;
  const at = readCommentLink(window.location.href);
  if (at?.surface === 'file' && at.token === String(token || '').toLowerCase()) return at.commentId;
  if (import.meta.env.DEV) {
    // the dev harness shows the page at /?fileshareqa=<fixture>
    const q = new URLSearchParams(window.location.search);
    if (q.has('fileshareqa')) return q.get('comment') || null;
  }
  return null;
}

//   composeSlot   an element under the player: at narrow widths the box you
//                 write in is drawn there (FileThreads.jsx)
//   holdRef       .current is true while unsent words are in the open card
//   userId        who is signed in (unsent words are kept under it); undefined
//                 while that is being read, and the conversations wait for it
export function FileComments({
  token, signedIn, canComment = signedIn, kind, getAnchor, currentPage = null,
  onSeek, onFocusCompose, onComments, activeId = null, onActivate, signInHref,
  focusRequest = 0, api, composeSlot = null, holdRef = null, userId = null,
  // the comment a notice asked for, when the file opens over the app (its
  // address is the app's, so it names none)
  linked = null,
}) {
  const feedback = useOptionalFeedback();
  const [list, setList] = useState(null);
  const [loadErr, setLoadErr] = useState(false);
  // The conversations could not be drawn: 'chunk' when their download failed,
  // 'bug' when they threw. `tries` remounts their boundary.
  const [partFailed, setPartFailed] = useState(null);
  const [tries, setTries] = useState(0);
  const [linkedId, setLinkedId] = useState(() => linked || linkedComment(token));
  const alive = useRef(true);
  const onCommentsRef = useRef(onComments);
  onCommentsRef.current = onComments;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // → the rows, or null when the read failed
  const load = useCallback(async () => {
    const { data, error } = await api.listFileComments(token);
    if (!alive.current) return null;
    if (error || !data || data.status !== 'ok') { setLoadErr(true); return null; }
    const rows = Array.isArray(data.comments) ? data.comments : [];
    setLoadErr(false);
    setList(rows);
    onCommentsRef.current?.(rows);
    return rows;
  }, [api, token]);

  // Poll while the tab is visible, and catch up the moment it comes back.
  useEffect(() => {
    load();
    const tick = () => { if (document.visibilityState === 'visible') load(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [load]);

  const onLinkDone = useCallback(() => {
    setLinkedId(null);
    if (linked) return;   // it came from a notice: the address is the app's own
    try { window.history.replaceState(window.history.state, '', withoutCommentLink(window.location.href)); } catch (_) { /* the address stays */ }
  }, [linked]);
  const onPartFail = useCallback((_e, info) => setPartFailed(info?.chunk ? 'chunk' : 'bug'), []);
  // A browser keeps a download that failed for the page's life and answers
  // the next ask with the same failure (lib/lazyWithReload.js), so asking for
  // the chunk again means loading the page again. Unsent words are kept.
  const retryPart = useCallback(() => {
    if (partFailed === 'chunk') { window.location.reload(); return; }
    setPartFailed(null);
    setTries((n) => n + 1);
  }, [partFailed]);

  // Conversations, not replies; the ones on an earlier version of the file
  // are counted by their own section.
  const roots = (list || []).filter((c) => !c.reply_to && c.on_current !== false);
  const nOpen = roots.filter((c) => !c.resolved).length;
  const nResolved = roots.length - nOpen;
  const canCompose = signedIn && canComment;

  return (
    <section className="fsc" aria-label={t`Comments`}>
      <header className="fsc-head">
        <h2 className="fsc-title"><Trans>Comments</Trans></h2>
        {list && (
          <span className="fsc-total">
            {plural(nOpen, { one: '# open', other: '# open' })}
            {nResolved > 0 && <> · {plural(nResolved, { one: '# resolved', other: '# resolved' })}</>}
          </span>
        )}
      </header>
      {/* A refresh failed with a list on screen: said quietly, until the next one works. */}
      {list && loadErr && <p className="fsc-stale" role="status"><Trans>Couldn't refresh. Trying again…</Trans></p>}
      <div className="fsc-body cmt-dark" data-keys-own onContextMenu={(e) => e.stopPropagation()}>
        {list === null && !loadErr && <p className="fsr-note"><Trans>Loading comments…</Trans></p>}
        {loadErr && list === null && (
          <p className="fsr-note"><Trans>Couldn't load comments.</Trans> <button type="button" className="fsc-link" onClick={load}><Trans>Try again</Trans></button></p>
        )}
        {list && partFailed && (
          <p className="fsr-note">
            <Trans>Couldn't load comments.</Trans>{' '}
            <button type="button" className="fsc-link" onClick={retryPart}><Trans>Try again</Trans></button>
          </p>
        )}
        {list && !partFailed && userId !== undefined && (
          <CommentPartsBoundary key={tries} onFail={onPartFail}>
            <Suspense fallback={<p className="fsr-note"><Trans>Loading comments…</Trans></p>}>
              <FileThreads
                token={token} rows={list} kind={kind} signedIn={!!signedIn} canComment={!!canComment}
                api={api} feedback={feedback} reload={load}
                getAnchor={getAnchor} currentPage={currentPage} onSeek={onSeek} onFocusCompose={onFocusCompose}
                activeId={activeId} onActivate={onActivate} focusRequest={focusRequest}
                linkedId={linkedId} onLinkDone={onLinkDone} composeSlot={composeSlot} holdRef={holdRef}
                userId={userId}
              />
            </Suspense>
          </CommentPartsBoundary>
        )}
      </div>
      {!canCompose && (
        <footer className="fsc-foot">
          {!signedIn ? (
            <a className="fsc-signin" href={signInHref}
               onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'comments' })}>
              <Trans>Sign in to comment</Trans>
            </a>
          ) : (
            <p className="fsr-note"><Trans>You can read comments on this file, but not add them.</Trans></p>
          )}
        </footer>
      )}
    </section>
  );
}

export default FileComments;
