// Scout — burst batching.
//
// One attachment per message means a 12-photo dump arrives as 12 separate
// messages, seconds apart. Without batching the user gets 12 replies, 12 layout
// passes, and 12 chances to race each other writing the same board.
//
// Trailing debounce: every new message pushes the deadline out, so we fire once
// the user has actually stopped sending. A hard ceiling stops someone uploading
// continuously for ten minutes from never getting a confirmation.

export function makeBatcher({ waitMs = 20_000, maxWaitMs = 90_000, onFlush }) {
  const pending = new Map();   // key → { burst, timer, firstAt, flushing, again }

  async function flush(key) {
    const entry = pending.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);

    // A flush already in flight: mark it so we re-run afterwards rather than
    // interleaving two writes to the same board.
    if (entry.flushing) { entry.again = true; return; }

    pending.delete(key);
    entry.flushing = true;
    try {
      await onFlush(entry.burst);
    } catch (e) {
      console.error('[scout] flush failed', key, e?.stack || e?.message || e);
    }
  }

  return {
    add(key, msg) {
      let entry = pending.get(key);
      if (!entry) {
        entry = {
          burst: {
            platform: msg.platform,
            threadKey: msg.threadKey,
            handle: msg.handle,
            service: msg.service,
            space: msg.space,
            texts: [],
            attachments: [],
          },
          timer: null,
          firstAt: Date.now(),
          flushing: false,
          again: false,
        };
        pending.set(key, entry);
      }
      if (msg.text) entry.burst.texts.push(msg.text);
      if (msg.attachment) entry.burst.attachments.push(msg.attachment);
      // Keep the freshest space handle — replying through a stale one after a
      // reconnect silently drops the confirmation.
      if (msg.space) entry.burst.space = msg.space;

      clearTimeout(entry.timer);
      const elapsed = Date.now() - entry.firstAt;
      const delay = Math.max(0, Math.min(waitMs, maxWaitMs - elapsed));
      entry.timer = setTimeout(() => { flush(key); }, delay);
    },

    // Flush everything now — used on shutdown so an in-flight burst isn't lost
    // when Fly recycles the machine.
    async drain() {
      const keys = [...pending.keys()];
      await Promise.allSettled(keys.map((k) => flush(k)));
    },

    get size() { return pending.size; },
  };
}
