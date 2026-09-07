// CaptureHud — the controls you need while the camera is already rolling.
//
// Settings → Capture is where you set a shoot up. This is what you drive during
// it: the handful of toggles worth changing between takes, close to the thumb,
// without opening a modal that would itself be in the shot.
//
// The hard requirement is that it can get out of the way COMPLETELY and come
// back with no keyboard. A screen recording captures the whole display, so a
// control panel parked in a corner is in every frame; and on a phone there is
// no ⌘ to summon it back with. So: Hide removes it from the DOM entirely, and a
// three-finger tap anywhere brings it back. Three fingers because the canvas
// uses one (draw, drag) and two (pan, pinch) — nothing else listens above that.
import { useEffect, useState } from 'react';
import { X, Minus } from '../../lib/icons.js';
import { Icon } from '../Icon.jsx';
import { setCapture, resetCapture } from '../../lib/captureState.js';
import { useCaptureState } from '../../hooks/useCaptureState.js';
import { ASPECTS } from '../../lib/captureAspect.js';

const CHIPS = [
  // Reframe first: on a phone shoot it is the control you reach for between
  // every take, and the HUD scrolls horizontally on a narrow screen.
  { key: 'reframe',   label: 'Reframe',   on: 'Fitted',  off: 'As-is' },
  { key: 'clean',     label: 'Chrome',    on: 'Hidden',  off: 'Shown' },
  { key: 'silence',   label: 'Toasts',    on: 'Muted',   off: 'Live' },
  { key: 'freeze',    label: 'Grain',     on: 'Off',     off: 'On' },
  { key: 'spotlight', label: 'Cursor',    on: 'Lit',     off: 'Plain' },
  { key: 'persona',   label: 'Identity',  on: 'Persona', off: 'Real' },
];

// How many stand-in collaborators the Cast button steps through.
const CAST_SIZES = [0, 2, 3, 5];

export function CaptureHud() {
  const cap = useCaptureState();
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Summon paths. ⌘⇧H for a desk, three fingers for a phone. Both are toggles,
  // so the same gesture that dismissed the panel brings it back — there is no
  // state to remember and nothing to get stuck in.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== 'h' && e.key !== 'H') return;
      e.preventDefault();
      setHidden(v => !v);
    };
    // Passive: this must never be able to swallow a canvas gesture. We only
    // read the touch count; we never cancel the event.
    const onTouch = (e) => { if (e.touches && e.touches.length >= 3) setHidden(v => !v); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouch, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouch);
    };
  }, []);

  if (hidden) return null;

  if (collapsed) {
    return (
      <button type="button" className="capture-hud-dot"
              onClick={() => setCollapsed(false)}
              title="Capture mode — click to expand"
              aria-label="Expand capture controls">
        <span className="capture-hud-dot-pip" />
      </button>
    );
  }

  const toggle = (key) => setCapture({ [key]: !cap[key] });

  // 'fit' frames the whole board; 'selection' pushes in on what's selected and
  // falls back to the board when nothing is.
  const moveCamera = (target) => {
    document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: { target } }));
  };

  const aspectIdx = Math.max(0, ASPECTS.findIndex(a => a.id === (cap.aspect ?? null)));
  const aspectLabel = ASPECTS[aspectIdx].label;
  const cycleAspect = () => setCapture({ aspect: ASPECTS[(aspectIdx + 1) % ASPECTS.length].id });

  const castIdx = Math.max(0, CAST_SIZES.indexOf(cap.cast));
  const cycleCast = () => setCapture({ cast: CAST_SIZES[(castIdx + 1) % CAST_SIZES.length] });

  return (
    <div className="capture-hud" role="group" aria-label="Capture controls">
      <span className="capture-hud-title">Capture</span>

      {CHIPS.map(c => (
        <button key={c.key} type="button"
                className={`capture-hud-chip ${cap[c.key] ? 'is-on' : ''}`}
                aria-pressed={cap[c.key]}
                onClick={() => toggle(c.key)}>
          <span className="capture-hud-chip-label">{c.label}</span>
          <span className="capture-hud-chip-val">{cap[c.key] ? c.on : c.off}</span>
        </button>
      ))}

      <span className="capture-hud-sep" />

      {/* A cycling button, not a <select>. WebKit refuses to size a native
          select to a touch target — it came out 18px tall on an iPad — and a
          dropdown that opens a system sheet over the canvas is the last thing
          you want mid-take. Tap to step through the shapes. */}
      <button type="button" className="capture-hud-chip"
              aria-label={`Framing guide: ${aspectLabel}. Tap for the next shape.`}
              onClick={cycleAspect}>
        <span className="capture-hud-chip-label">Frame</span>
        <span className="capture-hud-chip-val">{aspectLabel}</span>
      </button>

      <button type="button" className={`capture-hud-chip ${cap.cast ? 'is-on' : ''}`}
              aria-label={`Stand-in collaborators: ${cap.cast || 'none'}. Tap to change.`}
              onClick={cycleCast}>
        <span className="capture-hud-chip-label">Cast</span>
        <span className="capture-hud-chip-val">{cap.cast || 'None'}</span>
      </button>

      {/* The camera. A tweened move is what separates a product video from
          somebody scroll-wheeling around; these are the two shots you actually
          want. Dispatched as an event — the canvas that answers is four
          components below this one. */}
      <button type="button" className="capture-hud-btn" onClick={() => moveCamera('fit')}>
        Fit
      </button>
      <button type="button" className="capture-hud-btn" onClick={() => moveCamera('selection')}>
        Push in
      </button>

      <span className="capture-hud-sep" />

      <button type="button" className="capture-hud-btn" onClick={resetCapture}>Reset</button>

      <button type="button" className="capture-hud-icon"
              onClick={() => setCollapsed(true)}
              title="Collapse to a dot" aria-label="Collapse capture controls">
        <Icon as={Minus} size={13} />
      </button>
      <button type="button" className="capture-hud-icon"
              onClick={() => setHidden(true)}
              title="Hide — ⌘⇧H or a three-finger tap brings it back"
              aria-label="Hide capture controls">
        <Icon as={X} size={12} />
      </button>
    </div>
  );
}
