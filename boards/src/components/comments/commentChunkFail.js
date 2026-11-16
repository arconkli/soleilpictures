// What only a comment chunk that could not be fetched needs, a small chunk of
// its own so the app's first download carries none of it: whether the page
// may reload for it and how the pins are asked for again
// (lib/commentChunkReload.js), and what a press that could not open says.
// comments/commentPartsLazy.jsx fetches it as the canvas mounts and keeps
// it; where it could not be fetched either there is no network to reload
// over, nothing reloads and nothing is said.

import { warmFeedbackOverlay } from '../AppFeedback.jsx';
import { t } from '@lingui/core/macro';

export { recoverCommentChunk, importAgain } from '../../lib/commentChunkReload.js';

// The toast is drawn by an overlay that is lazy too (AppFeedback.jsx), and
// drawing it before its chunk is in would reload the page (the overlay's own
// recovery). So the overlay is asked for at the first idle moment after the
// canvas painted, and with the parts (preloadCommentParts)…
export function warmToast() {
  (window.requestIdleCallback || setTimeout)(warmFeedbackOverlay, { timeout: 3000 });
}

// …and a press that fails says so only once the overlay has answered that it
// is in. Every ask is a real one: nothing remembers a warm that may have
// failed. Without it the press is just no longer open. Said once when the
// card and the list fail together.
let saidAt = 0;
export function sayFailed(feedback, chunk) {
  const now = Date.now();
  if (now - saidAt < 1500) return;
  saidAt = now;
  warmFeedbackOverlay().then((ok) => {
    if (ok) feedback?.toast?.(chunk
      ? { type: 'error', code: 'comment_parts_failed', message: t`Comments couldn't load. Check your connection.` }
      : { type: 'error', code: 'comment_parts_crashed', message: t`Comments couldn't open. Try again.` });
  });
}
