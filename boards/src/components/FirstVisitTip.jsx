// FirstVisitTip — a small dark-on-light pill that shows a signed-out visitor how
// to get around a shared cluster, once per device (lib/firstVisitTip.js owns the
// steps and the words, this owns the DOM).
//
//   "Click a cluster to open it"  -> ring on the first cluster card in view
//   "Click Lost Time to go back"  -> ring on the parent crumb in the top bar
//   "Drag to look around, ..."    -> a cluster with nothing inside
//
// The anchors are found in the page by selector and every lookup fails soft:
// with no anchor the pill sits centred at the bottom, without a ring. The
// canvas is not told about the tip and the tip never blocks it — the pill is
// the only thing that takes pointer events.
//
// The depth prop (how many clusters deep the visitor is) is how the tip learns
// they opened one or came back; a tap on the board anywhere else finishes the
// step ("Got it").

import { useCallback, useEffect, useRef, useState } from 'react';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import {
  initialTipState, tipReducer, retargetTip, tipOutcome, tipCopy, tipDots, readTipSeen, markTipSeen,
} from '../lib/firstVisitTip.js';
import './shareJoin.css';

const HOST = '.public-canvas-host';
const CLUSTER_CARD = `${HOST} .card.card-kind-board, ${HOST} .card.card-kind-boardlink`;
const PARENT_CRUMB = '.public-crumbs .public-crumb.clk';
// Let the canvas settle (its first frame, the fit-to-view) before pointing at it.
const SETTLE_MS = 700;

function storage() {
  try { return window.localStorage; } catch (_) { return null; }
}

function isPhone() {
  try {
    return !!(window.matchMedia?.('(pointer: coarse)').matches || window.matchMedia?.('(max-width: 640px)').matches);
  } catch (_) { return false; }
}

// The rectangle to point at for this step, or null (fail soft).
function findAnchor(step) {
  try {
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (step === 'open') {
      for (const el of document.querySelectorAll(CLUSTER_CARD)) {
        const r = el.getBoundingClientRect();
        const w = Math.min(r.right, vw) - Math.max(r.left, 0);
        const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
        if (w > 40 && h > 30) return r;
      }
      return null;
    }
    if (step === 'back') {
      const crumbs = document.querySelectorAll(PARENT_CRUMB);
      const el = crumbs[crumbs.length - 1];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    }
  } catch (_) { /* no anchor */ }
  return null;
}

function sameRect(a, b) {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1
    && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

export function FirstVisitTip({ hasSubClusters, depth, parentName = '', hidden = false, onDone }) {
  // `hidden`: the page is not showing the tip right now (it is mounted for the
  // rest of the page so a flip keeps its step), so nothing is drawn, polled or
  // counted as shown, and a tap does not finish the step.
  // Decided when the tip mounts, and again while the visitor has not touched
  // anything: the sub-cluster map can arrive late.
  const [state, setState] = useState(() => initialTipState({
    hasSubClusters, isPhone: isPhone(), seen: readTipSeen(storage()),
  }));
  const stateRef = useRef(state);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [settled, setSettled] = useState(false);
  const [rect, setRect] = useState(null);
  const [size, setSize] = useState({ w: 320, h: 56 });
  const pillRef = useRef(null);
  const shownRef = useRef(new Set());
  const touchedRef = useRef(false);

  const send = useCallback((event) => {
    const cur = stateRef.current;
    const next = tipReducer(cur, event);
    if (next === cur) return;
    const out = tipOutcome(cur, event);
    touchedRef.current = true;
    stateRef.current = next;
    setState(next);
    if (out) { try { logEvent(EV.SHARE_TIP, out); } catch (_) {} }
    if (next.step === 'done') {
      markTipSeen(storage());
      doneRef.current?.();
    }
  }, []);

  // Already seen on this device: nothing to show, nothing to wait for.
  useEffect(() => {
    if (stateRef.current.step === 'done') doneRef.current?.();
  }, []);

  useEffect(() => {
    if (state.step === 'done') return undefined;
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [state.step]);

  // The sub-cluster map arrived (or changed) before the visitor did anything.
  // Only at the depth the tip started on: opening a sub-cluster changes depth
  // and hasSubClusters in one render, and that is the visitor moving, which the
  // depth effect below handles (a leaf sub-cluster must still get 'back').
  const startDepthRef = useRef(depth);
  useEffect(() => {
    if (touchedRef.current || depth !== startDepthRef.current) return;
    const next = retargetTip(stateRef.current, hasSubClusters);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, [hasSubClusters, depth]);

  // Opened a cluster / came back: the visitor's depth in the link changed.
  const depthRef = useRef(depth);
  useEffect(() => {
    if (depth !== depthRef.current) touchedRef.current = true;
    if (depth > depthRef.current) send('opened_cluster');
    else if (depth < depthRef.current) send('went_back');
    depthRef.current = depth;
  }, [depth, send]);

  // Any tap on the board while it shows is "Got it". A tap on a cluster in the
  // first step is the thing it asks for, so it is not one.
  useEffect(() => {
    if (state.step === 'done' || hidden) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.closest(HOST)) return;
      if (stateRef.current.step === 'open' && t.closest('.card-kind-board, .card-kind-boardlink')) return;
      send('tap');
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [state.step, hidden, send]);

  // Follow the anchor: the canvas pans and zooms under the tip, the window
  // resizes. A light poll, only while the tip shows.
  useEffect(() => {
    if (!settled || state.step === 'done' || hidden) return undefined;
    const look = () => setRect((prev) => {
      const r = findAnchor(stateRef.current.step);
      return sameRect(prev, r) ? prev : r;
    });
    setRect(null);   // a new step starts without the last step's ring
    look();
    const iv = setInterval(look, 250);
    window.addEventListener('resize', look);
    return () => { clearInterval(iv); window.removeEventListener('resize', look); };
  }, [settled, state.step, hidden]);

  // Said once per step, when it first shows.
  const showing = settled && state.step !== 'done' && !hidden;
  useEffect(() => {
    if (!showing || shownRef.current.has(state.step)) return;
    shownRef.current.add(state.step);
    try { logEvent(EV.SHARE_TIP, { step: state.step, action: 'shown' }); } catch (_) {}
  }, [showing, state.step]);

  useEffect(() => {
    if (!showing || !pillRef.current) return;
    const r = pillRef.current.getBoundingClientRect();
    setSize((prev) => (Math.abs(prev.w - r.width) < 1 && Math.abs(prev.h - r.height) < 1 ? prev : { w: r.width, h: r.height }));
  }, [showing, state.step, rect]);

  if (!showing) return null;
  const copy = tipCopy(state, parentName);
  const dots = tipDots(state);

  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;
  let style = null;
  let edge = '';
  let ring = null;
  if (rect) {
    const gap = 14;
    const below = rect.bottom + gap + size.h <= vh - 12;
    const left = Math.max(12, Math.min(rect.left, vw - size.w - 12));
    style = { left, top: below ? rect.bottom + gap : Math.max(12, rect.top - gap - size.h) };
    edge = below ? 'up' : 'down';
    ring = { left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 };
  }

  return (
    <>
      {ring && <div className="fvt-ring" style={ring} aria-hidden="true" />}
      <div ref={pillRef} className={`fvt-tip ${style ? edge : 'is-free'}`} style={style || undefined} role="status">
        <span className="fvt-t">
          {copy.title}
          {copy.hint && <small>{copy.hint}</small>}
        </span>
        {dots && (
          <span className="fvt-dots" aria-hidden="true">
            {Array.from({ length: dots.total }, (_, i) => <i key={i} className={i === dots.on ? 'on' : ''} />)}
          </span>
        )}
        <button type="button" className="fvt-ok" onClick={() => send('dismiss')}>Got it</button>
      </div>
    </>
  );
}
