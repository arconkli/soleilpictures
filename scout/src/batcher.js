// Scout — burst batching.
//
// One attachment per message means a 12-photo dump arrives as 12 separate
// messages, seconds apart. Without batching the user gets 12 replies, 12 layout
// passes, and 12 chances to race each other writing the same board.
//
// Trailing debounce: every new message pushes the deadline out, so we fire once
// the user has actually stopped sending. A hard ceiling stops someone uploading
// continuously for ten minutes from never getting a confirmation.
//
// SERIALIZATION, and why it matters: a flush does network I/O (uploads, an LLM
// call, three writes) and can outlive the next debounce window. Two flushes
// running concurrently for the same conversation would each load the board,
// compute layout against what they saw, and write back a full board_state —
// so the slower one clobbers the faster one's cards and the user silently
// loses photos. Every key therefore keeps an in-flight promise chain, and a
// later burst awaits its predecessor instead of racing it.

export function makeBatcher({ waitMs = 20_000, maxWaitMs = 90_000, onFlush }) {
  const pending = new Map();   // key → { burst, timer, firstAt }
  const chains = new Map();    // key → Promise of the last flush for that key

  function flush(key) {
    const entry = pending.get(key);
    if (!entry) return chains.get(key) || Promise.resolve();
    clearTimeout(entry.timer);
    pending.delete(key);

    // Chain onto whatever is still running for this conversation. Errors are
    // swallowed into the chain so one bad burst can't poison the next.
    const prev = chains.get(key) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => onFlush(entry.burst))
      .catch((e) => { console.error('[scout] flush failed', key, e?.stack || e?.message || e); })
      .finally(() => { if (chains.get(key) === next) chains.delete(key); });

    chains.set(key, next);
    return next;
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
            country: msg.country,
            space: msg.space,
            texts: [],
            attachments: [],
            // Every provider message id folded into this burst. The ingest log
            // CLAIMS these on arrival and only marks them done once the burst
            // has landed, so a crash mid-flush leaves them re-deliverable
            // rather than permanently swallowed.
            messageIds: [],
          },
          timer: null,
          firstAt: Date.now(),
        };
        pending.set(key, entry);
      }
      if (msg.text) entry.burst.texts.push(msg.text);
      if (msg.attachment) entry.burst.attachments.push(msg.attachment);
      if (msg.messageId) entry.burst.messageIds.push(msg.messageId);
      // Keep the freshest space handle — replying through a stale one after a
      // reconnect silently drops the confirmation.
      if (msg.space) entry.burst.space = msg.space;

      clearTimeout(entry.timer);
      // Clamp to the ceiling measured from the FIRST message, so a continuous
      // uploader still gets a confirmation instead of an ever-receding one.
      const elapsed = Date.now() - entry.firstAt;
      const delay = Math.max(0, Math.min(waitMs, maxWaitMs - elapsed));
      entry.timer = setTimeout(() => { flush(key); }, delay);
    },

    // Flush everything now and wait for it — used on shutdown so an in-flight
    // burst isn't lost when Fly recycles the machine.
    async drain() {
      for (const key of [...pending.keys()]) flush(key);
      await Promise.allSettled([...chains.values()]);
    },

    get size() { return pending.size; },
    get inFlight() { return chains.size; },
  };
}
