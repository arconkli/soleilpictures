// While this tab is moving files (lib/activity.js), hold the page busy
// (lib/buildWatch.js holdReload): a new build doesn't reload it, and the party
// sockets don't park, so presence stays up through an upload that is queued
// or making its preview, when no request is on the wire.
//
// It also owns two things that must not go quiet with the tray folded: the
// warning before the tab closes while it holds work nothing else has (a file
// still going up, a kept file waiting for Retry, a change not yet stored), and
// the tab title's "(6/12) " / "Offline · " part.

import { useEffect, useRef } from 'react';
import { subscribeActivity, activitySnapshot } from '../lib/activity.js';
import { hasActiveTransfers, titlePrefix } from '../lib/activityWords.js';
import { holdReload } from '../lib/buildWatch.js';
import { setTitleActivity } from '../lib/documentTitle.js';

export function useActivityGuards({ conn = null } = {}) {
  const connRef = useRef(conn);
  connRef.current = conn;

  useEffect(() => {
    let release = null;
    const check = () => {
      const active = hasActiveTransfers(activitySnapshot());
      if (active && !release) release = holdReload();
      else if (!active && release) { release(); release = null; }
    };
    check();
    const off = subscribeActivity(check);
    return () => { off(); release?.(); };
  }, []);

  // Leaving with work only this tab holds asks first. Read through a ref and
  // the store at the moment of leaving, so the listener is added once.
  useEffect(() => {
    const onBeforeUnload = (ev) => {
      const snap = activitySnapshot();
      const c = connRef.current;
      const keptFile = (snap.items || []).some((i) => i.state === 'failed' && !i.parked && i.actions?.retry);
      const unsaved = !!c?.pending && (!c.kept || c.state === 'offline' || c.state === 'reconnecting' || c.state === 'error');
      if (!hasActiveTransfers(snap) && !keptFile && !unsaved) return undefined;
      ev.preventDefault();
      ev.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // The tab title: "Offline · " while the tab can't reach the network, else
  // the upload count.
  const connState = conn?.state;
  useEffect(() => {
    const apply = () => {
      const offline = (typeof navigator !== 'undefined' && navigator.onLine === false) || connState === 'offline';
      setTitleActivity(offline ? 'Offline · ' : titlePrefix(activitySnapshot()));
    };
    apply();
    const off = subscribeActivity(apply);
    window.addEventListener('online', apply);
    window.addEventListener('offline', apply);
    return () => {
      off();
      window.removeEventListener('online', apply);
      window.removeEventListener('offline', apply);
      setTitleActivity('');
    };
  }, [connState]);
}
