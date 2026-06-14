// frictionSignal.test.mjs
//
// Unit test for the stuck-detection core + the stateful session layer. Run with:
//   cd boards && node src/lib/frictionSignal.test.mjs
//
// Plain Node ESM, no test framework — exit 0 on pass, non-zero on failure
// (matches demoCardCap.test.mjs). frictionSignal.js only imports the pure
// firstValueTrigger helpers, so this loads with no backend/vite.

import {
  evaluateStuck, start, stop, recordIntent, evaluateNow, isRunning,
  STUCK_TIMEOUT_MS, RAGE_WINDOW_MS, RAGE_COUNT,
} from './frictionSignal.js';

let failed = 0, passed = 0;
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) { console.error(`FAIL: ${msg}\n  expected: ${b}\n  actual:   ${a}`); failed++; }
  else passed++;
}
function assert(cond, msg) { if (!cond) { console.error(`FAIL: ${msg}`); failed++; } else passed++; }

// ── Pure core: evaluateStuck ───────────────────────────────────────────────
assertEq(evaluateStuck({ intents: [], now: 0 }), { stuck: false, reason: null }, 'no intents → not stuck');

// hasGenuine short-circuits even with a rage-worthy burst.
assertEq(evaluateStuck({ intents: [0, 100, 200], now: 200, hasGenuine: true }),
  { stuck: false, reason: null }, 'genuine card present → never stuck');

// Rage: 3 intents inside the 1.5s window.
assertEq(evaluateStuck({ intents: [0, 400, 900], now: 900 }),
  { stuck: true, reason: 'rage' }, 'rage: 3 intents within 1.5s');

// Not rage: only 2 inside the window, and the first intent is recent → not stuck.
assertEq(evaluateStuck({ intents: [0, 1400], now: 1400 }),
  { stuck: false, reason: null }, '2 intents, oldest recent → not stuck');

// Rage needs rageCount; 2 fast clicks are not enough.
assertEq(evaluateStuck({ intents: [0, 200], now: 200 }),
  { stuck: false, reason: null }, '2 intents in window → below rage threshold');

// Timeout: a single intent, no card, 12s elapsed.
assertEq(evaluateStuck({ intents: [0], now: STUCK_TIMEOUT_MS }),
  { stuck: true, reason: 'timeout' }, 'timeout: first intent 12s old');

// Just under the timeout → still not stuck.
assertEq(evaluateStuck({ intents: [0], now: STUCK_TIMEOUT_MS - 1 }),
  { stuck: false, reason: null }, 'just under timeout → not stuck');

// Rage takes precedence over timeout when both could apply: the old intent at 0
// makes it timeout-eligible, but 3 intents inside the trailing 1.5s window → rage.
assertEq(evaluateStuck({ intents: [0, STUCK_TIMEOUT_MS - 100, STUCK_TIMEOUT_MS - 50, STUCK_TIMEOUT_MS], now: STUCK_TIMEOUT_MS }),
  { stuck: true, reason: 'rage' }, 'rage wins over timeout');

// Sanity on the exported constants.
assert(STUCK_TIMEOUT_MS === 12000 && RAGE_WINDOW_MS === 1500 && RAGE_COUNT === 3, 'constants as documented');

// ── Stateful layer ─────────────────────────────────────────────────────────
let CLOCK = 0;
const clock = () => CLOCK;

// Scope off: recordIntent before start() does nothing (no session, no callback).
let fires = 0;
recordIntent('dblclick');
assert(!isRunning() && fires === 0, 'recordIntent before start() is a no-op');

// Rage fires once, synchronously on the 3rd intent.
let lastPayload = null;
CLOCK = 1000;
start({ getCards: () => [], onStuck: (p) => { fires++; lastPayload = p; }, clock });
recordIntent('dblclick'); CLOCK = 1300; recordIntent('add_menu'); CLOCK = 1600; recordIntent('paste');
assertEq(fires, 1, 'rage fired exactly once');
assertEq(lastPayload && lastPayload.reason, 'rage', 'rage payload reason');
assertEq(lastPayload && lastPayload.intents, 3, 'rage payload intent count');
assertEq(lastPayload && lastPayload.method_last, 'paste', 'rage payload method_last is the latest gesture');
// Further intents don't re-fire (fired latch).
CLOCK = 1700; recordIntent('drag_in');
assertEq(fires, 1, 'no re-fire after stuck latch');
stop();

// Timeout path: one intent, advance the clock past the timeout, evaluateNow().
fires = 0; lastPayload = null; CLOCK = 5000;
start({ getCards: () => [], onStuck: (p) => { fires++; lastPayload = p; }, clock });
recordIntent('tool_place');
assertEq(fires, 0, 'no immediate fire for a single intent');
CLOCK = 5000 + STUCK_TIMEOUT_MS; evaluateNow();
assertEq(fires, 1, 'timeout fired after 12s');
assertEq(lastPayload && lastPayload.reason, 'timeout', 'timeout payload reason');
assertEq(lastPayload && lastPayload.method_last, 'tool_place', 'timeout payload method_last');
stop();

// Genuine card present → recordIntent stops the session and never fires.
fires = 0; CLOCK = 9000;
start({ getCards: () => [{ id: 'real-1' }], onStuck: () => { fires++; }, clock });
recordIntent('dblclick'); recordIntent('dblclick'); recordIntent('dblclick');
assert(fires === 0 && !isRunning(), 'genuine card → no fire + session stopped');

// Seed-only cards are NOT genuine → the signal still runs and can fire.
fires = 0; CLOCK = 12000;
start({ getCards: () => [{ id: 'onb-welcome', seed: true }], onStuck: () => { fires++; }, clock });
recordIntent('dblclick'); CLOCK = 12200; recordIntent('dblclick'); CLOCK = 12400; recordIntent('dblclick');
assertEq(fires, 1, 'seed-only board is not genuine → rage still fires');
stop();

// After stop(), recordIntent is inert again.
fires = 0; recordIntent('paste');
assert(fires === 0 && !isRunning(), 'recordIntent after stop() is a no-op');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
