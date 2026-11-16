// /f/<token>: one shared file, on its own. A dark screening room — the file
// is judged against black — with the comment rail beside it for people who can
// comment. Neutral ink at rest; gold only marks focus and the active comment.
//
// The party's /file-share presigns the file for THIS viewer (0421's
// get_file_share decides access as the caller). The page gets URLs, never
// storage keys: the RPC's keys are identifiers the party strips before it
// answers (they open nothing on their own). Viewers get the pseudo-keys
// r2:__fs/<token>/src and …/poster, which lib/fileShareUrls.js maps onto the
// latest presigned urls (a scoped resolver: the app's own files are untouched,
// so the same view can open over the app — variant 'overlay').
//
// Those urls live FILE_SHARE_URL_TTL_SECONDS (6h). The page re-fetches every 5
// minutes while visible and on coming back, so a stopped share turns into
// "isn't available" within one refresh. The resolver always answers the latest
// url, but a mounted video or PDF keeps the one it opened with, so once that is
// older than 5h (an hour before it dies) the viewer is remounted on the fresh
// one at the same place: a video only while it is stopped (or at once when the
// <video> errors, which also re-fetches), a PDF on the page it was on.
//
// The heavy viewers are lazy so each kind loads only its own.
//
// Someone who can manage the file (access 'manage': the answer then carries
// board_id and card_id) gets "Manage sharing" in the header, which opens the
// owner's dialog right here (lazy). When it closes, or any write lands
// (FILE_SHARE_CHANGED_EVENT), the page reads its state again.
//
// A doc (0426) is not a stored file: the answer names its live room, and
// DocShareView (lazy, held with the rest of doc sharing: docSharesAllowed)
// reads or edits it there, with the same header and the same Manage sharing.
//
// Inside the app (variant 'overlay', opened by lib/sharedFileBus.js from the
// Shared page, the bell or a shortcut) the same view is a dialog over the app:
// Close instead of the brand, Esc closes, and the host adds its own actions
// (Save a copy, Add shortcut). A signed-in open marks the file opened (0424),
// which also puts a link you opened on your "Shared with me" list.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lazyWithReload } from '../../lib/lazyWithReload.js';
import { createPortal } from 'react-dom';
import {
  fetchFileShare, listFileComments, addFileComment, resolveFileComment, deleteFileComment, restoreFileComment,
  editFileComment, markFileShareOpened, formatAt,
} from '../../lib/fileShares.js';
import { rememberShare } from '../../lib/fileShareUrls.js';
import { FILE_SHARE_URL_TTL_SECONDS, fsRef } from '../../lib/fileShareBundle.js';
import * as modalGuard from '../../lib/modalGuard.js';
import { isEditableTarget } from '../../lib/isEditableTarget.js';
import { readCommentLink, withoutCommentLink } from '../../lib/commentLink.js';
import { isComposingKey } from '../../lib/composerKeys.js';
import { docSharesAllowed, sharedFilesAllowed } from '../../lib/appHost.js';
import { Icon } from '../Icon.jsx';
import { X } from '../../lib/icons.js';
import { timeToFrame } from '../../lib/timecode.js';
import { logEvent, logEventNow, logEventOnce, seedFileShareFirstSource } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { ClustersMark } from '../SoleilWordmark.jsx';
import { FileComments, Avatar } from './FileComments.jsx';
import { FILE_SHARE_CHANGED_EVENT } from '../../lib/fileShareBus.js';
import './fileShare.css';
import { t as tr, ph, plural } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { sizeText } from '../../lib/intlFormat.js';

const FilmPlayer = lazyWithReload(() => import('../film/FilmPlayer.jsx').then((m) => ({ default: m.FilmPlayer })));
const PdfViewer = lazyWithReload(() => import('../PdfViewer.jsx').then((m) => ({ default: m.PdfViewer })));
const ImageZoomStage = lazyWithReload(() => import('../ImageLightbox.jsx').then((m) => ({ default: m.ImageZoomStage })));
const FileShareDialog = lazyWithReload(() => import('./FileShareDialog.jsx').then((m) => ({ default: m.FileShareDialog })));
const DocShareView = lazyWithReload(() => import('./DocShareView.jsx').then((m) => ({ default: m.DocShareView })));

const REFRESH_MS = 5 * 60 * 1000;
// A mounted viewer's urls older than this are swapped for fresh ones.
export const STALE_URLS_MS = (FILE_SHARE_URL_TTL_SECONDS - 60 * 60) * 1000;
// The answers that mean something; anything else is a failure to read.
const KNOWN_STATUS = new Set(['ok', 'gone', 'sign_in', 'no_access']);
// Where the comments are (the rail, the box under the player, their menus):
// a key pressed there is theirs, never the player's or the page's.
const OWN_KEYS = '[data-keys-own], .cmt-pop';
// Where Escape is the comments' own: an open conversation, the box you write
// in, a comment menu or popover (and any field being typed in). On a row of
// the list, a section's fold or the "at this moment" button it is the page's.
const ESC_OWN = '.cmt-card, .cmt-composer, .cmt-pop';
const TIMED_KINDS = new Set(['video', 'audio']);
// How long a seek asked of a video waits: for the player to arrive, and then
// for the film to say how long it is (seekVideo).
const SEEK_WAIT_MS = 20000;

async function getSupabase() {
  return (await import('../../lib/supabase.js')).supabase;
}

export const defaultApi = {
  fetchFileShare, listFileComments, addFileComment, resolveFileComment, deleteFileComment, restoreFileComment,
  editFileComment, markFileShareOpened,
  // Who is signed in on this browser, or null. Read from the session kept
  // here: nothing is asked of the server.
  async getSessionUserId() {
    try {
      const sb = await getSupabase();
      const { data } = await sb.auth.getSession();
      return data?.session?.user?.id || null;
    } catch (_) { return null; }
  },
  async signOut() {
    const sb = await getSupabase();
    if (!sb) return;
    try { await sb.auth.signOut(); } catch (_) { /* go to sign-in anyway */ }
  },
};

// commentId: the comment the address asked for, carried through sign-in so
// the way back is /f/<token>?comment=<id> (lib/shareReturn.js).
export function signInHrefFor(token, medium = 'signin', commentId = null) {
  const href = fileSignInHref(token, medium);
  return commentId ? `${href}&comment=${encodeURIComponent(commentId)}` : href;
}
function fileSignInHref(token, medium) {
  const t = encodeURIComponent(token);
  return `/?back=file&file_token=${t}&utm_source=file_share&utm_medium=${medium}&utm_campaign=${t}`;
}

// The comment this page's address asks for (/f/<token>?comment=<id>), or null.
function linkedCommentAt(token) {
  if (typeof window === 'undefined') return null;
  const at = readCommentLink(window.location.href);
  return at?.surface === 'file' && at.token === String(token || '').toLowerCase() ? at.commentId : null;
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v, i = 0;
  const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'];
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  const whole = x >= 10 || i === 0;
  const shown = whole ? Math.round(x) : x.toFixed(1);
  return sizeText(`${shown} ${u[i]}`, Number(shown), units[i], whole ? 0 : 1);
}

// Called at render, so the words follow the current language.
const kindLabel = (kind) => ({ video: tr`Video`, audio: tr`Audio`, image: tr`Image`, pdf: tr`PDF`, file: tr`File` })[kind];

function factsLine(file) {
  const ext = file?.ext ? String(file.ext).toUpperCase() : '';
  const kind = file?.kind === 'file' ? (ext ? tr`${ext} file` : tr`File`) : kindLabel(file?.kind) || tr`File`;
  const parts = [kind];
  if (file?.size != null) parts.push(formatBytes(file.size));
  if ((file?.kind === 'video' || file?.kind === 'audio') && Number(file?.duration) > 0) parts.push(formatAt(Number(file.duration) * 1000));
  if (file?.kind === 'pdf' && Number(file?.page_count) > 0) parts.push(plural(Number(file.page_count), { one: '# page', other: '# pages' }));
  return parts.filter(Boolean).join(' · ');
}

// A doc's page is not the dark screening room: the doc keeps the reader's own
// theme, as it has in the app, under the same dark bar (fileShare.css .fsp--doc).
function Shell({ children, signedOut, token, wide = false, doc = false, action = null }) {
  // the comment the address asked for, kept through sign-in
  const [linked] = useState(() => linkedCommentAt(token));
  return (
    <div className={doc ? 'fsp fsp--doc' : 'fsp public-dark'}>
      <header className="fsp-top">
        <a className="fsp-brand" href="/" aria-label={tr`Clusters home`}>
          <ClustersMark size={22} />
          <span><Trans context="brand">Clusters</Trans></span>
        </a>
        {action}
        {signedOut && (
          <a className="fsp-top-link" href={signInHrefFor(token, 'signin', linked)}
             onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'topbar' })}><Trans>Sign in</Trans></a>
        )}
      </header>
      <main className={`fsp-main${wide ? ' is-wide' : ''}${doc ? ' is-doc' : ''}`}>{children}</main>
    </div>
  );
}

// The same room as a dialog over the app: Close where the brand was, Esc
// closes unless something sits above it (the owner's dialog, a confirm).
// hostRef (optional) receives this dialog's modal handle too, so a player inside
// can tell when something opened above the dialog (FilmPlayer modalHandle).
//
// A doc's Escape is the doc's first, as in its cluster (DocCard.jsx): while
// typing it's the text's, and a layer in the doc (its side panel, the find
// bar, a menu) takes its own. Only one nothing in the doc took closes this.
//
// escFirst(e) (optional) is asked before an Escape closes the dialog: 'theirs'
// leaves the key to what has the caret (a comment part closes itself first),
// 'done' means it was used (the active comment was put away).
function OverlayShell({ children, wide = false, doc = false, action = null, onClose, label = tr`Shared file`, hostRef = null, escFirst = null }) {
  const ownRef = useRef(null);
  const modalRef = hostRef || ownRef;
  const rootRef = useRef(null);
  const escFirstRef = useRef(escFirst);
  escFirstRef.current = escFirst;
  useEffect(() => {
    const unregister = modalGuard.registerModalOpen();
    modalRef.current = unregister;
    return () => { modalRef.current = null; unregister(); };
  }, []);
  useEffect(() => {
    const prev = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => { try { prev?.focus?.({ preventScroll: true }); } catch (_) {} };
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (isComposingKey(e)) return;
      if (e.key !== 'Escape') return;
      if (modalGuard.isTopModal && !modalGuard.isTopModal(modalRef.current)) return;
      if (doc && (e.defaultPrevented || isComposingKey(e) || isEditableTarget(e))) return;
      const took = escFirstRef.current?.(e);
      if (took === 'theirs') return;
      e.preventDefault(); e.stopPropagation();
      if (took === 'done') return;
      onClose?.();
    };
    // A doc's on the way back up, once its own layers have had it.
    const at = doc ? window : document;
    at.addEventListener('keydown', onKey, !doc);
    return () => at.removeEventListener('keydown', onKey, !doc);
  }, [onClose, doc]);
  return createPortal(
    <div ref={rootRef} tabIndex={-1} className={`fsp fsp--overlay ${doc ? 'fsp--doc' : 'public-dark'}`} role="dialog" aria-modal="true" aria-label={label}>
      <header className="fsp-top">
        <button type="button" className="fsp-btn fsp-close" onClick={() => onClose?.()} aria-label={tr`Close`} title={tr`Close (Esc)`}>
          <Icon as={X} size={16} weight="regular" />
        </button>
        <span className="fsp-top-label"><Trans>Shared with you</Trans></span>
        {action}
      </header>
      <main className={`fsp-main${wide ? ' is-wide' : ''}${doc ? ' is-doc' : ''}`}>{children}</main>
    </div>,
    document.body,
  );
}

// The page's frame, or the dialog's: one stable component, so a player inside
// never remounts because the host re-rendered.
function Frame({ overlay = false, onClose = null, escFirst = null, ...props }) {
  return overlay ? <OverlayShell {...props} onClose={onClose} escFirst={escFirst} /> : <Shell {...props} />;
}

function StatePanel({ title, body, children }) {
  return (
    <div className="fsp-state" role="status">
      <h1 className="fsp-state-title">{title}</h1>
      {body && <p className="fsp-state-body">{body}</p>}
      {children && <div className="fsp-state-actions">{children}</div>}
    </div>
  );
}

function FileCardView({ file }) {
  const ext = (file?.ext || '').toString().slice(0, 6).toUpperCase() || tr`FILE`;
  return (
    <div className="fsp-filecard">
      <span className="fsp-ext" aria-hidden="true">{ext}</span>
      <span className="fsp-filecard-name">{file?.name || tr`File`}</span>
      <span className="fsp-filecard-sub">{[formatBytes(file?.size), file?.mime || ''].filter(Boolean).join(' · ')}</span>
    </div>
  );
}

export function FileSharePage({
  token, api = defaultApi, staleAfterMs = STALE_URLS_MS,
  variant = 'page', onClose = null,
  // (res) => node: the in-app host's own header actions (Save a copy, Add shortcut).
  renderActions = null,
  // Over the app: the comment a notice asked for (the page reads its own
  // from the address).
  commentId = null,
}) {
  const [res, setRes] = useState({ status: 'loading' });
  const okRef = useRef(false);
  const markedRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const overlay = variant === 'overlay';
  // A sign-up that starts on this page is its sharer's (0741): seeded before the
  // page's first event, as the /share viewer seeds its link. Not over the app,
  // where whoever opened it is already signed in.
  useEffect(() => { if (!overlay) seedFileShareFirstSource(token); }, [overlay, token]);

  const load = useCallback(async ({ refresh = false } = {}) => {
    const asObj = (out) => (out && typeof out === 'object' ? out : { status: 'error' });
    let r = asObj(await api.fetchFileShare(token));
    if (!alive.current) return;
    // A session that can't be renewed: ask once more as nobody, so a link
    // anyone can open still opens (a person-only one says "Sign in").
    if (!refresh && r.status === 'auth_expired') {
      r = asObj(await api.fetchFileShare(token, { anonymous: true }));
      if (!alive.current) return;
    }
    if (!KNOWN_STATUS.has(r.status)) r = { ...r, status: 'error' };
    // A blip on a background refresh (any answer but a real one) keeps the
    // file on screen and the polling going; gone, sign_in, no_access replace it.
    if (refresh && okRef.current && r.status === 'error') return;
    if (r.status === 'ok') {
      // Storage keys never reach the page: r2:__fs/<token>/<name> → these urls.
      rememberShare(token, r);
      r = { ...r, issuedAt: Date.now() };
      // Opened: read on the Shared page, and a link you opened is listed there.
      if (r.signed_in && !markedRef.current) {
        markedRef.current = true;
        Promise.resolve(api.markFileShareOpened?.(token)).catch(() => {});
      }
    }
    okRef.current = r.status === 'ok';
    setRes(r);
    if (!refresh) {
      logEventOnce(`file_share_view:${token}`, EV.FILE_SHARE_VIEW, {
        status: r.status || 'error', access: r.access || null, kind: r.file?.kind || null,
        signed_in: !!r.signed_in, risky: !!r.file?.risky,
        // Which share it was (0742), in place of the token no event may carry.
        share_id: r.share_id || null,
      });
    }
  }, [api, token]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && okRef.current) load({ refresh: true });
    }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible' && okRef.current) load({ refresh: true }); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  const status = res.status;
  // Read once, as the page opens: the rail takes the comment out of the
  // address once it has shown it, and signing in after that still comes back
  // to it.
  const [linkedAtOpen] = useState(() => (overlay ? null : linkedCommentAt(token)));
  const signInHref = signInHrefFor(token, 'signin', linkedAtOpen);

  if (status === 'loading') {
    if (overlay) {
      return <Frame overlay={overlay} onClose={onClose} signedOut={false} token={token}><span className="fsp-spinner" aria-label={tr`Loading`} /></Frame>;
    }
    return <div className="fsp public-dark fsp--splash" aria-busy="true"><span className="fsp-spinner" aria-label={tr`Loading`} /></div>;
  }
  if (status === 'gone') {
    return (
      <Frame overlay={overlay} onClose={onClose} signedOut={false} token={token}>
        <StatePanel title={tr`This file isn't available anymore.`}
                    body={tr`It may have been deleted, or the person who shared it stopped sharing.`} />
      </Frame>
    );
  }
  if (status === 'sign_in') {
    return (
      <Frame overlay={overlay} onClose={onClose} signedOut={false} token={token}>
        <StatePanel title={tr`Sign in to open this file`} body={tr`Only people it was shared with can open it.`}>
          <a className="fsp-btn fsp-btn--primary" href={signInHref}
             onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'gate' })}><Trans>Sign in</Trans></a>
        </StatePanel>
      </Frame>
    );
  }
  if (status === 'no_access') {
    const switchAccount = async (e) => {
      e.preventDefault();
      logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'switch_account' });
      await api.signOut?.();
      window.location.assign(signInHref);
    };
    return (
      <Frame overlay={overlay} onClose={onClose} signedOut={false} token={token}>
        <StatePanel title={tr`You need access`}
                    body={res.email ? tr`Ask the person who shared it to add ${ph({ email: res.email })}.` : tr`Ask the person who shared it to add you.`}>
          <a className="fsp-btn" href={signInHref} onClick={switchAccount}><Trans>Use another account</Trans></a>
        </StatePanel>
      </Frame>
    );
  }
  if (status !== 'ok') {
    return (
      <Frame overlay={overlay} onClose={onClose} signedOut={false} token={token}>
        <StatePanel title={tr`Couldn't load this file.`} body={tr`Check your connection and try again.`}>
          <button type="button" className="fsp-btn" onClick={() => { setRes({ status: 'loading' }); load(); }}><Trans>Try again</Trans></button>
        </StatePanel>
      </Frame>
    );
  }
  return (
    <FileShareView token={token} res={res} commentId={commentId} api={api} signInHref={signInHref} overlay={overlay} onClose={onClose}
                   extraActions={renderActions ? renderActions(res) : null}
                   staleAfterMs={staleAfterMs} onRefresh={() => load({ refresh: true })} />
  );
}

// An audio file's comments on a line under its player: where each one sits
// along the file, and how far it has played. A dot makes its comment the
// active one and moves the player there.
function AudioMarks({ audioRef, marks, duration = 0, onPick }) {
  const [length, setLength] = useState(duration > 0 ? duration : 0);
  const [at, setAt] = useState(0);
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return undefined;
    const size = () => { if (Number.isFinite(el.duration) && el.duration > 0) setLength(el.duration); };
    const tick = () => setAt(el.currentTime || 0);
    size();
    el.addEventListener('durationchange', size);
    el.addEventListener('loadedmetadata', size);
    el.addEventListener('timeupdate', tick);
    el.addEventListener('seeked', tick);
    return () => {
      el.removeEventListener('durationchange', size);
      el.removeEventListener('loadedmetadata', size);
      el.removeEventListener('timeupdate', tick);
      el.removeEventListener('seeked', tick);
    };
  }, [audioRef]);
  if (!(length > 0) || !marks.length) return null;
  const pct = (s) => `${Math.max(0, Math.min(100, (s / length) * 100))}%`;
  return (
    <div className="fsp-amarks" role="group" aria-label={tr`Comments along the file`}>
      <span className="fsp-amarks-fill" style={{ width: pct(at) }} />
      {marks.map((m) => {
        const time = m.label;
        return (
          <button key={m.id} type="button" className={`fsp-amark${m.active ? ' is-active' : ''}`} style={{ left: pct(m.at) }}
                  data-mark={m.id} aria-label={tr`Comment at ${time}`} aria-current={m.active || undefined} title={time}
                  onClick={() => onPick(m)} />
        );
      })}
    </div>
  );
}

function FileShareView({ token, res, api, signInHref, staleAfterMs, onRefresh, overlay = false, onClose = null, extraActions = null, commentId = null }) {
  const SRC = fsRef(token, 'src');
  const POSTER = fsRef(token, 'poster');
  const file = res.file || {};
  const urls = res.urls || {};
  const kind = file.kind;
  const risky = !!file.risky;
  const signedIn = !!res.signed_in;
  const showRail = res.access === 'comment' || res.access === 'manage';
  const inline = !risky && kind !== 'file' && !!urls.src;

  const playerRef = useRef(null);
  const audioRef = useRef(null);
  // Inside the app the view is a dialog: the player leaves Escape and its keys
  // to anything opened above it (Add to cluster, Manage sharing).
  const hostModalRef = useRef(null);
  const [comments, setComments] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageRequest, setPageRequest] = useState(null);
  const [fps, setFps] = useState(null);
  const [focusReq, setFocusReq] = useState(0);
  // Under the player: at narrow widths the box you write in is drawn here.
  const [composeSlot, setComposeSlot] = useState(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const holdRef = useRef(false);        // unsent words in the open conversation
  // Who is signed in: unsent words are kept under their id. undefined while
  // it is read (the conversations wait for it), null when it cannot be had.
  const [viewerId, setViewerId] = useState(signedIn ? undefined : null);
  useEffect(() => {
    if (!signedIn) { setViewerId(null); return undefined; }
    let off = false;
    Promise.resolve(typeof api.getSessionUserId === 'function' ? api.getSessionUserId() : null)
      .then((id) => { if (!off) setViewerId(id || null); }, () => { if (!off) setViewerId(null); });
    return () => { off = true; };
  }, [signedIn, api]);
  // A share nobody may comment on has no rail to open a linked comment in:
  // the address drops it quietly.
  useEffect(() => {
    if (showRail || overlay || !linkedCommentAt(token)) return;
    try { window.history.replaceState(window.history.state, '', withoutCommentLink(window.location.href)); } catch (_) { /* the address stays */ }
  }, [showRail, overlay, token]);
  // The caret is in the comments: the player's and the page's keys stand down.
  const [inComments, setInComments] = useState(false);
  useEffect(() => {
    const read = () => setInComments(!!document.activeElement?.closest?.(OWN_KEYS));
    const later = () => requestAnimationFrame(read);
    document.addEventListener('focusin', read);
    document.addEventListener('focusout', later);
    return () => { document.removeEventListener('focusin', read); document.removeEventListener('focusout', later); };
  }, []);

  // ---- the owner's dialog, on the page ---------------------------------
  const canManage = res.access === 'manage' && !!res.board_id && !!res.card_id;
  const [manageOpen, setManageOpen] = useState(false);
  useEffect(() => {
    if (!canManage) return undefined;
    const on = (e) => {
      const d = e.detail || {};
      if (d.boardId === res.board_id && d.cardId === res.card_id) onRefreshRef.current?.();
    };
    document.addEventListener(FILE_SHARE_CHANGED_EVENT, on);
    return () => document.removeEventListener(FILE_SHARE_CHANGED_EVENT, on);
  }, [canManage, res.board_id, res.card_id]);
  const closeManage = useCallback(() => {
    setManageOpen(false);
    onRefreshRef.current?.();
  }, []);

  // ---- keeping a mounted video / PDF on live urls ----------------------
  const stageRef = useRef(null);
  const resRef = useRef(res);
  resRef.current = res;
  const pageRef = useRef(page);
  pageRef.current = page;
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;
  const [gen, setGen] = useState(0);                 // the viewer's key
  const viewerUrls = useRef({ src: urls.src || null, at: res.issuedAt || Date.now() });
  const pendingRef = useRef(false);                  // stale, waiting for the video to stop
  const forceRef = useRef(false);                    // the video errored: swap at once
  const playingRef = useRef(false);
  const restoreRef = useRef(null);
  const pdfRestoreRef = useRef(null);

  // The PDF reports its page once it is ready, then on every change. After a
  // remount that first report means it is loaded: let it fit its width (the
  // next frames), then turn back to the page it was on.
  const onPdfPage = useCallback((n) => {
    setPage(n);
    const want = pdfRestoreRef.current;
    if (want == null) return;
    pdfRestoreRef.current = null;
    requestAnimationFrame(() => requestAnimationFrame(() => setPageRequest({ page: want, nonce: Date.now() })));
  }, []);

  const isStale = useCallback(() => {
    const src = resRef.current?.urls?.src || null;
    const v = viewerUrls.current;
    return !!src && src !== v.src && Date.now() - v.at > staleAfterMs;
  }, [staleAfterMs]);

  const remount = useCallback(() => {
    if (kind === 'video') {
      const st = playerRef.current?.getState?.();
      const el = playerRef.current?.element?.();
      const t = st && Number.isFinite(st.time) ? st.time : (el && Number.isFinite(el.currentTime) ? el.currentTime : 0);
      restoreRef.current = { time: t, playing: playingRef.current };
    } else {
      restoreRef.current = { page: pageRef.current };
    }
    const r = resRef.current;
    viewerUrls.current = { src: r?.urls?.src || null, at: r?.issuedAt || Date.now() };
    pendingRef.current = false;
    setGen((g) => g + 1);
  }, [kind]);

  useEffect(() => {
    const force = forceRef.current;
    forceRef.current = false;
    if (!inline || (kind !== 'video' && kind !== 'pdf') || !isStale()) return;
    if (kind === 'pdf' || force || !playerRef.current?.getPlaying?.()) remount();
    else pendingRef.current = true;
  }, [res]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Media events don't bubble, so the stage listens in the capture phase and
  // keeps only the ones from the player's own <video>.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || kind !== 'video') return undefined;
    const fromVideo = (e) => !!e.target && e.target === playerRef.current?.element?.();
    const onPlay = (e) => { if (fromVideo(e)) playingRef.current = true; };
    const onStop = (e) => {
      if (!fromVideo(e)) return;
      playingRef.current = false;
      if (pendingRef.current && isStale()) remount();
    };
    const onErr = (e) => {
      if (!fromVideo(e)) return;
      forceRef.current = true;
      onRefreshRef.current?.();
    };
    stage.addEventListener('play', onPlay, true);
    stage.addEventListener('pause', onStop, true);
    stage.addEventListener('ended', onStop, true);
    stage.addEventListener('error', onErr, true);
    return () => {
      stage.removeEventListener('play', onPlay, true);
      stage.removeEventListener('pause', onStop, true);
      stage.removeEventListener('ended', onStop, true);
      stage.removeEventListener('error', onErr, true);
    };
  }, [kind, isStale, remount]);

  // After a remount: back to the same time (and playing, if it was), or page.
  useEffect(() => {
    const want = restoreRef.current;
    restoreRef.current = null;
    if (!gen || !want) return undefined;
    if (kind === 'pdf') {
      // Asked once the new viewer has laid its pages out (see onPdfPage).
      pdfRestoreRef.current = want.page || 1;
      return undefined;
    }
    let off = false;
    let el = null;
    let tries = 0;
    let timer = null;
    const go = () => {
      if (off) return;
      playerRef.current?.seekTime?.(want.time);
      if (want.playing) playerRef.current?.play?.();
    };
    const onMeta = () => { el?.removeEventListener('loadedmetadata', onMeta); requestAnimationFrame(go); };
    const find = () => {
      if (off) return;
      el = playerRef.current?.element?.() || null;
      if (!el) { if (tries++ < 100) timer = setTimeout(find, 50); return; }
      if (el.readyState >= 1) requestAnimationFrame(go);
      else el.addEventListener('loadedmetadata', onMeta);
    };
    find();
    return () => { off = true; clearTimeout(timer); el?.removeEventListener('loadedmetadata', onMeta); };
  }, [gen]);   // eslint-disable-line react-hooks/exhaustive-deps

  // The audio element keeps its url until it fails: swapping src on every
  // refresh would restart playback. On an error it picks up the latest one.
  const [audioSrc, setAudioSrc] = useState(urls.src || null);
  const onAudioError = () => {
    const el = audioRef.current;
    if (urls.src && urls.src !== audioSrc) {
      const t = el?.currentTime || 0;
      setAudioSrc(urls.src);
      requestAnimationFrame(() => { try { if (audioRef.current) audioRef.current.currentTime = t; } catch (_) {} });
    }
  };

  // The player reads its own frame rate (probe); markers follow it.
  const onFrameChange = useCallback(() => {
    const f = playerRef.current?.getFps?.();
    if (f) setFps((prev) => (prev && JSON.stringify(prev) === JSON.stringify(f) ? prev : f));
  }, []);

  const markers = useMemo(() => {
    if (kind !== 'video') return [];
    const rate = fps || [24, 1];
    const t0 = playerRef.current?.getT0?.() || 0;
    return comments
      .filter((c) => !c.deleted && !c.reply_to && c.at_ms != null && !c.resolved && c.on_current !== false)
      .map((c) => ({
        id: c.id,
        frame: timeToFrame(c.at_ms / 1000, rate, t0),
        label: formatAt(c.at_ms),
        author: (c.author?.name && c.author.name !== 'Someone') ? c.author.name : tr`Someone`,
        text: c.body || '',
        active: c.id === activeId,
      }));
  }, [kind, comments, fps, activeId]);

  // An audio file's comments along its own line, as a video's are on its timeline.
  const audioMarks = useMemo(() => {
    if (kind !== 'audio') return [];
    return comments
      .filter((c) => !c.deleted && !c.reply_to && c.at_ms != null && !c.resolved && c.on_current !== false)
      .map((c) => ({ id: c.id, at: c.at_ms / 1000, label: formatAt(c.at_ms), active: c.id === activeId }));
  }, [kind, comments, activeId]);

  // The player takes Escape for itself and hands it on as an action: it puts
  // the active comment away first, and inside the app the next one closes the
  // viewer like Escape anywhere else on it.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onPlayerAction = useCallback((name, payload) => {
    if (name === 'marker' && payload?.id) setActiveId(payload.id);
    else if (name === 'comment') { playerRef.current?.pause?.(); setFocusReq((n) => n + 1); }
    else if (name === 'escape') {
      if (activeIdRef.current) setActiveId(null);
      else if (overlay) onCloseRef.current?.();
    }
  }, [overlay]);

  // Escape, asked by the dialog before it closes (OverlayShell escFirst), and
  // on the page by the listener below.
  const escFirst = useCallback((e) => {
    if (e.target?.closest?.(ESC_OWN) || isEditableTarget(e)) return 'theirs';
    if (activeIdRef.current) { setActiveId(null); return 'done'; }
    return null;
  }, []);
  useEffect(() => {
    if (overlay) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || isComposingKey(e) || isEditableTarget(e)) return;
      if (escFirst(e) === 'done') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [overlay, escFirst]);

  const getAnchor = useCallback(() => {
    if (kind === 'video') {
      const st = playerRef.current?.getState?.();
      return st && Number.isFinite(st.time) ? { atMs: st.time * 1000 } : null;
    }
    if (kind === 'audio') {
      const el = audioRef.current;
      return el ? { atMs: (el.currentTime || 0) * 1000 } : null;
    }
    if (kind === 'pdf') return { page };
    return null;
  }, [kind, page]);

  const onFocusCompose = useCallback(() => {
    if (kind === 'video') playerRef.current?.pause?.();
    else if (kind === 'audio') audioRef.current?.pause?.();
  }, [kind]);

  // A time asked of the video before it can take one (a link to a comment
  // opens the page cold: the player is a download of its own, and then the
  // film has to say how long it is) is kept and applied once it can. → a
  // promise: true once the player is at the time, false when another seek
  // took its place, the player never came, or the film would not load: on
  // its error, or SEEK_WAIT_MS after the player was found with nothing known
  // of its length. Either way the wait ends, so a link's ?comment= is cleaned
  // from the address and nothing is left to jump the film later.
  const wantSeek = useRef(null);
  const seekVideo = useCallback((sec) => new Promise((resolve) => {
    wantSeek.current?.cancel();
    let off = false;
    let el = null;
    let tries = 0;
    let timer = null;
    const done = (ok) => {
      if (off) return;
      off = true;
      clearTimeout(timer);
      el?.removeEventListener('loadedmetadata', go);
      el?.removeEventListener('error', fail, true);
      if (wantSeek.current === mine) wantSeek.current = null;
      resolve(ok);
    };
    function go() {
      if (off) return;
      playerRef.current?.pause?.();
      playerRef.current?.seekTime?.(sec);
      done(true);
    }
    function fail() { done(false); }
    const find = () => {
      if (off) return;
      el = playerRef.current?.element?.() || null;
      if (!el) { if (tries++ < SEEK_WAIT_MS / 50) timer = setTimeout(find, 50); else done(false); return; }
      if (el.readyState >= 1) { go(); return; }
      if (el.error) { done(false); return; }
      el.addEventListener('loadedmetadata', go);
      // capture: a <source> that fails says so on itself, and that does not bubble
      el.addEventListener('error', fail, true);
      timer = setTimeout(fail, SEEK_WAIT_MS);
    };
    const mine = { cancel: () => done(false) };
    wantSeek.current = mine;
    find();
  }), []);
  useEffect(() => () => wantSeek.current?.cancel(), []);

  const onSeek = useCallback((c) => {
    if (c.at_ms != null) {
      if (kind === 'video') return seekVideo(c.at_ms / 1000);
      if (kind === 'audio' && audioRef.current) { audioRef.current.currentTime = c.at_ms / 1000; }
    } else if (c.page != null && kind === 'pdf') {
      setPageRequest({ page: c.page, nonce: Date.now() });
    }
    return undefined;
  }, [kind, seekVideo]);

  // The active comment stays the active one while the file is at its moment.
  // Once the playhead has been there, leaving puts it away: playing 2 s past
  // it, or a seek elsewhere (while paused, any move more than a few frames
  // from it). Not while its words are being written.
  const getAnchorRef = useRef(getAnchor);
  getAnchorRef.current = getAnchor;
  const activeAt = useMemo(() => {
    if (!activeId || !TIMED_KINDS.has(kind)) return null;
    const c = comments.find((x) => x.id === activeId);
    return c && c.at_ms != null && c.on_current !== false ? c.at_ms / 1000 : null;
  }, [activeId, comments, kind]);
  useEffect(() => {
    if (activeAt == null) return undefined;
    const id = activeId;
    let been = false;
    let prev = null;
    const read = () => {
      const a = getAnchorRef.current?.();
      if (!a || !Number.isFinite(a.atMs)) return;
      const now = a.atMs / 1000;
      const playing = kind === 'video' ? !!playerRef.current?.getState?.()?.playing : !!(audioRef.current && !audioRef.current.paused);
      const was = prev;
      prev = { now, playing };
      if (now >= activeAt - 0.5 && now <= activeAt + 2) {
        const moved = was && !was.playing && !playing && Math.abs(now - was.now) > 0.001;
        if (!(been && moved && Math.abs(now - activeAt) > 0.3)) { been = true; return; }
      }
      if (!been || holdRef.current || document.activeElement?.closest?.('.cmt-card')) return;
      setActiveId((cur) => (cur === id ? null : cur));
    };
    read();   // whatever made it the active one has already moved the file there
    const timer = setInterval(read, 250);
    return () => clearInterval(timer);
  }, [activeId, activeAt, kind]);

  const onAudioMark = useCallback((m) => {
    setActiveId(m.id);
    if (audioRef.current) { try { audioRef.current.currentTime = m.at; } catch (_) { /* not loaded yet */ } }
  }, []);

  const sharedBy = (res.shared_by?.name && res.shared_by.name !== 'Someone on Clusters') ? res.shared_by.name : tr`Someone on Clusters`;

  // On the page, someone signed in can take the file into the app, where
  // Save a copy and Add shortcut live (held with the Shared page).
  const openInApp = !overlay && signedIn && sharedFilesAllowed() ? (
    <a className="fsp-btn fsp-open-app" href={`/?shared=${encodeURIComponent(token)}`}><Trans>Open in Clusters</Trans></a>
  ) : null;
  const headerActions = (canManage || extraActions || openInApp) ? (
    <div className="fsp-top-actions">
      {extraActions}
      {openInApp}
      {canManage && (
        <button type="button" className="fsp-btn fsp-manage" onClick={() => setManageOpen(true)}>
          <Trans>Manage sharing</Trans>
        </button>
      )}
    </div>
  ) : null;
  const manageDialog = canManage && manageOpen ? (
    <Suspense fallback={null}>
      <FileShareDialog boardId={res.board_id} cardId={res.card_id}
                       card={{ id: res.card_id, kind: file.kind, fileName: file.name }}
                       onClose={closeManage}
                       {...(typeof api?.getFileShareSettings === 'function' ? { api } : {})} />
    </Suspense>
  ) : null;

  // A doc: its live room, keyed by room so a new generation is a new view.
  if (kind === 'doc') {
    return (
      <Frame overlay={overlay} onClose={onClose} signedOut={!signedIn} token={token} doc action={headerActions}
             label={tr`Shared doc`}>
        {manageDialog}
        {docSharesAllowed() ? (
          <Suspense fallback={<div className="dsv-wait"><span className="fsp-spinner" aria-label={tr`Loading`} /></div>}>
            <DocShareView key={res.room || 'none'} token={token} res={res} onRefresh={onRefresh}
                          signInHref={signInHref} api={api} />
          </Suspense>
        ) : (
          <StatePanel title={tr`This doc isn't available here yet.`} body={tr`Ask the person who shared it for another way to see it.`} />
        )}
      </Frame>
    );
  }

  let viewer;
  if (!inline) {
    viewer = <FileCardView file={file} />;
  } else if (kind === 'video') {
    viewer = (
      <FilmPlayer key={`v${gen}`} ref={playerRef} mode="full" keyboard={!manageOpen && !inComments} src={SRC} poster={urls.poster ? POSTER : null}
                  modalHandle={overlay ? hostModalRef : undefined} surface={overlay ? 'shared_file' : 'file_share'}
                  title={file.name || ''} markers={markers} onAction={onPlayerAction} onFrameChange={onFrameChange}
                  probe={() => import('../../hooks/useMediaFacts.js').then((m) => m.probeCardVideo({ kind: 'video', src: SRC }))} />
    );
  } else if (kind === 'audio') {
    viewer = (
      <div className="fsp-audio">
        {urls.poster && <img className="fsp-audio-art" src={urls.poster} alt="" />}
        <audio ref={audioRef} className="fsp-audio-el" controls preload="metadata" src={audioSrc || undefined}
               onError={onAudioError} aria-label={file.name || tr`Audio`} />
        <AudioMarks audioRef={audioRef} marks={audioMarks} duration={Number(file.duration) || 0} onPick={onAudioMark} />
      </div>
    );
  } else if (kind === 'pdf') {
    viewer = <PdfViewer key={`p${gen}`} embedded src={SRC} name={file.name || 'PDF'} onPageChange={onPdfPage} pageRequest={pageRequest} />;
  } else if (kind === 'image') {
    viewer = <ImageZoomStage src={SRC} alt={file.name || ''} />;
  } else {
    viewer = <FileCardView file={file} />;
  }

  return (
    <Frame overlay={overlay} onClose={onClose} signedOut={!signedIn} token={token} wide={showRail} action={headerActions}
           hostRef={hostModalRef} escFirst={escFirst}>
      {manageDialog}
      <div className={`fsp-layout${showRail ? ' has-rail' : ''}`}>
        <div className="fsp-col">
          <div ref={stageRef} className={`fsp-stage fsp-stage--${inline ? kind : 'file'}`}>
            <Suspense fallback={<span className="fsp-spinner" aria-label={tr`Loading`} />}>{viewer}</Suspense>
          </div>
          {showRail && (
            <div ref={setComposeSlot} className="fsp-compose-slot cmt-dark" data-keys-own
                 onContextMenu={(e) => e.stopPropagation()} />
          )}
          <div className="fsp-info">
            <h1 className="fsp-name">{file.name || tr`File`}</h1>
            <p className="fsp-facts">{factsLine(file)}</p>
            <div className="fsp-byline">
              <Avatar name={sharedBy} url={res.shared_by?.avatar_url} size={22} />
              <span><Trans>Shared by</Trans> <span className="fsp-by">{sharedBy}</span></span>
            </div>
            {risky && (
              <p className="fsp-warn" role="note">
                <Trans>Files like this can run programs on your computer. Only download it if you trust the person who shared it.</Trans>
              </p>
            )}
            {urls.download && (
              <div className="fsp-actions">
                <a className="fsp-btn fsp-btn--primary" href={urls.download} rel="noopener noreferrer"
                   onClick={() => logEvent(EV.FILE_SHARE_DOWNLOAD, { kind: kind || null, access: res.access || null })}>
                  <Trans>Download</Trans>
                </a>
              </div>
            )}
          </div>
          {!signedIn && !overlay && (
            <footer className="fsp-cta">
              <span><Trans>Made with Clusters, one place for every file you make.</Trans></span>
              <a className="fsp-btn" href={`/?utm_source=file_share&utm_medium=cta&utm_campaign=${encodeURIComponent(token)}`}
                 onClick={() => logEventNow(EV.FILE_SHARE_CTA_CLICK, { surface: 'footer' })}><Trans>Try Clusters free</Trans></a>
            </footer>
          )}
        </div>
        {showRail && (
          <aside className="fsp-rail">
            <FileComments token={token} signedIn={signedIn} canComment={!!res.can_comment}
                          kind={kind} getAnchor={getAnchor} currentPage={kind === 'pdf' ? page : null}
                          onSeek={onSeek} onFocusCompose={onFocusCompose} onComments={setComments}
                          activeId={activeId} onActivate={setActiveId} signInHref={signInHref}
                          focusRequest={focusReq} api={api} composeSlot={composeSlot} holdRef={holdRef}
                          userId={viewerId} linked={overlay ? commentId : null} />
          </aside>
        )}
      </div>
    </Frame>
  );
}

export default FileSharePage;
