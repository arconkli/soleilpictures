// Image renderer that knows how to resolve our `r2:<key>` sentinel.
//
// - If src is `r2:<key>` → fetch a signed read URL via the cache,
//   render <img> with the signed URL once it lands. Re-fetches
//   silently before TTL expiry so visible images never blink.
// - If src is any other string (https URL, data: URI, etc.) →
//   render <img> with it as-is. Backwards-compatible with legacy
//   Supabase Storage URLs and any externally-hosted image.
// - If src is empty or the user can't read this key → render the
//   shared "no access" placeholder.

import { useEffect, useState } from 'react';
import { cachedUrl, resolveSrc, getSignedUrl } from '../lib/r2.js';

const REFRESH_BEFORE_MS = 30 * 1000; // re-presign 30s before client cache expires

export function R2Image({ src, alt = '', eager = false, onError, ...rest }) {
  const initial = cachedUrl(src);
  const [url, setUrl] = useState(initial);
  const [failed, setFailed] = useState(false);

  // Resolve the src on mount + whenever it changes. Schedule a
  // refresh just before the client cache TTL expires so visible
  // images don't go stale mid-session.
  useEffect(() => {
    let cancelled = false;
    let refreshTimer = null;

    const tick = async () => {
      const resolved = await resolveSrc(src);
      if (cancelled) return;
      if (!resolved) { setFailed(true); return; }
      setUrl(resolved);
      setFailed(false);
      // Only schedule refresh for r2: sentinels — legacy URLs don't expire.
      if (typeof src === 'string' && src.startsWith('r2:')) {
        refreshTimer = setTimeout(async () => {
          if (cancelled) return;
          const fresh = await getSignedUrl(src.slice(3));
          if (!cancelled && fresh) setUrl(fresh);
        }, 4 * 60 * 1000 - REFRESH_BEFORE_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (refreshTimer) clearTimeout(refreshTimer); };
  }, [src]);

  if (failed) {
    return (
      <div className="r2-img r2-img-blocked" {...rest} aria-label="No access">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="5" y="9" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M8 9 V6 a3 3 0 0 1 6 0 V9" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      </div>
    );
  }

  if (!url) {
    // Loading state — soft shimmer placeholder while presign in flight.
    return <div className="r2-img r2-img-loading" {...rest} />;
  }

  return (
    <img src={url}
         alt={alt}
         loading={eager ? 'eager' : 'lazy'}
         decoding="async"
         fetchpriority={eager ? 'high' : 'low'}
         {...rest}
         onError={(e) => {
           // Signed URL fetch worked but the actual GET failed (e.g.
           // bucket missing the object, R2 hiccup). Retry once by
           // re-resolving; if it still fails, show blocked state.
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
