// Image renderer that knows how to resolve our `r2:<key>` sentinel.
//
// Two flavors, picked by the `progressive` prop:
//
//  - R2ImageBasic (default) — fetch a signed read URL via the cache, render
//    <img> once it lands; re-fetch before TTL expiry so visible images never
//    blink. Non-r2 srcs (https / data:) render as-is. Used by avatars, entity
//    previews, tag thumbnails, and the lightbox — single <img>, unchanged.
//
//  - R2ImageProgressive (`progressive` — canvas image cards) — three-tier load:
//      Tier 0  an instant blurred placeholder from the image's thumbhash
//              (zero image bytes), so a zoomed-out board "shows everything"
//              immediately.
//      Tier 1  a downscaled WebP preview (preview_path) for canvas display.
//      Tier 2  the original — swapped in on idle ("upgrade to full"), and used
//              when no preview exists yet. Writers also lazily BACKFILL the
//              preview + thumbhash from the decoded original the first time an
//              un-backfilled image is seen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cachedUrl, resolveSrc, getSignedUrl, CACHE_TTL_MS } from '../lib/r2.js';
import { getMeta, subscribeMeta, primeImageMeta } from '../lib/imageMeta.js';
import { runGated } from '../lib/backfillGate.js';
import { thumbHashToDataURL } from 'thumbhash';
import * as perf from '../lib/perf.js';

const REFRESH_BEFORE_MS = 30 * 1000; // re-presign 30s before client cache expires

// A sign-reads call can transiently return null — the auth session isn't hydrated
// yet on a cold board open, a worker/network hiccup, or a batch that came back
// empty. That used to permanently lock the image (the `failed` state is sticky).
// Retry a few times with backoff before falling back to the blocked placeholder,
// so a momentary miss never strands an image the viewer can actually access.
const MAX_SIGN_RETRIES = 4;
const SIGN_RETRY_BASE_MS = 800; // backoff: 0.8s, 1.6s, 3.2s, 6.4s

// One backfill attempt per image key per session (success OR definitive
// failure). Cleared only by a page reload.
const _backfillAttempted = new Set();

// One metadata prime per image key per session — a card re-entering the viewport
// must not re-fire primeImageMeta (imageMeta dedupes the query too, but this
// avoids even scheduling the call). Cleared only by a page reload.
const _primeAttempted = new Set();

// Decode a base64 thumbhash to a data URL once (cheap, but cache anyway).
const _blurCache = new Map();
function base64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function blurToDataUrl(b64) {
  if (!b64) return null;
  if (_blurCache.has(b64)) return _blurCache.get(b64);
  let url = null;
  try { url = thumbHashToDataURL(base64ToU8(b64)); } catch (_) { url = null; }
  _blurCache.set(b64, url);
  return url;
}

function BlockedPlaceholder({ rootRef, ...rest }) {
  return (
    <div ref={rootRef} className="r2-img r2-img-blocked" {...rest} aria-label="No access">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="5" y="9" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 9 V6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

// ── Basic (unchanged behavior) ──────────────────────────────────────────
function R2ImageBasic({ src, alt = '', eager = false, onError, w, h,
                        // progressive-only props are accepted + ignored here so
                        // they never leak onto the DOM if mis-passed.
                        backfillEnabled, upgradeToFull, boardId, ...rest }) {
  const initial = cachedUrl(src);
  const [url, setUrl] = useState(initial);
  const [failed, setFailed] = useState(false);
  // Viewport gating: defer presign + image decode for cards that aren't near
  // the viewport. eager-marked images (lightbox hero, already-presigned cached
  // cards) skip the gate. Once visible, we stay visible.
  const [visible, setVisible] = useState(() => eager || !!initial);
  const rootRef = useRef(null);

  useEffect(() => {
    if (visible) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setVisible(true); io.disconnect(); return; }
      }
    }, { rootMargin: '100%' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let refreshTimer = null;
    let retryTimer = null;
    let attempt = 0;
    const tick = async () => {
      const resolved = await resolveSrc(src);
      if (cancelled) return;
      if (!resolved) {
        // Transient sign failures: retry with backoff before showing the lock.
        if (typeof src === 'string' && src.startsWith('r2:') && attempt < MAX_SIGN_RETRIES) {
          attempt += 1;
          retryTimer = setTimeout(tick, SIGN_RETRY_BASE_MS * 2 ** (attempt - 1));
          return;
        }
        setFailed(true);
        return;
      }
      attempt = 0;
      setUrl(resolved);
      setFailed(false);
      if (typeof src === 'string' && src.startsWith('r2:')) {
        refreshTimer = setTimeout(async () => {
          if (cancelled) return;
          const fresh = await getSignedUrl(src.slice(3));
          if (!cancelled && fresh) setUrl(fresh);
        }, CACHE_TTL_MS - REFRESH_BEFORE_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); if (retryTimer) clearTimeout(retryTimer); };
  }, [src, visible]);

  if (failed) return <BlockedPlaceholder {...rest} />;

  if (!url) {
    // Loading shimmer; rootRef anchors the IntersectionObserver.
    return <div ref={rootRef} className="r2-img r2-img-loading" {...rest} />;
  }

  // Explicit width/height tell Chrome to decode-at-size and cache that decoded
  // form (one decode per image per session — zoom is a pure compositor scale).
  return (
    <img ref={rootRef}
         src={url}
         alt={alt}
         width={w}
         height={h}
         loading={eager ? 'eager' : 'lazy'}
         decoding="async"
         fetchpriority={eager ? 'high' : 'low'}
         {...rest}
         onError={(e) => {
           if (typeof src === 'string' && src.startsWith('r2:')) {
             getSignedUrl(src.slice(3)).then(fresh => {
               if (fresh && fresh !== url) setUrl(fresh);
               else setFailed(true);
             });
           } else {
             setFailed(true);
           }
           onError?.(e);
         }} />
  );
}

// ── Progressive (canvas image cards) ────────────────────────────────────
function R2ImageProgressive({ src, alt = '', eager = false, onError, w, h,
                              backfillEnabled = false, upgradeToFull = true, boardId = null,
                              className, style, draggable, ...rest }) {
  const originalKey = (typeof src === 'string' && src.startsWith('r2:')) ? src.slice(3) : null;

  const [meta, setMeta] = useState(() => (originalKey ? getMeta(originalKey) : null));
  // The r2 sentinel currently being shown. Prefers the preview when known;
  // never downgrades a loaded image (see the pre-load switch effect below).
  const [activeSrc, setActiveSrc] = useState(() => {
    const m = originalKey ? getMeta(originalKey) : null;
    return (m && m.previewKey) ? `r2:${m.previewKey}` : src;
  });
  const initialUrl = cachedUrl(activeSrc);
  const [url, setUrl] = useState(initialUrl);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(() => eager || !!initialUrl);

  const rootRef = useRef(null);
  const imgRef = useRef(null);
  const upgradedRef = useRef(false);
  const hitMarkedRef = useRef(false);

  // Freeze the crossOrigin decision at mount so a later meta update (e.g. our
  // own backfill landing) doesn't flip the attribute and force the full image
  // to refetch. We only need a CORS-clean canvas read when we'll backfill —
  // i.e. a writer viewing an r2 original that has no preview yet.
  const wantCorsRef = useRef(null);
  if (wantCorsRef.current === null) {
    const m0 = originalKey ? getMeta(originalKey) : null;
    wantCorsRef.current = !!(backfillEnabled && originalKey && !(m0 && m0.previewKey));
  }

  const blurUrl = useMemo(() => ((visible || eager) ? blurToDataUrl(meta?.blur) : null), [meta, visible, eager]);

  // Subscribe to metadata arriving after a cold open (the prime query landing,
  // or a fresh upload's variant generation).
  useEffect(() => {
    if (!originalKey) return;
    setMeta(getMeta(originalKey));
    const unsub = subscribeMeta(originalKey, () => setMeta(getMeta(originalKey)));
    return unsub;
  }, [originalKey]);

  // Reset tier state when src changes (e.g. local blob preview → r2 key after
  // an upload completes). Without this the once-initialized activeSrc would
  // keep pointing at the stale (revoked) blob.
  useEffect(() => {
    upgradedRef.current = false;
    hitMarkedRef.current = false;
    setLoaded(false);
    setFailed(false);
    const m = originalKey ? getMeta(originalKey) : null;
    setActiveSrc((m && m.previewKey) ? `r2:${m.previewKey}` : src);
  }, [src]);

  // Viewport gate (same as basic; rootRef on the always-present wrapper).
  useEffect(() => {
    if (visible) return;
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { setVisible(true); io.disconnect(); return; }
      }
    }, { rootMargin: '100%' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  // Safety net: surfaces/cards that didn't go through the board-open prime get
  // their metadata fetched lazily the first time they're visible.
  useEffect(() => {
    if (!visible || !originalKey) return;
    if (_primeAttempted.has(originalKey)) return;
    if (getMeta(originalKey) == null) { _primeAttempted.add(originalKey); primeImageMeta([originalKey]); }
  }, [visible, originalKey]);

  // Before anything has loaded, if a preview becomes known, prefer it (catches
  // the late-prime race without downgrading an already-loaded original).
  useEffect(() => {
    if (loaded || upgradedRef.current) return;
    if (meta && meta.previewKey) {
      const pv = `r2:${meta.previewKey}`;
      if (activeSrc !== pv) setActiveSrc(pv);
    }
  }, [meta, loaded, activeSrc]);

  // Resolve the active src → signed URL; refresh before TTL expiry.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let refreshTimer = null;
    let retryTimer = null;
    let attempt = 0;
    const tick = async () => {
      const resolved = await resolveSrc(activeSrc);
      if (cancelled) return;
      if (!resolved) {
        // Transient sign failures: retry with backoff before showing the lock.
        if (typeof activeSrc === 'string' && activeSrc.startsWith('r2:') && attempt < MAX_SIGN_RETRIES) {
          attempt += 1;
          retryTimer = setTimeout(tick, SIGN_RETRY_BASE_MS * 2 ** (attempt - 1));
          return;
        }
        setFailed(true);
        return;
      }
      attempt = 0;
      setUrl(resolved);
      setFailed(false);
      if (typeof activeSrc === 'string' && activeSrc.startsWith('r2:')) {
        refreshTimer = setTimeout(async () => {
          if (cancelled) return;
          const fresh = await getSignedUrl(activeSrc.slice(3));
          if (!cancelled && fresh) setUrl(fresh);
        }, CACHE_TTL_MS - REFRESH_BEFORE_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); if (retryTimer) clearTimeout(retryTimer); };
  }, [activeSrc, visible]);

  // Tier-2 upgrade: once a preview has painted, swap to the original on idle so
  // the card "slowly loads up to full quality" (no flash — same <img>). Gated
  // on the card's ACTUAL displayed size (getBoundingClientRect includes the
  // canvas zoom transform): a zoomed-out board shows the card far smaller than
  // the 1280px preview, so the preview is already crisp and we must NOT
  // re-download the multi-MB original. We only upgrade when the card is shown
  // large enough that the preview would be visibly upscaled.
  useEffect(() => {
    if (!upgradeToFull || upgradedRef.current || !loaded) return;
    if (!meta || !meta.previewKey) return;
    if (activeSrc !== `r2:${meta.previewKey}`) return;
    let cancelled = false;
    const ric = (typeof window !== 'undefined' && window.requestIdleCallback)
      ? window.requestIdleCallback : (fn) => setTimeout(() => fn(), 300);
    const cancelRic = (typeof window !== 'undefined' && window.cancelIdleCallback)
      ? window.cancelIdleCallback : clearTimeout;
    const id = ric(() => {
      if (cancelled) return;
      const el = imgRef.current;
      let displayedPx = 0;
      try {
        const r = el?.getBoundingClientRect();
        displayedPx = (r?.width || 0) * (window.devicePixelRatio || 1);
      } catch (_) {}
      // Threshold: ~85% of the preview's width means it's being stretched
      // toward/past 1:1 — worth the original. Below that the preview suffices.
      const threshold = meta.previewW ? meta.previewW * 0.85 : 1000;
      if (displayedPx < threshold) return;  // preview is sharp at this size; skip
      upgradedRef.current = true;
      setActiveSrc(src);                 // original (Tier 2)
      perf.bump('image.tier2Upgrade');
    });
    return () => { cancelled = true; try { cancelRic(id); } catch (_) {} };
  }, [loaded, meta, activeSrc, src, upgradeToFull]);

  const maybeBackfill = () => {
    if (!backfillEnabled || !originalKey) return;
    if (meta && meta.previewKey) return;        // already has a preview
    if (_backfillAttempted.has(originalKey)) return;
    const el = imgRef.current;
    if (!el) return;
    _backfillAttempted.add(originalKey);
    const ws = originalKey.split('/')[0];
    // Dynamic import keeps the variant-generation/upload module (+ its canvas
    // encode path) out of the basic R2Image consumers (avatars, lightbox,
    // public viewer); it only loads when a writer actually backfills.
    runGated(() => import('../lib/uploads.js').then(m => m.generateAndUploadVariants({
      workspaceId: ws, boardId, storagePath: originalKey, imageSource: el,
    })));
  };

  const onImgLoad = () => {
    setLoaded(true);
    if (!hitMarkedRef.current) {
      hitMarkedRef.current = true;
      const showingPreview = !!(meta && meta.previewKey) && activeSrc === `r2:${meta.previewKey}`;
      if (showingPreview) perf.bump('image.preview.hit');
      else if (originalKey && !(meta && meta.previewKey)) perf.bump('image.preview.miss');
    }
    // When we loaded the original because no preview existed, backfill one.
    if (originalKey && activeSrc === src && !(meta && meta.previewKey)) maybeBackfill();
    if (meta?.blur) perf.bump('image.tier0.blurShown');
  };

  if (failed) return <BlockedPlaceholder {...rest} />;

  return (
    <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}>
      {blurUrl && <img className="r2p-blur" src={blurUrl} alt="" aria-hidden="true" draggable="false" />}
      {!blurUrl && !url && <div className="r2p-layer r2-img-loading" />}
      {url && (
        <img ref={imgRef}
             className={`r2p-img ${loaded ? 'is-loaded' : ''}`}
             src={url}
             alt={alt}
             width={w}
             height={h}
             loading={eager ? 'eager' : 'lazy'}
             decoding="async"
             fetchpriority={eager ? 'high' : 'low'}
             draggable={draggable}
             crossOrigin={wantCorsRef.current ? 'anonymous' : undefined}
             onLoad={onImgLoad}
             onError={(e) => {
               // Re-presign once; if it still fails, show the blocked state.
               if (typeof activeSrc === 'string' && activeSrc.startsWith('r2:')) {
                 getSignedUrl(activeSrc.slice(3)).then(fresh => {
                   if (fresh && fresh !== url) setUrl(fresh);
                   else setFailed(true);
                 });
               } else {
                 setFailed(true);
               }
               onError?.(e);
             }} />
      )}
    </div>
  );
}

export function R2Image({ progressive = false, ...props }) {
  return (progressive && props.src) ? <R2ImageProgressive {...props} /> : <R2ImageBasic {...props} />;
}
