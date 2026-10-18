// /f/<token>: one shared file, on its own. A dark screening room — the file
// is judged against black — with the comment rail beside it for people who can
// comment. Neutral ink at rest; gold only marks focus and the active comment.
//
// The party's /file-share presigns the file for THIS viewer (0421's
// get_file_share decides access as the caller). The page gets URLs, never
// storage keys: the RPC's keys are identifiers the party strips before it
// answers (they open nothing on their own). Viewers get the pseudo-keys
// r2:__fs/src and r2:__fs/poster, which the read-url resolver below maps onto
// the latest presigned urls.
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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchFileShare, listFileComments, addFileComment, resolveFileComment, deleteFileComment, restoreFileComment,
  formatAt,
} from '../../lib/fileShares.js';
import { setReadUrlResolver, clearReadUrlResolver } from '../../lib/r2.js';
import { FILE_SHARE_URL_TTL_SECONDS } from '../../lib/fileShareBundle.js';
import { timeToFrame } from '../../lib/timecode.js';
import { logEvent, logEventNow, logEventOnce } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { ClustersMark } from '../SoleilWordmark.jsx';
import { FileComments, Avatar } from './FileComments.jsx';
import './fileShare.css';

const FilmPlayer = lazy(() => import('../film/FilmPlayer.jsx').then((m) => ({ default: m.FilmPlayer })));
const PdfViewer = lazy(() => import('../PdfViewer.jsx').then((m) => ({ default: m.PdfViewer })));
const ImageZoomStage = lazy(() => import('../ImageLightbox.jsx').then((m) => ({ default: m.ImageZoomStage })));

const REFRESH_MS = 5 * 60 * 1000;
// A mounted viewer's urls older than this are swapped for fresh ones.
export const STALE_URLS_MS = (FILE_SHARE_URL_TTL_SECONDS - 60 * 60) * 1000;
// The answers that mean something; anything else is a failure to read.
const KNOWN_STATUS = new Set(['ok', 'gone', 'sign_in', 'no_access']);
const SRC = 'r2:__fs/src';
const POSTER = 'r2:__fs/poster';

async function getSupabase() {
  return (await import('../../lib/supabase.js')).supabase;
}

export const defaultApi = {
  fetchFileShare, listFileComments, addFileComment, resolveFileComment, deleteFileComment, restoreFileComment,
  async signOut() {
    const sb = await getSupabase();
    if (!sb) return;
    try { await sb.auth.signOut(); } catch (_) { /* go to sign-in anyway */ }
  },
};

export function signInHrefFor(token, medium = 'signin') {
  const t = encodeURIComponent(token);
  return `/?back=file&file_token=${t}&utm_source=file_share&utm_medium=${medium}&utm_campaign=${t}`;
}

function formatBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let x = v, i = 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x >= 10 || i === 0 ? Math.round(x) : x.toFixed(1)} ${u[i]}`;
}

const KIND_LABEL = { video: 'Video', audio: 'Audio', image: 'Image', pdf: 'PDF', file: 'File' };

function factsLine(file) {
  const ext = file?.ext ? String(file.ext).toUpperCase() : '';
  const kind = file?.kind === 'file' ? (ext ? `${ext} file` : 'File') : KIND_LABEL[file?.kind] || 'File';
  const parts = [kind];
  if (file?.size != null) parts.push(formatBytes(file.size));
  if ((file?.kind === 'video' || file?.kind === 'audio') && Number(file?.duration) > 0) parts.push(formatAt(Number(file.duration) * 1000));
  if (file?.kind === 'pdf' && Number(file?.page_count) > 0) parts.push(`${file.page_count} ${Number(file.page_count) === 1 ? 'page' : 'pages'}`);
  return parts.filter(Boolean).join(' · ');
}

function Shell({ children, signedOut, token, wide = false }) {
  return (
    <div className="fsp public-dark">
      <header className="fsp-top">
        <a className="fsp-brand" href="/" aria-label="Clusters home">
          <ClustersMark size={22} />
          <span>Clusters</span>
        </a>
        {signedOut && (
          <a className="fsp-top-link" href={signInHrefFor(token)}
             onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'topbar' })}>Sign in</a>
        )}
      </header>
      <main className={`fsp-main${wide ? ' is-wide' : ''}`}>{children}</main>
    </div>
  );
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
  const ext = (file?.ext || '').toString().slice(0, 6).toUpperCase() || 'FILE';
  return (
    <div className="fsp-filecard">
      <span className="fsp-ext" aria-hidden="true">{ext}</span>
      <span className="fsp-filecard-name">{file?.name || 'File'}</span>
      <span className="fsp-filecard-sub">{[formatBytes(file?.size), file?.mime || ''].filter(Boolean).join(' · ')}</span>
    </div>
  );
}

export function FileSharePage({ token, api = defaultApi, staleAfterMs = STALE_URLS_MS }) {
  const [res, setRes] = useState({ status: 'loading' });
  const urlsRef = useRef({});
  const okRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Storage keys never reach the page: r2:__fs/<name> → the presigned url.
  useEffect(() => {
    setReadUrlResolver((key) => (typeof key === 'string' && key.startsWith('__fs/') ? urlsRef.current[key.slice(5)] || null : null));
    return () => clearReadUrlResolver();
  }, []);

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
      urlsRef.current = { ...(r.urls || {}) };
      r = { ...r, issuedAt: Date.now() };
    }
    okRef.current = r.status === 'ok';
    setRes(r);
    if (!refresh) {
      logEventOnce(`file_share_view:${token}`, EV.FILE_SHARE_VIEW, {
        status: r.status || 'error', access: r.access || null, kind: r.file?.kind || null,
        signed_in: !!r.signed_in, risky: !!r.file?.risky,
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
  const signInHref = signInHrefFor(token);

  if (status === 'loading') {
    return <div className="fsp public-dark fsp--splash" aria-busy="true"><span className="fsp-spinner" aria-label="Loading" /></div>;
  }
  if (status === 'gone') {
    return (
      <Shell signedOut={false} token={token}>
        <StatePanel title="This file isn't available anymore."
                    body="It may have been deleted, or the person who shared it stopped sharing." />
      </Shell>
    );
  }
  if (status === 'sign_in') {
    return (
      <Shell signedOut={false} token={token}>
        <StatePanel title="Sign in to open this file" body="Only people it was shared with can open it.">
          <a className="fsp-btn fsp-btn--primary" href={signInHref}
             onClick={() => logEventNow(EV.FILE_SHARE_SIGNIN_CLICK, { surface: 'gate' })}>Sign in</a>
        </StatePanel>
      </Shell>
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
      <Shell signedOut={false} token={token}>
        <StatePanel title="You need access"
                    body={res.email ? `Ask the person who shared it to add ${res.email}.` : 'Ask the person who shared it to add you.'}>
          <a className="fsp-btn" href={signInHref} onClick={switchAccount}>Use another account</a>
        </StatePanel>
      </Shell>
    );
  }
  if (status !== 'ok') {
    return (
      <Shell signedOut={false} token={token}>
        <StatePanel title="Couldn't load this file." body="Check your connection and try again.">
          <button type="button" className="fsp-btn" onClick={() => { setRes({ status: 'loading' }); load(); }}>Try again</button>
        </StatePanel>
      </Shell>
    );
  }
  return (
    <FileShareView token={token} res={res} api={api} signInHref={signInHref}
                   staleAfterMs={staleAfterMs} onRefresh={() => load({ refresh: true })} />
  );
}

function FileShareView({ token, res, api, signInHref, staleAfterMs, onRefresh }) {
  const file = res.file || {};
  const urls = res.urls || {};
  const kind = file.kind;
  const risky = !!file.risky;
  const signedIn = !!res.signed_in;
  const showRail = res.access === 'comment' || res.access === 'manage';
  const inline = !risky && kind !== 'file' && !!urls.src;

  const playerRef = useRef(null);
  const audioRef = useRef(null);
  const [comments, setComments] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageRequest, setPageRequest] = useState(null);
  const [fps, setFps] = useState(null);
  const [focusReq, setFocusReq] = useState(0);

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
      .filter((c) => !c.deleted && !c.reply_to && c.at_ms != null && !c.resolved)
      .map((c) => ({
        id: c.id,
        frame: timeToFrame(c.at_ms / 1000, rate, t0),
        label: formatAt(c.at_ms),
        author: c.author?.name || 'Someone',
        text: c.body || '',
        active: c.id === activeId,
      }));
  }, [kind, comments, fps, activeId]);

  const onPlayerAction = useCallback((name, payload) => {
    if (name === 'marker' && payload?.id) setActiveId(payload.id);
    else if (name === 'comment') { playerRef.current?.pause?.(); setFocusReq((n) => n + 1); }
  }, []);

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

  const onSeek = useCallback((c) => {
    if (c.at_ms != null) {
      if (kind === 'video') { playerRef.current?.pause?.(); playerRef.current?.seekTime?.(c.at_ms / 1000); }
      else if (kind === 'audio' && audioRef.current) { audioRef.current.currentTime = c.at_ms / 1000; }
    } else if (c.page != null && kind === 'pdf') {
      setPageRequest({ page: c.page, nonce: Date.now() });
    }
  }, [kind]);

  const sharedBy = res.shared_by?.name || 'Someone on Clusters';

  let viewer;
  if (!inline) {
    viewer = <FileCardView file={file} />;
  } else if (kind === 'video') {
    viewer = (
      <FilmPlayer key={`v${gen}`} ref={playerRef} mode="full" keyboard src={SRC} poster={urls.poster ? POSTER : null}
                  title={file.name || ''} markers={markers} onAction={onPlayerAction} onFrameChange={onFrameChange}
                  probe={() => import('../../hooks/useMediaFacts.js').then((m) => m.probeCardVideo({ kind: 'video', src: SRC }))} />
    );
  } else if (kind === 'audio') {
    viewer = (
      <div className="fsp-audio">
        {urls.poster && <img className="fsp-audio-art" src={urls.poster} alt="" />}
        <audio ref={audioRef} className="fsp-audio-el" controls preload="metadata" src={audioSrc || undefined}
               onError={onAudioError} aria-label={file.name || 'Audio'} />
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
    <Shell signedOut={!signedIn} token={token} wide={showRail}>
      <div className={`fsp-layout${showRail ? ' has-rail' : ''}`}>
        <div className="fsp-col">
          <div ref={stageRef} className={`fsp-stage fsp-stage--${inline ? kind : 'file'}`}>
            <Suspense fallback={<span className="fsp-spinner" aria-label="Loading" />}>{viewer}</Suspense>
          </div>
          <div className="fsp-info">
            <h1 className="fsp-name">{file.name || 'File'}</h1>
            <p className="fsp-facts">{factsLine(file)}</p>
            <div className="fsp-byline">
              <Avatar name={sharedBy} url={res.shared_by?.avatar_url} size={22} />
              <span>Shared by <span className="fsp-by">{sharedBy}</span></span>
            </div>
            {risky && (
              <p className="fsp-warn" role="note">
                Files like this can run programs on your computer. Only download it if you trust the person who shared it.
              </p>
            )}
            {urls.download && (
              <div className="fsp-actions">
                <a className="fsp-btn fsp-btn--primary" href={urls.download} rel="noopener noreferrer"
                   onClick={() => logEvent(EV.FILE_SHARE_DOWNLOAD, { kind: kind || null, access: res.access || null })}>
                  Download
                </a>
              </div>
            )}
          </div>
          {!signedIn && (
            <footer className="fsp-cta">
              <span>Made with Clusters, one place for every file you make.</span>
              <a className="fsp-btn" href={`/?utm_source=file_share&utm_medium=cta&utm_campaign=${encodeURIComponent(token)}`}
                 onClick={() => logEventNow(EV.FILE_SHARE_CTA_CLICK, { surface: 'footer' })}>Try Clusters free</a>
            </footer>
          )}
        </div>
        {showRail && (
          <aside className="fsp-rail">
            <FileComments token={token} access={res.access} signedIn={signedIn} canComment={!!res.can_comment}
                          kind={kind} getAnchor={getAnchor} currentPage={kind === 'pdf' ? page : null}
                          onSeek={onSeek} onFocusCompose={onFocusCompose} onComments={setComments}
                          activeId={activeId} onActivate={setActiveId} signInHref={signInHref}
                          initialCount={res.comment_count ?? null} focusRequest={focusReq} api={api} />
          </aside>
        )}
      </div>
    </Shell>
  );
}

export default FileSharePage;
