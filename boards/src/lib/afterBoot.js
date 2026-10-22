// afterBoot — run something once the page has done what the visit came for,
// at the next idle moment after that (the schedule is lib/pixelSchedule.js's):
//   * signedInApp: the open board's first picture (boot:image), or a while
//     after it painted (boot:paint) when it has none, or a cap when no board
//     paints at all;
//   * any other page: its load event.
// The Meta Pixel's script waits for this (lib/metaPixel.js), and so do the
// chunks App fetches ahead of a first click.

import { onBootMark } from './bootMarks.js';
import { schedulePixel } from './pixelSchedule.js';

export function afterBoot(fn, { signedInApp = false } = {}) {
  if (typeof window === 'undefined') return;
  schedulePixel({
    signedInApp,
    onPaint: (cb) => onBootMark('paint', cb),
    onImage: (cb) => onBootMark('image', cb),
    onLoad: (cb) => {
      if (document.readyState === 'complete') cb();
      else window.addEventListener('load', cb, { once: true });
    },
    wait: (ms, cb) => setTimeout(cb, ms),
    idle: (cb) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 2000 });
      else setTimeout(cb, 200);
    },
    load: fn,
  });
}
