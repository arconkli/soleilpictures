import { useEffect, useRef } from 'react';
import { resolveSrc } from '../lib/r2.js';
import { analyzeArrayBuffer, analyzable } from '../lib/audioAnalysis.js';
import { getMeta } from '../lib/imageMeta.js';
import { readCoverFromBuffer } from '../lib/audioTags.js';
import { uploadImage } from '../lib/uploads.js';
import { lowMemoryDevice } from '../lib/device.js';

// One-shot, best-effort backfill: give EXISTING audio cards a real waveform.
// New uploads analyze their File eagerly; this catches the ones from before
// that pipeline — which is every audio card that predates it, because the
// waveform they show today is synthesized from a hash of the filename.
//
// Same contract as useVideoPosterBackfill: writer-only, one attempt per card
// per session, bounded per pass, and patched through updateCardSilent so the
// waveform never lands on the undo stack.
//
// Two differences from the video hook, both about not moving bytes we don't
// need to:
//   • it consults the images-table size FIRST and skips anything over the
//     analysis cap, so it never pulls a 45 MB stem across the wire to draw a
//     340-pixel picture;
//   • it reads arrayBuffer() directly rather than blob → object URL, because
//     decodeAudioData wants the buffer anyway.
//
// `analyzed` is the "don't try again" marker. It is set when a decode ATTEMPT
// completed — including a hard codec rejection, so an undecodable file is
// asked once and never again. A card skipped by the size cap leaves it unset,
// so the same card gets a chance in a desktop session where it fits.
//
// One deliberate gap: a card that already has peaks is never revisited, so if
// it also has no cover it keeps none. Widening the filter to catch that would
// mean re-downloading whole audio files purely to look for artwork, which is
// the trade this hook exists to avoid. Waveforms and covers shipped together,
// so the set of cards in that state is empty in practice — and a cover can
// always be set by hand.
export function useAudioPeaksBackfill({
  cards, canEdit, workspaceId, boardId, userId, updateCardSilent, enabled = true, perPass = 2,
}) {
  const attempted = useRef(new Set());
  useEffect(() => {
    if (!enabled || !canEdit || typeof updateCardSilent !== 'function') return;
    const lowMemory = lowMemoryDevice();
    const targets = (cards || []).filter(c =>
      c.kind === 'audio' && c.src && String(c.src).startsWith('r2:')
      && !c.peaks && !c.analyzed && !c.pending && !attempted.current.has(c.id)
      && analyzable({
          sizeBytes: c.sizeBytes || getMeta(String(c.src).replace(/^r2:/, ''))?.sizeBytes || 0,
          durationSec: c.duration ?? null,
          lowMemory,
        })
    );
    if (!targets.length) return;
    let cancelled = false;
    (async () => {
      for (const c of targets.slice(0, perPass)) {
        if (cancelled) break;
        attempted.current.add(c.id);
        try {
          const url = await resolveSrc(c.src);
          if (!url || cancelled) continue;
          const res = await fetch(url);
          if (!res.ok || cancelled) continue;
          const buf = await res.arrayBuffer();
          if (cancelled) continue;
          const a = await analyzeArrayBuffer(buf);
          if (cancelled) continue;
          // Either way the attempt is spent: a null here means the codec is
          // one this browser cannot decode, and re-downloading it next session
          // would produce the same null.
          updateCardSilent(c.id, a
            ? { peaks: a.peaks, duration: a.duration, sampleRate: a.sampleRate, channels: a.channels, analyzed: 1 }
            : { analyzed: 1 });

          // The bytes are already here, so lift the embedded cover too rather
          // than making a second pass download the same file. Only when the
          // card has none — a cover someone chose by hand always wins.
          if (!c.cover && workspaceId && userId) {
            const cover = readCoverFromBuffer(buf);
            if (cover && !cancelled) {
              const base = (c.fileName || c.title || 'cover').replace(/\.[a-z0-9]+$/i, '').replace(/[^a-z0-9-_ ]/gi, '_').slice(0, 60) || 'cover';
              const file = new File([cover.bytes], `${base}.${cover.ext}`, { type: cover.mime });
              const up = await uploadImage({ file, workspaceId, boardId, userId });
              if (up?.src && !cancelled) updateCardSilent(c.id, { cover: up.src });
            }
          }
        } catch (_) { /* best-effort — the card keeps the flat strip */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, canEdit, enabled, workspaceId, boardId, userId]);
}
