import { useEffect, useState } from 'react';
import { resolveSrc } from '../lib/r2.js';
import { probeMedia, mediaFacts, urlSource } from '../lib/mediaProbe.js';
import { getMeta } from '../lib/imageMeta.js';

// What a video file is — frame rate, codec, start timecode — for a card that
// was uploaded before Info knew to ask (lib/mediaProbe.js). Probed only when
// someone opens Info or the player on it, never while a board renders.
//
// An editor's result is written onto the card with `writeMeta` (no undo step,
// no "modified by" stamp — mutators.updateCardMeta), so the next person
// doesn't probe it again. A viewer can't write; theirs is kept for the session.
const session = new Map();     // file key → facts | null (probed, nothing readable)
const inflight = new Map();    // file key → Promise

export function probeCardVideo(card) {
  const src = card?.kind === 'video' ? card.src : null;
  if (!src) return Promise.resolve(null);
  const key = String(src);
  if (session.has(key)) return Promise.resolve(session.get(key));
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    try {
      const url = await resolveSrc(src);
      if (!url) return null;
      const size = getMeta(key.replace(/^r2:/, ''))?.sizeBytes ?? null;
      const facts = mediaFacts(await probeMedia(urlSource(url, { size })));
      session.set(key, facts);
      return facts;
    } catch (_) {
      session.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, run);
  return run;
}

// The card's `media`, or — once probed — the probe's. Pass `writeMeta(id,
// patch)` to persist it (editors only).
export function useMediaFacts(card, { writeMeta = null } = {}) {
  const has = !!card?.media?.probed;
  const key = card?.kind === 'video' ? card?.src || '' : '';
  const [facts, setFacts] = useState(() => (key && session.get(key)) || null);
  useEffect(() => {
    if (!key || has) return undefined;
    let alive = true;
    probeCardVideo(card).then((f) => {
      if (!alive || !f) return;
      setFacts(f);
      if (writeMeta && card?.id) {
        try { writeMeta(card.id, { media: { ...(card.media || {}), ...f } }); } catch (_) {}
      }
    });
    return () => { alive = false; };
    // card.id/src identify the file; a new card object for the same file
    // doesn't need a new probe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, has, card?.id]);
  if (has) return card.media;
  return facts ? { ...(card?.media || {}), ...facts } : (card?.media || null);
}
