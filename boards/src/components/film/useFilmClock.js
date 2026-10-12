import { useEffect, useRef, useState } from 'react';
import { rateValue, snapFps, timeToFrame } from '../../lib/timecode.js';

// The film player's clock: which frame is on screen, read from the video's
// own presented frames (requestVideoFrameCallback mediaTime) rather than
// currentTime, which runs ahead of the picture during playback and lands
// between frames after a seek.
//
//   el      the <video> on show — the clock follows it when the player flips
//           A/B, so it always counts the picture you're looking at
//   fps     the rate to count in — from the file (lib/mediaProbe.js) when the
//           card knows it, else MEASURED here from the first frames presented
//   t0      the media time of frame 0, measured once while paused at the start
//   onTick  called for every presented frame with (frame, mediaTime), outside
//           React — the timecode and playhead write straight to the DOM, so
//           playback never re-renders the player 24 times a second
const PROVISIONAL = [24, 1];

export function useFilmClock(el, { fps: knownFps = null, url, onTick }) {
  const [fps, setFps] = useState(knownFps || null);
  const [t0, setT0] = useState(0);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const t0Ref = useRef(0);
  t0Ref.current = t0;
  // Read through a ref: a probe that lands after the clip started must stop
  // the measuring, not be overwritten by it.
  const knownRef = useRef(knownFps);
  knownRef.current = knownFps;

  useEffect(() => { if (knownFps) setFps(knownFps); }, [knownFps && knownFps.join?.('/')]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = el;
    if (!v || !url) return undefined;
    const rvfc = typeof v.requestVideoFrameCallback === 'function';
    let handle = null;
    let alive = true;
    const samples = [];
    let lastMedia = null;
    let firstSeen = false;

    const report = (mediaTime) => {
      // Until the rate is known, count at the player's provisional 24 (shown
      // as ≈24), so the playhead and a pause still land on a frame.
      const r = fpsRef.current || PROVISIONAL;
      const f = timeToFrame(mediaTime, r, t0Ref.current);
      try { tickRef.current?.(f, mediaTime); } catch (_) {}
    };

    const onFrame = (_now, md) => {
      if (!alive) return;
      const mt = md?.mediaTime ?? v.currentTime;
      if (!firstSeen) {
        firstSeen = true;
        // The first frame the decoder hands over after load sits at frame
        // 0's media time — usually 0, sometimes an encoder's start offset.
        // Only while paused at the very start: a clip that autoplays hands
        // over frame 1 or 2 first, and taking that as frame 0 would put
        // every count after it one frame out.
        if (v.paused && v.currentTime < 0.001 && (md?.presentedFrames ?? 1) <= 1 && mt < 0.25) { t0Ref.current = mt; setT0(mt); }
      }
      // Measure the rate from consecutive presented frames while playing at 1×.
      if (!knownRef.current && !fpsRef.current && !v.paused && v.playbackRate === 1 && md?.presentedFrames != null) {
        if (lastMedia != null) {
          const d = mt - lastMedia.t;
          const frames = md.presentedFrames - lastMedia.n;
          if (frames === 1 && d > 0.004 && d < 0.2) samples.push(d);
          if (samples.length >= 12) {
            samples.sort((a, b) => a - b);
            const med = samples[Math.floor(samples.length / 2)];
            const r = snapFps(1 / med);
            if (r && !knownRef.current) { fpsRef.current = r; setFps(r); }
          }
        }
        lastMedia = { t: mt, n: md.presentedFrames };
      }
      report(mt);
      handle = v.requestVideoFrameCallback(onFrame);
    };

    // No requestVideoFrameCallback (older browsers): poll on animation frames,
    // but only while playing — a paused clip reports on seeked instead.
    const onRaf = () => {
      if (!alive) return;
      report(v.currentTime);
      handle = !v.paused ? requestAnimationFrame(onRaf) : null;
    };
    const startRaf = () => { if (!rvfc && handle == null) handle = requestAnimationFrame(onRaf); };

    if (rvfc) handle = v.requestVideoFrameCallback(onFrame);
    else if (!v.paused) startRaf();
    // A paused seek presents a frame too, but some browsers skip the callback
    // for it: report on seeked (and on the first frame) as well.
    const onSeeked = () => report(v.currentTime);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadeddata', onSeeked);
    v.addEventListener('playing', startRaf);
    return () => {
      alive = false;
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadeddata', onSeeked);
      v.removeEventListener('playing', startRaf);
      if (handle != null) {
        if (rvfc) { try { v.cancelVideoFrameCallback(handle); } catch (_) {} }
        else cancelAnimationFrame(handle);
      }
    };
  }, [el, url]);

  return { fps, t0, fpsValue: rateValue(fps) };
}
