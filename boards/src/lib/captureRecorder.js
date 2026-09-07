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

// webm/vp9 is the only format with broad MediaRecorder support. Everything that
// ingests social video takes it, and re-encoding is a one-liner if not.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

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

export function isRecording() {
  return !!recorder && recorder.state === 'recording';
}

function cleanup() {
  try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
  recorder = null;
  chunks = [];
  stream = null;
}

/**
 * Begin recording. Resolves once the stream is live, so a caller can start a
 * camera move knowing the first frame is already being captured.
 *
 * Rejects if the person dismisses the browser's surface picker — that is a
 * cancellation, not a failure, and the caller should treat it as one.
 */
export async function startRecording({ fps = 30 } = {}) {
  const support = recordingSupport();
  if (!support.ok) throw new Error(support.reason);
  if (isRecording()) return;

  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: fps },
    audio: false,
    // Chrome-only, ignored elsewhere: makes THIS tab the default choice, and
    // hides the "share audio" clutter for a silent product clip.
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
  });

  chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: pickMime() });
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  // Stopping from the browser's own "Stop sharing" bar has to end the take the
  // same way our button does, or the recorder is left running against a dead
  // track and the file is never written.
  const track = stream.getVideoTracks()[0];
  if (track) track.addEventListener('ended', () => { try { recorder?.stop(); } catch (_) {} }, { once: true });

  recorder.start();
  // One frame of headroom so the first move isn't clipped.
  await new Promise(r => setTimeout(r, 120));
}

/**
 * Stop and hand back the finished clip as a Blob. Returns null if nothing was
 * recording, so a double-press is harmless.
 */
export function stopRecording() {
  if (!recorder) return Promise.resolve(null);
  const r = recorder;
  return new Promise((resolve) => {
    r.addEventListener('stop', () => {
      const blob = chunks.length ? new Blob(chunks, { type: r.mimeType || 'video/webm' }) : null;
      cleanup();
      resolve(blob);
    }, { once: true });
    try { r.stop(); } catch (_) { cleanup(); resolve(null); }
  });
}

/** A filename that sorts, and says what it is without being opened. */
export function clipFilename(takeId, now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
              + `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const slug = (takeId || 'clip').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `soleil-${slug}-${stamp}.webm`;
}

/** Save a blob to the user's downloads. */
export function saveClip(blob, filename) {
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
