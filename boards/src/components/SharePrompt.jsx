// SharePrompt — dismissible signup prompt on the public /share viewer.
//
// Shows at most once per pageload, after real engagement rather than on
// arrival: 30 seconds of VISIBLE dwell (the timer pauses while the tab is
// hidden and resumes with the remainder) or the first sub-board navigation,
// whichever comes first. Dismissal is remembered for 14 days (localStorage),
// and a CTA click anywhere on the page this load suppresses it entirely —
// no point pitching someone who already clicked through.
//
// Fixed card bottom-right on desktop, bottom sheet on phones (styles.css
// .share-prompt-*). It floats over the canvas but never blocks interaction
// outside its own box.

import { useEffect, useRef, useState } from 'react';
import { logEvent } from '../lib/analytics.js';
import { EV } from '../lib/analyticsEvents.js';
import { qaSharePromptMs } from '../lib/localMode.js';

const DISMISS_KEY = 'soleil.share.prompt.dismissedAt';
const DISMISS_TTL_MS = 14 * 24 * 60 * 60 * 1000;
// QA override captured at module load: the viewer normalizes the URL via
// history.replaceState (dropping query params) before this component ever
// mounts, so reading location.search lazily would miss ?shareqa=1&promptms=.
const DWELL_MS = qaSharePromptMs() ?? 30_000;

function dismissedRecently() {
  try {
    const at = Date.parse(localStorage.getItem(DISMISS_KEY) || '');
    return Number.isFinite(at) && Date.now() - at < DISMISS_TTL_MS;
  } catch (_) { return false; }
}

export function SharePrompt({ href, onCtaClick, subboardOpened, ctaClickedRef }) {
  const [shown, setShown] = useState(false);
  const [closed, setClosed] = useState(false);
  const shownRef = useRef(false);
  const suppressedRef = useRef(dismissedRecently());
  const triggerRef = useRef(null);
  const shownAtRef = useRef(0);

  const show = (trigger) => {
    if (shownRef.current || suppressedRef.current || ctaClickedRef?.current) return;
    shownRef.current = true;
    triggerRef.current = trigger;
    shownAtRef.current = Date.now();
    setShown(true);
    logEvent(EV.SHARE_PROMPT_VIEW, { trigger });
  };

  const dismiss = () => {
    if (!shownRef.current || closed) return;
    setClosed(true);
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch (_) {}
    logEvent(EV.SHARE_PROMPT_DISMISS, {
      trigger: triggerRef.current,
      visible_ms: Date.now() - shownAtRef.current,
    });
  };

  // Trigger A — dwell: fires after DWELL_MS of cumulative VISIBLE time.
  useEffect(() => {
    if (suppressedRef.current) return undefined;
    let remaining = DWELL_MS;
    let timer = null;
    let startedAt = 0;
    const start = () => {
      if (timer || shownRef.current) return;
      startedAt = Date.now();
      timer = setTimeout(() => show('dwell'), remaining);
    };
    const stop = () => {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') start(); else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger B — first sub-board navigation.
  useEffect(() => {
    if (subboardOpened) show('subboard');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subboardOpened]);

  // Escape dismisses while visible.
  useEffect(() => {
    if (!shown || closed) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, closed]);

  if (!shown || closed) return null;
  return (
    <div className="share-prompt" role="dialog" aria-label="Try Clusters">
      <button type="button" className="share-prompt-x" aria-label="Dismiss" onClick={dismiss}>×</button>
      <div className="share-prompt-eyebrow">Made with Clusters</div>
      <div className="share-prompt-title">Like this board? Make your own.</div>
      <div className="share-prompt-sub">Moodboards, references, and ideas — free to start.</div>
      <a className="public-cta share-prompt-cta" href={href} onClick={onCtaClick}>Try Clusters free</a>
    </div>
  );
}
