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
import { setReadUrlResolver, clearReadUrlResolver } from '../lib/r2.js';
import { setMetaResolver, clearMetaResolver } from '../lib/imageMeta.js';
import { EntityNavigateContext } from '../hooks/useEntityNavigate.js';
import { OpenDmContext } from '../hooks/useOpenDm.js';
import { useDwellTime } from '../hooks/useDwellTime.js';
import { logEvent, logEventNow, logEventOnce, seedShareFirstSource } from '../lib/analytics.js';
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

// Build the /share URL for a given board within a link. The root board
// omits the ?b= param so the canonical share URL stays clean.
function shareUrl(token, boardId, rootId) {
  return (!boardId || boardId === rootId)
    ? `/share/${token}`
    : `/share/${token}?b=${boardId}`;
}

// Signup CTAs land on "/" carrying explicit utm params as the attribution
// FALLBACK: the primary mechanism (seedShareFirstSource → sessionStorage)
// only survives same-tab navigation, so cmd-click / "open in new tab" still
// attributes the signup to this share link.
function ctaHref(token, surface) {
  return `/?utm_source=share_link&utm_medium=${surface}&utm_campaign=${token}`;
}

// Branded top bar — rendered in every viewer state (loading / invalid / ok)
// so the wordmark and signup CTA are visible from the first paint.
function PublicTopbar({ token, center, busy, onCta }) {
  return (
    <div className="public-topbar">
      <a className="public-brand" href={ctaHref(token, 'badge')} title="Clusters home" onClick={onCta('badge')}>
        <ClustersMark size={20} />
        <span className="public-brand-name">Clusters</span>
      </a>
      {center}
      <div className="public-topbar-actions">
        <a className="public-signin-quiet" href={ctaHref(token, 'signin')} onClick={onCta('signin')}>Sign in</a>
        <a className="public-cta" href={ctaHref(token, 'topbar')} onClick={onCta('topbar')}>Try Clusters free</a>
      </div>
      {busy && <div className="public-nav-progress" aria-hidden="true" />}
    </div>
  );
}

export function PublicBoardView({ token }) {
  const [status, setStatus] = useState('loading');   // 'loading' | 'ok' | 'invalid'
  const [cache, setCache] = useState({});             // boardId → decoded bundle
  const [navBoards, setNavBoards] = useState({});     // boardId → name (reachable)
  const [includeSubboards, setIncludeSubboards] = useState(false);
  const [rootId, setRootId] = useState(null);
  const [stack, setStack] = useState([]);             // board ids, last = current
  const [navBusy, setNavBusy] = useState(false);
  const [subboardOpened, setSubboardOpened] = useState(false); // SharePrompt trigger B

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
  const openingRef = useRef(false);        // openBoard reentrancy guard (navBusy state lags a render)

  const currentId = stack.length ? stack[stack.length - 1] : null;
  const cur = currentId ? cache[currentId] : null;
  const currentIdRef = useRef(null);
  currentIdRef.current = currentId;
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
    logEventNow(EV.SHARE_CTA_CLICK, { surface, share_token: token });
  }, [token]);

  // Time-on-board, fired once on leave (hide/unload/unmount). board_id and
  // boards_opened are read at fire time so they reflect where the visitor
  // actually ended up.
  useDwellTime(EV.SHARE_DWELL, () => ({
    share_token: token,
    board_id: currentIdRef.current,
    boards_opened: openCountRef.current,
  }));

  // Seed share attribution into the session first-touch source BEFORE the
  // first event of this pageload, so share_token (+ utm_source=share_link)
  // rides on every row and lands in profiles.first_source at signup.
  useEffect(() => {
    seedShareFirstSource(token);
  }, [token]);

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
    const url = `${PARTYKIT_PROTOCOL}://${PARTYKIT_HOST}/parties/upload/share/share-bundle`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, boardId: boardId || undefined }),
    });
    if (!res.ok) throw new Error('bundle-failed');
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
      ydoc,
      cards: readCards(ydoc),
      arrows: readArrows(ydoc),
      strokes: readStrokes(ydoc),
      groups: readGroups(ydoc),
    };
    return { bundle, decoded };
  }, [token]);

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
        try { window.history.replaceState({ shareStack: initStack }, '', shareUrl(token, id, root)); } catch (_) {}
        setStatus('ok');
        logEventOnce(`share_view:${token}`, EV.SHARE_VIEW, {
          share_token: token,
          board_id: id || null,
          root_id: root || null,
          include_subboards: !!r.bundle.include_subboards,
          valid: true,
        });
      } catch (e) {
        console.error('[share] bundle fetch failed', e);
        if (!cancelled) {
          setStatus('invalid');
          logEventOnce(`share_view_invalid:${token}`, EV.SHARE_VIEW, { share_token: token, valid: false });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [token, fetchBundle, applyBundle]);

  // Keep the tab title in sync with the visible board — same format the
  // worker injects server-side for the root board's unfurl/title.
  useEffect(() => {
    const name = (cur?.board?.name || '').trim();
    document.title = name ? `${name} — Soleil Clusters` : 'Soleil Clusters';
  }, [cur]);

  // Long-lived-tab URL freshness: when the tab becomes visible (or hourly
  // while open) and the bundle is >24h old, silently re-fetch the current
  // board's bundle and merge ONLY image_urls/image_meta into the session
  // refs — cache/state untouched, so nothing remounts or re-renders. The
  // throwaway Y.Doc is destroyed immediately. Failures are swallowed (old
  // URLs still have days of life; the next tick retries).
  useEffect(() => {
    if (status !== 'ok') return undefined;
    const maybeRefresh = async () => {
      if (refreshingRef.current) return;
      if (Date.now() - bundleFetchedAtRef.current < URL_REFRESH_AGE_MS) return;
      refreshingRef.current = true;
      try {
        const id = currentIdRef.current;
        const { decoded } = await fetchBundle(!id || id === rootId ? null : id);
        Object.assign(imageMapRef.current, decoded.imageUrls);
        Object.assign(imageMetaRef.current, decoded.imageMeta);
        bundleFetchedAtRef.current = Date.now();
        ydocsRef.current.delete(decoded.ydoc);
        try { decoded.ydoc.destroy(); } catch (_) {}
      } catch (_) {
      } finally {
        refreshingRef.current = false;
      }
    };
    const onVis = () => { if (document.visibilityState === 'visible') maybeRefresh(); };
    document.addEventListener('visibilitychange', onVis);
    const iv = setInterval(maybeRefresh, 60 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', onVis); clearInterval(iv); };
  }, [status, rootId, fetchBundle]);

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
      for (const id of targets) {
        if (cancelled || cacheRef.current[id]) continue;
        try { applyBundle(await fetchBundle(id)); } catch (_) {}
      }
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
        try { window.history.pushState({ shareStack: next }, '', shareUrl(token, boardId, rootId)); } catch (_) {}
        return next;
      });
      openCountRef.current += 1;
      setSubboardOpened(true);
      logEvent(EV.SHARE_SUBBOARD_OPEN, {
        share_token: token,
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
  }, [cache, currentId, fetchBundle, applyBundle, navBusy, token, rootId, stack.length]);

  // Jump to a breadcrumb level.
  const goToCrumb = useCallback((i) => {
    setStack(prev => {
      if (i >= prev.length - 1) return prev;
      const next = prev.slice(0, i + 1);
      const id = next[next.length - 1];
      try { window.history.pushState({ shareStack: next }, '', shareUrl(token, id, rootId)); } catch (_) {}
      return next;
    });
  }, [token, rootId]);

  // Boards map for CanvasSurface: reachable sub-boards (+ the current board)
  // so board / board-link cards render as real tiles and navigate via
  // onOpenBoard. Unreachable targets are absent → BoardCard's "No access"
  // tile, matching per-board sharing semantics.
  const boardsMap = useMemo(() => {
    const m = {};
    Object.entries(navBoards).forEach(([id, name]) => { m[id] = { id, name }; });
    if (cur?.board?.id) m[cur.board.id] = cur.board;
    return m;
  }, [navBoards, cur]);

  if (status === 'loading') {
    return (
      <div className="public-shell">
        <PublicTopbar token={token} center={<div className="public-topbar-spacer" />} onCta={onCta} />
        <div className="public-loading">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div>Opening the board…</div>
        </div>
      </div>
    );
  }
  if (status === 'invalid') {
    return (
      <div className="public-shell">
        <PublicTopbar token={token} center={<div className="public-topbar-spacer" />} onCta={onCta} />
        <div className="public-empty">
          <SoleilMark size={42} color="var(--soleil)" glow />
          <div className="public-empty-title">This link is no longer live</div>
          <div className="public-empty-sub">
            The board you're looking for was shared with a link that has expired or
            been revoked. Ask the owner for a fresh link — or make a board of your own.
          </div>
          <div className="public-empty-actions">
            <a className="public-cta" href={ctaHref(token, 'invalid_page')} onClick={onCta('invalid_page')}>Try Clusters free</a>
            <a className="public-signin-quiet" href={ctaHref(token, 'signin')} onClick={onCta('signin')}>Sign in</a>
          </div>
        </div>
      </div>
    );
  }

  const board = cur?.board || EMPTY_OBJ;
  const showCrumbs = stack.length > 1;

  // Keep the dark app chrome regardless of board.bg_color (only the canvas
  // surface honors it): chrome built from theme tokens can't guarantee
  // contrast over arbitrary owner-picked backgrounds, and the dark frame
  // reads like a gallery mat around light boards.
  return (
    <div className="public-shell" style={{ background: board.bg_color || 'var(--bg-0)' }}>
      <PublicTopbar
        token={token}
        busy={navBusy}
        onCta={onCta}
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
      <EntityNavigateContext.Provider value={EMPTY_OBJ}>
        <OpenDmContext.Provider value={NOOP}>
          <div className={`public-canvas-host${navBusy ? ' is-nav-busy' : ''}`} aria-busy={navBusy}>
            <CanvasSurface
              board={board}
              boards={boardsMap}
              cards={cur?.cards || EMPTY}
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
              selectedTool="select"
              setSelectedTool={NOOP}
              defaults={null}
              workspaceId={null}
              userId={null}
            />
          </div>
        </OpenDmContext.Provider>
      </EntityNavigateContext.Provider>

      <SharePrompt
        href={ctaHref(token, 'prompt')}
        onCtaClick={onCta('prompt')}
        subboardOpened={subboardOpened}
        ctaClickedRef={ctaClickedRef}
      />
    </div>
  );
}
