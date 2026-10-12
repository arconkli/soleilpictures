// Run `onRestore` when the browser brings this page back from its back/forward
// cache.
//
// A checkout or portal button goes busy and then leaves with location.assign.
// Press Back on Stripe and Safari (an iOS swipe-back especially) restores the
// page exactly as it was left — busy, disabled, a spinner nothing will ever
// clear — because no React code runs on a bfcache restore. `pageshow` with
// `persisted` is the one signal that it happened.
import { useEffect, useRef } from 'react';

export function useBfcacheRestore(onRestore) {
  const ref = useRef(onRestore);
  ref.current = onRestore;
  useEffect(() => {
    const onShow = (e) => { if (e.persisted) ref.current?.(); };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
}
