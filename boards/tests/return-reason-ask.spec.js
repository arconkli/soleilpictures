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

test('it competes for the shared slot like every other ambient ask', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');
  const slot = read('src/lib/upsellSlot.js');
  expect(ask).toMatch(/claimUpsellSlot\('return-reason'\)/);
  // An unregistered kind would be rejected by the slot and the ask would never
  // show at all — silently, since it fails closed.
  expect(slot).toMatch(/'return-reason'/);
});

test('the once-per-account rule is enforced on the server, not just locally', () => {
  const mig = read('../supabase/migrations/0282_return_reason_feedback.sql');
  expect(mig).toMatch(/where f\.user_id = v_uid and f\.kind = 'return_reason'/);
  expect(mig).toMatch(/return false;/);
  // The choice list is closed server-side too, so the column stays groupable.
  expect(mig).toMatch(/not in \('unfinished', 'new_material', 'reminded', 'someone_asked', 'looking'\)/);
  // Writes must not go through a permissive policy on a table whose grants
  // still include DELETE for authenticated.
  expect(mig).toMatch(/revoke insert, update, delete on public\.feedback from anon, authenticated/);
  expect(mig).toMatch(/on delete cascade/);
});

test('a dismissal is remembered, and the answer text never rides an event', () => {
  const ask = read('src/components/ReturnReasonAsk.jsx');
  expect(ask).toMatch(/markHandled\('dismissed'\)/);
  expect(ask).toMatch(/markHandled\('answered'\)/);

  // The analytics event may say WHETHER a note was written, never what it said.
  const answered = ask.slice(ask.indexOf('RETURN_REASON_ANSWERED'));
  const payload = answered.slice(0, answered.indexOf('}'));
  expect(payload).toMatch(/has_note/);
  expect(payload, 'the free text must go to feedback and nowhere else').not.toMatch(/note:\s*note/);
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
