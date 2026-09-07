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
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Minus } from '../../lib/icons.js';
import { Icon } from '../Icon.jsx';
import { setCapture, resetCapture } from '../../lib/captureState.js';
import { useCaptureState } from '../../hooks/useCaptureState.js';
import { ASPECTS, aspectSpec } from '../../lib/captureAspect.js';
import { TAKES, takeFor, takeDuration } from '../../lib/captureTakes.js';
import {
  recordingSupport, stillSupport, startRecording, stopRecording,
  grabStill, saveClip, saveFile, clipFilename, stillFilename, extForBlob,
} from '../../lib/captureRecorder.js';

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
  // Which take is armed, and whether we are rolling. Local, not in captureState:
  // neither should survive a reload — coming back to a page that thinks it is
  // recording, with no MediaRecorder behind it, is a dead button.
  const [takeId, setTakeId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [shooting, setShooting] = useState(false);
  const stopTimerRef = useRef(null);
  const support = useMemo(() => recordingSupport(), []);
  const stills = useMemo(() => stillSupport(), []);
  const canRecord = support.ok;

  // A hidden HUD must not leave a recording running with no way to stop it.
  useEffect(() => () => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
  }, []);

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

  // ── Takes and recording ──────────────────────────────────────────────────
  const take = takeFor(takeId);
  const cycleTake = () => {
    const ids = [null, ...TAKES.map(t => t.id)];
    setTakeId(ids[(ids.indexOf(takeId) + 1) % ids.length]);
  };
  const playTake = (id) => {
    document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: { take: id } }));
  };

  const shotTitle = cap.aspect
    ? `Save a PNG, cropped to ${cap.aspect}`
    : 'Save a PNG of the whole frame. Set a framing guide to crop it.';

  const recordTitle = !support.ok ? support.reason
    : recording ? 'Stop and save'
    : take ? `Record ${take.label} — starts, plays it, saves the clip`
    : 'Start recording. Pick a take to have it played for you.';

  // One press does the whole thing. Recording starts BEFORE the take so the
  // first move is in frame, and stops on the take's own duration rather than a
  // guess — takeDuration is derived from the moves.
  // Take the tool out of its own picture, wait for paint, shoot, put it back.
  // Without the two frames the shutter lands before the compositor has dropped
  // the HUD and it appears in the still it was used to take.
  const withShutter = async (fn) => {
    document.body.setAttribute('data-capture-shutter', '1');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { return await fn(); }
    finally { document.body.removeAttribute('data-capture-shutter'); }
  };

  const onShot = async () => {
    if (shooting) return;
    setShooting(true);
    try {
      // Crop to the framing guide, so the file arrives at the ratio you were
      // composing for rather than needing a marquee round it afterwards.
      const blob = await withShutter(() => grabStill({ ratio: aspectSpec(cap.aspect).ratio }));
      if (blob) saveFile(blob, stillFilename(cap.aspect ? `shot-${cap.aspect.replace(':', 'x')}` : 'shot'));
    } catch (_) {
      // Dismissing the surface picker is a cancellation, not a failure.
    } finally {
      setShooting(false);
    }
  };

  const onRecord = async () => {
    if (recording) {
      setRecording(false);
      const blob = await stopRecording();
      if (blob) saveClip(blob, clipFilename(takeId || 'clip', extForBlob(blob)));
      return;
    }
    try {
      await startRecording();
    } catch (_) {
      // Dismissing the browser's surface picker is a cancellation, not a
      // failure — say nothing and leave the button where it was.
      return;
    }
    setRecording(true);
    if (!take) return;                       // free-running: stop by hand

    playTake(take.id);
    const ms = takeDuration(take.moves) + 400;   // a beat of tail
    stopTimerRef.current = window.setTimeout(async () => {
      setRecording(false);
      const blob = await stopRecording();
      if (blob) saveClip(blob, clipFilename(take.id));
    }, ms);
  };

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

      {/* A take is a written-down sequence — establish, hold, go in, come back.
          Doing that by hand means hitting two buttons at the right moments
          while also recording, and getting it identical on the retake is luck. */}
      <button type="button" className="capture-hud-chip"
              aria-label={`Take: ${take ? take.label : 'none'}. Tap to change.`}
              onClick={cycleTake}>
        <span className="capture-hud-chip-label">Take</span>
        <span className="capture-hud-chip-val">{take ? take.label : 'None'}</span>
      </button>

      <span className="capture-hud-sep" />

      {/* A still, cropped to the framing guide, at the tab's real device
          resolution, with no cursor and none of this panel in it. */}
      <button type="button" className="capture-hud-btn"
              disabled={!stills.ok || shooting}
              title={stills.ok ? shotTitle : stills.reason}
              onClick={onShot}>
        {shooting ? '…' : 'Shot'}
      </button>

      {/* One press: start recording, play the take, stop, save. */}
      <button type="button"
              className={`capture-hud-rec ${recording ? 'is-live' : ''}`}
              disabled={!canRecord}
              title={recordTitle}
              aria-label={recordTitle}
              onClick={onRecord}>
        <span className="capture-hud-rec-dot" />
        <span>{recording ? 'Stop' : take ? 'Record' : 'Rec'}</span>
      </button>

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
