import { useCallback, useEffect, useState } from 'react';
import { knownCopy, mediaKindOfKey } from '../lib/playCopy.js';

// What a player loads for `src`, and the converter's part when this browser
// can't play it (lib/playCopy.js):
//
//   source       the 'r2:' key to load: the copy when the card names its own
//                (playSrc), else the original
//   failed(why)  the player says `source` failed: decode, no picture, stalled
//   handles(why) whether that failure is this hook's to deal with rather than
//                the player's to show (the player shows it once this gives up)
//   busy         looking for a copy, or asking for one
//   preparing    the converter is making it; the player plays it when it comes
//
// When the original fails, a copy someone already made is played; otherwise
// one is asked for (a signed-in member who can read the file) and waited on.
// When the copy fails (its object is gone), the original is tried, and if that
// fails too the copy is asked for again: the Worker re-makes a missing one.
// The looking, asking and waiting load with lib/playCopyWork.js the first time
// a file fails; most play as they are.

const COPY_REASONS = new Set(['decode', 'no_picture', 'stalled']);
const WORKING = ['looking', 'asking', 'preparing'];

const start = (src, playSrc) => {
  const copy = knownCopy(src, playSrc);
  return { src, phase: copy ? 'copy' : 'original', copy, copyBroken: false };
};

export function usePlayCopy({ src, playSrc = null, enabled = true }) {
  const key = typeof src === 'string' && src.startsWith('r2:') ? src.slice(3) : '';
  const eligible = enabled && !!mediaKindOfKey(key);
  const [raw, setRaw] = useState(() => start(src, playSrc));
  // A new src starts over (a player that isn't remounted for it).
  const st = raw.src === src ? raw : start(src, playSrc);
  const move = useCallback((fn) => {
    setRaw((s) => fn(s.src === src ? s : start(src, playSrc)));
  }, [src, playSrc]);

  const { phase, copyBroken } = st;
  useEffect(() => {
    if (!eligible || !WORKING.includes(phase)) return undefined;
    const run = { off: false, timer: null };
    const to = (next) => { if (!run.off) move((s) => ({ ...s, ...next })); };
    // Its chunk not loading (offline, a deploy since) is a copy not found.
    import('../lib/playCopyWork.js').then(
      (work) => { if (!run.off) work.runPhase(phase, key, { copyBroken, to, run }); },
      () => to({ phase: 'none' }),
    );
    return () => { run.off = true; clearTimeout(run.timer); };
  }, [phase, key, eligible]);   // eslint-disable-line react-hooks/exhaustive-deps

  const failed = useCallback((why) => {
    if (!eligible || !COPY_REASONS.has(why)) return;
    move((s) => {
      if (s.phase === 'copy') {
        // A copy that stalls is a slow connection, which the player says and
        // retries; one that won't decode is gone or broken.
        return why === 'stalled' ? s : { ...s, phase: 'original', copy: null, copyBroken: true };
      }
      if (s.phase === 'original') return { ...s, phase: s.copyBroken ? 'asking' : 'looking' };
      return s;
    });
  }, [eligible, move]);

  const handles = (why) => eligible && COPY_REASONS.has(why) && phase !== 'none'
    && !(phase === 'copy' && why === 'stalled');

  return {
    source: phase === 'copy' ? st.copy : src,
    onCopy: phase === 'copy',
    busy: phase === 'looking' || phase === 'asking',
    preparing: phase === 'preparing',
    failed,
    handles,
  };
}
