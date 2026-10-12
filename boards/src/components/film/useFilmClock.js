import { useEffect, useRef, useState } from 'react';
import { rateValue, snapFps, timeToFrame } from '../../lib/timecode.js';

// The film player's clock: which frame is on screen, read from the video's
// own presented frames (requestVideoFrameCallback mediaTime) rather than
// currentTime, which runs ahead of the picture during playback and lands
// between frames after a seek.
//
//   fps     the rate to count in — from the file (lib/mediaProbe.js) when the
//           card knows it, else MEASURED here from the first frames presented
//   t0      the media time of frame 0, measured once the video can show one
//   onTick  called for every presented frame with (frame, mediaTime), outside
//           React — the timecode and playhead write straight to the DOM, so
//           playback never re-renders the player 24 times a second
export function useFilmClock(videoRef, { fps: knownFps = null, url, onTick }) {
  const [fps, setFps] = useState(knownFps || null);
  const [t0, setT0] = useState(0);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  const fpsRef = useRef(fps);
  fpsRef.current = fps;
  const t0Ref = useRef(0);
  t0Ref.current = t0;

  useEffect(() => { if (knownFps) setFps(knownFps); }, [knownFps && knownFps.join?.('/')]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url) return undefined;
    const rvfc = typeof v.requestVideoFrameCallback === 'function';
    let handle = null;
    let alive = true;
    let measured = !!knownFps;
    const samples = [];
    let lastMedia = null;
    let firstSeen = false;

    const report = (mediaTime) => {
      const r = fpsRef.current;
      const f = r ? timeToFrame(mediaTime, r, t0Ref.current) : null;
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
      if (!measured && !v.paused && v.playbackRate === 1 && md?.presentedFrames != null) {
        if (lastMedia != null) {
          const d = mt - lastMedia.t;
          const frames = md.presentedFrames - lastMedia.n;
          if (frames === 1 && d > 0.004 && d < 0.2) samples.push(d);
          if (samples.length >= 12) {
            samples.sort((a, b) => a - b);
            const med = samples[Math.floor(samples.length / 2)];
            const r = snapFps(1 / med);
            if (r) { measured = true; fpsRef.current = r; setFps(r); }
          }
        }
        lastMedia = { t: mt, n: md.presentedFrames };
      }
      report(mt);
      handle = v.requestVideoFrameCallback(onFrame);
    };

    // No requestVideoFrameCallback (older browsers): poll on animation frames.
    const onRaf = () => {
      if (!alive) return;
      report(v.currentTime);
      handle = requestAnimationFrame(onRaf);
    };

    if (rvfc) handle = v.requestVideoFrameCallback(onFrame);
    else handle = requestAnimationFrame(onRaf);
    // A paused seek presents a frame too, but some browsers skip the callback
    // for it: report on seeked as well.
    const onSeeked = () => report(v.currentTime);
    v.addEventListener('seeked', onSeeked);
    return () => {
      alive = false;
      v.removeEventListener('seeked', onSeeked);
      if (handle != null) {
        if (rvfc) { try { v.cancelVideoFrameCallback(handle); } catch (_) {} }
        else cancelAnimationFrame(handle);
      }
    };
    // knownFps is read once per url: a probe landing later updates fps via setFps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, url]);

  return { fps, t0, fpsValue: rateValue(fps) };
}
