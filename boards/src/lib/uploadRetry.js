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

// Worth another try: no response (a dropped connection), a 429 (rate limited)
// or a 5xx. Never an abort, an explicit no-retry (over quota) or any other 4xx.
export function isRetryableUploadError(err) {
  if (err?.noRetry) return false;
  const msg = String(err?.message || '');
  if (msg === 'aborted' || /\baborted\b/i.test(msg)) return false;
  const status = uploadErrorStatus(err);
  return status === 0 || status === 429 || status >= 500;
}

// A single-PUT URL lives 300 s and a multipart part URL 60 min (party/upload.ts).
// One older than this is re-presigned before the next attempt, not retried
// as-is. Part URLs get a wide margin: they are signed once per batch of parts
// and a part can wait a long while for a slot.
export const PUT_URL_FRESH_MS = 240_000;
export const PART_URL_FRESH_MS = 45 * 60_000;
export const PUT_TRIES = 10;

const defaultSlot = (fn) => fn();

// Presign, then PUT, retrying a PUT that failed on the network or with a 5xx
// (MEDIA-10). A single-PUT upload used to have no retry at all: a three-second
// Wi-Fi drop deleted every in-flight card of a 25-photo drop. Multipart parts
// always retried (putPartWithRetry); this gives the one-shot paths the same.
//
//   presign() -> { uploadUrl, key }   put(uploadUrl) -> resolves when stored
//   wait(attempt) -> resolves when it is worth trying again (backoff, online)
//   slot(fn) -> runs fn when the tab has a free connection for it
//
// Every attempt runs inside the slot and the freshness check is inside it too,
// right before the put: a PUT can wait for a slot longer than its URL lives.
// A 403 is an expired URL answering with CORS: re-presign once at once, no
// wait; a second 403 is real and is thrown.
//
// Returns the presign result that was actually used: a re-presign mints a NEW
// key, and the caller must record that one.
export async function presignAndPut({ presign, put, wait, now = () => Date.now(),
                                      tries = PUT_TRIES, freshMs = PUT_URL_FRESH_MS, slot = defaultSlot }) {
  let signed = await presign();
  let signedAt = now();
  let resignedOn403 = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await slot(async () => {
        if (now() - signedAt > freshMs) { signed = await presign(); signedAt = now(); }
        return put(signed.uploadUrl);
      });
      return signed;
    } catch (err) {
      if (uploadErrorStatus(err) === 403 && !err?.noRetry && !resignedOn403) {
        resignedOn403 = true;
        signed = await presign(); signedAt = now();
        attempt--; // an expired URL is not a failed try
        continue;
      }
      if (!isRetryableUploadError(err) || attempt >= tries - 1) throw err;
      await wait(attempt);
    }
  }
}

// PUT one multipart part, retrying a dropped connection, a 429 or a 5xx. A part
// that failed with NO response (status 0) is retried on a freshly signed URL
// (`resign() -> url`): a bad or stale signature on B2 answers without CORS
// headers, which looks exactly like a dropped connection from the browser,
// and re-sending the same URL would fail the same way. A 5xx keeps its URL.
// If the fresh URL can't be had, the old one is tried again. A URL older than
// freshMs when the part finally gets its slot is re-signed first, and a 403
// (an expired URL answered with CORS) re-signs once and retries at once.
export async function putPartRetrying({ url, put, resign, wait, aborted = () => false, tries = PUT_TRIES,
                                        now = () => Date.now(), signedAt = now(), freshMs = PART_URL_FRESH_MS,
                                        slot = defaultSlot }) {
  let current = url;
  let at = signedAt;
  let resignedOn403 = false;
  const refresh = async () => {
    if (!resign) return;
    try { const u = await resign(); if (u) { current = u; at = now(); } }
    catch (_) { /* keep the old URL */ }
  };
  for (let attempt = 0; ; attempt++) {
    if (aborted()) throw new Error('aborted');
    try {
      return await slot(async () => {
        if (aborted()) throw new Error('aborted');
        if (now() - at > freshMs) await refresh();
        return put(current);
      });
    } catch (err) {
      if (aborted() || String(err?.message) === 'aborted') throw err;
      const status = uploadErrorStatus(err);
      if (status === 403 && !err?.noRetry && !resignedOn403) {
        resignedOn403 = true;
        await refresh();
        attempt--; // an expired URL is not a failed try
        continue;
      }
      if (!isRetryableUploadError(err) || attempt >= tries - 1) throw err;
      await wait(attempt);
      if (status === 0) await refresh();
    }
  }
}

// Wait before try `attempt + 2`: exponential from baseMs, capped, with +-20 %
// jitter so a folder of files that failed together doesn't retry together.
export function retryDelayMs(attempt, { baseMs = 1000, maxMs = 30_000, random = Math.random } = {}) {
  return Math.round(Math.min(maxMs, baseMs * 2 ** attempt) * (0.8 + 0.4 * random()));
}

const defaultIsOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const defaultOnOnline = (cb) => {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
  window.addEventListener('online', cb);
  return () => window.removeEventListener('online', cb);
};

// Resolves when it is worth trying again; rejects 'aborted' the moment the
// signal aborts. While the browser says it is offline it first waits for the
// connection to return (or offlineCapMs), so time offline never burns tries,
// then backs off by retryDelayMs. Timers and listeners are always cleaned up.
export function retryWait(attempt, { signal = null, baseMs, maxMs, random, offlineCapMs = 15 * 60_000,
                                     isOffline = defaultIsOffline, onOnline = defaultOnOnline } = {}) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let unsub = null;
    let onAbort = null;
    const unsubscribe = () => { if (unsub) { try { unsub(); } catch (_) { /* nothing to undo */ } unsub = null; } };
    const cleanup = () => {
      clearTimeout(timer); timer = null;
      unsubscribe();
      if (onAbort) { signal?.removeEventListener?.('abort', onAbort); onAbort = null; }
    };
    const finish = (fn, v) => { cleanup(); fn(v); };
    if (signal?.aborted) { reject(new Error('aborted')); return; }
    if (signal) {
      onAbort = () => finish(reject, new Error('aborted'));
      signal.addEventListener('abort', onAbort);
    }
    const backoff = () => {
      timer = setTimeout(() => finish(resolve), retryDelayMs(attempt, { baseMs, maxMs, random }));
    };
    if (isOffline()) {
      const back = () => { clearTimeout(timer); unsubscribe(); backoff(); };
      timer = setTimeout(back, offlineCapMs);
      unsub = onOnline(back);
    } else backoff();
  });
}

// Run fn(attempt), trying again on a retryable error after a wait, up to
// `tries`. An aborted upload, an error that is not retryable and the last try
// all rethrow the error as it came.
export async function retryingCall(fn, { tries = 6, wait = (a) => retryWait(a), retryable = isRetryableUploadError,
                                         aborted = () => false } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(attempt); }
    catch (err) {
      if (aborted() || !retryable(err) || attempt >= tries - 1) throw err;
      await wait(attempt);
    }
  }
}

// After a multipart upload failed: is the saved resume session still worth
// keeping for a re-drop (MEDIA-11)? Yes after a network failure with no
// response, a 429, or a 5xx from the storage itself on a part PUT: nothing was
// decided, and the parts already stored are still there. Not after a 5xx from
// an upload-service step (create, sign-parts, complete: they carry mpuStep):
// that can be permanent for this session (the service answers 500 for a B2
// upload id when it has no B2 keys), and keeping it made every re-drop of the
// same file for 24 hours resume it and fail, e.g. "mpu/complete failed: 502".
// Any other HTTP
// answer (404 NoSuchUpload, 403 an expired or foreign session, 402) also
// means the session is dead or finished.
export function keepResumeSession(err) {
  const msg = String(err?.message || '');
  if (msg === 'aborted') return false;
  const status = uploadErrorStatus(err);
  if (status === 0) return true;
  if (status === 429) return true;
  if (status >= 500) return !err?.mpuStep;
  return false;
}
