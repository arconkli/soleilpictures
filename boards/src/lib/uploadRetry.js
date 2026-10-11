// Retry and resume policy for uploads (lib/uploads.js). Pure, with the I/O
// passed in, so node tests can drive it without a browser.

// The HTTP status an upload error carries: err.code when the party typed it,
// else a 3-digit run in the message ("Upload failed: 503 …"), else 0 for a
// network failure with no response at all — which, because R2 sends no CORS
// header on an error, is also what an R2 refusal looks like from here.
export function uploadErrorStatus(err) {
  if (Number.isInteger(err?.code) && err.code >= 100 && err.code < 600) return err.code;
  const m = String(err?.message || err || '').match(/\b(\d{3})\b/);
  return m ? parseInt(m[1], 10) : 0;
}

// Worth another try: no response (a dropped connection) or a 5xx. Never an
// abort, an explicit no-retry (over quota) or any other 4xx.
export function isRetryableUploadError(err) {
  if (err?.noRetry) return false;
  const msg = String(err?.message || '');
  if (msg === 'aborted' || /\baborted\b/i.test(msg)) return false;
  const status = uploadErrorStatus(err);
  return status === 0 || status >= 500;
}

// A presigned PUT URL lives 300 s (party/upload.ts). One older than this is
// re-presigned before the next attempt rather than retried as-is.
export const PUT_URL_FRESH_MS = 240_000;
export const PUT_TRIES = 4;

// Presign, then PUT, retrying a PUT that failed on the network or with a 5xx
// (MEDIA-10). A single-PUT upload used to have no retry at all: a three-second
// Wi-Fi drop deleted every in-flight card of a 25-photo drop. Multipart parts
// always retried (putPartWithRetry); this gives the one-shot paths the same.
//
//   presign() → { uploadUrl, key }   put(uploadUrl) → resolves when stored
//   wait(attempt) → resolves when it is worth trying again (backoff, online)
//
// Returns the presign result that was actually used: a re-presign mints a NEW
// key, and the caller must record that one.
export async function presignAndPut({ presign, put, wait, now = () => Date.now(),
                                      tries = PUT_TRIES, freshMs = PUT_URL_FRESH_MS }) {
  let signed = await presign();
  let signedAt = now();
  for (let attempt = 0; ; attempt++) {
    try {
      await put(signed.uploadUrl);
      return signed;
    } catch (err) {
      if (!isRetryableUploadError(err) || attempt >= tries - 1) throw err;
      await wait(attempt);
      if (now() - signedAt > freshMs) { signed = await presign(); signedAt = now(); }
    }
  }
}

// Backoff before attempt `attempt + 1`, waiting first for the browser to come
// back online (capped, so a machine that never reconnects still fails).
export function retryWait(attempt, { baseMs = 750, onlineCapMs = 30_000 } = {}) {
  const backoff = () => new Promise(r => setTimeout(r, baseMs * Math.pow(2, attempt)));
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
    && typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  if (!offline) return backoff();
  return new Promise((resolve) => {
    let t = null;
    const done = () => { clearTimeout(t); window.removeEventListener('online', done); resolve(); };
    t = setTimeout(done, onlineCapMs);
    window.addEventListener('online', done);
  }).then(backoff);
}

// After a multipart upload failed: is the saved resume session still worth
// keeping for a re-drop (MEDIA-11)? Only when nothing was decided — a network
// failure with no response. Any HTTP answer from create/sign-parts/complete,
// or a part PUT the server refused (404 NoSuchUpload, 403 an expired or
// foreign session), means the session is dead or finished: keeping it made
// every re-drop of the same file for 24 hours resume it and fail with
// "mpu/complete failed: 502".
export function keepResumeSession(err) {
  const msg = String(err?.message || '');
  if (msg === 'aborted') return false;
  return uploadErrorStatus(err) === 0;
}
