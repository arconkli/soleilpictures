// iPhone Safari has no Vibration API, but a real tap on an <input switch>
// makes the phone buzz. This overlays a transparent label on its parent so
// the user's own tap toggles a hidden switch. Renders nothing elsewhere.
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { ensureHapticSwitch, hapticsEnabled, subscribeHaptics, usesSwitchTrick } from '../lib/haptics.js';

export function useHapticsEnabled() {
  return useSyncExternalStore(subscribeHaptics, hapticsEnabled, () => true);
}

const STYLE = {
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  background: 'transparent',
  margin: 0,
  padding: 0,
  border: 0,
  cursor: 'inherit',
  WebkitTapHighlightColor: 'transparent',
  WebkitTouchCallout: 'none',
  WebkitUserSelect: 'none',
  userSelect: 'none',
};

// The same declarations as CSS text, for labels built outside React.
const CSS_TEXT = Object.entries(STYLE)
  .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).replace(/^webkit-/, '-webkit-')}:${v}`)
  .join(';');

// Menu rows close their menu in onClick; React commits that in a microtask
// before the label's default action runs, and a detached label no longer finds
// its for= target, so the switch would never toggle. Re-running the host's
// click on the next task keeps the label on the page until the switch has
// toggled, and the host's handler still runs once.
function onClick(e) {
  const host = e.currentTarget.parentElement;
  e.stopPropagation();
  setTimeout(() => { if (host && host.isConnected) host.click(); }, 0);
}

export default function HapticTap() {
  const enabled = useHapticsEnabled();
  const on = enabled && usesSwitchTrick();
  const ref = useRef(null);

  useLayoutEffect(() => {
    if (!on) return undefined;
    ensureHapticSwitch();
    const parent = ref.current && ref.current.parentElement;
    if (!parent || getComputedStyle(parent).position !== 'static') return undefined;
    const prev = parent.style.position;
    parent.style.position = 'relative';
    return () => { parent.style.position = prev; };
  }, [on]);

  if (!on) return null;
  return <label htmlFor="soleil-haptic-switch" aria-hidden="true" className="haptic-tap" onClick={onClick} ref={ref} style={STYLE} />;
}

// The same overlay for hosts that come from saved HTML rather than React (a
// note's checklist boxes): after every render each match inside rootRef gets a
// label, removed again when haptics are off. The host's click handler must
// spot `label[data-haptic-label]` and defer itself, as cards.jsx does.
export function useHapticLabels(rootRef, selector) {
  const enabled = useHapticsEnabled();
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !usesSwitchTrick()) return;
    if (!enabled) { root.querySelectorAll('label[data-haptic-label]').forEach((l) => l.remove()); return; }
    ensureHapticSwitch();
    root.querySelectorAll(selector).forEach((host) => {
      if (host.closest('[contenteditable="true"], .ProseMirror')) return; // never inside an editor
      if (host.querySelector(':scope > label[data-haptic-label]')) return;
      const label = document.createElement('label');
      label.htmlFor = 'soleil-haptic-switch';
      label.className = 'haptic-tap';
      label.setAttribute('aria-hidden', 'true');
      label.setAttribute('data-haptic-label', '');
      label.style.cssText = CSS_TEXT;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      host.appendChild(label);
    });
  });
}
