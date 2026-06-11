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
import { requestImageBackfill } from '../lib/previewBackfill.js';
import { thumbHashToDataURL } from 'thumbhash';
import * as perf from '../lib/perf.js';
import { bumpPerf } from '../lib/perfReport.js';

const REFRESH_BEFORE_MS = 30 * 1000; // re-presign 30s before client cache expires

// A sign-reads call can transiently return null — the auth session isn't hydrated
// yet on a cold board open, a worker/network hiccup, or a batch that came back
// empty. That used to permanently lock the image (the `failed` state is sticky).
// Retry a few times with backoff before falling back to the blocked placeholder,
// so a momentary miss never strands an image the viewer can actually access.
const MAX_SIGN_RETRIES = 4;
const SIGN_RETRY_BASE_MS = 800; // backoff: 0.8s, 1.6s, 3.2s, 6.4s

// One-backfill-attempt-per-key dedupe lives in previewBackfill.js
// (backfillAttempted) — shared with the whole-board sweep so the two paths
// never generate variants for the same image twice.

// One metadata prime per image key per session — a card re-entering the viewport
// must not re-fire primeImageMeta (imageMeta dedupes the query too, but this
// avoids even scheduling the call). Cleared only by a page reload.
const _primeAttempted = new Set();

// A decoded original above this many pixels costs more GPU/decode memory
// than the one-time blur-up it would avoid (a 12MP photo decodes to ~48MB;
// dozens of those alive at once is how canvas raster tiles get dropped).
// Below it, a warm original is comparable to the 1280px preview (~1.6MP).
const MAX_WARM_ORIGINAL_PX = 2_500_000;

// Pick which tier to mount/show before anything has loaded. Prefer the
// preview ONLY when it's at least as warm as the original:
//   preview signed URL cached → preview (smaller decode, the fast path)
//   both cold                 → preview (smaller cold download)
//   original warm, preview cold → original IF it's small (≤2.5MP, unknown
//     dims count as too big): a URL signed this session/recently means the
//     bytes are near-certainly in the browser disk cache, so a culling
//     remount right after a mid-session backfill must not downgrade to a
//     cold preview key and re-blur. Large originals take the cold preview
//     anyway — one blur-up, bounded GPU memory; the preview is warm from
//     then on (its URL is pre-warmed by generateAndUploadVariants).
// Public viewer: cachedUrl resolves via the share bundle, so every bundled
// key counts as warm and the preview keeps winning there.
function pickTierSrc(src, originalKey) {
  const m = originalKey ? getMeta(originalKey) : null;
  if (!m || !m.previewKey) return src;
  const pv = `r2:${m.previewKey}`;
  if (cachedUrl(pv) || !cachedUrl(src)) return pv;
  if (!(m.w && m.h && m.w * m.h <= MAX_WARM_ORIGINAL_PX)) return pv;
  return src;
}

// The Tier-2 upgrade only pays when the original genuinely has more pixels
// than the preview AND decodes within the GPU-tile budget:
//   - native-resolution webp previews (the ≤1280px byte-heavy re-encode
//     path) have previewW == original width — upgrading re-downloads a
//     multi-hundred-KB original for ZERO extra pixels;
//   - originals above MAX_WARM_ORIGINAL_PX are exactly the decodes that
//     blow Chrome's canvas raster-tile budget (black patches mid-pan).
// Unknown dims keep the legacy behavior (upgrade) — can't prove zero gain.
function originalWorthUpgrade(m) {
  if (!m) return true;
  if (m.w && m.previewW && m.w <= m.previewW) return false;
  if (m.w && m.h && m.w * m.h > MAX_WARM_ORIGINAL_PX) return false;
  return true;
}

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
  try {
    const u8 = base64ToU8(b64);
    // hasAlpha header bit: thumbhash composites transparent pixels onto the
    // image's average color, so for a cutout the placeholder is a smear across
    // regions the real image leaves transparent — and the blur layer sits
    // underneath the loaded image forever, so the smear would keep showing
    // through. No placeholder beats a wrong one; alpha images shimmer instead.
    if (!(((u8[0] | (u8[1] << 8) | (u8[2] << 16)) >> 23) & 1)) {
      url = thumbHashToDataURL(u8);
    }
  } catch (_) { url = null; }
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
  // After a couple of failed presign attempts, surface a quiet "still
  // trying" cue so the shimmer doesn't read as hung during the backoff.
  const [slowRetry, setSlowRetry] = useState(false);
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
          if (attempt >= 2) setSlowRetry(true);
          retryTimer = setTimeout(tick, SIGN_RETRY_BASE_MS * 2 ** (attempt - 1));
          return;
        }
        setFailed(true);
        return;
      }
      attempt = 0;
      setSlowRetry(false);
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
    return <div ref={rootRef} className={`r2-img r2-img-loading ${slowRetry ? 'r2-img-retrying' : ''}`} {...rest} />;
  }

  // Explicit width/height tell Chrome to decode-at-size and cache that decoded
  // form (one decode per image per session — zoom is a pure compositor scale).
  // NO native loading="lazy": the IO `visible` gate above is the lazy
  // mechanism, and unlike the browser's lazy-loader it stays correct when the
  // canvas moves content on-screen via ancestor transform only (zoom/pan).
  // Native lazy left such images unfetched — stuck on their placeholder until
  // an unrelated style invalidation (e.g. hover) re-ran its evaluation.
  return (
    <img ref={rootRef}
         src={url}
         alt={alt}
         width={w}
         height={h}
         decoding="async"
         fetchpriority={eager ? 'high' : 'low'}
         {...rest}
         onError={(e) => {
           if (typeof src === 'string' && src.startsWith('r2:')) {
             // Force a fresh sign (evicts the cached string) — the URL we were
             // handed may be an expired signature, so re-presigning WITHOUT
             // force would just hand back the same dead URL and lock the image.
             getSignedUrl(src.slice(3), { force: true }).then(fresh => {
               if (fresh) setUrl(fresh);
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
  // The r2 sentinel currently being shown. Prefers the warmest tier
  // (pickTierSrc); never downgrades a loaded image (see the pre-load switch
  // effect below).
  const [activeSrc, setActiveSrc] = useState(() => pickTierSrc(src, originalKey));
  const initialUrl = cachedUrl(activeSrc);
  const [url, setUrl] = useState(initialUrl);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(() => eager || !!initialUrl);
  // Signed URL for the small (DPR-down) preview, resolved in parallel so the
  // <img> can offer a srcset. null until resolved / when there's no sm variant.
  const [smUrl, setSmUrl] = useState(null);

  const rootRef = useRef(null);
  const imgRef = useRef(null);
  const upgradedRef = useRef(false);
  const hitMarkedRef = useRef(false);
  // Set after the resolve effect exhausted its retries on the preview tier
  // and fell back to the original — stops the prefer-preview effect from
  // flipping back (ping-pong). Reset on src change.
  const fellBackRef = useRef(false);
  // One failed→retry re-arm per mount (see the resolve effect) so a transient
  // sign-reads outage doesn't brick the card until reload.
  const rearmedRef = useRef(false);
  // Fast-load fade skip: when fetch+decode completes quickly (bytes were in
  // the browser disk cache — the common case for a viewport-culling remount),
  // the 0.35s blur-fade would only delay an instant paint, so onImgLoad sets
  // fastLoadRef and the img gets the r2p-warm (transition: none) class.
  // Measured, not guessed from cache state, so it can't go stale. is-loaded
  // still gates opacity and the blur stays underneath — never a blank flash.
  const urlSetAtRef = useRef(initialUrl ? performance.now() : 0);
  const fastLoadRef = useRef(false);
  const FAST_LOAD_MS = 200;

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
    fellBackRef.current = false;
    rearmedRef.current = false;
    fastLoadRef.current = false;
    setLoaded(false);
    setFailed(false);
    const next = pickTierSrc(src, originalKey);
    urlSetAtRef.current = cachedUrl(next) ? performance.now() : 0;
    setActiveSrc(next);
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

  // Before anything has loaded, re-evaluate the tier when metadata lands
  // (late prime, or a mid-session backfill's setMetaLocal). pickTierSrc keeps
  // a warm original in place — a backfill completing must NOT flip a
  // disk-cached original to a cold preview while the user is panning.
  useEffect(() => {
    if (loaded || upgradedRef.current || fellBackRef.current) return;
    const want = pickTierSrc(src, originalKey);
    if (want !== activeSrc) setActiveSrc(want);
  }, [meta, loaded, activeSrc, src, originalKey]);

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
        // The preview tier exhausted its retries, but the original may still
        // resolve (its URL is often already cached). Fall back ONCE per
        // mount: setActiveSrc re-runs this effect with a fresh retry budget
        // against the original. fellBackRef keeps the prefer-preview effect
        // from flipping back. The blocked placeholder is reserved for the
        // case where the ORIGINAL can't resolve either — real loss of access.
        if (originalKey && activeSrc !== src && !fellBackRef.current) {
          fellBackRef.current = true;
          setActiveSrc(src);
          return;
        }
        setFailed(true);
        // One slow re-arm per mount: a transient sign-reads outage must not
        // brick the card until reload (the lock renders no <img>, so even the
        // onError force-resign path can never fire). Genuine loss of access
        // re-locks after this one extra cycle and stays locked.
        if (!rearmedRef.current) {
          rearmedRef.current = true;
          retryTimer = setTimeout(() => {
            if (cancelled) return;
            fellBackRef.current = false;
            attempt = 0;
            setFailed(false);
            tick();
          }, 30000);
        }
        return;
      }
      attempt = 0;
      urlSetAtRef.current = performance.now();
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

  // Resolve the small (DPR-down) preview in parallel so the card <img> can offer
  // a srcset and let the browser pick the right-sized candidate on first paint.
  // Purely additive: the lg `url` above stays the canonical src + fallback.
  // getSignedUrl is cached/batched and honors the public-viewer resolver, so the
  // /share path resolves the bundle's presigned sm URL the same way.
  const previewSmKey = (meta && meta.previewSmKey) || null;
  useEffect(() => {
    if (!visible || !previewSmKey) { setSmUrl(null); return; }
    let cancelled = false;
    getSignedUrl(previewSmKey).then((u) => { if (!cancelled) setSmUrl(u || null); });
    return () => { cancelled = true; };
  }, [visible, previewSmKey]);

  // Warm the Tier-2 signed URL as soon as the upgrade is predictable — the card
  // is already displayed near/above the preview's native size — instead of
  // paying preview-load → idle → rAF presign batch (~400ms) before the original
  // can even start downloading. Only the URL is warmed: no bytes are fetched
  // until the upgrade effect below actually swaps the src, so a card that never
  // upgrades costs at most one extra key in an already-batched presign call.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!visible || warmedRef.current || !upgradeToFull || upgradedRef.current) return;
    if (!originalKey || !meta || !meta.previewKey) return;
    if (!originalWorthUpgrade(meta)) return;
    let displayedPx = 0;
    try {
      const r = rootRef.current?.getBoundingClientRect();
      displayedPx = (r?.width || 0) * (window.devicePixelRatio || 1);
    } catch (_) {}
    const threshold = meta.previewW ? meta.previewW * 0.85 : 1000;
    if (displayedPx < threshold) return;
    warmedRef.current = true;
    getSignedUrl(originalKey);
  }, [visible, meta, upgradeToFull, originalKey]);

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
    if (!originalWorthUpgrade(meta)) return;
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
      bumpPerf('image.tier2Upgrade');
    });
    return () => { cancelled = true; try { cancelRic(id); } catch (_) {} };
  }, [loaded, meta, activeSrc, src, upgradeToFull]);

  const onImgLoad = () => {
    // Fade skip is decided by MEASURED fetch+decode time from the moment the
    // URL was handed to the <img> — disk-cache loads come in well under the
    // threshold, network loads don't. Set before setLoaded so the is-loaded
    // render picks it up.
    fastLoadRef.current = urlSetAtRef.current > 0 &&
      (performance.now() - urlSetAtRef.current) < FAST_LOAD_MS;
    setLoaded(true);
    if (!hitMarkedRef.current) {
      hitMarkedRef.current = true;
      const showingPreview = !!(meta && meta.previewKey) && activeSrc === `r2:${meta.previewKey}`;
      if (showingPreview) { perf.bump('image.preview.hit'); bumpPerf('image.preview.hit'); }
      else if (originalKey && !(meta && meta.previewKey)) { perf.bump('image.preview.miss'); bumpPerf('image.preview.miss'); }
      // Two distinct third paths, counted separately so the warm-tier
      // strategy stays observable: warmOriginal = pickTierSrc deliberately
      // kept the warm original; fellBack = the preview tier failed to
      // resolve and we recovered on the original.
      else if (originalKey) perf.bump(fellBackRef.current ? 'image.preview.fellBack' : 'image.preview.warmOriginal');
    }
    // When we loaded the original because no preview existed, generate one.
    // Fetch-based (cache-bypassing) — never reads the displayed element's
    // canvas, so the display img needs no crossOrigin and can't be broken by
    // CORS cache poisoning (see previewBackfill.js).
    if (backfillEnabled && originalKey && activeSrc === src && !(meta && meta.previewKey)) {
      requestImageBackfill(originalKey, boardId);
    }
    if (blurUrl) perf.bump('image.tier0.blurShown');
  };

  // Offer a srcset ONLY while showing the preview tier with both candidate URLs
  // ready (lazy cards; eager ones keep the single-src fast path). The `sizes`
  // hint is the card's on-canvas width — `w` is the card's board-coordinate size
  // (Math.round(c.w) from CanvasSurface), which is zoom-invariant because the
  // canvas zooms via an ancestor CSS transform that doesn't change layout width.
  // Handing the browser an explicit length (not sizes="auto") means this works
  // on every browser, and the srcset w-descriptor algorithm picks the ~640px sm
  // candidate when w*DPR <= 640 and the 1280px lg otherwise. That algorithm never
  // selects an undersized candidate (smallest candidate >= needed device px, else
  // the largest), so sm is never upscaled. Zooming a card in far enough triggers
  // the Tier-2 swap to the original below. Outside the preview tier (Tier-2
  // original, or any image with no sm variant — i.e. every pre-existing image)
  // srcset is omitted, so legacy images are byte-for-byte unchanged.
  const inPreviewTier = !!(meta && meta.previewKey) && activeSrc === `r2:${meta.previewKey}`;
  const canSrcset = !eager && inPreviewTier && !!smUrl && !!url
    && !!meta.previewSmW && !!meta.previewW && url !== smUrl;
  const imgSrcSet = canSrcset ? `${smUrl} ${meta.previewSmW}w, ${url} ${meta.previewW}w` : undefined;
  const cardDisplayW = (typeof w === 'number' && w > 0) ? Math.round(w) : null;
  // Explicit length when we know the card width (the canvas + public-viewer
  // case); fall back to sizes=auto only if it's somehow unknown.
  const imgSizes = imgSrcSet ? (cardDisplayW ? `${cardDisplayW}px` : 'auto') : undefined;

  if (failed) return <BlockedPlaceholder {...rest} />;

  return (
    <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}>
      {blurUrl && <img className="r2p-blur" src={blurUrl} alt="" aria-hidden="true" draggable="false" />}
      {!blurUrl && !url && <div className="r2p-layer r2-img-loading" />}
      {url && (
        <img ref={imgRef}
             className={`r2p-img ${loaded ? 'is-loaded' : ''}${fastLoadRef.current ? ' r2p-warm' : ''}`}
             src={url}
             srcSet={imgSrcSet}
             sizes={imgSizes}
             alt={alt}
             width={w}
             height={h}
             decoding="async"
             fetchpriority={eager ? 'high' : 'low'}
             draggable={draggable}
             onLoad={onImgLoad}
             onError={(e) => {
               // The browser may have chosen the sm srcset candidate; drop it so
               // we fall back to the lg `src` rather than retrying a bad sm URL.
               if (smUrl) setSmUrl(null);
               // Force a fresh sign (evicts the cached string). The URL may be an
               // expired signature; re-presigning WITHOUT force would hand back
               // the same dead URL and lock the image. A null result means real
               // loss of access → blocked; any fresh URL → recover.
               if (typeof activeSrc === 'string' && activeSrc.startsWith('r2:')) {
                 getSignedUrl(activeSrc.slice(3), { force: true }).then(fresh => {
                   if (fresh) setUrl(fresh);
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
