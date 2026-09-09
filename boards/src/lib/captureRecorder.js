// captureRecorder — press once, get a file.
//
// Recording a demo normally means: start the OS recorder, switch back to the
// browser, perform the moves by hand, switch away, stop, find the file, trim
// the switching off both ends. This does the whole thing from inside the app —
// and because the camera can play a written-down sequence, one press can record
// a take and save it already framed.
//
// ── What this cannot do, and where ─────────────────────────────────────────
// getDisplayMedia does not exist on iOS Safari, at all. On a real iPhone or
// iPad there is no way for a web page to record the screen, and there will not
// be one — use the OS recorder in Control Centre. `recordingSupport()` says so
// explicitly rather than leaving a button that fails when pressed, because
// "why did nothing happen" is a worse experience than "not here, do this".
//
// On desktop Chrome the tab picker still appears — the browser will not let a
// page start a capture without the user choosing a surface. preferCurrentTab
// makes this tab the default choice, so it is one confirmation, not a hunt.

import { cropRectFor } from './captureAspect.js';

// mp4/h264 FIRST, because the file has to be editable. A webm drops straight
// out of most timelines — Premiere and Final Cut either refuse it or need a
// plugin — and "the clip exists but you can't cut it" is not a working feature.
// Chrome (130+) and Safari both record mp4 now; Firefox is still webm-only, so
// the fallbacks stay. The extension is derived from what was actually chosen
// rather than assumed, so a Firefox clip is not a webm named .mp4.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',   // h264 baseline — opens anywhere
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The right extension for what the browser actually produced. */
export function extForBlob(blob) {
  return (blob?.type || '').toLowerCase().includes('mp4') ? 'mp4' : 'webm';
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (_) {}
  }
  return null;
}

/**
 * Whether this browser can record, and if not, what to do instead.
 * Returns { ok, reason } — `reason` is written to be shown to a person.
 */
export function recordingSupport() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { ok: false, reason: 'Not in a browser.' };
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    // Overwhelmingly this is iOS. Name the actual way forward.
    return {
      ok: false,
      reason: 'This browser can’t record a screen. On iPhone and iPad use the OS recorder in Control Centre — the staging here still applies to it.',
    };
  }
  if (!pickMime()) {
    return { ok: false, reason: 'This browser has no video recorder available.' };
  }
  return { ok: true, reason: '' };
}

let recorder = null;
let chunks = [];
let stream = null;
// The finish, created WITH the recorder rather than when somebody asks to stop.
//
// A recording can end four ways: our Stop button, a take's auto-stop, the
// browser's own "Stop sharing" bar, and the surface going away. Attaching the
// 'stop' listener inside stopRecording() meant only the first of those ever
// assembled a Blob — the others fired 'stop' with nobody listening, and the
// button press that came afterwards threw InvalidStateError into a catch that
// ran cleanup() and DELETED the chunks. The footage was already in memory; it
// was thrown away on the way out.
//
// Hoisting the listener to construction makes the four endings converge: every
// one of them resolves this same promise with the same Blob, and whoever asks
// second just gets the same answer.
let pendingStop = null;

export function isRecording() {
  return !!recorder && recorder.state === 'recording';
}

function cleanup() {
  try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
  recorder = null;
  chunks = [];
  stream = null;
  pendingStop = null;
}

/**
 * Begin recording. Resolves once the stream is live, so a caller can start a
 * camera move knowing the first frame is already being captured.
 *
 * Rejects if the person dismisses the browser's surface picker — that is a
 * cancellation, not a failure, and the caller should treat it as one.
 */
// ── Keeping the controls out of the recording ──────────────────────────────
//
// The obvious problem with a control panel you drive DURING a take is that a
// tab capture records the rendered page, so the panel is in every frame. Hiding
// it solves the recording and breaks the driving.
//
// Element Capture is the way out: restrictTo() captures one element's subtree
// and ignores anything painted over it. So the panel can sit on top of the app,
// fully usable, and simply not exist as far as the video is concerned.
//
// It needs the element to be OUTSIDE the restricted subtree — which is why the
// HUD portals to <body> rather than living inside #root like the rest of the UI.
export function elementCaptureSupported() {
  return typeof window !== 'undefined'
    && typeof window.RestrictionTarget !== 'undefined'
    && typeof MediaStreamTrack !== 'undefined'
    && typeof MediaStreamTrack.prototype.restrictTo === 'function';
}

/**
 * Start recording.
 *
 * `restrictToElement` is the subtree to film. When Element Capture is
 * available, everything outside it — the capture controls, the framing guide —
 * is absent from the video while staying on your screen. Returns
 * `{ restricted }` so the caller knows whether it still has to hide itself.
 *
 * The trade-off, stated plainly because it is invisible otherwise: restricting
 * to #root also excludes anything React portals to <body>, which is every
 * modal and the command palette. Fine for a canvas demo, wrong if the modal IS
 * the shot — hence the opt-out.
 */
export async function startRecording({ fps = 30, restrictToElement = null } = {}) {
  const support = recordingSupport();
  if (!support.ok) throw new Error(support.reason);
  // THROW rather than return quietly. The old early return handed back
  // `{ restricted: false }` without opening a picker or starting anything, so a
  // caller that had lost track of an existing take would set itself to
  // "recording" against a stream it did not create — and then stop and save the
  // PREVIOUS recording under the new take's name. A caller that double-starts
  // has a bug; say so rather than producing a mislabelled file.
  if (isRecording()) throw new Error('Already recording.');

  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: fps },
    audio: false,
    // Chrome-only, ignored elsewhere: makes THIS tab the default choice, and
    // hides the "share audio" clutter for a silent product clip.
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  });

  let restricted = false;
  if (restrictToElement && elementCaptureSupported()) {
    try {
      const track = stream.getVideoTracks()[0];
      const target = await window.RestrictionTarget.fromElement(restrictToElement);
      await track.restrictTo(target);
      restricted = true;
    } catch (_) {
      // Restriction only works when self-capturing this tab. Pick a window or a
      // whole screen in the picker and it throws — that is a legitimate choice,
      // so carry on unrestricted and let the caller hide its own controls.
      restricted = false;
    }
  }

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: pickMime() });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  // The one place the Blob is assembled, wired before anything can stop us.
  const r = recorder;
  pendingStop = new Promise((resolve) => {
    r.addEventListener('stop', () => {
      const blob = chunks.length ? new Blob(chunks, { type: r.mimeType || 'video/webm' }) : null;
      cleanup();
      resolve(blob);
    }, { once: true });
  });

  // Stopping from the browser's own "Stop sharing" bar has to end the take the
  // same way our button does, or the recorder is left running against a dead
  // track and the file is never written.
  //
  // It also has to tell the app, or the UI sits there believing it is still
  // rolling with a Stop button behind a dead recorder. An event rather than a
  // callback for the same reason `soleil-capture-camera` is one: the thing that
  // needs to know is a component this module has no reference to.
  const track = stream.getVideoTracks()[0];
  if (track) {
    track.addEventListener('ended', () => {
      const p = pendingStop;
      try { recorder?.stop(); } catch (_) {}
      if (p) p.then((blob) => document.dispatchEvent(
        new CustomEvent('soleil-capture-recording-ended', { detail: { blob } })));
    }, { once: true });
  }

  // A timeslice, so `chunks` grows in bounded pieces rather than as one blob
  // the encoder holds until stop. A five-minute take is then a list of seconds,
  // and a tab that dies mid-shoot has left something behind rather than nothing.
  recorder.start(1000);
  // One frame of headroom so the first move isn't clipped.
  await new Promise(r2 => setTimeout(r2, 120));
  return { restricted };
}

/**
 * Stop and hand back the finished clip as a Blob. Returns null if nothing was
 * recording, so a double-press is harmless.
 */
export function stopRecording() {
  if (!recorder) return Promise.resolve(null);
  const p = pendingStop || Promise.resolve(null);
  // May throw InvalidStateError when the browser's own Stop-sharing bar has
  // already stopped us. That is not a failure and must NOT clean up: `p` is
  // already resolving with the real footage, and the old catch ran cleanup() —
  // which clears `chunks` — and resolved null, which is how a finished take
  // became no file at all.
  try { recorder.stop(); } catch (_) {}
  return p;
}

// ── Stills ─────────────────────────────────────────────────────────────────
//
// A screenshot from inside the app, rather than from the OS. What that buys
// over ⌘⇧4 is the three things you would otherwise do by hand every time:
// it crops to the framing guide, it captures at the tab's real device
// resolution rather than whatever you managed to drag a marquee around, and
// there is no cursor in it.
//
// The source is one frame of a display stream, so it is pixel-exact to what is
// on screen — unlike re-rendering the board, which would be a second
// implementation of the canvas that could drift from the real one.

function frameFrom(mediaStream) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = mediaStream;
    const fail = (e) => { cleanupVideo(); reject(e instanceof Error ? e : new Error('Could not read a frame.')); };
    const cleanupVideo = () => { try { video.pause(); video.srcObject = null; } catch (_) {} };
    video.onerror = fail;
    video.onloadedmetadata = () => {
      video.play().then(() => {
        // Two frames: the first can land before the compositor has painted the
        // surface, which produces a black still roughly one time in five.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return fail(new Error('The captured surface had no size.'));
          resolve({ video, w, h, done: cleanupVideo });
        }));
      }).catch(fail);
    };
  });
}

export function stillSupport() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { ok: false, reason: 'Not in a browser.' };
  }
  // A still needs the screen, but not MediaRecorder — so it is available in a
  // couple of places recording is not, and gets its own check rather than
  // riding recordingSupport()'s.
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return {
      ok: false,
      reason: 'This browser can’t read the screen. On iPhone and iPad take the OS screenshot — everything staged here applies to it. The framing guide shows you the crop, so hide it with a three-finger tap before you shoot or it lands in the picture.',
    };
  }
  return { ok: true, reason: '' };
}

/**
 * Grab a still as a PNG blob.
 *
 * `ratio` is width÷height — the crop is solved against the CAPTURED frame,
 * which is the only place the real pixel dimensions are known (a 1440×900 tab
 * on a 2× display captures at 2880×1800). Omit it for the whole frame.
 *
 * PNG, not JPEG: this is a screenshot of an interface, and JPEG's ringing
 * around high-contrast type is exactly the artefact you would notice on a card
 * title. The files are bigger and it does not matter for a handful of assets.
 *
 * Reuses the recording stream when one is already open, so grabbing a still
 * mid-take costs nothing and raises no second permission prompt.
 */
export async function grabStill({ ratio = null } = {}) {
  const support = stillSupport();
  if (!support.ok) throw new Error(support.reason);

  const reusing = !!stream;
  const src = reusing
    ? stream
    : await navigator.mediaDevices.getDisplayMedia({
      // `never` is the whole point of doing this from inside the app rather
      // than with the OS shortcut.
      video: { cursor: 'never' },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
    });

  try {
    const { video, w, h, done } = await frameFrom(src);
    const r = cropRectFor(w, h, ratio);
    const canvas = document.createElement('canvas');
    canvas.width = r.w;
    canvas.height = r.h;
    canvas.getContext('2d').drawImage(video, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    done();
    return await new Promise(res => canvas.toBlob(res, 'image/png'));
  } finally {
    // Only tear down a stream we opened. Stopping a borrowed one would end the
    // recording that is using it.
    if (!reusing) { try { src.getTracks().forEach(t => t.stop()); } catch (_) {} }
  }
}

/** A filename that sorts, and says what it is without being opened. */
export function captureFilename(name, ext, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
              + `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const slug = (name || 'capture').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
            || 'capture';
  return `soleil-${slug}-${stamp}.${ext}`;
}

// The recording path passes the extension in, because only the finished blob
// knows whether this browser gave us mp4 or webm. NO DEFAULT, deliberately: a
// default of 'mp4' is exactly the assumption the header of this file argues
// against, and it is how a Firefox webm shipped named .mp4. Making it required
// means the next call site has to answer the question rather than inherit a
// wrong answer.
export const clipFilename = (takeId, ext, now) => captureFilename(takeId || 'clip', ext, now);
export const stillFilename = (name, now) => captureFilename(name || 'shot', 'png', now);

/** Save a blob to the user's downloads. */
export function saveFile(blob, filename) {
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

// Kept as the name the recording path already reads well with.
export const saveClip = saveFile;
