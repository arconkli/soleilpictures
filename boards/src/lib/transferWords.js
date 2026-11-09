// Plain words for a failed upload or download toast.
//
// What a transfer throws is partly written for the person and partly machine
// talk. The person's reasons (lib/uploads.js: "Storage is full for this
// cluster's owner — …", "Video too large (…)", "Could not finish saving the
// PDF — please try again.") reach the toast as they are. A few failures get a
// plain reason of their own: a zip that can't be read (zipRead.js
// ZipReadError, by its code), a file storage no longer has (cardDownload.js
// "Storage returned 404"), and an upload refused because the person can't
// edit the cluster (party/upload.ts "Not allowed to upload to this board",
// not_writer). The rest told nobody anything: the browser's "Failed to
// fetch", "Load failed" and "NetworkError when attempting to fetch resource",
// and our own plumbing ("Presign failed: 403 …", "Upload network error",
// "Part upload failed: 500 …", "workspaceId required"). Those become one plain
// sentence. The toast's code still names the failure in Admin › Issues, and
// the callers still log the raw error.
import { uploadErrorStatus } from './uploadRetry.js';

const FOR_PEOPLE = /^(?:Storage is full\b|(?:Audio|PDF|Video|Image|File) too (?:large|long)\b|Could not (?:finish|read)\b|Not signed in$)/;

const ZIP_WORDS = {
  not_zip: "Couldn't open that zip: it isn't a zip file.",
  truncated: "Couldn't open that zip: it's damaged or incomplete.",
  crc: "Couldn't open that file: it's damaged inside the zip.",
  no_inflate: "This browser can't open zip files. Try updating it.",
  too_big: 'That zip is too big for this browser to open.',
};

function rawText(err) {
  return String(err?.message ?? err ?? '').trim();
}

// A failure with plain words of its own, or null.
function ownWords(err, raw) {
  if (err?.name === 'ZipReadError' && Object.hasOwn(ZIP_WORDS, err.code)) return ZIP_WORDS[err.code];
  if (/^Storage returned 404\b/.test(raw)) return "Couldn't find that file. It may have been deleted.";
  if (/Not allowed to upload|not_writer/.test(raw)) return "You can't add files to this cluster.";
  return null;
}

export function uploadFailedWords(err, plain = "Couldn't upload that file. Try again.") {
  const raw = rawText(err);
  return ownWords(err, raw) || (FOR_PEOPLE.test(raw) ? `Upload failed: ${raw}` : plain);
}

export function downloadFailedWords(err, plain = "Couldn't download that file. Try again.") {
  const raw = rawText(err);
  return ownWords(err, raw) || (FOR_PEOPLE.test(raw) ? `Download failed: ${raw}` : plain);
}

const NETWORKY = /network error|stalled|failed to fetch|load failed|networkerror|timed? ?out/i;

// Did this upload fail because the connection did, so that trying again later
// is the right answer? Refusals (storage full, not allowed, a file too big or
// too long, a zip that can't be read, a file storage lost) and aborts fail the
// same way every time.
export function isNetworkUploadFailure(err, { online = true } = {}) {
  if (err == null) return false;
  const raw = rawText(err);
  if (raw === 'aborted' || /\baborted\b/i.test(raw) || err.name === 'AbortError') return false;
  if (err.code === 402 || err.code === 403 || err.code === 'video_too_long') return false;
  if (err.noRetry === true) return false;
  if (FOR_PEOPLE.test(raw) || /Not allowed to upload|not_writer/.test(raw)) return false;
  if (/^Storage returned 404\b/.test(raw) || err.name === 'ZipReadError') return false;
  if (!online) return true;
  if (NETWORKY.test(raw)) return true;
  const status = uploadErrorStatus(err);
  return status === 0 || status >= 500;
}
