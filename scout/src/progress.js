// Scout — telling someone what's happening, without spamming their thread.
//
// The tension: a 12-photo dump is 12 inbound messages and takes real time
// (upload, a model call, three writes). Saying nothing for 30 seconds is
// alarming when you're standing in a parking lot on one bar and you need to
// know the photos landed. Saying something twelve times gets you muted.
//
// Resolution: ONE message, edited in place as the work progresses. Photon
// supports edits (space.send(edit(text(...), sent))), so the user watches a
// single bubble go "Got it…" → "Uploading…" → "Arranging…" → the confirmation.
//
// Editing is best-effort by design. If a provider refuses — a closed edit
// window, an unsupported channel — we stop trying to narrate and make sure the
// FINAL message still gets through as a new send. Worst case the user gets two
// messages; never twelve.

import { edit, text } from 'spectrum-ts';

export function makeProgress(space, { enabled = true } = {}) {
  let sent = null;
  let canEdit = true;
  let last = null;
  let finished = false;

  async function put(body, { isFinal = false } = {}) {
    if (finished || !body || body === last) return;
    last = body;

    // First message: a plain send. Everything after edits that same bubble.
    if (!sent) {
      if (!enabled && !isFinal) return;
      try {
        sent = await space.send(body);
      } catch (e) {
        console.error('[scout] progress send failed', e?.message);
      }
      if (isFinal) finished = true;
      return;
    }

    if (canEdit) {
      try {
        await space.send(edit(text(body), sent));
        if (isFinal) finished = true;
        return;
      } catch (_) {
        // Provider won't edit. Stop narrating — but a final message still has
        // to arrive, so fall through.
        canEdit = false;
      }
    }

    if (isFinal) {
      try {
        await space.send(body);
      } catch (e) {
        console.error('[scout] final send failed', e?.message);
      }
      finished = true;
    }
  }

  return {
    // Intermediate narration. Silently dropped once editing is unavailable, so
    // an un-editable channel gets exactly one message instead of a running
    // commentary.
    step: (body) => put(body),
    // The one message that must always land.
    done: (body) => put(body, { isFinal: true }),
    get usedEdits() { return canEdit && !!sent; },
  };
}

// Stage copy lives in replies.js with the rest of the bot's words — this
// re-export keeps the import site readable without pulling the provider SDK
// into anything that only needs the strings.
export { STAGES } from './replies.js';
