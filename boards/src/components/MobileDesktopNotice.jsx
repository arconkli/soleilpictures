import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBreakpoint } from '../hooks/useBreakpoint.js';
import { Icon } from './Icon.jsx';
import { Browsers } from '../lib/icons.js';

// One-time "Clusters is best on desktop" notice for mobile / tablet / touch
// users. Shows the first time someone lands in the authenticated app on a
// small or touch device, then never again (a per-device localStorage flag).
//
// Rendered unconditionally from Workspace (App.jsx) — it gates itself on the
// breakpoint so it stays inert on a precise-pointer desktop. Portals to
// <body> like the Sheet primitive. The flag key is versioned so we can
// re-surface the notice later by bumping it if the copy materially changes.
const STORAGE_KEY = 'soleil.boards.dismissed.mobile-desktop-notice.v1';

export function MobileDesktopNotice() {
  const { isPhone, isTablet, isDesktop, isTouch } = useBreakpoint();
  // Anything that isn't a precise-pointer desktop: phones, tablets, and any
  // touch device (incl. a landscape iPad, which reads as isDesktop && isTouch).
  const isMobileish = isPhone || isTablet || isTouch;
  const [open, setOpen] = useState(false);

  const dismiss = useCallback(() => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch (_) {}
    setOpen(false);
  }, []);

  // Decide whether to show, once we know the breakpoint. Small delay so the
  // notice doesn't slam the very first paint while the app boots in.
  useEffect(() => {
    if (!isMobileish) return;
    let dismissed = false;
    try { dismissed = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
    if (dismissed) return;
    const t = setTimeout(() => setOpen(true), 450);
    return () => clearTimeout(t);
  }, [isMobileish]);

  // Esc closes (and persists), mirroring the Sheet/Modal dialogs.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') dismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open) return null;

  return createPortal(
    <div className="mdn-root" role="dialog" aria-modal="true" aria-labelledby="mdn-title">
      <div className="mdn-backdrop" onClick={dismiss} />
      <div className="mdn-panel">
        <div className="mdn-icon"><Icon as={Browsers} size={40} /></div>
        <div id="mdn-title" className="mdn-title">Best on desktop</div>
        <div className="mdn-body">
          Clusters works best on a computer. We&rsquo;re still polishing mobile &mdash;
          for now we recommend opening it on a desktop or laptop.
        </div>
        <button className="btn-primary mdn-cta" onClick={dismiss} autoFocus>
          Got it
        </button>
      </div>
    </div>,
    document.body,
  );
}
