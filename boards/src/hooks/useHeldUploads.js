// useHeldUploads — the release half of lib/heldUploads.js, mounted once by App.
//
// A held drop waits for the one change that can make room for it: the
// person's plan going from free to paid (Checkout in another tab, a trial),
// or their drive growing (a 1TB block). This watches for both and marks the
// entries ready; the surface that owns each entry point (CanvasSurface, App's
// list and full-Files claimers) then claims and uploads them.
//
// When to look:
//   • the plan changed in this tab — useMyTier refetches on focus by itself,
//     and a trial or a checkout lands here as a new `tier`;
//   • another tab said the plan or the drive changed (Checkout's success page,
//     lib/heldUploads announceBillingChange), and the extra-storage sheet in
//     this one;
//   • the tab came back into view;
//   • every few seconds while a payment for held files is under way, for as
//     long as heldUploads.awaitingPayment allows.
//
// It also keeps the tab from being left by accident while it holds anything:
// a reload or a closed tab lets the files go, so the browser asks first, and
// the build watcher's own reload waits until nothing is held.

import { useEffect, useRef } from 'react';
import {
  awaitingPayment, clearAwaitingPayment, hasHeld, heldEntries, listenBillingChange,
  markReady, readyFor, setHeldBaseline, setHeldLogger, setHeldOwner, settleAwaitingPayment, subscribeHeld,
} from '../lib/heldUploads.js';
import { storageRoom } from '../lib/storageRoom.js';
import { holdReload } from '../lib/buildWatch.js';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { sizeBucket } from '../lib/fileIngest.js';

function logHeld(kind, list) {
  const props = {
    via: list[0]?.via || null,
    limit: list[0]?.limit || null,
    n: list.reduce((n, e) => n + e.count, 0),
    size_bucket: sizeBucket(list.reduce((n, e) => n + e.bytes, 0)),
  };
  if (kind === 'kept') logEvent(EV.HELD_DROP_KEPT, props);
  else if (kind === 'released') {
    logEvent(EV.HELD_DROP_RELEASED, { ...props, held_ms: Date.now() - Math.min(...list.map((e) => e.heldAt)) });
  } else {
    logEvent(EV.HELD_DROP_DISCARDED, { ...props, reason: kind === 'let_go' ? 'checkout_same_tab' : 'discard' });
  }
}

const POLL_MS = 10 * 1000;

export function useHeldUploads({ tier = null, refetchTier = null, userId = null } = {}) {
  useEffect(() => { setHeldOwner(userId); }, [userId]);
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const refetchRef = useRef(refetchTier);
  refetchRef.current = refetchTier;
  const checkRef = useRef(null);

  useEffect(() => {
    setHeldLogger(logHeld);
    let alive = true;
    let busy = false;
    let again = false;
    const check = async () => {
      if (!alive || !hasHeld()) return;
      if (busy) { again = true; return; }
      busy = true;
      try {
        const waiting = heldEntries().filter((e) => !e.ready);
        if (!waiting.length) return;
        // One dry-run read per cluster with a storage hold: the drive its
        // uploads count against, the owner's (lib/storageRoom).
        const quotas = new Map();
        for (const id of new Set(waiting.filter((e) => e.limit === 'storage').map((e) => e.boardId))) {
          quotas.set(id, (await storageRoom(id))?.quota ?? null);
          if (!alive) return;
        }
        const ready = [];
        for (const e of waiting) {
          const quota = quotas.get(e.boardId) ?? null;
          if (e.limit === 'storage' && e.quotaAtHold == null && quota != null) setHeldBaseline(e.id, quota);
          if (readyFor(e, { tier: tierRef.current, quota })) ready.push(e.id);
        }
        if (ready.length) {
          clearAwaitingPayment();
          markReady(ready);
        }
      } finally {
        busy = false;
        if (again && alive) { again = false; check(); }
      }
    };
    checkRef.current = check;

    const offBilling = listenBillingChange((msg) => {
      // Backed out of the checkout opened for these files: nothing is coming.
      if (msg?.kind === 'canceled') { clearAwaitingPayment(); return; }
      refetchRef.current?.();
      check();
    });
    // Coming back to this tab is often how a checkout was left: its tab closed.
    const onFocus = () => { settleAwaitingPayment(); check(); };
    const onVisible = () => { if (document.visibilityState === 'visible') { settleAwaitingPayment(); check(); } };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    let poll = null;
    const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    const armPoll = () => {
      if (!awaitingPayment()) { stopPoll(); return; }
      if (poll) return;
      poll = setInterval(() => {
        if (!awaitingPayment()) { stopPoll(); settleAwaitingPayment(); return; }
        refetchRef.current?.();
        check();
      }, POLL_MS);
    };
    // Nor may the build watcher reload the page under them (lib/buildWatch.js).
    let releaseReload = null;
    const holdForReload = () => {
      if (hasHeld() && !releaseReload) releaseReload = holdReload();
      else if (!hasHeld() && releaseReload) { releaseReload(); releaseReload = null; }
    };
    const onStore = () => { armPoll(); holdForReload(); };
    const offStore = subscribeHeld(onStore);
    onStore();

    const guard = (ev) => {
      if (!hasHeld()) return undefined;
      ev.preventDefault();
      ev.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', guard);

    return () => {
      alive = false;
      checkRef.current = null;
      setHeldLogger(null);
      offBilling();
      offStore();
      stopPoll();
      if (releaseReload) releaseReload();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('beforeunload', guard);
    };
  }, []);

  // The plan changed in this tab.
  useEffect(() => { checkRef.current?.(); }, [tier]);
}
