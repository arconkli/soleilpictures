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
//      Tier 1  downscaled WebP previews for canvas display, a ladder of rungs:
//              xs (~256px, the quick one that paints at once), sm (640px) and
//              lg (1280px, preview_path). A card mounts on the rung its
//              on-screen size needs (often via xs first) and the image-tier
//              scheduler climbs or steps it down from there.
//      Tier 2  the original — swapped in on idle ("upgrade to full"), and used
//              when no preview exists yet. Writers also lazily BACKFILL the
//              preview + thumbhash from the decoded original the first time an
//              un-backfilled image is seen.

import { useEffect, useMemo, useRef, useState } from 'react';
import { cachedUrl, resolveSrc, getSignedUrl, notifyImageAuthError, signFailure, isWarm, markLoaded, CACHE_TTL_MS } from '../lib/r2.js';
import { CardCouldntLoad } from './cards/CardCouldntLoad.jsx';
import { getMeta, subscribeMeta, primeImageMeta } from '../lib/imageMeta.js';
import { isAnimatedImageKey } from '../lib/fileIngest.js';
import { viewKindOfKey, isViewKey, drawsNowhere } from '../lib/fileView.js';
import { requestImageBackfill } from '../lib/previewBackfill.js';
import { thumbHashToDataURL } from 'thumbhash';
import * as perf from '../lib/perf.js';
import { bumpPerf, getGestureActiveUntil } from '../lib/perfReport.js';
import { getImageTierScale } from '../lib/canvasScale.js';
import { getImageTierScheduler } from '../lib/imageTierScheduler.js';
import { lowMemoryDevice, constrainedConnection } from '../lib/device.js';
import './r2Image.css';
import { bootMark } from '../lib/bootMarks.js';
import { t as tr } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';

const REFRESH_BEFORE_MS = 30 * 1000; // re-presign 30s before client cache expires

// A sign-reads call can transiently return null — the auth session isn't hydrated
// yet on a cold board open, a worker/network hiccup, or a batch that came back
// empty. That used to permanently lock the image (the `failed` state is sticky).
// Retry a few times with backoff before falling back to the blocked placeholder,
// so a momentary miss never strands an image the viewer can actually access.
const MAX_SIGN_RETRIES = 4;
const SIGN_RETRY_BASE_MS = 800; // backoff: 0.8s, 1.6s, 3.2s, 6.4s
// After those, a picture that failed for want of a network asks again in 30 s,
// then 1, 2, 4 and every 5 min, so a long outage doesn't have every failed
// picture on the page asking every half minute. Coming back online asks at once.
const REARM_MS = 30000;
const REARM_MAX_MS = 300000;
const rearmDelay = (n) => Math.min(REARM_MS * 2 ** n, REARM_MAX_MS);

// One-backfill-attempt-per-key dedupe lives in previewBackfill.js
// (backfillAttempted) — shared with the whole-board sweep so the two paths
// never generate variants for the same image twice.

// One metadata prime per image key per session — a card re-entering the viewport
// must not re-fire primeImageMeta (imageMeta dedupes the query too, but this
// avoids even scheduling the call). Cleared only by a page reload.
const _primeAttempted = new Set();

// ── Cache-bust for in-place-overwritten objects (board thumbnails) ─────────
// Most R2 objects are content-stable (per-UUID keys), so the party serves them
// with `immutable, max-age=7d` and the same signed URL is reused forever — a
// browser-disk-cache hit on every view. Board thumbnails break that assumption:
// they reuse a STABLE key (<ws>/thumbs/<id>.webp) and are overwritten in place
// when a board (or one of its nested boards) changes. Under `immutable`, the
// browser then shows the OLD bytes for up to 7 days and won't even revalidate.
//
// Fix: when a thumbnail's content version (thumb_updated_at) is newer than the
// last version we minted a URL for, force a fresh presign. The new X-Amz-Date
// produces a new URL string → a browser-cache MISS → fresh bytes; and the new
// URL is legitimately immutable (that version's bytes never change — the next
// version gets its own URL). Persisted so an UNCHANGED thumbnail still reuses
// its URL across sessions (no needless re-download), only changed ones re-sign.
const _BUST_LS = 'soleil:thumbbust';
let _bustMap = null;
function bustMap() {
  if (_bustMap) return _bustMap;
  _bustMap = new Map();
  try {
    const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(_BUST_LS);
    if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) _bustMap.set(k, v);
  } catch (_) { /* disabled/quota storage — in-memory only */ }
  return _bustMap;
}
function shouldBust(key, version) {
  return bustMap().get(key) !== String(version);
}
function markBust(key, version) {
  const m = bustMap();
  m.set(key, String(version));
  try {
    if (typeof localStorage === 'undefined') return;
    // Bound the map (drop oldest) so it can't grow past the LS quota.
    while (m.size > 2000) { const oldest = m.keys().next().value; m.delete(oldest); }
    localStorage.setItem(_BUST_LS, JSON.stringify(Object.fromEntries(m)));
  } catch (_) { /* quota — keep the in-memory map, skip persistence */ }
}

// A decoded original above this many pixels costs more GPU/decode memory
// than the one-time blur-up it would avoid (a 12MP photo decodes to ~48MB;
// dozens of those alive at once is how canvas raster tiles get dropped).
// Below it, a warm original is comparable to the 1280px preview (~1.6MP).
const MAX_WARM_ORIGINAL_PX = 2_500_000;
// A big original (above MAX_WARM_ORIGINAL_PX) reaches the canvas only when it
// is drawn well past the lg preview, is no bigger than this, and fewer than
// MAX_CANVAS_ORIGINALS cards hold one at once: one sharp photo under a deep
// zoom, never a wall of 48MB decodes.
const MAX_CANVAS_ORIGINAL_PX = 24_000_000;
const MAX_CANVAS_ORIGINALS = 4;
// cardIds currently showing a big original (see the release paths in the card).
const _canvasOriginals = new Set();

// Hysteresis: a card climbs to a rung once it is drawn at 85% of the rung
// below's width, and steps down to a rung once it is drawn under 70% of that
// rung's width. The band between keeps a card at a boundary from flapping.
const PROMOTE_AT = 0.85;
const DEMOTE_BELOW = 0.7;
const RUNGS = ['xs', 'sm', 'lg', 'original'];
const rungIndex = (r) => RUNGS.indexOf(r);

// The image metadata this card tiers on. A GIF's preview is its first frame, so
// a GIF card never tiers: it is read as having no preview, which keeps it on
// the (animated) original through mount, promotion and demotion alike. Rows
// uploaded before the upload path stopped making GIF previews still carry one;
// this is what un-freezes them. The blur placeholder is kept.
// A small original gets a quick (xs) rung but no lg: it is its own top
// preview. It is read with previewKey = the original (previewIsOriginal), so
// every preview path treats the original as the lg rung and none of them
// backfills, upgrades past it or demotes into it.
const _readMetaMemo = new WeakMap();
function readMeta(key) {
  const m = key ? getMeta(key) : null;
  if (!m) return m;
  const memo = _readMetaMemo.get(m);
  if (memo && memo.key === key) return memo.out;
  let out = m;
  if (isAnimatedImageKey(key)) {
    if (m.previewKey || m.previewSmKey || m.previewXsKey) {
      out = { ...m, previewKey: null, previewW: null, previewH: null, previewSmKey: null, previewSmW: null, previewSmH: null,
              previewXsKey: null, previewXsW: null, previewXsH: null };
    }
  } else if (!m.previewKey && m.previewXsKey && !drawsNowhere(key)) {
    out = { ...m, previewKey: key, previewW: m.w ?? null, previewH: m.h ?? null, previewIsOriginal: true };
  }
  // Same object for the same row, so setMeta(readMeta(…)) re-renders only
  // when the row itself changed.
  _readMetaMemo.set(m, { key, out });
  return out;
}

// The picture's width-to-height, from the original's size, else the lg
// preview's; 0 when unknown.
function aspectOf(m) {
  if (m && m.w > 0 && m.h > 0) return m.w / m.h;
  if (m && m.previewW > 0 && m.previewH > 0) return m.previewW / m.previewH;
  return 0;
}
// How wide the picture is drawn in a w×h box: object-fit cover fills the box
// (the overflowing side is cropped), contain fits inside it. Unknown aspect →
// the box's width.
function drawnWidth(w, h, fit, aspect) {
  if (!(w > 0)) return 0;
  if (!(aspect > 0) || !(h > 0)) return w;
  return fit === 'contain' ? Math.min(w, h * aspect) : Math.max(w, h * aspect);
}

// The r2 key of each rung that exists, with its width (null when unknown).
function rungKey(m, rung) {
  if (!m) return null;
  if (rung === 'xs') return m.previewXsKey || null;
  if (rung === 'sm') return m.previewSmKey || null;
  if (rung === 'lg') return m.previewKey || null;
  return null;
}
function rungWidth(m, rung) {
  if (!m) return null;
  if (rung === 'xs') return m.previewXsW || null;
  if (rung === 'sm') return m.previewSmW || null;
  if (rung === 'lg') return m.previewW || null;
  return null;
}

// The rung the screen needs: the smallest of xs / sm / lg whose width is
// known and covers needPx with headroom; else lg. needPx 0 (unknown size) →
// lg, never worse than before the smaller rungs existed. The original is
// reached only by promotion (and the warm-small-original guard).
function needRung(m, needPx) {
  if (needPx > 0) {
    for (const r of ['xs', 'sm']) {
      const wd = rungWidth(m, r);
      if (rungKey(m, r) && wd && needPx < PROMOTE_AT * wd) return r;
    }
  }
  return 'lg';
}
// The next rung up that exists (lg has none: the original is not a rung the
// mount picks on its own).
function rungAbove(m, rung) {
  for (let i = rungIndex(rung) + 1; i < 3; i++) if (rungKey(m, RUNGS[i])) return RUNGS[i];
  return null;
}

// Which rung `activeSrc` is. With previewIsOriginal the original IS lg, so it
// reads as the top rung and never as 'original'.
function rungOf(m, activeSrc, src) {
  if (!m || typeof activeSrc !== 'string') return null;
  if (m.previewXsKey && activeSrc === `r2:${m.previewXsKey}`) return 'xs';
  if (m.previewSmKey && activeSrc === `r2:${m.previewSmKey}`) return 'sm';
  if (m.previewKey && activeSrc === `r2:${m.previewKey}`) return 'lg';
  if (activeSrc === src) return 'original';
  return null;
}

// What a non-r2 src (a blob during upload, a legacy https URL, data:) costs
// is not ours to know; it renders at once as it always has.
function warmNow(s) {
  if (typeof s !== 'string' || !s) return false;
  return s.startsWith('r2:') ? isWarm(s) : true;
}

// Device pixels the card needs: its drawn width × any zoom of its own (a grid
// cell's crop zoom) × the settled canvas scale × DPR. 0 when unknown.
function needPxFor(m, { w, h, fit = 'cover', tierScale = 1 } = {}) {
  const drawn = drawnWidth(typeof w === 'number' ? w : 0, typeof h === 'number' ? h : 0, fit, aspectOf(m));
  if (!drawn) return 0;
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const k = typeof tierScale === 'number' && tierScale > 0 ? tierScale : 1;
  return drawn * k * getImageTierScale() * dpr;
}

// Pick the rung a card mounts on, before anything has loaded. In order:
//   1. the rung the screen needs, when its URL is warm (its bytes loaded under
//      this URL, so the disk cache has them — isWarm, not merely signed: the
//      share viewer signs every key up front);
//   2. the rung directly above that, when warm (one rung only — sharper for
//      free, but not a 1280px decode for a thumbnail);
//   3. a warm original IF it's small (≤2.5MP, unknown dims count as too big)
//      and the device isn't memory-constrained: a culling remount right after
//      a mid-session backfill must not downgrade a disk-cached original to a
//      cold variant key and re-blur;
//   4. the quick xs rung, for a card the scheduler will climb (canDetour):
//      ~10 KB that paints at once, then sharpens to what the screen needs
//      once the wave of first paints goes quiet. Not on Save-Data / 2G, where
//      the detour is a second download the person pays for;
//   5. the rung the screen needs.
// Before CanvasSurface's layout effect runs, getImageTierScale() can be
// stale; that is why a card that isn't warm renders nothing until its
// IntersectionObserver reports (after that effect), and the pre-load switch
// effect re-picks then. An original no browser draws is never chosen.
function pickInitialTier(src, originalKey, opts = {}) {
  const m = readMeta(originalKey);
  if (!m || !m.previewKey) return src;
  const need = needRung(m, needPxFor(m, opts));
  const needSrc = `r2:${rungKey(m, need)}`;
  if (isWarm(needSrc)) return needSrc;
  const above = rungAbove(m, need);
  if (above && isWarm(`r2:${rungKey(m, above)}`)) return `r2:${rungKey(m, above)}`;
  if (!drawsNowhere(originalKey) && !m.previewIsOriginal && isWarm(src)
      && m.w && m.h && m.w * m.h <= MAX_WARM_ORIGINAL_PX && !lowMemoryDevice()) return src;
  if (opts.canDetour && rungIndex(need) > rungIndex('xs')) {
    // A rung below the need whose bytes are already here paints at once for
    // nothing and is sharper than the quick one; the scheduler climbs it the
    // same way. Largest first.
    for (let i = rungIndex(need) - 1; i >= 0; i--) {
      const k = rungKey(m, RUNGS[i]);
      if (k && isWarm(`r2:${k}`)) return `r2:${k}`;
    }
    if (m.previewXsKey && !constrainedConnection()) return `r2:${m.previewXsKey}`;
  }
  return needSrc;
}

// Whether the Tier-2 original URL is worth warming ahead of a promotion:
// only when the original genuinely has more pixels than the preview AND
// decodes within the GPU-tile budget:
//   - native-resolution webp previews (the ≤1280px byte-heavy re-encode
//     path) have previewW == original width — upgrading re-downloads a
//     multi-hundred-KB original for ZERO extra pixels;
//   - originals above MAX_WARM_ORIGINAL_PX are exactly the decodes that
//     blow Chrome's canvas raster-tile budget (black patches mid-pan).
// Unknown dims keep the legacy behavior (upgrade) — can't prove zero gain.
function originalWorthUpgrade(m) {
  // Memory-constrained clients (iOS Safari's per-tab budget, ≤4GB): the Tier-2
  // original never pays — a pinch-zoom-in rolling several 12–24MP photos
  // through decode is exactly what OOM-crashes the WebKit renderer ("A problem
  // repeatedly occurred"). Cap the canvas at the 1280px lg preview instead.
  if (lowMemoryDevice()) return false;
  if (!m) return true;
  if (m.previewIsOriginal) return false;      // the original is already the top rung
  if (m.w && m.previewW && m.w <= m.previewW) return false;
  if (m.w && m.h && m.w * m.h > MAX_WARM_ORIGINAL_PX) return false;
  return true;
}

// Whether a card drawn at displayedPx may climb from lg to its original.
// A small original (≤2.5MP): from 85% of the lg width, as before. A big one
// (or dims unknown): only past 120% of lg — real extra detail on screen —
// within MAX_CANVAS_ORIGINAL_PX, on a device and connection that can afford
// it, and while fewer than MAX_CANVAS_ORIGINALS cards hold one. `ignoreCap`
// skips only that last test: a card that wants an original while the slots are
// full must still read as unsettled (the commit in evaluate() checks the cap
// itself), or the scheduler would record it as done at this scale and never
// climb it once a slot frees.
function originalAllowed(m, displayedPx, { ignoreCap = false } = {}) {
  if (!m || m.previewIsOriginal || !m.previewW) return false;
  if (lowMemoryDevice()) return false;
  if (m.w && m.w <= m.previewW) return false;   // no extra pixels to gain
  const known = !!(m.w && m.h);
  if (known && m.w * m.h <= MAX_WARM_ORIGINAL_PX) return displayedPx >= PROMOTE_AT * m.previewW;
  if (displayedPx <= 1.2 * m.previewW) return false;
  if (known && m.w * m.h > MAX_CANVAS_ORIGINAL_PX) return false;
  if (constrainedConnection()) return false;
  return ignoreCap || _canvasOriginals.size < MAX_CANVAS_ORIGINALS;
}
function isBigOriginal(m) {
  return !(m && m.w && m.h && m.w * m.h <= MAX_WARM_ORIGINAL_PX);
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
    <div ref={rootRef} className="r2-img r2-img-blocked" {...rest} aria-label={tr`No access`}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
        <rect x="5" y="9" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M8 9 V6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    </div>
  );
}

// The bytes arrived (or were never there) but the browser could not show them:
// a TIFF or PSD outside Safari, a HEIC on Chrome/Firefox, a key whose object is
// gone. Distinct from BlockedPlaceholder — nothing about access is wrong, so
// it must not read as a padlock. `downloadSrc` (canvas cards) adds a Download,
// because the file itself is still perfectly good to someone with the right app.
function UnavailablePlaceholder({ rootRef, downloadSrc = null, alt = '', className = '', ...rest }) {
  const download = (ev) => {
    ev.stopPropagation();
    // Dynamic: the export path stays out of the bundle until someone needs it.
    import('../lib/imageExport.js')
      .then(m => m.downloadImage({ src: downloadSrc, title: alt }))
      .catch(() => {});
  };
  return (
    <div ref={rootRef} {...rest} className={`r2-img r2-img-blocked r2-img-unavailable ${className}`}>
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
        <rect x="4" y="5" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M4 14 l4-4 3 3 2-2 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M3 3 L19 19" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
      <span className="r2-img-unavailable-label"><Trans>Preview not available</Trans></span>
      {downloadSrc && (
        <button type="button" className="r2-img-unavailable-dl"
                onPointerDown={(ev) => ev.stopPropagation()}
                onClick={download}>
          <Trans>Download</Trans>
        </button>
      )}
    </div>
  );
}

// A photo with a view (lib/fileView.js) opens on it in the single-image
// flavor (the lightbox, Quick look): the view exists because some browser
// can't draw the file, and the original would be a download that shows nothing
// there. Every browser shows the same picture; Download still gives the file.
function serverView(key) {
  const pv = key && viewKindOfKey(key) ? getMeta(key)?.previewKey : null;
  return pv && isViewKey(pv) ? pv : null;
}

// Wait for the view of a photo the browser couldn't draw (lib/fileViewWork.js
// asks for it and watches it being made); `done` gets its preview key, or null
// when there won't be one.
function waitForView(key, done) {
  import('../lib/fileViewWork.js').then((m) => m.awaitView(key))
    .then((r) => done(r === 'ready' ? getMeta(key)?.previewKey || null : null), () => done(null));
}

// ── Basic ───────────────────────────────────────────────────────────────
function R2ImageBasic({ src, alt = '', eager = false, onError, w, h,
                        // `bust` (optional): a content-version token (board
                        // thumb_updated_at) that forces a fresh presign when it
                        // changes, so an in-place R2 overwrite isn't hidden by
                        // the immutable browser cache. Destructured (not in
                        // ...rest) so it never leaks onto the DOM.
                        bust,
                        // progressive-only props are accepted + ignored here so
                        // they never leak onto the DOM if mis-passed.
                        backfillEnabled, upgradeToFull, boardId, placeholder, ...rest }) {
  const srcKey = typeof src === 'string' && src.startsWith('r2:') ? src.slice(3) : null;
  // The file's preview, shown in place of an original the browser can't draw.
  const [viaPreview, setViaPreview] = useState(() => serverView(srcKey));
  const shown = viaPreview ? `r2:${viaPreview}` : src;
  // A format no browser draws (a raw, a .psd, OpenEXR) never loads its
  // original: until its view is here the picture waits (see noPicture).
  const blockOriginal = !viaPreview && drawsNowhere(srcKey);
  const initial = blockOriginal ? null : cachedUrl(shown);
  const [url, setUrl] = useState(initial);
  const [failed, setFailed] = useState(false);
  // Retry on the "Couldn't load" tile: a new run of the sign effect.
  const [retryTick, setRetryTick] = useState(0);
  // After a couple of failed presign attempts, surface a quiet "still
  // trying" cue so the shimmer doesn't read as hung during the backoff.
  const [slowRetry, setSlowRetry] = useState(false);
  // Viewport gating: defer presign + image decode for cards that aren't near
  // the viewport. eager-marked images (lightbox hero, already-presigned cached
  // cards) skip the gate. Once visible, we stay visible.
  const [visible, setVisible] = useState(() => eager || !!initial);
  const rootRef = useRef(null);
  // The browser refused the bytes even after one fresh signature (see onError).
  const [unavailable, setUnavailable] = useState(false);
  const resignedRef = useRef(false);
  // One failed→retry re-arm per src, as the progressive flavor has: without it
  // a ~12 s sign-reads outage (a laptop waking, captive Wi-Fi) left cluster
  // thumbnails and Files previews padlocked until the user navigated away
  // (MEDIA-14). Re-arms after rearmDelay (30 s, doubling to 5 min), or at
  // once when the browser comes online.
  // A failure that is the network's (signFailure 'network') re-arms every time;
  // a 'denied' one re-locks after the one extra cycle and stays.
  const rearmedRef = useRef(false);
  // Network re-arms since the last good sign (rearmDelay).
  const rearmsRef = useRef(0);
  // The key whose view this is waiting on (see noPicture).
  const viewForRef = useRef(null);
  const [awaitingView, setAwaitingView] = useState(false);
  useEffect(() => { resignedRef.current = false; rearmedRef.current = false; rearmsRef.current = 0; setUnavailable(false); }, [src]);
  // A new file starts on its own view, when it has one, and waits on nothing.
  useEffect(() => {
    viewForRef.current = null; setAwaitingView(false); setViaPreview(serverView(srcKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // The browser refused the bytes. An original falls back to the file's
  // preview when it has one, and a photo that gets a view waits for it (the
  // shimmer, not "Preview not available"); anything else says so.
  const showPreview = (pv) => {
    resignedRef.current = false;
    setUrl(cachedUrl(`r2:${pv}`) || null);
    setViaPreview(pv);
  };
  const noPicture = () => {
    const pv = srcKey && !viaPreview ? getMeta(srcKey)?.previewKey : null;
    if (pv) { showPreview(pv); return; }
    if (!srcKey || viaPreview || !viewKindOfKey(srcKey) || viewForRef.current) { setUnavailable(true); return; }
    const key = srcKey;
    viewForRef.current = key;
    setAwaitingView(true);
    waitForView(key, (next) => {
      if (viewForRef.current !== key) return;
      setAwaitingView(false);
      if (next) showPreview(next); else setUnavailable(true);
    });
  };

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
    if (blockOriginal) {
      if (!viewForRef.current) noPicture();
      return undefined;
    }
    let cancelled = false;
    let refreshTimer = null;
    let retryTimer = null;
    let onOnline = null;
    let attempt = 0;
    const isR2 = typeof shown === 'string' && shown.startsWith('r2:');
    const key = isR2 ? shown.slice(3) : null;
    const dropOnline = () => {
      if (onOnline) { try { window.removeEventListener('online', onOnline); } catch (_) {} onOnline = null; }
    };
    const tick = async () => {
      // When a content version (bust) newer than the one we last minted is
      // present, force a fresh presign so the URL string changes and the
      // immutable browser cache is bypassed (see the bust tracker above).
      const wantBust = isR2 && bust != null && shouldBust(key, bust);
      const resolved = wantBust
        ? await getSignedUrl(key, { force: true })
        : await resolveSrc(shown);
      if (cancelled) return;
      if (!resolved) {
        // Transient sign failures: retry with backoff before showing the lock.
        if (isR2 && attempt < MAX_SIGN_RETRIES) {
          attempt += 1;
          if (attempt >= 2) setSlowRetry(true);
          retryTimer = setTimeout(tick, SIGN_RETRY_BASE_MS * 2 ** (attempt - 1));
          return;
        }
        setFailed(true);
        // Genuine loss of access re-locks after this one extra cycle and stays.
        if (isR2 && (signFailure(key) === 'network' || !rearmedRef.current)) {
          rearmedRef.current = true;
          const rearm = () => {
            if (cancelled) return;
            dropOnline();
            clearTimeout(retryTimer);
            attempt = 0;
            setSlowRetry(false);
            setFailed(false);
            tick();
          };
          retryTimer = setTimeout(rearm, rearmDelay(rearmsRef.current++));
          onOnline = rearm;
          try { window.addEventListener('online', onOnline); } catch (_) {}
        }
        return;
      }
      // Record the version only after a successful sign, so a transient
      // failure retries the bust next time instead of silently skipping it.
      if (wantBust) markBust(key, bust);
      attempt = 0;
      rearmsRef.current = 0;
      setSlowRetry(false);
      setUrl(resolved);
      setFailed(false);
      if (isR2) {
        refreshTimer = setTimeout(async () => {
          if (cancelled) return;
          const fresh = await getSignedUrl(key);
          if (!cancelled && fresh) setUrl(fresh);
        }, CACHE_TTL_MS - REFRESH_BEFORE_MS);
      }
    };
    tick();
    return () => { cancelled = true; dropOnline(); if (refreshTimer) clearTimeout(refreshTimer); if (retryTimer) clearTimeout(retryTimer); };
  }, [shown, visible, bust, retryTick]);

  if (failed) {
    const failKey = typeof shown === 'string' && shown.startsWith('r2:') ? shown.slice(3) : null;
    if (failKey && signFailure(failKey) === 'network') {
      const retry = () => {
        rearmedRef.current = false;
        rearmsRef.current = 0;
        resignedRef.current = false;
        setSlowRetry(false);
        setFailed(false);
        setRetryTick((t) => t + 1);
      };
      return <CardCouldntLoad rootRef={rootRef} onRetry={retry} {...rest} />;
    }
    return <BlockedPlaceholder {...rest} />;
  }
  if (unavailable) return <UnavailablePlaceholder alt={alt} {...rest} />;

  if (!url || awaitingView || blockOriginal) {
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
         onLoad={(e) => {
           resignedRef.current = false;
           // These bytes are in the disk cache now: a canvas card may mount on them.
           if (typeof shown === 'string' && shown.startsWith('r2:')) markLoaded(shown, url);
           rest.onLoad?.(e);
         }}
         onError={(e) => {
           if (typeof shown === 'string' && shown.startsWith('r2:') && !resignedRef.current) {
             // Force a fresh sign (evicts the cached string) — the URL we were
             // handed may be an expired signature, so re-presigning WITHOUT
             // force would just hand back the same dead URL and lock the image.
             // ONCE per load: a fresh signature is a new URL string, so an
             // image the browser can't decode (TIFF, PSD, HEIC) or a key whose
             // object is gone re-downloaded the whole original and failed
             // again, every second or two, for as long as it was mounted.
             resignedRef.current = true;
             const failedUrl = url;
             getSignedUrl(shown.slice(3), { force: true }).then(fresh => {
               // The same string back (the public viewer's static map) cannot
               // load any better than it just did.
               if (fresh && fresh === failedUrl) noPicture();
               else if (fresh) setUrl(fresh);
               // A network failure goes back through the sign effect, so its retries, back-off and `online` re-arm apply.
               else if (signFailure(shown.slice(3)) === 'network') setRetryTick((t) => t + 1);
               else setFailed(true);
             });
             // Public viewers resolve from a static presigned map, so the
             // force-sign above can't help — escalate so the viewer re-fetches
             // the bundle for fresh URLs (no-op in the authenticated app).
             notifyImageAuthError(shown.slice(3));
           } else {
             noPicture();
           }
           onError?.(e);
         }} />
  );
}

// ── Progressive (canvas image cards) ────────────────────────────────────
// `placeholder(state)` draws what stands in for a picture that isn't there:
// 'idle' until there's one to show (while its meta loads, and under it until
// it has faded in), 'making' while its view is being made, 'none' when none
// will come. Without it, the shimmer, "Preview not available" and the
// padlock. A document's file card passes its glyph.
function R2ImageProgressive({ src, alt = '', eager = false, onError, w, h,
                              backfillEnabled = false, upgradeToFull = true, boardId = null,
                              cardId = null, className, style, draggable, placeholder = null,
                              // How the picture sits in its w×h box ('cover' | 'contain'),
                              // any zoom of the card's own on top of the canvas's (a grid
                              // cell's crop zoom), and styles for the picture layers
                              // themselves (object-fit / object-position) — the wrapper
                              // keeps `style`.
                              fit = 'cover', tierScale = 1, imgStyle, ...rest }) {
  const originalKey = (typeof src === 'string' && src.startsWith('r2:')) ? src.slice(3) : null;
  // A format no browser draws (a raw, a .psd, OpenEXR): the original is never
  // fetched, shown or promoted to; the card shows its view, or waits for one.
  const undrawable = drawsNowhere(originalKey);

  const [meta, setMeta] = useState(() => readMeta(originalKey));
  // What pickInitialTier needs, current every render. Only a card the
  // scheduler will climb (canvas, not eager, upgrades on) may detour via xs.
  const pickOpts = { w, h, fit, tierScale, canDetour: !eager && !!cardId && upgradeToFull };
  // The r2 sentinel currently being shown. Prefers the warmest tier at mount
  // (pickInitialTier); before load it only ever switches via the pre-load
  // switch effect below. AFTER load it moves both ways under the image-tier
  // SCHEDULER (lib/imageTierScheduler.js): the card registers a handle and the
  // scheduler drives promotion (climb a rung when displayed near/past the
  // rung's native size) and demotion (step down on idle) with a global
  // budget, so a fit-all settle can't fire ~70 texture swaps at once. Swaps
  // are probe-decoded first, so a loaded image never re-blurs.
  const [activeSrc, setActiveSrc] = useState(() => pickInitialTier(src, originalKey, pickOpts));
  // A card starts with a URL only when it is eager or its bytes are warm. A
  // URL that is merely signed (every key on the share viewer, whose bundle
  // map answers cachedUrl at once) would be fetched by every mounted card at
  // once, at a rung picked from a canvas scale that isn't set yet. Without a
  // URL the card waits for its IntersectionObserver (below), which reports
  // after CanvasSurface's layout effect has set the scale, and the pre-load
  // switch effect re-picks before the first byte is asked for.
  const initialUrlRef = useRef(undefined);
  if (initialUrlRef.current === undefined) {
    initialUrlRef.current = (eager || warmNow(activeSrc)) ? cachedUrl(activeSrc) : null;
  }
  const initialUrl = initialUrlRef.current;
  const [url, setUrl] = useState(initialUrl);
  const [failed, setFailed] = useState(false);
  // Retry on the "Couldn't load" tile: a new run of the sign effect.
  const [retryTick, setRetryTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [visible, setVisible] = useState(() => eager || !!initialUrl);
  // The blur placeholder is a real <img> layer behind every card. It USED to
  // stay mounted for the whole session — ~70 extra painted layers sampled in
  // every fit-all raster. Once the real image has painted and faded in, the
  // blur is fully occluded, so we unmount it (a frame later than the fade) to
  // hand that paint budget back. A culling remount is a fresh component →
  // blurMounted resets true → the blur shows again under the reload (fine).
  const [blurMounted, setBlurMounted] = useState(true);

  const rootRef = useRef(null);
  const imgRef = useRef(null);
  const upgradedRef = useRef(false);
  const hitMarkedRef = useRef(false);
  // Direction of this card's last committed tier swap ('up' | 'down'), so a
  // reversal can be counted as a flap. See noteSwap in the evaluate() handle.
  const lastTierDirRef = useRef(null);
  // Set after the resolve effect exhausted its retries on the preview tier
  // and fell back to the original — stops the prefer-preview effect from
  // flipping back (ping-pong). Reset on src change.
  const fellBackRef = useRef(false);
  // Set once a failing xs or sm rung fell back to the lg preview (before the
  // original, which can be a 40MP decode): the pre-load switch must not flip the
  // card back to the rung that just failed. Reset on src change.
  const rungFellBackRef = useRef(false);
  // One failed→retry re-arm per mount (see the resolve effect) so a transient
  // sign-reads outage doesn't brick the card until reload.
  const rearmedRef = useRef(false);
  // Network re-arms since the last good sign (rearmDelay).
  const rearmsRef = useRef(0);
  // The tier src whose <img> error already bought one forced re-sign (see the
  // img onError). A second error on the same tier means the browser cannot
  // show these bytes, so the card says so instead of re-downloading forever.
  const resignedForRef = useRef(null);
  const [unavailable, setUnavailable] = useState(false);
  // The key whose view the card is waiting on: a photo the browser can't draw
  // with no preview yet shows the shimmer until its view arrives (noPicture).
  const viewForRef = useRef(null);
  const [awaitingView, setAwaitingView] = useState(false);
  // The original failed to display after its one re-sign while a variant
  // exists (a HEIC/TIFF whose preview Safari made, a gone original whose
  // retention-locked previews remain). The card drops back to the preview and
  // the scheduler never promotes it again: a card showing a good preview must
  // not turn into "Preview not available" just because someone zoomed in.
  const originalBrokenRef = useRef(undrawable);
  // The id this card holds in _canvasOriginals while it shows a big original.
  // Released when it leaves the original (a demote, a give-up), on src change
  // and on unmount, so the cap counts only big originals actually on screen.
  const originalSlotRef = useRef(null);
  const releaseOriginalSlot = () => {
    if (originalSlotRef.current != null) {
      const freed = _canvasOriginals.delete(originalSlotRef.current);
      originalSlotRef.current = null;
      // A card that wanted an original while the slots were full is waiting
      // on this one: have the scheduler collect it again.
      if (freed) { try { getImageTierScheduler().nudge(); } catch (_) {} }
    }
  };
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

  // Once the real image has painted, drop the blur layer a beat after the
  // 0.35s fade completes (it's fully occluded by then). Frees ~1 painted layer
  // per card — at fit-all on a 70-image board that's the difference between the
  // compositor sampling 70 vs 140 textures every raster. `loaded` can't unset
  // while mounted, so this never strands a card on a blank. A `placeholder`
  // drawn under the picture goes the same way.
  const BLUR_UNMOUNT_MS = 500;
  const underLayer = !!blurUrl || typeof placeholder === 'function';
  useEffect(() => {
    if (!loaded || !underLayer || !blurMounted) return undefined;
    const t = setTimeout(() => setBlurMounted(false), BLUR_UNMOUNT_MS);
    return () => clearTimeout(t);
  }, [loaded, underLayer, blurMounted]);

  // Subscribe to metadata arriving after a cold open (the prime query landing,
  // or a fresh upload's variant generation).
  useEffect(() => {
    if (!originalKey) return;
    setMeta(readMeta(originalKey));
    const unsub = subscribeMeta(originalKey, () => setMeta(readMeta(originalKey)));
    return unsub;
  }, [originalKey]);

  // Reset tier state when src changes (e.g. local blob preview → r2 key after
  // an upload completes). Without this the once-initialized activeSrc would
  // keep pointing at the stale (revoked) blob.
  useEffect(() => {
    upgradedRef.current = false;
    hitMarkedRef.current = false;
    fellBackRef.current = false;
    rungFellBackRef.current = false;
    rearmedRef.current = false;
    rearmsRef.current = 0;
    resignedForRef.current = null;
    originalBrokenRef.current = drawsNowhere(originalKey);
    fastLoadRef.current = false;
    viewForRef.current = null;
    setAwaitingView(false);
    setLoaded(false);
    setFailed(false);
    setUnavailable(false);
    releaseOriginalSlot();
    const next = pickInitialTier(src, originalKey, pickOpts);
    urlSetAtRef.current = cachedUrl(next) ? performance.now() : 0;
    setActiveSrc(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // A big original's slot goes when the card leaves the original, however it
  // left (a demote, a give-up to a preview, a src change), and on unmount.
  useEffect(() => {
    if (activeSrc !== src) releaseOriginalSlot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSrc, src]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => releaseOriginalSlot(), []);

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
  // (late prime, or a mid-session backfill's setMetaLocal), when the card
  // turns visible (the canvas scale is set by then) and when its box changes.
  // pickInitialTier keeps a warm original in place — a backfill completing
  // must NOT flip a disk-cached original to a cold preview while the user is
  // panning.
  useEffect(() => {
    if (loaded || upgradedRef.current || fellBackRef.current || rungFellBackRef.current) return;
    const want = pickInitialTier(src, originalKey, pickOpts);
    if (want !== activeSrc) setActiveSrc(want);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, loaded, activeSrc, src, originalKey, visible, w, h, fit, tierScale]);

  // An undrawable original with no view in its (read) meta waits for one.
  const blockOriginal = undrawable && activeSrc === src;
  useEffect(() => {
    if (!visible || !blockOriginal || viewForRef.current) return;
    if (meta && !meta.previewKey) noPicture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, blockOriginal, meta]);

  // Resolve the active src → signed URL; refresh before TTL expiry.
  useEffect(() => {
    if (!visible || blockOriginal) return;
    // Before the first load, never ask for a rung the pre-load switch is about
    // to replace: when the card has just turned visible, this effect and that
    // one run in the same flush, and this one still holds the rung picked from
    // the stale first-render scale. Switch here instead (the same pick), and
    // this effect runs again for the rung that will actually be shown.
    if (!loaded && !upgradedRef.current && !fellBackRef.current && !rungFellBackRef.current) {
      const want = pickInitialTier(src, originalKey, pickOpts);
      if (want !== activeSrc) { setActiveSrc(want); return; }
    }
    let cancelled = false;
    let refreshTimer = null;
    let retryTimer = null;
    let onOnline = null;
    let attempt = 0;
    const dropOnline = () => {
      if (onOnline) { try { window.removeEventListener('online', onOnline); } catch (_) {} onOnline = null; }
    };
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
        // A quick or sm rung that won't sign tries the lg preview before the
        // original, which can be a 40MP decode on a phone with little memory.
        const m = readMeta(originalKey);
        if (originalKey && !rungFellBackRef.current && m && m.previewKey
            && `r2:${m.previewKey}` !== activeSrc) {
          const rung = rungOf(m, activeSrc, src);
          if (rung === 'xs' || rung === 'sm') {
            rungFellBackRef.current = true;
            setActiveSrc(`r2:${m.previewKey}`);
            return;
          }
        }
        // The preview tier exhausted its retries, but the original may still
        // resolve (its URL is often already cached). Fall back ONCE per
        // mount: setActiveSrc re-runs this effect with a fresh retry budget
        // against the original. fellBackRef keeps the prefer-preview effect
        // from flipping back. The blocked placeholder is reserved for the
        // case where the ORIGINAL can't resolve either — real loss of access.
        if (originalKey && activeSrc !== src && !fellBackRef.current && !undrawable) {
          fellBackRef.current = true;
          setActiveSrc(src);
          return;
        }
        setFailed(true);
        // Re-arm after rearmDelay (30 s, doubling to 5 min while the failure
        // stays the network's), or at once when the browser comes back
        // online: a transient sign-reads outage must not brick the card until
        // reload (the lock renders no <img>, so even the onError force-resign
        // path can never fire). A failure that is the network's re-arms every
        // time; genuine loss of access re-locks after one extra cycle and stays.
        if ((typeof activeSrc === 'string' && signFailure(activeSrc.slice(3)) === 'network') || !rearmedRef.current) {
          rearmedRef.current = true;
          const rearm = () => {
            if (cancelled) return;
            dropOnline();
            clearTimeout(retryTimer);
            fellBackRef.current = false;
            attempt = 0;
            setFailed(false);
            tick();
          };
          retryTimer = setTimeout(rearm, rearmDelay(rearmsRef.current++));
          onOnline = rearm;
          try { window.addEventListener('online', onOnline); } catch (_) {}
        }
        return;
      }
      attempt = 0;
      rearmsRef.current = 0;
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
    return () => { cancelled = true; dropOnline(); if (refreshTimer) clearTimeout(refreshTimer); if (retryTimer) clearTimeout(retryTimer); };
  }, [activeSrc, visible, blockOriginal, retryTick]);

  // Warm the Tier-2 signed URL as soon as the upgrade is predictable — the card
  // is already displayed near/above the preview's native size — instead of
  // paying preview-load → idle → rAF presign batch (~400ms) before the original
  // can even start downloading. Only the URL is warmed: no bytes are fetched
  // until the upgrade effect below actually swaps the src, so a card that never
  // upgrades costs at most one extra key in an already-batched presign call.
  const warmedRef = useRef(false);
  useEffect(() => {
    if (!visible || warmedRef.current || !upgradeToFull || upgradedRef.current || undrawable) return;
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

  // ── Image-tier scheduler integration ─────────────────────────────────────
  // The card no longer drives its own promote/demote effects. One settle used
  // to wake ~70 of them in the same requestIdleCallback window → 70 forced
  // layouts + 70 texture swaps, each re-rastering its slice of the single
  // GPU-promoted .canvas layer: at fit-all that was the multi-hundred-ms
  // compositor freeze ("everything DIES"). Instead the card registers a handle
  // and the global scheduler (lib/imageTierScheduler.js) measures + commits
  // transitions with a budget (a few in flight at once, promotes
  // viewport-gated and nearest the centre first after a settle or once a wave
  // of first paints goes quiet, demotes only after ~1.5s of true idle).
  //
  // evaluate() reads the LATEST render state through stateRef (the handle
  // OBJECT is created once, so register/unregister doesn't churn), takes the
  // ONE getBoundingClientRect at execution time, and returns the single tier
  // transition the card's current on-screen size justifies — or null.
  // Promotes go straight to the rung the screen needs (xs→lg in one swap),
  // and probe-decode it first so the card swaps to bytes that are ready; the
  // old texture stays up meanwhile. A climb to the original from below lg
  // goes via lg (returned as 'step': the scheduler measures again and comes
  // back for the original), so a big original never downloads under a blur.
  // Demotes probe-decode their target too, so a loaded image never re-blurs.
  // Hysteresis: promote to a rung at ≥85% of the width of the rung below,
  // demote below 70% of the target's width — a non-overlapping band at every
  // boundary (xs↔sm, sm↔lg, lg↔original), so no card can loop.
  const stateRef = useRef(null);
  stateRef.current = { meta, activeSrc, src, originalKey, upgradeToFull, loaded, failed, fit, cardId };

  const handleRef = useRef(null);
  if (!handleRef.current) {
    handleRef.current = {
      evaluate() {
        const st = stateRef.current;
        if (!st || !st.loaded || st.failed) return null;
        const m = st.meta;
        if (!m || !m.previewKey) return null;
        const el = imgRef.current;
        if (!el) return null;
        let rect;
        try { rect = el.getBoundingClientRect(); } catch (_) { return null; }
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        // The rect already includes the canvas zoom and any transform on the
        // card's own wrapper (a grid cell's crop zoom).
        const displayedPx = drawnWidth(rect.width || 0, rect.height || 0, st.fit, aspectOf(m)) * dpr;
        if (!displayedPx) return null;
        const area = (rect.width || 0) * (rect.height || 0);
        const vw = (typeof window !== 'undefined' && window.innerWidth) || 0;
        const vh = (typeof window !== 'undefined' && window.innerHeight) || 0;
        const mx = vw * 0.25, my = vh * 0.25;
        const inViewport = rect.right > -mx && rect.left < vw + mx
                        && rect.bottom > -my && rect.top < vh + my;
        const dist = Math.hypot(rect.left + rect.width / 2 - vw / 2, rect.top + rect.height / 2 - vh / 2);

        const current = rungOf(m, st.activeSrc, st.src);
        if (!current) return null;
        const at = rungIndex(current);

        // A FLAP is this card reversing its last tier decision — promote after a
        // demote, or the other way round. Oscillation around a threshold is the
        // one tier pathology the promote/demote counters cannot show: they only
        // say how many swaps happened, never whether the same card kept undoing
        // itself, and a stall investigation could not tell a genuine zoom
        // sequence from a card thrashing at a boundary. The hysteresis band
        // (promote ≥85%, demote <70%) says this should be rare — this is how we
        // find out whether it actually is.
        const noteSwap = (dir) => {
          if (lastTierDirRef.current && lastTierDirRef.current !== dir) {
            perf.bump('image.tierFlap'); bumpPerf('image.tierFlap');
          }
          lastTierDirRef.current = dir;
        };
        const gestureOn = () => {
          try { return performance.now() < getGestureActiveUntil(); } catch (_) { return false; }
        };
        // Swap to `next`, and let a re-evaluation in the same drain see it
        // before React re-renders.
        const commit = (next) => {
          stateRef.current = { ...stateRef.current, activeSrc: next };
          setActiveSrc(next);
        };
        // Sign, fetch and decode a rung off screen, then swap to it: the card
        // keeps its current texture until the new one is ready. True only if
        // the swap committed; any abort leaves the card re-evaluatable.
        const probeSwap = async (key, dir) => {
          // The card owns the no-mid-gesture invariant (the scheduler gates
          // too — belt + suspenders, since the presign+decode takes time).
          if (gestureOn()) return false;
          const u = await getSignedUrl(key);
          if (!u) return false;
          try {
            const probe = new Image();
            probe.fetchPriority = 'low';
            probe.src = u;
            await probe.decode();
          } catch (_) { return false; }
          if (gestureOn()) return false;
          markLoaded(key, u);
          commit(`r2:${key}`);
          noteSwap(dir);
          return true;
        };

        // PROMOTE to the rung the screen needs, or past lg to the original.
        if (st.upgradeToFull) {
          let target = needRung(m, displayedPx);
          if (!upgradedRef.current && !originalBrokenRef.current && m.previewW
              && displayedPx >= PROMOTE_AT * m.previewW
              && originalAllowed(m, displayedPx, { ignoreCap: true })) {
            target = 'original';
          }
          if (rungIndex(target) > at) {
            if (target === 'original' && current === 'lg') {
              return { kind: 'promote', area, dist, inViewport, run: () => {
                // Several cards measured in one drain may all have seen room
                // under the cap; the first ones to commit take it.
                if (isBigOriginal(m) && _canvasOriginals.size >= MAX_CANVAS_ORIGINALS) return false;
                upgradedRef.current = true;
                if (isBigOriginal(m) && st.cardId) {
                  _canvasOriginals.add(st.cardId);
                  originalSlotRef.current = st.cardId;
                }
                commit(st.src);                     // original (Tier 2)
                noteSwap('up');
                perf.bump('image.tier2Upgrade'); bumpPerf('image.tier2Upgrade');
                return true;
              } };
            }
            // A preview rung, or lg on the way to the original ('step').
            const stepping = target === 'original';
            const key = rungKey(m, stepping ? 'lg' : target);
            if (key) {
              return { kind: 'promote', area, dist, inViewport, run: async () => {
                const ok = await probeSwap(key, 'up');
                if (!ok) return false;
                perf.bump('image.tierPromote'); bumpPerf('image.tierPromote');
                return stepping ? 'step' : true;
              } };
            }
          }
        }

        // DEMOTE to the smallest rung that still covers the on-screen size:
        // xs first, then sm, then (from the original) lg.
        let targetKey = null;
        if (m.previewXsKey && m.previewXsW && displayedPx < DEMOTE_BELOW * m.previewXsW && at > rungIndex('xs')) {
          targetKey = m.previewXsKey;
        } else if (m.previewSmKey && m.previewSmW && displayedPx < DEMOTE_BELOW * m.previewSmW && at > rungIndex('sm')) {
          targetKey = m.previewSmKey;
        } else if (current === 'original' && m.previewW && displayedPx < DEMOTE_BELOW * m.previewW) {
          targetKey = m.previewKey;              // no/too-small sm → lg preview
        }
        if (targetKey && st.activeSrc !== `r2:${targetKey}`) {
          return { kind: 'demote', area, dist, inViewport, run: async () => {
            const ok = await probeSwap(targetKey, 'down');
            if (!ok) return false;
            upgradedRef.current = false;          // zooming back in may re-promote
            perf.bump('image.tierDemote'); bumpPerf('image.tierDemote');
            return true;
          } };
        }
        return null;
      },
    };
  }

  // Register while this card is a live, loaded, variant-bearing canvas image.
  // Eager/lightbox cards are singular (not the storm) and opt out. Cleanup
  // unregisters on unmount / when it stops qualifying, so a viewport-culling
  // remount or an src change re-registers cleanly (handles remount mid-queue).
  const hasPreview = !!(meta && meta.previewKey);
  useEffect(() => {
    if (eager || !cardId || !visible || !loaded || !originalKey || !hasPreview) return undefined;
    const sched = getImageTierScheduler();
    return sched.register(cardId, handleRef.current);
  }, [eager, cardId, visible, loaded, originalKey, hasPreview]);

  // A loaded card whose box changed (a grid cell's crop zoom, Fit/Fill, a
  // resize) needs measuring again: the scheduler skips a card whose canvas
  // scale hasn't moved. Not on mount: `loaded` is false until the first load,
  // and the scheduler learns the card then (notePaint).
  useEffect(() => {
    if (!loaded || eager || !cardId) return;
    try { getImageTierScheduler().touch(cardId); } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, fit, tierScale]);

  const onImgLoad = () => {
    // Boot timing: the first picture on the canvas this load, and which size
    // it was. An original here on a cold open is a multi-MB download that a
    // preview would have spared; `meta` says whether the preview was known.
    bootMark('image', {
      tier: !(meta && meta.previewKey) ? 'original' : (rungOf(meta, activeSrc, src) || 'original'),
      meta: !!(meta && meta.previewKey),
    });
    // These bytes are in the disk cache under this URL now: a remount, or a
    // reload within the URL's life, may mount straight on them (isWarm).
    // Only when this URL is the one signed for the rung on screen: a URL left
    // over from the previous rung can still fire its load after a pre-load
    // re-pick switched activeSrc.
    if (url && typeof activeSrc === 'string' && activeSrc.startsWith('r2:')
        && url === cachedUrl(activeSrc)) markLoaded(activeSrc, url);
    // Fade skip is decided by MEASURED fetch+decode time from the moment the
    // URL was handed to the <img> — disk-cache loads come in well under the
    // threshold, network loads don't. Set before setLoaded so the is-loaded
    // render picks it up.
    fastLoadRef.current = urlSetAtRef.current > 0 &&
      (performance.now() - urlSetAtRef.current) < FAST_LOAD_MS;
    resignedForRef.current = null;   // a later expiry earns its own re-sign
    setLoaded(true);
    if (!hitMarkedRef.current) {
      hitMarkedRef.current = true;
      // Any preview rung (xs / sm / lg) is a hit; only the original is not.
      const firstRung = meta && meta.previewKey ? rungOf(meta, activeSrc, src) : null;
      const showingPreview = !!firstRung && firstRung !== 'original';
      if (showingPreview) { perf.bump('image.preview.hit'); bumpPerf('image.preview.hit'); }
      else if (originalKey && !(meta && meta.previewKey)) { perf.bump('image.preview.miss'); bumpPerf('image.preview.miss'); }
      // Two distinct third paths, counted separately so the warm-tier
      // strategy stays observable: warmOriginal = pickInitialTier deliberately
      // kept the warm original; fellBack = the preview tier failed to
      // resolve and we recovered on the original.
      else if (originalKey) perf.bump(fellBackRef.current ? 'image.preview.fellBack' : 'image.preview.warmOriginal');
      // A canvas card's first picture (often the quick xs rung) joins the
      // scheduler's paint wave: once the wave goes quiet, the cards on screen
      // climb to what the screen needs.
      if (!eager && cardId) {
        try { getImageTierScheduler().notePaint(getImageTierScale()); } catch (_) {}
      }
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

  // Cached-image safety net. When a viewport-culling remount renders an <img>
  // whose bytes are already warm in the browser cache (the common case during
  // a fast zoom-out — the card unmounted and remounted within seconds), the
  // load can COMPLETE before React attaches the onLoad handler, so onImgLoad
  // never fires: `loaded` stays false, the img sits at opacity 0 and only the
  // blur shows — cards stranded blurry after fast zooming. Detect the
  // already-complete element after each url change and run the handler. (We do
  // not reset urlSetAtRef here, so a genuinely-cached load still counts as a
  // fast load and skips the fade.)
  useEffect(() => {
    if (!url || loaded) return;
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) onImgLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, loaded]);

  // No srcset on the canvas imgs: `activeSrc` is the single tier decision-maker
  // (pickInitialTier at mount, then the promote/demote ladder). The browser's
  // w-descriptor picker fought that — it never downgrades an already-chosen
  // candidate, so a card zoomed in then out stayed on lg — and its first-paint
  // pick depended on a `sizes` hint that read scale=1 before the layout effect
  // ran. One src, one decision.

  // Nothing the browser can draw and no preview: a photo that gets a view
  // waits for it, and then shows it and never goes back to the original.
  const noPicture = () => {
    if (!originalKey || !viewKindOfKey(originalKey) || viewForRef.current) { setUnavailable(true); return; }
    const key = originalKey;
    viewForRef.current = key;
    setAwaitingView(true);
    waitForView(key, (pv) => {
      if (viewForRef.current !== key) return;
      setAwaitingView(false);
      if (!pv) { setUnavailable(true); return; }
      originalBrokenRef.current = true;
      upgradedRef.current = true;
      setUrl(cachedUrl(`r2:${pv}`) || null);
      setActiveSrc(`r2:${pv}`);
    });
  };

  const stand = (state) => <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}>{placeholder(state)}</div>;
  if (failed) {
    if (placeholder) return stand('none');
    if (typeof activeSrc === 'string' && activeSrc.startsWith('r2:') && signFailure(activeSrc.slice(3)) === 'network') {
      const retry = () => {
        rearmedRef.current = false;
        rearmsRef.current = 0;
        fellBackRef.current = false;
        resignedForRef.current = null;
        setFailed(false);
        setRetryTick((t) => t + 1);
      };
      return <CardCouldntLoad rootRef={rootRef} onRetry={retry} {...rest} />;
    }
    return <BlockedPlaceholder {...rest} />;
  }
  if (unavailable) {
    if (placeholder) return stand('none');
    return <UnavailablePlaceholder rootRef={rootRef} className={className || ''} style={style} alt={alt}
                                   downloadSrc={originalKey ? src : null} {...rest} />;
  }
  if (awaitingView || blockOriginal) {
    if (placeholder) return stand(awaitingView ? 'making' : 'idle');
    return <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}><div className="r2p-layer r2-img-loading" style={imgStyle} /></div>;
  }

  // fetchpriority 'auto', not 'low', for canvas cards: Chrome raises
  // in-viewport images itself, and 'low' held on-screen first paints behind
  // off-screen ones.
  return (
    <div ref={rootRef} className={`r2p ${className || ''}`} style={style} {...rest}>
      {blurUrl && blurMounted && <img className="r2p-blur" src={blurUrl} alt="" aria-hidden="true" draggable="false" style={imgStyle} />}
      {!blurUrl && (placeholder ? blurMounted && placeholder('idle') : !url && <div className="r2p-layer r2-img-loading" style={imgStyle} />)}
      {url && (
        <img ref={imgRef}
             className={`r2p-img ${loaded ? 'is-loaded' : ''}${fastLoadRef.current ? ' r2p-warm' : ''}`}
             style={imgStyle}
             src={url}
             alt={alt}
             width={w}
             height={h}
             decoding="async"
             fetchpriority={eager ? 'high' : 'auto'}
             draggable={draggable}
             onLoad={onImgLoad}
             onError={(e) => {
               // Force a fresh sign (evicts the cached string). The URL may be an
               // expired signature; re-presigning WITHOUT force would hand back
               // the same dead URL and lock the image. A null result means real
               // loss of access → blocked; any fresh URL → recover.
               //
               // Once per tier: a fresh signature is a new URL string, so bytes
               // the browser cannot decode (TIFF/PSD everywhere but Safari, HEIC
               // on Chrome/Firefox) or a missing object used to re-download the
               // original every second or two for as long as the card lived. A
               // second error on a variant drops to the original; a second
               // error on the original drops to a variant that has not failed
               // (and pins it there); only with neither left is it "Preview
               // not available", with a Download.
               const isR2 = typeof activeSrc === 'string' && activeSrc.startsWith('r2:');
               // The variant an original falls back to: lg, or for a small
               // original that is its own lg, the largest rung below it.
               const fallbackKey = meta?.previewIsOriginal
                 ? (meta.previewSmKey || meta.previewXsKey || null)
                 : (meta?.previewKey || null);
               const giveUp = () => {
                 releaseOriginalSlot();
                 // A quick or sm rung that won't load tries the lg preview
                 // before the original (a possible 40MP decode).
                 const rung = rungOf(meta, activeSrc, src);
                 if ((rung === 'xs' || rung === 'sm') && meta.previewKey
                     && `r2:${meta.previewKey}` !== activeSrc && !rungFellBackRef.current) {
                   rungFellBackRef.current = true;
                   setActiveSrc(`r2:${meta.previewKey}`);
                   return;
                 }
                 if (originalKey && activeSrc !== src && !fellBackRef.current && !originalBrokenRef.current) {
                   fellBackRef.current = true;
                   setActiveSrc(src);
                 } else if (originalKey && activeSrc === src && fallbackKey
                            && !fellBackRef.current && !originalBrokenRef.current) {
                   originalBrokenRef.current = true;
                   upgradedRef.current = true;   // keeps the pre-load switch + warm-up off too
                   setActiveSrc(`r2:${fallbackKey}`);
                 } else {
                   noPicture();
                 }
               };
               if (isR2 && resignedForRef.current === activeSrc) {
                 giveUp();
               } else if (isR2) {
                 resignedForRef.current = activeSrc;
                 const failedUrl = url;
                 getSignedUrl(activeSrc.slice(3), { force: true }).then(fresh => {
                   // The same string back (the public viewer's static map)
                   // cannot load any better; an expired one is re-minted by the
                   // bundle refresh below, which remounts the canvas anyway.
                   if (fresh && fresh === failedUrl) giveUp();
                   else if (fresh) setUrl(fresh);
                   // A network failure goes back through the sign effect, so its retries, back-off and `online` re-arm apply.
                   else if (signFailure(activeSrc.slice(3)) === 'network') setRetryTick((t) => t + 1);
                   else setFailed(true);
                 });
                 // Public viewers resolve from a static presigned map → the
                 // force-sign can't recover an expired URL; escalate for a
                 // bundle re-fetch (no-op in the authenticated app).
                 notifyImageAuthError(activeSrc.slice(3));
               } else {
                 setUnavailable(true);
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
