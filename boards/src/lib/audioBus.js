// Module-level singleton so only one audio card plays at a time across
// the board. Each AudioCard calls claim(stopFn) on play and release(stopFn)
// on pause/end/unmount. Starting a new card invokes the previous owner's
// stopFn, which pauses its wavesurfer instance.

let active = null;

export function claim(stopFn) {
  if (active && active !== stopFn) {
    try { active(); } catch (_) {}
  }
  active = stopFn;
}

export function release(stopFn) {
  if (active === stopFn) active = null;
}
