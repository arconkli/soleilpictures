// Shared concurrency gate for self-healing background backfills.
//
// Two independent features lazily persist derived image data the first time a
// writer views something:
//   - useThumbnailBackfill — renders + stores a board's preview thumbnail.
//   - R2Image preview backfill — downscales an un-backfilled image to a WebP
//     preview + thumbhash (progressive image loading).
//
// A freshly-painted grid or an image-heavy board can mount many tiles/cards at
// once. Without a shared cap each would fire its own presign + R2 PUT + Supabase
// write on first paint — a burst that competes with the visible work. This one
// global gate keeps the total backfill burst civil across BOTH features (a board
// open shouldn't fire thumbnail PUTs and image-preview PUTs simultaneously).

// 4 in flight: the work is mostly async (createImageBitmap decode, R2 PUT,
// Supabase RPC) so a cap of 2 left CPU + network idle and made late cards on a
// 20-image board wait seconds for a preview slot. 4 keeps the burst civil
// without starving the visible work.
//
// Memory-constrained clients (iOS Safari, ≤4GB devices) are the exception: each
// task holds a full-resolution decode (createImageBitmap) plus 1–2 canvas
// encodes, and 4 concurrent on an iPad with 12MP/HEIC photos OOMs the tab. Halve
// the cap there — the work just takes a little longer, it doesn't freeze.
import { lowMemoryDevice } from './device.js';
const CONCURRENCY = lowMemoryDevice() ? 2 : 4;
let _active = 0;
const _queue = [];

// Run `task` (a () => Promise) under the shared cap. Errors are swallowed —
// callers are fire-and-forget and idempotent. Never throws.
export function runGated(task) {
  const start = () => {
    _active++;
    Promise.resolve()
      .then(task)
      .catch(() => {})
      .finally(() => {
        _active--;
        const next = _queue.shift();
        if (next) next();
      });
  };
  if (_active < CONCURRENCY) start();
  else _queue.push(start);
}
