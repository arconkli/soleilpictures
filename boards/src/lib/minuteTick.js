// One clock for every relative time on screen. A single interval runs while
// anything listens, so a message bubble that doesn't re-render (it's
// memoized) still says "5m ago" and not "just now" forever, and a thousand
// labels cost one timer, not a thousand.
export const TICK_MS = 30 * 1000;

const listeners = new Set();
let timer = null;
let now = Date.now();

export function subscribeMinute(fn) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}

export function minuteNow() {
  return now;
}

export function minuteListenerCount() {
  return listeners.size;
}
