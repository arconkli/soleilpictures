// The return question — a source guard on the promises it makes.
//
// This is the first thing in the product that asks the user for words, in a
// codebase whose house style is emphatically not to nag. The properties below
// are the ones that keep it acceptable, and every one of them is a single line
// away from being lost in a refactor:
//
//   * it never fires on a first session — it is gated on the return signal
//   * it goes through the shared upsell slot, so it cannot stack on the cap
//     wall or on either of the other two ambient asks
//   * a dismissal is remembered, and the once-per-account rule is enforced on
//     the SERVER, so clearing localStorage cannot reopen it
//   * the answer text never rides on an analytics event
//
// Asserted on code shape rather than on prose: a `not.toContain` guard matches
// the comment explaining the code and forces the explanation to be deleted.
//
// WHAT THIS FILE NO LONGER DOES, and why. It used to assert that migration 0282
// CONTAINS the string 'return_reason'. It did, all along — and every call still
// raised 23514, because the table's CHECK had never permitted that kind. The
// test read one side of a contract and reported it as coverage. Anything that
// spans the client and the database now lives in
// src/lib/feedbackContract.test.mjs, which resolves the constraint across ALL
// migrations last-writer-wins and compares it against every writer — and which
// `npm test` actually runs. This file is a Playwright spec and is not part of
// that gate.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(path.join(root, '..', p), 'utf8');

test('the ask is gated on returning, never on a first session', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');
  const app = read('src/App.jsx');

  // The only trigger is the return signal.
  expect(ask).toMatch(/addEventListener\(\s*'soleil:returned'/);
  expect(ask).not.toMatch(/addEventListener\(\s*'soleil:first-value'/);
  expect(ask).not.toMatch(/addEventListener\(\s*'soleil:share-ask'/);

  // And App only ever emits it having established this is a later day than the
  // one we last saw this browser on.
  //
  // Asserted on the IMMEDIATE guard, not on a window of surrounding text: an
  // earlier version of this test grepped 900 characters back for the branch
  // condition, which kept passing after the dispatch was moved out of that
  // branch entirely. A guard that can be satisfied by unrelated code nearby is
  // not a guard.
  const idx = app.indexOf("new CustomEvent('soleil:returned'");
  expect(idx, 'App must dispatch the return signal').toBeGreaterThan(0);
  const before = app.slice(Math.max(0, idx - 260), idx);
  expect(before, 'the dispatch must be guarded by the returned-after check')
    .toMatch(/if\s*\(returnedAfter\s*!=\s*null\)/);
  // And that variable is only ever non-null on a later calendar day.
  expect(app).toMatch(/returnedAfter\s*=\s*last\s*&&\s*last\s*!==\s*today/);
});

test('the clock counts visible time, and a deferral never burns the one shot', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');

  // A plain wall-clock setTimeout ran while the tab was backgrounded, so the
  // account's single lifetime exposure could be spent on a banner nobody was
  // there to see.
  expect(ask).toMatch(/document\.hidden/);

  // upsellSlot.js's own header: a false claim must return BEFORE any stamp is
  // written, because deferring is not declining. The marker therefore cannot
  // appear inside the branch that handles a refused claim.
  const claim = ask.indexOf("claimUpsellSlot('return-reason')");
  expect(claim).toBeGreaterThan(0);
  const refusal = ask.slice(claim, ask.indexOf('setOpen(true)', claim));
  expect(refusal, 'the ask must not be marked handled on a mere deferral')
    .not.toMatch(/writeKey\(ASKED_KEY/);
});

test('it competes for the shared slot like every other ambient ask', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');
  const slot = read('src/lib/upsellSlot.js');
  expect(ask).toMatch(/claimUpsellSlot\('return-reason'\)/);
  // An unregistered kind would be rejected by the slot and the ask would never
  // show at all — silently, since it fails closed.
  expect(slot).toMatch(/'return-reason'/);
});

test('the error the RPC returns is READ, never wrapped and hoped over', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');

  // THE GUARD THAT WOULD HAVE CAUGHT IT. The first version's call was
  //
  //   try { await supabase.rpc('submit_return_reason', {...}) } catch (_) {}
  //
  // and the bug was not a MISSING try/catch — it was a present one. The
  // supabase-js builder resolves with {data, error}; it does not throw, so the
  // catch fired on nothing and the 23514 that destroyed every answer the
  // product ever received was discarded twice over. The only shape that can
  // see a failure is a destructure.
  expect(ask, 'the rpc result must be destructured so `error` is visible')
    .toMatch(/const\s*\{\s*data\s*,\s*error\s*\}\s*=\s*await\s+supabase\.rpc\(\s*'submit_return_reason'/);
  expect(ask, 'a failure must be reportable, or total loss looks exactly like success')
    .toMatch(/RETURN_REASON_WRITE_FAILED/);

  // And a failed write must not retire the account. The first version wrote the
  // permanent marker BEFORE the round trip, so every user was retired on a
  // write that could never succeed.
  expect(ask).toMatch(/PENDING_KEY/);
  expect(ask, 'a check violation must never be retried forever').toMatch(/TERMINAL/);
});

test('a dismissal is remembered, and the answer text never rides an event', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');
  expect(ask).toMatch(/writeKey\(ASKED_KEY, 'dismissed'\)/);
  expect(ask).toMatch(/writeKey\(ASKED_KEY, 'answered'\)/);
  // And an ask that was actually delivered counts as asked, so someone who
  // ignores it is not asked again on their next return.
  expect(ask).toMatch(/writeKey\(ASKED_KEY, 'shown'\)/);

  // The analytics event may say HOW LONG a note was, never what it said.
  //
  // Brace-balanced rather than sliced to the first '}': the payload now carries
  // a spread of the session shape, so indexOf('}') stopped at a nested object
  // and silently shrank the region being asserted on to nothing.
  const at = ask.indexOf('EV.RETURN_REASON_NOTE');
  expect(at, 'the note event must exist').toBeGreaterThan(0);
  const open = ask.indexOf('{', at);
  let depth = 0; let end = open;
  for (let i = open; i < ask.length; i += 1) {
    if (ask[i] === '{') depth += 1;
    else if (ask[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const payload = ask.slice(open, end + 1);
  expect(payload).toMatch(/len:/);
  expect(payload, 'the free text must go to feedback and nowhere else').not.toMatch(/note:\s*(note|text)\b/);
});

test('the privacy page documents it, since the surface test cannot', () => {
  // docsite.test.mjs hashes card kinds, tabs, routes and endpoints. A component
  // that starts collecting written text moves none of those, so nothing fails
  // if this page is left stale — which is exactly why it is asserted here.
  const doc = read('content/docs/account/data-and-privacy.md');
  expect(doc).toMatch(/once per account/i);
  expect(doc).toMatch(/free-text/i);
  expect(doc).toMatch(/never appears on your first session/i);
});
