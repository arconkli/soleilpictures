// "What's holding you back?" — the wiring that decides who is asked, when, and
// whether their answer can be lost. Source-level, and under src/lib on purpose:
// npm test is the gate CI runs, and the return question's first version was
// broken for a week behind a Playwright spec nobody ran (see ReturnReasonAsk).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');
const ask = read('../components/UpgradeReasonAsk.jsx');
const modal = read('../components/PricingModal.jsx');
const app = read('../App.jsx');

// The text between `from` and the first `until` after it.
function region(src, from, until) {
  const a = src.indexOf(from);
  assert.ok(a > -1, `not found: ${from}`);
  const b = src.indexOf(until, a + from.length);
  assert.ok(b > a, `no end after: ${from}`);
  return src.slice(a, b);
}

test('the pricing modal announces a dismissal, and only a real one, by someone the offer was for', () => {
  const close = region(modal, 'const handleClose = (method', 'onClose?.();');
  const announce = close.indexOf('OFFER_DISMISSED');
  assert.ok(announce > 0, 'handleClose must announce the dismissal');
  // Inside the not-redirecting branch: a checkout click is not a dismissal.
  assert.ok(close.indexOf('if (!redirectingRef.current)') < announce);
  // Never from the admin gallery's preview; only for a free-plan account.
  assert.match(close, /if \(!tierPreview && tier === 'demo'\) \{[\s\S]*OFFER_DISMISSED/);
  assert.match(close, /dwell_ms: timing\?\.dwell_ms \?\? null/, 'the dwell rides along for the one-second floor');
});

test('the import dialog announces only a declined upgrade, and only on the person\'s own plan', () => {
  const answer = region(app, 'const answerImportAsk = useCallback(', '}, []);');
  assert.match(answer, /else if \(ask\.own && \(action === 'cancel' \|\| action === 'partial'\)\) \{[\s\S]*OFFER_DISMISSED/);
  assert.doesNotMatch(region(answer, "if (action === 'upgrade')", '} else if'), /OFFER_DISMISSED/,
    'choosing to upgrade is not declining it');
});

test('who is asked: a free-plan owner, after the offer was really on screen, once', () => {
  const on = region(ask, 'const onDismissed = async (e) => {', 'window.addEventListener(OFFER_DISMISSED');
  assert.match(on, /if \(d\.tier !== 'demo'\) return;/);
  assert.match(on, /d\.dwell_ms < MIN_OFFER_DWELL_MS\) return;/);
  assert.match(on, /if \(alreadyHandled\(who\)\) return;/);
  assert.match(on, /upgrade_reason_asked_at\) serverAskedFor = who/, 'the per-account marker is read from the server');
});

test('a busy slot is "not this time", never an answer', () => {
  const on = region(ask, 'const onDismissed = async (e) => {', 'window.addEventListener(OFFER_DISMISSED');
  const claim = on.indexOf("if (!claimUpsellSlot('upgrade-reason')) return;");
  assert.ok(claim > 0, 'the slot is claimed at show time');
  assert.doesNotMatch(on.slice(0, claim), /writeKey\(askedKey|stampUpgradePrompt/,
    'nothing may be stamped before the claim succeeds');
});

test('the answer cannot be lost quietly', () => {
  assert.match(ask, /const \{ data, error \} = await supabase\.rpc\('submit_upgrade_reason'/,
    'the error is destructured and read, never wrapped and hoped over');
  assert.match(ask, /EV\.UPGRADE_REASON_WRITE_FAILED/);
  assert.match(ask, /const pendingKey = \(uid\) => `soleil\.upgradereason\.pending\.v1:\$\{uid \|\| 'anon'\}`;/);
  assert.match(ask, /const TERMINAL = new Set\(/);
  // The tap is banked before the note: a dropped follow-up costs the note only.
  const bank = region(ask, 'const bank = async (choice) => {', 'const send = async');
  assert.ok(bank.indexOf('writePending(') < bank.indexOf('await deliver('));
});

test('the note event carries its length, never its words', () => {
  const at = ask.indexOf('EV.UPGRADE_REASON_NOTE');
  assert.ok(at > 0);
  const payload = ask.slice(at, ask.indexOf('}', at) + 1);
  assert.match(payload, /len:/);
  assert.doesNotMatch(payload, /note:\s*(note|text)\b/);
});

test('what rides along is shown before it is sent', () => {
  assert.match(ask, /Sent with your answer: \{contextLine\}/);
  assert.match(ask, /buildFeedbackContext\(/);
});

test('markers and pending answers belong to an account, never to a shared device', () => {
  assert.match(ask, /const askedKey = \(uid\) => `soleil\.upgradereason\.v1:\$\{uid \|\| 'anon'\}`;/);
  assert.match(ask, /if \(!p \|\| p\.uid !== uid\) return;/, 'another account\'s pending answer is never sent in this session');
  assert.match(ask, /writePending\(ask\.uid, \{ uid: ask\.uid, choice,/);
  // One slot per account: the next account's answer can't overwrite (and so
  // lose) an earlier account's unsent one.
  assert.doesNotMatch(ask, /PENDING_KEY/, 'no device-wide pending slot');
  assert.match(ask, /const p = readPending\(uid\);/);
  const rr = read('../components/ReturnReasonAsk.jsx');
  assert.match(rr, /const roleKey = \(uid\) => `soleil\.role\.v1:\$\{uid \|\| 'anon'\}`;/);
  assert.match(rr, /if \(p\.uid && p\.uid !== uid\) \{ flushed = false; return; \}/);
  assert.match(rr, /if \(p\?\.uid && p\.uid !== uid\) \{ roleFlushed = false; return; \}/);
});

test('a note carries the context of the tap it follows', () => {
  const send = region(ask, 'const send = async () => {', 'Not now');
  assert.match(send, /context: ask\.context/);
  assert.match(send, /await deliver\(picked, text, ask\.context\)/);
  assert.doesNotMatch(send, /context: null/);
  const rr = read('../components/ReturnReasonAsk.jsx');
  assert.match(rr, /tapContextRef\.current = context;/);
  assert.match(rr, /await deliver\(picked, text, tapContext\)/);
});

test('answering or closing the return question before the delivery tick still marks the account asked', () => {
  const rr = read('../components/ReturnReasonAsk.jsx');
  const mark = region(rr, 'const markDelivered = () => {', 'const bank = async');
  assert.match(mark, /if \(readKey\(ASKED_KEY\)\) return;/, 'once: the tick writes the key, so either it or this runs');
  assert.match(mark, /EV\.RETURN_REASON_SHOWN/);
  assert.match(mark, /if \(!serverAsked\) \{ try \{ onAsked\?\.\(\); \} catch \(_\) \{\} \}/);
  const bank = region(rr, 'const bank = async (choice) => {', 'const pickRole');
  assert.ok(bank.indexOf('markDelivered();') >= 0 && bank.indexOf('markDelivered();') < bank.indexOf("writeKey(ASKED_KEY, 'answered')"),
    'before the answer\'s own marker, or the tick\'s work is skipped for good');
  const dismiss = region(rr, 'const dismiss = () => {', 'setOpen(false)');
  assert.ok(dismiss.indexOf('markDelivered();') >= 0 && dismiss.indexOf('markDelivered();') < dismiss.indexOf("writeKey(ASKED_KEY, 'dismissed')"));
});

test('a fast answer or close is still counted as shown — the same denominator rule as the return question', () => {
  const mark = region(ask, 'const markShown = () => {', 'const bank = async');
  assert.match(mark, /if \(readKey\(askedKey\(ask\.uid\)\)\) return;/, 'once: the tick writes the marker');
  assert.match(mark, /EV\.UPGRADE_REASON_SHOWN/);
  const bank = region(ask, 'const bank = async (choice) => {', 'const send = async');
  assert.ok(bank.indexOf('markShown();') >= 0 && bank.indexOf('markShown();') < bank.indexOf("writeKey(askedKey(ask.uid), 'answered')"));
  const dismiss = region(ask, 'const dismiss = (via) => {', 'setAsk(null)');
  assert.ok(dismiss.indexOf('if (!picked) markShown();') >= 0 && dismiss.indexOf('markShown') < dismiss.indexOf("'dismissed'"));
});
