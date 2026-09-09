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
import { createPortal } from 'react-dom';
import { X } from '../../lib/icons.js';
import { Icon } from '../Icon.jsx';
import { setCapture, resetCapture } from '../../lib/captureState.js';
import { useCaptureState } from '../../hooks/useCaptureState.js';
import { ASPECTS, aspectSpec } from '../../lib/captureAspect.js';
import { TAKES, takeFor, takeDuration } from '../../lib/captureTakes.js';
import {
  recordingSupport, stillSupport, startRecording, stopRecording, isRecording,
  grabStill, saveClip, saveFile, clipFilename, stillFilename, extForBlob,
  elementCaptureSupported,
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
  // Three states, not two: open → `closed` (a dot you can get back from) →
  // `gone` (nothing at all, for an OS recording that would capture the dot).
  const [closed, setClosed] = useState(false);
  const [gone, setGone] = useState(false);
  // Which take is armed, and whether we are rolling. Local, not in captureState:
  // neither should survive a reload — coming back to a page that thinks it is
  // recording, with no MediaRecorder behind it, is a dead button.
  const [takeId, setTakeId] = useState(null);
  const [recording, setRecording] = useState(false);
  const [shooting, setShooting] = useState(false);
  // Whether the running recording is EXCLUDING this panel. When it is, the HUD
  // stays on screen and stays usable mid-take; when it isn't, it has to get out
  // of the frame the old-fashioned way.
  const [excluded, setExcluded] = useState(false);
  // Rec spans the browser's surface picker, which is seconds of real time with
  // no state change to show for it. Without a synchronous guard a second press
  // in that window opens a SECOND getDisplayMedia, and the first stream's
  // tracks are then never stopped — the browser's sharing indicator stays lit
  // with nothing in the app able to turn it off. `shooting` already does this
  // job for the Shot button; Rec never had it.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const stopTimerRef = useRef(null);
  const support = useMemo(() => recordingSupport(), []);
  const stills = useMemo(() => stillSupport(), []);
  const canRecord = support.ok;

  // Read by handlers that outlive the render they were written in — the
  // unmount cleanup and the ended subscriber both have [] deps, so closing over
  // `takeId` directly would name every clip after whatever was armed on first
  // render.
  const takeIdRef = useRef(null);
  takeIdRef.current = takeId;

  const saveTake = (blob, id) => {
    if (blob) saveClip(blob, clipFilename(id || 'clip', extForBlob(blob)));
  };

  // One timer, cancelled everywhere it can be superseded. It used to be
  // cancelled only on unmount, so stopping a take early left its auto-stop
  // armed: press Record again and the previous take's timer cut the new one
  // short by exactly how early you were.
  const clearStopTimer = () => {
    if (stopTimerRef.current) { clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
  };

  // The browser ended the share from its own bar. That is a legitimate way to
  // finish a take and it has to save the file, not drop it.
  useEffect(() => {
    const onEnded = (e) => {
      clearStopTimer();
      setRecording(false);
      setExcluded(false);
      saveTake(e.detail?.blob, takeIdRef.current);
    };
    document.addEventListener('soleil-capture-recording-ended', onEnded);
    return () => document.removeEventListener('soleil-capture-recording-ended', onEnded);
  }, []);

  // The take says when it is finished, and that is what stops the recording.
  //
  // takeDuration() is arithmetic over the move list, but a hold is a setTimeout
  // and a tween is rAF, so the real wall clock drifts a little per move — over
  // sweep's seven moves, enough to clip the last beat off the file. The timer
  // armed alongside this is a ceiling for the case where nothing answered the
  // camera event at all; when the camera does answer, this is the truth.
  useEffect(() => {
    const onDone = async (e) => {
      if (!stopTimerRef.current) return;      // not an auto-stopping take
      // Only OUR take. Pressing Fit or Push in mid-take supersedes the sequence
      // and finishes as a different (unnamed) run; that is a cancelled camera
      // move, not a finished recording, and it must not stop the tape.
      if ((e.detail?.take ?? null) !== (takeIdRef.current ?? null)) return;
      clearStopTimer();
      setRecording(false);
      setExcluded(false);
      saveTake(await stopRecording(), takeIdRef.current);
    };
    document.addEventListener('soleil-capture-camera-done', onDone);
    return () => document.removeEventListener('soleil-capture-camera-done', onDone);
  }, []);

  // A hidden HUD must not leave a recording running with no way to stop it —
  // which is what this effect claimed to do while only clearing a timeout.
  //
  // Five things unmount this component mid-take: the Reset button below, ⌘⇧.,
  // the command-palette entry, the Settings master toggle, and losing admin.
  // All five used to orphan the MediaRecorder and the display stream for the
  // life of the tab, with the browser still showing you as sharing.
  //
  // Gated on the MODULE's isRecording(), not on component state, for the same
  // stale-closure reason as takeIdRef. A cleanup cannot be async, so this is
  // deliberately fire-and-forget: saving a take somebody abandoned is a
  // judgement call, and the alternative is silently binning footage.
  useEffect(() => () => {
    clearStopTimer();
    if (isRecording()) stopRecording().then((blob) => saveTake(blob, takeIdRef.current));
  }, []);

  // Summon paths. ⌘⇧H for a desk, three fingers for a phone. Both are toggles,
  // so the same gesture that dismissed the panel brings it back — there is no
  // state to remember and nothing to get stuck in.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== 'h' && e.key !== 'H') return;
      e.preventDefault();
      setGone(v => !v);
    };
    // Passive: this must never be able to swallow a canvas gesture. We only
    // read the touch count; we never cancel the event.
    const onTouch = (e) => { if (e.touches && e.touches.length >= 3) setGone(v => !v); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouch, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouch);
    };
  }, []);

  // Rolling, and the recording is NOT excluding us: the panel cannot stay on
  // screen, because an unrestricted capture films it. See the dot below for
  // what it collapses to — it used to collapse to NOTHING, which left a
  // free-running take with no on-screen way to stop it at all.
  const mustDuck = recording && !excluded;

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

  // Accessible names only — NOT title attributes. A native tooltip trails the
  // cursor, hangs around after the click that opened it, and on a recording
  // that isn't excluded it ends up in the video. The buttons carry visible
  // labels; anything longer belongs in Settings → Capture.
  const shotLabel = cap.aspect
    ? `Save a PNG, cropped to ${cap.aspect}`
    : 'Save a PNG of the whole frame';

  const recordLabel = !support.ok ? support.reason
    : recording ? 'Stop and save'
    : take ? `Record the ${take.label} take`
    : 'Start recording';

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
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (recording) {
        // Stopping by hand supersedes the take's own auto-stop. Leaving it
        // armed is what cut the NEXT take short.
        clearStopTimer();
        setRecording(false);
        setExcluded(false);
        saveTake(await stopRecording(), takeId);
        return;
      }
      let restricted = false;
      try {
        // Film #root and nothing else, so this panel — which portals to <body>,
        // outside that subtree — is absent from the video while staying usable.
        const res = await startRecording({ restrictToElement: document.getElementById('root') });
        restricted = !!res?.restricted;
      } catch (_) {
        // Dismissing the browser's surface picker is a cancellation, not a
        // failure — say nothing and leave the button where it was.
        return;
      }
      clearStopTimer();
      setExcluded(restricted);
      setRecording(true);
      if (!take) return;                       // free-running: stop by hand

      playTake(take.id);
      // A ceiling, not the schedule. The take announces its own end (see the
      // camera-done subscriber above), which is exact; this catches the case
      // where nothing answered the camera event at all — a public view, or no
      // canvas mounted — so a press of Record always terminates.
      const ms = takeDuration(take.moves) + 1200;
      stopTimerRef.current = window.setTimeout(async () => {
        stopTimerRef.current = null;
        setRecording(false);
        setExcluded(false);
        saveTake(await stopRecording(), take.id);
      }, ms);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Everything below portals to <body>, OUTSIDE #root. That placement is what
  // makes restrictTo(#root) able to film the app and not these controls.
  //
  // Three states, and the order of these two branches is the whole point.
  // `gone` is genuinely nothing — that is the state an OS screen recording
  // needs, because it films the dot too. Everything else collapses to the DOT,
  // including a ducked take: a 22px pip in the corner of an unrestricted
  // recording is a far better trade than a take you cannot stop, which is what
  // `gone || mustDuck` produced. The dot goes red while rolling, so it is both
  // findable and a tally light.
  if (gone) return null;

  if (closed || mustDuck) {
    // Ducked, the dot IS the stop button — it must not reopen the panel into a
    // frame that is being filmed.
    return createPortal(
      <button type="button"
              className={`capture-hud-dot ${recording ? 'is-live' : ''}`}
              onClick={mustDuck ? onRecord : () => setClosed(false)}
              aria-label={mustDuck ? 'Stop recording and save'
                        : recording ? 'Recording — open capture controls to stop'
                        : 'Open capture controls'}>
        <span className="capture-hud-dot-pip" />
      </button>,
      document.body,
    );
  }

  return createPortal(
    <div className="capture-hud" role="group" aria-label="Capture controls"
         data-excluded={excluded ? '1' : undefined}>
      <span className="capture-hud-title">{excluded ? 'Off-camera' : 'Capture'}</span>

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
              aria-label={stills.ok ? shotLabel : stills.reason}
              onClick={onShot}>
        {shooting ? '…' : 'Shot'}
      </button>

      {/* One press: start recording, play the take, stop, save. */}
      <button type="button"
              data-cap="rec"
              className={`capture-hud-rec ${recording ? 'is-live' : ''}`}
              disabled={!canRecord || busy}
              aria-label={recordLabel}
              onClick={onRecord}>
        <span className="capture-hud-rec-dot" />
        <span>{recording ? 'Stop' : take ? 'Record' : 'Rec'}</span>
      </button>

      {!support.ok && (
        <span className="capture-hud-note">Use the OS recorder</span>
      )}

      <button type="button" className="capture-hud-btn" onClick={resetCapture}>Reset</button>

      <button type="button" className="capture-hud-icon"
              onClick={() => setClosed(true)}
              aria-label="Close capture controls — leaves a dot">
        <Icon as={X} size={12} />
      </button>
    </div>,
    document.body,
  );
}
