// stuckSync.js — when a connect watchdog's firing means the sync is stuck.
//
// yPartyKit.js arms a timer when a connection attempt starts and reports
// "Live sync stuck connecting" when it fires with the socket still down. A
// phone that slept, or a tab the browser froze, fires that timer late, and the
// time since it was armed then measures the sleep, not a sync that hung. Pure
// (yPartyKit.js pulls in the browser's modules), so node tests it
// (stuckSync.test.mjs).

// elapsed: performance.now() since the watchdog was armed or last re-anchored;
// delay: what it was armed for. A timer that fires on time, or a little late,
// is a verdict; one that fires over twice late was asleep, and re-arms.
export function stuckVerdict(elapsed, delay) {
  return elapsed > 2 * delay ? 'rearm' : 'report';
}
