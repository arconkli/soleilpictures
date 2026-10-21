// WhatsNewHint — the one-time "New" hint on the Files card (the owner's pick B,
// 2026-10-20), for accounts made before the files sidebar. lib/whatsNew.js has
// the words, who gets it and where it sits; this decides when, and keeps the
// record. App renders it wherever the files sidebar is on.
//
// It waits until the app has been open a moment, the Files card is on screen
// with its cluster tab on (the tab its words describe), and nothing else is:
// the tour, a dialog, the import guide, another hint, or anything holding the
// upsell slot. Then it claims the hint and the slot, so nothing lands beside
// it. On a phone it waits for the person to open the drawer; it never opens
// it for them. Non-modal: the board stays live and nothing takes focus.
//
// It ends on Got it, on Escape inside it, on What else is new (the changelog,
// in a new tab), or when what it points at goes away (the Files card folded,
// the sidebar closed, the drawer shut). It shows once: the device is marked
// before it shows, and the profile once it is on screen.

import './whatsNew.css';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowUpRight } from '@phosphor-icons/react';
import { Icon } from '../Icon.jsx';
import { logEvent, logEventNow } from '../../lib/analytics.js';
import { EV } from '../../lib/analyticsEvents.js';
import { anyModalOpen } from '../../lib/modalGuard.js';
import { tourShowing, hintUp, claimHint, releaseHint } from '../../lib/hints.js';
import { claimUpsellSlot } from '../../lib/upsellSlot.js';
import { isImportGuideOpen } from '../../lib/importGuide.js';
import {
  WHATS_NEW_HINT, WHATS_NEW_ANCHORS, CLUSTER_TAB, CHANGELOG_PATH, whatsNewFlagKey as flagKey,
  WHATS_NEW_SETTLE_MS, WHATS_NEW_RETRY_MS, WHATS_NEW_LOOK_MS, WHATS_NEW_GONE_MS,
  whatsNewEligible, whatsNewCopy, whatsNewRecord, whatsNewWidth, whatsNewPlace,
} from '../../lib/whatsNew.js';

// The same test SetupInWorkspace makes before its tips: the registered modals,
// the app's own overlays by class, and any modal dialog. The upsell slot is
// asked by claiming it.
const BUSY_SELECTOR = '[aria-modal="true"], .settings-bg, .upgrade-backdrop, .cmdk-bg, .lightbox, .pdfv, .iem, .share-prompt, .modal-shell-bg';

function screenBusy() {
  if (anyModalOpen() || tourShowing() || isImportGuideOpen()) return true;
  const held = hintUp();
  if (held && held !== 'whats_new') return true;
  try { if (document.querySelector(BUSY_SELECTOR)) return true; } catch (_) { /* no DOM */ }
  return false;
}

// Storage that can't be read counts as seen, so a browser that can't
// remember never shows it every visit (the hints.js discipline).
function readFlag(key) { try { return localStorage.getItem(key) === '1'; } catch (_) { return true; } }
function setFlag(key) { try { localStorage.setItem(key, '1'); } catch (_) { /* the profile keeps it */ } }

const onScreen = (r) => r && r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
  && r.top < window.innerHeight && r.left < window.innerWidth;

// In the phone drawer the meter with Upload stays pinned at the bottom while
// the rest scrolls under it; what can be seen ends at its top.
function seenTo(el) {
  const meter = document.querySelector('.sidebar.is-mobile-open .sbf-meter');
  if (!meter || meter.contains(el) || getComputedStyle(meter).position !== 'sticky') return window.innerHeight;
  return Math.min(window.innerHeight, meter.getBoundingClientRect().top);
}

// What it points at, if it is on screen (on a phone, clear of the drawer's
// pinned meter): the element, its box and the box it keeps clear of (the
// sidebar's frame, or the drawer). With `tab`, also the cluster tab's name,
// and only while that tab is on.
function findAnchor(phone, { tab = false } = {}) {
  const shell = WHATS_NEW_ANCHORS[phone ? 'phone' : 'desk'];
  let el = null;
  for (const sel of shell.anchors) {
    el = document.querySelector(`${shell.scope} ${sel}`);
    if (el) break;
  }
  if (!el) return null;
  const ar = el.getBoundingClientRect();
  const to = phone ? seenTo(el) : window.innerHeight;
  if (!onScreen(ar) || ar.top + ar.height / 2 >= to) return null;
  let cluster = null;
  if (tab) {
    const label = document.querySelector(`${shell.scope} ${CLUSTER_TAB}`);
    if (!label) return null;
    cluster = label.textContent || '';
  }
  const fr = document.querySelector(shell.frame)?.getBoundingClientRect() || null;
  return { el, ar, frame: fr && fr.width > 0 ? fr : null, cluster };
}

function Tail({ side, at }) {
  if (side === 'right') {
    return (
      <svg className="wn-tail is-left" viewBox="0 0 8 16" aria-hidden="true" style={{ top: `${at - 8}px` }}>
        <path d="M8.5 0.5 L1.3 7.2 Q0.4 8 1.3 8.8 L8.5 15.5" />
      </svg>
    );
  }
  return (
    <svg className={`wn-tail ${side === 'top' ? 'is-down' : 'is-up'}`} viewBox="0 0 16 8" aria-hidden="true" style={{ left: `${at - 8}px` }}>
      <path d={side === 'top' ? 'M0.5 -0.5 L7.2 6.7 Q8 7.6 8.8 6.7 L15.5 -0.5' : 'M0.5 8.5 L7.2 1.3 Q8 0.4 8.8 1.3 L15.5 8.5'} />
    </svg>
  );
}

export default function WhatsNewHint({ userId, createdAt, record, settingsLoaded, phone, save }) {
  const id = useId();
  const [phase, setPhase] = useState('wait');   // 'wait' | 'up' | 'over'
  const [cluster, setCluster] = useState('');
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);
  const shownRef = useRef(false);
  const endedRef = useRef(false);
  const seenHere = useRef(null);
  if (seenHere.current === null || seenHere.current.uid !== userId) {
    seenHere.current = { uid: userId, seen: !!userId && readFlag(flagKey(userId)) };
  }
  const eligible = !!settingsLoaded && !!userId
    && whatsNewEligible({ createdAt, record, seenHere: seenHere.current.seen });

  const keep = (action) => {
    const rec = whatsNewRecord({ action, now: new Date().toISOString() });
    Promise.resolve().then(() => save?.(rec)).catch(() => { /* this device is marked */ });
  };

  // ── Its turn ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!eligible || phase !== 'wait') return undefined;
    let t = 0;
    const attempt = () => {
      const at = findAnchor(phone, { tab: true });
      if (!at) { t = setTimeout(attempt, WHATS_NEW_LOOK_MS); return; }
      if (screenBusy() || !claimHint('whats_new')) { t = setTimeout(attempt, WHATS_NEW_RETRY_MS); return; }
      if (!claimUpsellSlot('whats-new')) {
        releaseHint('whats_new');
        t = setTimeout(attempt, WHATS_NEW_RETRY_MS);
        return;
      }
      setFlag(flagKey(userId));
      seenHere.current = { uid: userId, seen: true };
      setCluster(at.cluster);
      setPhase('up');
    };
    t = setTimeout(attempt, WHATS_NEW_SETTLE_MS);
    return () => clearTimeout(t);
  }, [eligible, phase, phone, userId]);

  const end = (action) => {
    if (endedRef.current) return;
    endedRef.current = true;
    releaseHint('whats_new');
    setPhase('over');
    // Gone before it was ever on screen: nothing was shown, so nothing ended.
    if (!shownRef.current) return;
    try { logEventNow(EV.WHATS_NEW_HINT, { hint: WHATS_NEW_HINT, action }); } catch (_) {}
    keep(action);
  };
  const endRef = useRef(end);
  endRef.current = end;

  // ── Following what it points at ───────────────────────────────────────────
  // Every frame for a moment after it appears (the drawer slides in), then on
  // a slow poll and on resize or scroll.
  useEffect(() => {
    if (phase !== 'up') return undefined;
    let raf = 0;
    let timer = 0;
    let hotUntil = performance.now() + 700;
    let goneSince = 0;
    const tick = () => {
      raf = 0;
      timer = 0;
      const at = findAnchor(phone);
      const pop = popRef.current;
      if (!at) {
        const now = performance.now();
        if (!goneSince) goneSince = now;
        else if (now - goneSince > WHATS_NEW_GONE_MS) { endRef.current('dismissed'); return; }
        setPos(null);
      } else if (pop) {
        goneSince = 0;
        const width = whatsNewWidth({ phone, frame: at.frame, vw: window.innerWidth });
        const height = pop.getBoundingClientRect().height;
        const next = { ...whatsNewPlace({ anchor: at.ar, pop: { width, height }, frame: at.frame, vw: window.innerWidth, vh: window.innerHeight, phone }), width };
        setPos((p) => (p && p.side === next.side && p.width === next.width && Math.abs(p.top - next.top) < 0.5
          && Math.abs(p.left - next.left) < 0.5 && Math.abs(p.tail - next.tail) < 0.5 ? p : next));
      }
      if (performance.now() < hotUntil) raf = requestAnimationFrame(tick);
      else timer = setTimeout(tick, 250);
    };
    const wake = () => {
      hotUntil = performance.now() + 400;
      if (timer) { clearTimeout(timer); timer = 0; raf = requestAnimationFrame(tick); }
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', wake);
    window.addEventListener('scroll', wake, true);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener('resize', wake);
      window.removeEventListener('scroll', wake, true);
    };
  }, [phase, phone]);

  // Logged, and kept on the profile, once it is actually on screen.
  useEffect(() => {
    if (!pos || shownRef.current) return;
    shownRef.current = true;
    try { logEvent(EV.WHATS_NEW_HINT, { hint: WHATS_NEW_HINT, action: 'shown' }); } catch (_) {}
    keep('shown');
  }, [pos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Released if App drops it mid-show.
  useEffect(() => () => releaseHint('whats_new'), []);

  if (phase !== 'up') return null;
  const copy = whatsNewCopy({ phone, cluster });
  const style = pos
    ? { top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }
    : { top: 0, left: 0, width: `${whatsNewWidth({ phone, vw: window.innerWidth })}px`, visibility: 'hidden' };

  return (
    <section ref={popRef} className={`wn-hint${phone ? ' is-phone' : ''}`} style={style}
      role="dialog" aria-labelledby={`${id}-h`} aria-describedby={`${id}-p`} data-hint={WHATS_NEW_HINT}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        end('dismissed');
      }}>
      {pos && <Tail side={pos.side} at={pos.tail} />}
      <p className="wn-eyebrow">{copy.eyebrow}</p>
      <h2 id={`${id}-h`} className="wn-h">{copy.title}</h2>
      <p id={`${id}-p`} className="wn-p">{copy.body}</p>
      <div className="wn-foot">
        <a className="wn-link" href={CHANGELOG_PATH} target="_blank" rel="noopener" onClick={() => end('changelog')}>
          {copy.link}<Icon as={ArrowUpRight} size={12} weight="regular" />
        </a>
        <button type="button" className="wn-chip" onClick={() => end('dismissed')}>{copy.ok}</button>
      </div>
    </section>
  );
}
