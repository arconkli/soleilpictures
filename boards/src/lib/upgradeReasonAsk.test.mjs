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
  assert.match(on, /if \(alreadyHandled\(\)\) return;/);
  assert.match(on, /upgrade_reason_asked_at\) serverAsked = true/, 'the per-account marker is read from the server');
});

test('a busy slot is "not this time", never an answer', () => {
  const on = region(ask, 'const onDismissed = async (e) => {', 'window.addEventListener(OFFER_DISMISSED');
  const claim = on.indexOf("if (!claimUpsellSlot('upgrade-reason')) return;");
  assert.ok(claim > 0, 'the slot is claimed at show time');
  assert.doesNotMatch(on.slice(0, claim), /writeKey\(ASKED_KEY|stampUpgradePrompt/,
    'nothing may be stamped before the claim succeeds');
});

test('the answer cannot be lost quietly', () => {
  assert.match(ask, /const \{ data, error \} = await supabase\.rpc\('submit_upgrade_reason'/,
    'the error is destructured and read, never wrapped and hoped over');
  assert.match(ask, /EV\.UPGRADE_REASON_WRITE_FAILED/);
  assert.match(ask, /PENDING_KEY/);
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
