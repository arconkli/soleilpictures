// useCaptureMode — arming, entry points, and pushing the flags at the DOM.
//
// One hook rather than four effects copy-pasted into two shells. Both the real
// app (App.jsx's Workspace) and the offline harness (LocalBoardsApp under
// ?local=1) call it, which is what lets a Playwright spec drive the genuine
// chrome through ?local=1&capture=1 with no auth and no backend — the specs
// exercise the same code path the shipped app does, not a stand-in for it.
//
// `allowed` is the gate. In the real app it is tier === 'admin'; in the DEV
// harness it is DEV itself. captureState refuses every write until armed, so
// passing false here genuinely disables the feature rather than just hiding
// its buttons.
import { useEffect } from 'react';
import { armCapture, setCapture, isCaptureActive } from '../lib/captureState.js';
import { setCaptureScaleBoost } from '../lib/canvasScale.js';
import { suspendViewPersistence } from '../lib/boardViewState.js';
import { isEditableTarget } from '../lib/isEditableTarget.js';
import { useCaptureState } from './useCaptureState.js';

// What ?capture=1 turns on. Not just `on` — a URL that stages the app but
// leaves the chrome up has done none of the work you asked for, and the shot
// CLI would then need a second step to be useful.
const ARMED_PRESET = { on: true, clean: true, silence: true, freeze: true };

export function useCaptureMode(allowed) {
  const capture = useCaptureState();
  const active = !!allowed && capture.on;

  // Arm on the gate, disarm the instant it stops being true. Disarming resets
  // state AND clears sessionStorage, so a dropped tier can never strand
  // somebody in a chromeless app with no visible way out.
  useEffect(() => { armCapture(!!allowed); }, [allowed]);

  // Two doors. ?capture=1 for a phone (bookmark it once) and for the headless
  // shot runner; ⌘⇧. for a desk. Mirrors the ?perf=1 + Ctrl+Shift+P block in
  // App() — same trust shape, same "nothing appears unless you asked".
  useEffect(() => {
    if (!allowed) return undefined;
    try {
      if (new URLSearchParams(window.location.search).get('capture') === '1') {
        setCapture(ARMED_PRESET);
      }
    } catch (_) {}
    const onKey = (e) => {
      if (isEditableTarget(e)) return;
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      // With shift held, e.key is '>' on a US layout — match the physical key
      // too so the shortcut works on layouts where it isn't.
      if (e.key !== '.' && e.key !== '>' && e.code !== 'Period') return;
      e.preventDefault();
      if (isCaptureActive()) setCapture({ on: false });
      else setCapture(ARMED_PRESET);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);

  // Body attributes rather than React props: the surfaces being hidden are
  // spread across a dozen components, and one CSS rule set already exists for
  // exactly this job (clean mode / focus mode). Adding a third attribute to
  // its :is() was cheaper and more honest than threading a prop everywhere.
  useEffect(() => {
    const b = document.body;
    if (active && capture.clean) b.setAttribute('data-capture-clean', '1');
    else b.removeAttribute('data-capture-clean');
    if (active && capture.freeze) b.setAttribute('data-capture-freeze', '1');
    else b.removeAttribute('data-capture-freeze');
    // A reframe shrinks cards in BOARD units, so R2Image would pick a preview
    // tier for images that are about to be photographed — the failure where a
    // marketing shot is subtly soft and nobody can say why. One tier of
    // headroom. Applied on read, so the next settle can't clobber it.
    setCaptureScaleBoost(active ? 2 : 1);
    // Framing a shot is a decision about that shot, not a viewing position to
    // resume. Without this the canvas's 400ms debounce writes the capture pose
    // to localStorage and silently restores it the next time the board is
    // opened — possibly weeks later, with nothing left to connect it to. The
    // real pre-capture view stays in storage untouched, so it comes back on its
    // own; there is nothing to stash.
    suspendViewPersistence(active);
    // What the shot CLI waits on. Keying off "the app applied my flags" beats
    // networkidle, which never settles on a live canvas.
    if (active) document.documentElement.setAttribute('data-capture-ready', '1');
    else document.documentElement.removeAttribute('data-capture-ready');
  }, [active, capture.clean, capture.freeze]);

  // Leaving the surface entirely (unmount) must not leave the DOM staged.
  useEffect(() => () => {
    document.body.removeAttribute('data-capture-clean');
    document.body.removeAttribute('data-capture-freeze');
    document.documentElement.removeAttribute('data-capture-ready');
    setCaptureScaleBoost(1);
    suspendViewPersistence(false);
  }, []);

  return { capture, active };
}
