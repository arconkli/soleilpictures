// Public read-only board viewer — for /share/<token> URLs (no
// account required).
//
// Calls the upload party's /share-bundle route with the token (and an
// optional board id); gets back the board metadata + Y.Doc snapshot bytes
// + a map of {storage_path → presigned R2 URL} covering every image on
// that board, plus the set of boards reachable via this link. The snapshot
// is applied to a live Y.Doc and rendered through the REAL board canvas
// (CanvasSurface) in read-only, chromeless mode — so a shared board looks
// and feels exactly like the editor (true pan/zoom, pixel-identical cards/
// arrows/notes), just with every toolbar hidden.
//
// When the link was created with "include sub-boards", board / board-link
// cards become navigable: clicking one fetches that descendant board (the
// server re-checks it's inside the shared subtree) and pushes it onto a
// breadcrumb stack. Otherwise they render the standard "No access" tile.
//
// Images resolve through a module-level override installed on r2.js
// (setReadUrlResolver): real cards ask for `r2:<key>` read URLs, which we
// answer from the bundle's presigned map instead of the auth-gated
// sign-reads endpoint. No realtime, no editing, no sidebar — just a clean
// preview with a Clusters wordmark + signup CTAs in the top bar.
//
// This page doubles as a marketing surface: it seeds share attribution
// into the session first-touch source (analytics.seedShareFirstSource), is
// fully instrumented (EV.SHARE_*), and shows a dismissible signup prompt
// after real engagement (SharePrompt).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { b64ToBytes, readCards, readArrows, readStrokes, readGroups } from '../lib/yhelpers.js';
import { SoleilMark } from './primitives.jsx';
import { ClustersMark } from './SoleilWordmark.jsx';
import { CanvasSurface } from './CanvasSurface.jsx';
import { SharePrompt } from './SharePrompt.jsx';
import PublicArticle from './PublicArticle.jsx';
import { setReadUrlResolver, clearReadUrlResolver, setImageAuthErrorHandler, clearImageAuthErrorHandler } from '../lib/r2.js';
import { setMetaResolver, clearMetaResolver } from '../lib/imageMeta.js';
import { matchToolPath } from '../lib/seoLanding.js';
import { logClientError } from '../lib/errorReporting.js';
import { EntityNavigateContext } from '../hooks/useEntityNavigate.js';
import { OpenDmContext } from '../hooks/useOpenDm.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { logEvent, logEventNow, logEventOnce, seedShareFirstSource, seedPublicBoardFirstSource } from '../lib/analytics.js';
import { getRelatedPublicBoards } from '../lib/publicBoardsApi.js';
import { encodeRemixParam } from '../lib/remix.js';
import { EV } from '../lib/analyticsEvents.js';
import { qaShareNoPrefetch } from '../lib/localMode.js';

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || 'localhost:1999';
const PARTYKIT_PROTOCOL = PARTYKIT_HOST.startsWith('localhost') ? 'http' : 'https';

const EMPTY = [];
const EMPTY_OBJ = {};
const NOOP = () => {};
// CanvasSurface reads exactly one tweak field (tweak.showArrows); arrows
// should render in the preview just like the editor.
const PUBLIC_TWEAK = { showArrows: true };

// Presigned image URLs are signed for 7 days; in a tab left open past that
// they would decay silently (the public resolver answers from our map, so
// R2Image's force-resign self-heal also reads the stale entry). Refresh the
// map well before then.
const URL_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;

// QA kill switch, captured at module load (the viewer's replaceState drops
// query params before any effect reads them). DEV-only.
const NO_PREFETCH = qaShareNoPrefetch();

// Build the viewer URL for a board within this link/board. The root board omits
// ?b= so the canonical URL stays clean. `ctx` is {token} for /share/<token>
// links or {slug} for /c/<slug> marketing boards — the slug path must NEVER emit
// a /share/<token> URL (it has no token), or it would clobber the clean slug in
// the address bar and re-introduce duplicate-content URLs.
function viewerUrl(ctx, boardId, rootId) {
  const base = ctx.slug ? `/c/${ctx.slug}` : `/share/${ctx.token}`;
  return (!boardId || boardId === rootId) ? base : `${base}?b=${boardId}`;
}

// Signup CTAs land on "/" carrying explicit utm params as the attribution
// FALLBACK: the primary mechanism (seed*FirstSource → sessionStorage) only
// survives same-tab navigation, so cmd-click / "open in new tab" still
// attributes the signup. Public marketing boards → public_board/<slug>; share
// links → share_link/<token>. The raw share_token / public_slug ride along too
// (getFirstSource reads them off the URL) so the structured id survives the
// new-tab hop, not just the utm approximation.
function ctaHref(ctx, surface) {
  const src = ctx.slug ? 'public_board' : 'share_link';
  const campaign = encodeURIComponent(ctx.slug || ctx.token || '');
  const idParam = ctx.slug
    ? `&public_slug=${encodeURIComponent(ctx.slug)}`
    : (ctx.token ? `&share_token=${encodeURIComponent(ctx.token)}` : '');
  return `/?utm_source=${src}&utm_medium=${encodeURIComponent(surface)}&utm_campaign=${campaign}${idParam}`;
}

// "Make a copy" CTA — carries the share/public attribution (utm + structured id,
// medium=remix) PLUS a ?remix=<source> param. AuthGate stashes the source; the
// authenticated app clones this board into the user's workspace after signup.
function remixHref(ctx) {
  const base = ctaHref(ctx, 'remix');
  const param = encodeRemixParam(ctx.slug ? { kind: 'slug', value: ctx.slug } : { kind: 'token', value: ctx.token });
  return param ? `${base}&remix=${encodeURIComponent(param)}` : base;
}

// Branded top bar — rendered in every viewer state (loading / invalid / ok)
// so the wordmark and signup CTA are visible from the first paint. When a valid
// board is loaded (remixUrl set), "Make a copy" is the primary action (highest
// intent: clone THIS board) and "Try free" steps back to secondary.
function PublicTopbar({ ctx, center, busy, onCta, remixUrl, remixLabel = 'Make a copy' }) {
  return (
    <div className="public-topbar">
      <a className="public-brand" href={ctaHref(ctx, 'badge')} title="Clusters home" onClick={onCta('badge')}>
        <ClustersMark size={20} />
        <span className="public-brand-name">Clusters</span>
      </a>
      {center}
      <div className="public-topbar-actions">
        <a className="public-signin-quiet" href={ctaHref(ctx, 'signin')} onClick={onCta('signin')}>Sign in</a>
        {remixUrl ? (
          <>
            <a className="public-cta" href={remixUrl} onClick={onCta('remix')}>{remixLabel}</a>
            <a className="public-signin-quiet" href={ctaHref(ctx, 'topbar')} onClick={onCta('topbar')}>Try free</a>
          </>
        ) : (
          <a className="public-cta" href={ctaHref(ctx, 'topbar')} onClick={onCta('topbar')}>Try Clusters free</a>
        )}
      </div>
      {busy && <div className="public-nav-progress" aria-hidden="true" />}
    </div>
  );
}

// Renders both /share/<token> (token mode) and /c/<slug> (admin-curated public
// marketing board, slug mode). Exactly one of token/slug is set. Slug mode hits
// the public-bundle endpoint, attributes to public_board, and keeps the address
// bar on /c/<slug> — it never synthesizes a token.
export function PublicBoardView({ token, slug }) {
  // Stable identity helpers for the two modes. ctx drives URL/CTA building;
  // attrib is spread into every analytics event; linkKey de-dupes once-events.
  const ctx = useMemo(() => ({ token, slug }), [token, slug]);
  const attrib = useMemo(() => (slug ? { public_slug: slug } : { share_token: token }), [slug, token]);
  const linkKey = slug || token;

  const [status, setStatus] = useState('loading');   // 'loading' | 'ok' | 'invalid'
  const [cache, setCache] = useState({});             // boardId → decoded bundle
  const [navBoards, setNavBoards] = useState({});     // boardId → name (reachable)
  const [includeSubboards, setIncludeSubboards] = useState(false);
  const [rootId, setRootId] = useState(null);
  const [stack, setStack] = useState([]);             // board ids, last = current
  const [navBusy, setNavBusy] = useState(false);
  const [subboardOpened, setSubboardOpened] = useState(false); // SharePrompt trigger B
  const [relatedBoards, setRelatedBoards] = useState(EMPTY);   // slug mode: tag-related public boards
  const [imgEpoch, setImgEpoch] = useState(0);                 // bumped on a forced URL refresh → canvas re-resolves

  // Session-wide presigned image map (merged across every board fetched)
  // + the live Y.Docs we keep alive for CanvasSurface (doc cards read their
  // per-card YMaps from them). Both torn down on unmount.
  const imageMapRef = useRef({});
  // Session-wide progressive-loading metadata (original key → { blur, preview }),
  // merged across every board fetched. Feeds imageMeta.getMeta via the resolver.
  const imageMetaRef = useRef({});
  const ydocsRef = useRef(new Set());
  const openCountRef = useRef(0);          // sub-boards opened (dwell props)
  const ctaClickedRef = useRef(false);     // any CTA clicked → suppress SharePrompt
  const bundleFetchedAtRef = useRef(0);    // last successful bundle fetch (URL freshness)
  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef(null);    // pending retry after a failed periodic refresh
  const lastForcedAtRef = useRef(0);       // throttle auth-error-driven forced refreshes (≤1/30s)
  const reportedMissingRef = useRef(new Set()); // board ids whose missing-state we've already reported
  const openingRef = useRef(false);        // openBoard reentrancy guard (navBusy state lags a render)

  const currentId = stack.length ? stack[stack.length - 1] : null;
  const cur = currentId ? cache[currentId] : null;
  const currentIdRef = useRef(null);
  currentIdRef.current = currentId;
  const rootIdRef = useRef(null);
  rootIdRef.current = rootId;
  // Render-time mirrors so async effects (URL refresh, prefetch) read fresh
  // state without listing cache/navBoards as deps (each prefetched bundle
  // updates cache, which would cancel the very loop that fetched it).
  const cacheRef = useRef(cache);
  cacheRef.current = cache;
  const navBoardsRef = useRef(navBoards);
  navBoardsRef.current = navBoards;
  const prefetchedRef = useRef(new Set());

  const onCta = useCallback((surface) => () => {
    ctaClickedRef.current = true;
    logEventNow(EV.SHARE_CTA_CLICK, { surface, ...attrib });
  }, [attrib]);

  // Time-on-board, fired once on leave (hide/unload/unmount). board_id and
  // boards_opened are read at fire time so they reflect where the visitor
  // actually ended up.
  useDwellTime(EV.SHARE_DWELL, () => ({
    ...attrib,
    board_id: currentIdRef.current,
    boards_opened: openCountRef.current,
  }));

  // Seed share attribution into the session first-touch source BEFORE the
  // first event of this pageload, so share_token (+ utm_source=share_link)
  // rides on every row and lands in profiles.first_source at signup.
  useEffect(() => {
    if (slug) seedPublicBoardFirstSource(slug);
    else seedShareFirstSource(token);
  }, [token, slug]);

  // Install the public image resolver so every `r2:<key>` image surface
  // (cards, board-tile thumbnails, doc images…) resolves from the bundle's
  // presigned map. Cleared + all Y.Docs destroyed on unmount.
  useEffect(() => {
    setReadUrlResolver((key) => imageMapRef.current[key] || null);
    // Resolve blur + preview metadata from the bundle (no Supabase session).
    // R2ImageProgressive reads blur/previewKey/previewSmKey (+ widths for the
    // srcset & Tier-2 threshold) off this shape; the bundle keys them as
    // preview / preview_sm / preview_*_w/h.
    setMetaResolver((key) => {
      const m = imageMetaRef.current[key];
      return m ? {
        blur:         m.blur || null,
        previewKey:   m.preview || null,
        previewW:     m.preview_w ?? null,
        previewH:     m.preview_h ?? null,
        previewSmKey: m.preview_sm || null,
        previewSmW:   m.preview_sm_w ?? null,
        previewSmH:   m.preview_sm_h ?? null,
      } : null;
    });
    return () => {
      clearReadUrlResolver();
      clearMetaResolver();
      ydocsRef.current.forEach((d) => { try { d.destroy(); } catch (_) {} });
      ydocsRef.current.clear();
    };
  }, []);

  // Fetch + decode one board bundle. boardId null/undefined → the link's
  // root board. Keeps the Y.Doc ALIVE (CanvasSurface + doc cards read it);
  // it's destroyed on component unmount.
  const fetchBundle = useCallback(async (boardId) => {
    // Consume the worker-injected early fetch (window.__shareBundle / __publicBundle
    // — an inline script in the served HTML starts the POST during parse,
    // overlapping the whole JS download) when it matches this exact request.
    // One-shot: a Response body is single-read. Mismatch / rejection / dev
    // builds (nothing injects there) fall through to the normal POST. Slug mode
    // (/c/<slug>) hits /public-bundle; token mode (/share) hits /share-bundle.
    let res = null;
    if (slug) {
      const early = typeof window !== 'undefined' ? window.__publicBundle : null;
      if (early && early.slug === slug && (early.boardId || null) === (boardId || null)) {
        window.__publicBundle = null;
        try { res = await early.promise; } catch (_) { res = null; }
        if (res && !res.ok) res = null;
      }
      if (!res) {
        const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/share/public-bundle`;
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, boardId: boardId || undefined }),
        });
        if (!res.ok) throw new Error('bundle-failed');
      }
    } else {
      const early = typeof window !== 'undefined' ? window.__shareBundle : null;
      if (early && early.token === token && (early.boardId || null) === (boardId || null)) {
        window.__shareBundle = null;
        try { res = await early.promise; } catch (_) { res = null; }
        if (res && !res.ok) res = null;
      }
      if (!res) {
        const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/share/share-bundle`;
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, boardId: boardId || undefined }),
        });
        if (!res.ok) throw new Error('bundle-failed');
      }
    }
    const bundle = await res.json();
    const ydoc = new Y.Doc();
    if (bundle.snapshot) {
      try { Y.applyUpdate(ydoc, b64ToBytes(bundle.snapshot)); }
      catch (e) { console.warn('[share] snapshot decode failed', e); }
    }
    ydocsRef.current.add(ydoc);
    const decoded = {
      board: bundle.board || {},
      imageUrls: bundle.image_urls || {},
      imageMeta: bundle.image_meta || {},
      // A null snapshot means the board has NO board_state row — a data
      // anomaly (a legitimately empty board still ships a non-null empty-doc
      // snapshot). Surface it instead of silently rendering a blank canvas.
      missingState: !bundle.snapshot,
      ydoc,
      cards: readCards(ydoc),
      arrows: readArrows(ydoc),
      strokes: readStrokes(ydoc),
      groups: readGroups(ydoc),
    };
    return { bundle, decoded };
  }, [token, slug]);

  // Fold a fetched bundle into state; returns the resolved board id.
  const applyBundle = useCallback(({ bundle, decoded }) => {
    const id = bundle.board?.id;
    if (id) setCache(c => ({ ...c, [id]: decoded }));
    // Merge this board's presigned URLs into the session-wide map so images
    // keep resolving as the viewer navigates (and back-navigates) between
    // boards within the link.
    if (decoded.imageUrls) Object.assign(imageMapRef.current, decoded.imageUrls);
    if (decoded.imageMeta) Object.assign(imageMetaRef.current, decoded.imageMeta);
    bundleFetchedAtRef.current = Date.now();
    if (Array.isArray(bundle.nav_boards) && bundle.nav_boards.length) {
      setNavBoards(prev => {
        const next = { ...prev };
        bundle.nav_boards.forEach(b => { if (b?.id) next[b.id] = b.name; });
        return next;
      });
    }
    setIncludeSubboards(!!bundle.include_subboards);
    if (bundle.root_id) setRootId(bundle.root_id);
    return id;
  }, []);

  // Initial load — honor a ?b=<id> deep link, falling back to the root
  // board if that specific board isn't reachable via this link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const initialB = new URLSearchParams(window.location.search).get('b');
      try {
        let r;
        try { r = await fetchBundle(initialB); }
        catch (e) { if (initialB) r = await fetchBundle(null); else throw e; }
        if (cancelled) return;
        const id = applyBundle(r);
        const root = r.bundle.root_id || id;
        const initStack = (id && id !== root) ? [root, id] : [root];
        setStack(initStack);
        try { window.history.replaceState({ shareStack: initStack }, '', viewerUrl(ctx, id, root)); } catch (_) {}
        setStatus('ok');
        logEventOnce(`share_view:${linkKey}`, EV.SHARE_VIEW, {
          ...attrib,
          board_id: id || null,
          root_id: root || null,
          include_subboards: !!r.bundle.include_subboards,
          valid: true,
        });
      } catch (e) {
        console.error('[share] bundle fetch failed', e);
        if (!cancelled) {
          setStatus('invalid');
          logEventOnce(`share_view_invalid:${linkKey}`, EV.SHARE_VIEW, { ...attrib, valid: false });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, slug, ctx, attrib, linkKey, fetchBundle, applyBundle]);

  // Keep the tab title in sync with the visible board — same format the
  // worker injects server-side for the root board's unfurl/title.
  useEffect(() => {
    const name = (cur?.board?.name || '').trim();
    document.title = name ? `${name} — Soleil Clusters` : 'Soleil Clusters';
  }, [cur]);

  // Report a missing board_state row (a blank-render anomaly) once per board,
  // so it surfaces in the admin Errors tab instead of failing invisibly. A
  // legitimately empty board ships a non-null empty-doc snapshot, so this only
  // fires on genuine data loss.
  useEffect(() => {
    if (status !== 'ok' || !cur?.missingState) return;
    const id = currentIdRef.current;
    if (reportedMissingRef.current.has(id)) return;
    reportedMissingRef.current.add(id);
    logClientError(new Error('share_missing_board_state'), { kind: 'warn' });
  }, [status, cur]);

  // Slug mode only: load tag-related public boards for the bottom strip (the
  // worker also injects these as crawlable links for search engines).
  useEffect(() => {
    if (!slug || status !== 'ok') return undefined;
    let cancelled = false;
    getRelatedPublicBoards(slug, 6).then((r) => { if (!cancelled) setRelatedBoards(r); });
    return () => { cancelled = true; };
  }, [slug, status]);

  // URL freshness for long-lived public tabs. Presigned image URLs live 7
  // days; we re-mint them well before that. Two triggers feed this one path:
  //   • periodic / visibility — when the bundle is >24h old (the common case);
  //   • forced — an image actually 403'd (notifyImageAuthError), so we can't
  //     wait on the clock. A forced refresh bumps imgEpoch to remount the
  //     canvas once so its <img>s re-resolve against the fresh URL map.
  // Either way we merge ONLY image_urls/image_meta into the session refs and
  // throw the snapshot Y.Doc away — board CONTENT stays the open-time snapshot
  // (static by design); this only keeps images from decaying.
  const maybeRefresh = useCallback(async ({ force = false } = {}) => {
    if (refreshingRef.current) return;
    if (!force && Date.now() - bundleFetchedAtRef.current < URL_REFRESH_AGE_MS) return;
    refreshingRef.current = true;
    try {
      const id = currentIdRef.current;
      const rid = rootIdRef.current;
      const { decoded } = await fetchBundle(!id || id === rid ? null : id);
      Object.assign(imageMapRef.current, decoded.imageUrls);
      Object.assign(imageMetaRef.current, decoded.imageMeta);
      bundleFetchedAtRef.current = Date.now();
      ydocsRef.current.delete(decoded.ydoc);
      try { decoded.ydoc.destroy(); } catch (_) {}
      if (force) setImgEpoch((e) => e + 1);
    } catch (_) {
      // Retry a transient failure sooner than the hourly tick so URLs can't
      // age toward the 7-day signing cliff. (Forced refreshes don't self-retry
      // — if images are still broken the next error re-escalates.)
      if (!force && !refreshTimerRef.current) {
        refreshTimerRef.current = setTimeout(() => {
          refreshTimerRef.current = null;
          maybeRefresh();
        }, 5 * 60 * 1000);
      }
    } finally {
      refreshingRef.current = false;
    }
  }, [fetchBundle]);

  // Periodic / visibility-driven refresh (the >24h-old common path).
  useEffect(() => {
    if (status !== 'ok') return undefined;
    const onVis = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(() => maybeRefresh(), 60 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(iv);
      if (refreshTimerRef.current) { clearTimeout(refreshTimerRef.current); refreshTimerRef.current = null; }
    };
  }, [status, maybeRefresh]);

  // Escalation: an image 403'd in the canvas (expired presigned URL). The
  // public resolver hands back the same dead URL, so R2Image's force-sign
  // can't recover — re-fetch the bundle for fresh URLs. Throttled to ≤1/30s.
  useEffect(() => {
    if (status !== 'ok') return undefined;
    setImageAuthErrorHandler(() => {
      const now = Date.now();
      if (now - lastForcedAtRef.current < 30 * 1000) return;
      lastForcedAtRef.current = now;
      maybeRefresh({ force: true });
    });
    return () => clearImageAuthErrorHandler();
  }, [status, maybeRefresh]);

  // Idle prefetch: warm the first few sub-board bundles reachable from the
  // current board so navigating into them is instant (marketing demos live
  // or die on that first click). Sequential, capped at 3, once per board;
  // prefetched bundles flow into the cache, so SHARE_SUBBOARD_OPEN's
  // `cached` prop measures the win.
  useEffect(() => {
    if (NO_PREFETCH || status !== 'ok' || !includeSubboards || !currentId) return undefined;
    if (prefetchedRef.current.has(currentId)) return undefined;
    prefetchedRef.current.add(currentId);
    let cancelled = false;
    const run = async () => {
      const decoded = cacheRef.current[currentId];
      if (!decoded) return;
      const targets = [];
      for (const c of decoded.cards) {
        const id = c.kind === 'board' ? c.id : (c.kind === 'boardlink' ? c.target : null);
        if (id && navBoardsRef.current[id] && !cacheRef.current[id] && !targets.includes(id)) targets.push(id);
        if (targets.length >= 3) break;
      }
      await Promise.allSettled(targets.map((id) =>
        (cancelled || cacheRef.current[id])
          ? null
          : fetchBundle(id).then((r) => { if (!cancelled) applyBundle(r); }).catch(() => {})));
    };
    const hasIdle = typeof window.requestIdleCallback === 'function';
    const handle = hasIdle
      ? window.requestIdleCallback(run, { timeout: 4000 })
      : setTimeout(run, 1500);
    return () => {
      cancelled = true;
      if (hasIdle) window.cancelIdleCallback?.(handle); else clearTimeout(handle);
    };
  }, [status, includeSubboards, currentId, fetchBundle, applyBundle]);

  // Browser back/forward — restore the stack we stamped into history.state.
  useEffect(() => {
    const onPop = (e) => {
      const s = e.state?.shareStack;
      if (Array.isArray(s) && s.length) {
        setStack(s);
        const id = s[s.length - 1];
        if (id && !cache[id]) {
          fetchBundle(id === rootId ? null : id).then(applyBundle).catch(() => {});
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [cache, rootId, fetchBundle, applyBundle]);

  // Navigate into a sub-board. Fired by CanvasSurface when a board /
  // board-link card is opened. The server re-checks the target is inside
  // the shared subtree; an out-of-subtree target throws and is ignored.
  // navBusy (the topbar progress shimmer) only flips for uncached targets —
  // cached navigation is instant and a 0ms flash would read as a glitch.
  const openBoard = useCallback(async (boardId) => {
    if (!boardId || openingRef.current || navBusy || boardId === currentId) return;
    openingRef.current = true;
    const wasCached = !!cache[boardId];
    try {
      if (!wasCached) {
        setNavBusy(true);
        applyBundle(await fetchBundle(boardId));
      }
      setStack(prev => {
        const next = [...prev, boardId];
        try { window.history.pushState({ shareStack: next }, '', viewerUrl(ctx, boardId, rootId)); } catch (_) {}
        return next;
      });
      openCountRef.current += 1;
      setSubboardOpened(true);
      logEvent(EV.SHARE_SUBBOARD_OPEN, {
        ...attrib,
        board_id: boardId,
        from_board_id: currentId,
        depth: stack.length,
        cached: wasCached,
      });
    } catch (e) {
      console.warn('[share] open sub-board failed', e);
    } finally {
      openingRef.current = false;
      if (!wasCached) setNavBusy(false);
    }
  }, [cache, currentId, fetchBundle, applyBundle, navBusy, ctx, attrib, rootId, stack.length]);

  // Jump to a breadcrumb level.
  const goToCrumb = useCallback((i) => {
    setStack(prev => {
      if (i >= prev.length - 1) return prev;
      const next = prev.slice(0, i + 1);
      const id = next[next.length - 1];
      try { window.history.pushState({ shareStack: next }, '', viewerUrl(ctx, id, rootId)); } catch (_) {}
      return next;
    });
  }, [ctx, rootId]);

  // Boards map for CanvasSurface: reachable sub-boards (+ the current board)
  // so board / board-link cards render as real tiles and navigate via
  // onOpenBoard.
  const boardsMap = useMemo(() => {
    const m = {};
    Object.entries(navBoards).forEach(([id, name]) => { m[id] = { id, name }; });
    if (cur?.board?.id) m[cur.board.id] = cur.board;
    return m;
  }, [navBoards, cur]);

  // Public-only: a board/boardlink card whose target isn't reachable via
  // this link (not shared, or deleted) is dropped entirely — a padlock /
  // "Missing board" tile is noise on a marketing surface. Arrows that
  // reference dropped cards are skipped (arrowGeometry resolveShape → null).
  // Render-time (not decode-time) so late-merged navBoards re-evaluate it.
  const visibleCards = useMemo(() => {
    const cards = cur?.cards || EMPTY;
    const filtered = cards.filter(c =>
      c.kind === 'board'     ? !!boardsMap[c.id]
    : c.kind === 'boardlink' ? !!boardsMap[c.target]
    : true);
    // Identity-stable when nothing was filtered (the common case) so
    // CanvasSurface memos keyed on the cards array don't churn.
    return filtered.length === cards.length ? cards : filtered;
  }, [cur, boardsMap]);

  // Editorial article under the canvas (slug mode): the worker injected the
  // exact page model it rendered as crawlable HTML — same structure, same
  // order (anti-cloaking parity), zero extra fetch. Hidden while navigated
  // into a sub-board (the model describes the root). No model (transient RPC
  // miss at the edge) → classic full-viewport canvas + bottom strip.
  // (Must sit ABOVE the early returns — it owns a hook.)
  const pageModel = (slug && typeof window !== 'undefined'
    && window.__publicPageModel && window.__publicPageModel.slug === slug)
    ? window.__publicPageModel : null;
  // The app pins html/body/#root to the viewport (canvas app). The doc-style
  // public page needs real document flow — release them for this route only.
  useEffect(() => {
    if (!pageModel) return undefined;
    document.documentElement.classList.add('public-doc-page');
    return () => document.documentElement.classList.remove('public-doc-page');
  }, [pageModel]);
  // Hero framing: tall generated boards open as a tiny fit-everything strip.
  // In article mode, frame the TOP BAND at fit-to-width instead — the rect's
  // aspect matches the hero, so CanvasSurface's center math top-anchors it.
  const initialFrame = useMemo(() => {
    if (!pageModel || stack.length > 1) return null;
    const cs = visibleCards;
    if (!cs || cs.length < 2) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity;
    for (const c of cs) {
      if (!Number.isFinite(c.x) || !Number.isFinite(c.w)) continue;
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x + c.w);
    }
    if (!Number.isFinite(minX) || maxX <= minX) return null;
    const w = maxX - minX;
    const heroW = window.innerWidth || 1280;
    const heroH = Math.min(920, Math.max(440, (window.innerHeight || 800) * 0.78));
    return { x: minX, y: minY, w, h: w * (heroH / heroW) };
  }, [pageModel, stack.length, visibleCards]);
  // "Interactive" affordance over the hero — gone after the first gesture.
  const [heroTouched, setHeroTouched] = useState(false);

  if (status === 'loading') {
    return (
      <div className="public-shell">
        <PublicTopbar ctx={ctx} center={<div className="public-topbar-spacer" />} onCta={onCta} />
        <div className="public-loading">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div>Loading board…</div>
        </div>
      </div>
    );
  }
  if (status === 'invalid') {
    return (
      <div className="public-shell">
        <PublicTopbar ctx={ctx} center={<div className="public-topbar-spacer" />} onCta={onCta} />
        <div className="public-empty">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div className="public-empty-title">{slug ? 'This board isn’t available' : 'This link is no longer live'}</div>
          <div className="public-empty-sub">
            {slug
              ? 'This board may have been unpublished or moved. Explore other boards — or make one of your own.'
              : 'The board you’re looking for was shared with a link that has expired or been revoked. Ask the owner for a new link — or make a board of your own.'}
          </div>
          <div className="public-empty-actions">
            <a className="public-cta" href={ctaHref(ctx, 'invalid_page')} onClick={onCta('invalid_page')}>Try Clusters free</a>
            <a className="public-signin-quiet" href={ctaHref(ctx, 'signin')} onClick={onCta('signin')}>Sign in</a>
          </div>
        </div>
      </div>
    );
  }

  const board = cur?.board || EMPTY_OBJ;
  const showCrumbs = stack.length > 1;
  const showArticle = !!(pageModel && stack.length <= 1);
  // The current board has no board_state row (null snapshot) — render a calm
  // empty state rather than a silent blank canvas. (The anomaly is reported to
  // the Errors tab by the effect above.)
  const missing = !!cur?.missingState;

  // Keep the dark app chrome regardless of board.bg_color (only the canvas
  // surface honors it): chrome built from theme tokens can't guarantee
  // contrast over arbitrary owner-picked backgrounds, and the dark frame
  // reads like a gallery mat around light boards.
  return (
    <div className={`public-shell public-dark${pageModel ? ' public-shell-doc' : ''}`}
         style={{ background: board.bg_color || 'var(--bg-0)' }}>
      <PublicTopbar
        ctx={ctx}
        busy={navBusy}
        onCta={onCta}
        // Contextual CTA: template boards keep the remix CTA with honest words;
        // reference boards (a World Cup guide isn't a template) drop the copy
        // button — "Try Clusters free" carries the conversion. Token /share
        // mode (no pageModel) keeps the classic "Make a copy".
        remixUrl={(!pageModel || pageModel.isTemplate) ? remixHref(ctx) : null}
        remixLabel={pageModel?.isTemplate ? 'Use this template' : 'Make a copy'}
        center={showCrumbs ? (
          <nav className="public-crumbs" aria-label="Breadcrumb">
            {stack.map((id, i) => {
              const name = (i === stack.length - 1 ? board.name : navBoards[id]) || 'Board';
              const last = i === stack.length - 1;
              return (
                <span key={id} className="public-crumb-wrap">
                  {i > 0 && <span className="public-crumb-sep" aria-hidden="true">›</span>}
                  {last ? (
                    <span className="public-crumb here" aria-current="page">{name}</span>
                  ) : (
                    <span className="public-crumb clk"
                          role="button"
                          tabIndex={0}
                          onClick={() => goToCrumb(i)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToCrumb(i); } }}>
                      {name}
                    </span>
                  )}
                </span>
              );
            })}
          </nav>
        ) : (
          <div className="public-board-name">{board.name || 'Untitled'}</div>
        )}
      />

      {/* Real board canvas, read-only + chromeless (see styles.css
          .public-canvas-host). The empty/no-op context providers keep any
          live <EntityLink> mention chips or avatars inside notes/cards from
          crashing — they simply become non-interactive. */}
      {missing ? (
        <div className="public-empty">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div className="public-empty-title">This board doesn’t have any content yet</div>
          <div className="public-empty-sub">
            There’s nothing to show here right now. Check back later — or make a board of your own.
          </div>
          <div className="public-empty-actions">
            <a className="public-cta" href={ctaHref(ctx, 'empty_board')} onClick={onCta('empty_board')}>Try Clusters free</a>
            <a className="public-signin-quiet" href={ctaHref(ctx, 'signin')} onClick={onCta('signin')}>Sign in</a>
          </div>
        </div>
      ) : (
      <EntityNavigateContext.Provider value={EMPTY_OBJ}>
        <OpenDmContext.Provider value={NOOP}>
          <div className={`public-canvas-host${navBusy ? ' is-nav-busy' : ''}`} aria-busy={navBusy}
               onPointerDownCapture={heroTouched ? undefined : () => setHeroTouched(true)}>
            {pageModel && stack.length <= 1 && (
              <div className={`pa-hero-hint${heroTouched ? ' is-gone' : ''}`} aria-hidden="true">
                This board is live — drag to explore
              </div>
            )}
            <CanvasSurface
              key={`cv-${imgEpoch}`}
              initialFrame={initialFrame}
              board={board}
              boards={boardsMap}
              cards={visibleCards}
              arrows={cur?.arrows || EMPTY}
              strokes={cur?.strokes || EMPTY}
              groups={cur?.groups || EMPTY}
              ydoc={cur?.ydoc || null}
              getAwareness={undefined}
              currentUser={undefined}
              mutators={EMPTY_OBJ}
              canEdit={false}
              isPublic
              onOpenBoard={openBoard}
              onOpenPicker={NOOP}
              tweak={PUBLIC_TWEAK}
              depth={Math.max(0, stack.length - 1)}
              selectedTool="pan"
              setSelectedTool={NOOP}
              defaults={null}
              workspaceId={null}
              userId={null}
            />
          </div>
        </OpenDmContext.Provider>
      </EntityNavigateContext.Provider>
      )}

      {/* The editorial article — canvas hero above, scrollable page below. */}
      {showArticle && !missing && (
        <PublicArticle
          model={pageModel}
          boardId={board.id}
          remixUrl={remixHref(ctx)}
          tryHref={ctaHref(ctx, 'article')}
          onCta={onCta}
        />
      )}

      {/* Legacy bottom strip — only when there's no article to carry these
          links (transient page-RPC miss at the edge, or pre-0181 content). */}
      {slug && !pageModel && (
        <nav className="public-related" aria-label="Related boards" style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 6,
          display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
          padding: '8px 14px', background: 'rgba(10,9,8,0.72)', backdropFilter: 'blur(8px)',
          borderTop: '1px solid rgba(255,255,255,0.08)', pointerEvents: 'auto',
        }}>
          {relatedBoards.length > 0 && (
            <>
              <span className="t-meta" style={{ color: 'var(--text-soft, #b7b1a6)', fontWeight: 600 }}>Related:</span>
              {relatedBoards.slice(0, 4).map((r) => (
                <a key={r.slug} href={`/c/${r.slug}`} style={{
                  color: '#FFA500', textDecoration: 'none', fontSize: '.85rem',
                  border: '1px solid rgba(255,165,0,0.3)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap',
                }}>{r.seo_title || r.slug}</a>
              ))}
            </>
          )}
          <span style={{ flex: '1 1 auto' }} />
          <a href={matchToolPath(board?.name) || '/use-cases'} style={{
            color: '#FFA500', textDecoration: 'none', fontSize: '.85rem', fontWeight: 600, whiteSpace: 'nowrap',
          }}>Make your own — free</a>
          <a href="/use-cases" style={{
            color: 'var(--text-soft, #b7b1a6)', textDecoration: 'none', fontSize: '.85rem', whiteSpace: 'nowrap',
          }}>What you can make</a>
        </nav>
      )}

      <SharePrompt
        href={ctaHref(ctx, 'prompt')}
        onCtaClick={onCta('prompt')}
        subboardOpened={subboardOpened}
        ctaClickedRef={ctaClickedRef}
      />
    </div>
  );
}
