// import-preflight.spec.js
//
// A folder drop bigger than the remaining cap must ASK before it uploads, and
// the cards that fit must survive when the server refuses the rest.
//
// Both behaviours come from live traces, and they are the same trace
// cap-wall-loss.spec.js opens on, one step earlier: a user signs up, drops a
// folder of a hundred-odd photographs minutes later, and is left holding a
// fraction of it — a count BELOW their own cap, because the batch had not
// merely overflowed, it had failed whole. They did not come back. The canvas
// drop path had no cap check at all: the list path always sliced, the canvas
// simply never did.
//
// SPLIT COVERAGE, deliberately — same split cap-wall-loss.spec.js documents.
// The real dialog is opened by App.jsx's preflightImport, and App.jsx
// early-returns to LocalBoardsApp under ?local=1, so the rendering is driven
// through the qaForceImportAsk render seam and the App.jsx/CanvasSurface
// plumbing is asserted against source. The decision itself — including the
// unresolved-is-not-uncapped rule that this whole bug turned on — is unit
// tested in importPreflight.test.mjs.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const app       = () => read('src/App.jsx');
const canvas    = () => read('src/components/CanvasSurface.jsx');
const boardsApi = () => read('src/lib/boardsApi.js');

test.describe('the question, before the upload', () => {
  test('an over-cap folder drop names the folder, the room, and both real choices', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=76,50,0,50');

    const ask = page.locator('.impcap');
    await expect(ask).toBeVisible();
    // The user's own folder is the stake — stated, not estimated.
    await expect(ask.getByText(/You dropped 76 photos/i)).toBeVisible();
    await expect(ask.getByText(/holds 50 more/i)).toBeVisible();
    // The promise that makes cancelling free. Without it the dialog reads as a
    // report of something that already happened, which is the old behaviour.
    await expect(ask.getByText(/Nothing has been uploaded yet/i)).toBeVisible();

    // The cards they are entitled to are a real button, not a consolation line
    // of prose — this is exactly what the old path threw away with the overflow.
    await expect(ask.getByRole('button', { name: /Add the first 50 photos/i })).toBeVisible();
    await expect(ask.getByRole('button', { name: /Upgrade — keep all 76/i })).toBeVisible();
    await expect(ask.getByRole('button', { name: /^Cancel$/ })).toBeVisible();
  });

  test('one card of room reads as singular, never "1 photos"', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=9,1,49,50');
    const ask = page.locator('.impcap');
    await expect(ask.getByRole('button', { name: /Add the first 1 photo$/i })).toBeVisible();
  });

  test('the meter reads the account, and stays quiet when there is nothing to read', async ({ page }) => {
    // At 45 of 50 the meter is information. At 0 an empty track is a stray
    // divider that says nothing the sentence above it hasn't already said.
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=9,5,45,50');
    await expect(page.locator('.impcap-meter')).toHaveCount(1);
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=76,50,0,50');
    await expect(page.locator('.impcap')).toBeVisible();
    await expect(page.locator('.impcap-meter')).toHaveCount(0);
  });

  test('a mixed batch is never called photos', async ({ page }) => {
    // rejectedNoun falls back to the neutral noun as soon as the drop is mixed;
    // the seam feeds it an all-image tally, so this pins the singular/plural
    // wiring rather than re-testing the pure helper.
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&importask=76,50,0,50');
    await expect(page.locator('.impcap').getByText(/You dropped 76 photos/i)).toBeVisible();
  });
});

test.describe('nothing moves until the question is answered (CanvasSurface path)', () => {
  test('the preflight runs BEFORE the files are measured, uploaded or placed', () => {
    const s = canvas();
    const preflight = s.indexOf('mutators.preflightImport');
    expect(preflight).toBeGreaterThan(-1);
    // The measure step reads every file off disk; the placement loop uploads.
    // Both must be downstream of the question, or the bytes are spent before
    // anyone checks the balance — which is precisely the old bug.
    expect(preflight).toBeLessThan(s.indexOf('const d = await readImageDims(it.file)'));
    expect(preflight).toBeLessThan(s.indexOf('optimisticDropImage(f, rcx, rcy, rect)'));
  });

  test('the answer is honoured — the batch is actually truncated', () => {
    const s = canvas();
    // `take` is authoritative. Clamped both ways so a broken mutator can neither
    // place more than the user chose nor go negative.
    expect(s).toMatch(/Math\.max\(0, Math\.min\(classified, Number\(take\) \|\| 0\)\)/);
    expect(s).toMatch(/accepted\.splice\(keep\)/);
  });

  test('the gesture stays measurable — n_over separates the cap from upload failure', () => {
    // n_accepted counted CLASSIFICATION, not survival: it reported a full
    // folder for a user who ended up holding a fraction of it, which is why
    // this went unnoticed for so long. n_over is the cap's share of that gap.
    expect(canvas()).toMatch(/n_over: over/);
    expect(read('src/lib/analyticsEvents.js')).toMatch(/IMPORT_PREFLIGHT:\s+'import_preflight'/);
  });
});

test.describe('unresolved is not uncapped (App.jsx-only path)', () => {
  test('capSource reports whether the cap actually LOADED', () => {
    const s = app();
    // The bug: `capped: myTier.tier === 'demo'` with a null tier read as "not a
    // demo user" and switched the gate off entirely, so whole folders reached a
    // server that then refused them.
    expect(s).toMatch(/resolved: mt\.tier !== null && mt\.tier !== undefined/);
    expect(s).toMatch(/resolved: Boolean\(cap\)/);
  });

  test('the cap is read live, not from the count frozen when the board opened', () => {
    const s = app();
    // The mutators memo only recomputes on a board change, so the captured
    // myTier froze its count — the "stale cached count" the server_cap path
    // keeps blaming. It would also make the preflight's refetch pointless: the
    // re-plan would read the same number the round trip just replaced.
    expect(s).toMatch(/const mt = myTierRef\.current \|\| myTier;/);
  });

  test('a bulk import resolves the cap instead of guessing', () => {
    const s = app();
    expect(s).toMatch(/plan\.outcome === 'unresolved'/);
    expect(s).toMatch(/myTierRef\.current\?\.refetch\?\.\(\)/);
    expect(s).toMatch(/boardCapacity\.refetch\?\.\(boardId\)/);
  });

  test('the question suspends the drop rather than answering it for the user', () => {
    const s = app();
    // The promise is resolved by the dialog, so preflightImport genuinely waits.
    expect(s).toMatch(/return await new Promise\(\(resolve\) => \{/);
    expect(s).toMatch(/ask\.resolve\?\.\(\{ take \}\)/);
    // Answered once: a double-click must not resolve a settled promise and hand
    // a stale `take` to the next drop.
    expect(s).toMatch(/if \(!ask\) return null;/);
  });

  test('upgrading does not silently half-import', () => {
    // Stripe checkout navigates away, so there is no honest way to hold a
    // FileList across it — upgrade takes 0 and the folder stays on disk.
    expect(app()).toMatch(/answerImportAsk\('upgrade', 0\)/);
    expect(app()).toMatch(/answerImportAsk\('cancel', 0\)/);
    expect(app()).toMatch(/answerImportAsk\('partial', importAsk\.take\)/);
  });
});

test.describe('a refused batch keeps the cards that fit (boardsApi path)', () => {
  test('"new" is no longer treated as "over the cap"', () => {
    const s = boardsApi();
    // PostgREST fails a batch whole, so every genuinely-new row used to be
    // withdrawn — including the ones the user still had room for. That is why
    // both big importers finished BELOW their own cap.
    expect(s).toMatch(/async function landUpToCap/);
    expect(s).toMatch(/const rejected = await landUpToCap\(\{ boardId, rows: overflow, sigFor, cache \}\)/);
  });

  test('the room comes from the server, not from a client guess', () => {
    const s = boardsApi();
    expect(s).toMatch(/get_board_capacity/);
    expect(s).toMatch(/Math\.max\(0, Number\(r\.cap \?\? 0\) - Number\(r\.used \?\? 0\)\)/);
  });

  test('a lost race degrades to probing rather than to data loss', () => {
    const s = boardsApi();
    // The trigger's test is monotonic, so the first refusal ends the walk and
    // everything before it is already persisted.
    expect(s).toMatch(/if \(res\.error\) return rows\.slice\(i\)/);
    // Only rows that actually landed may cache a signature; the rest keep a
    // stale one on purpose so a later sync retries them.
    expect(s).toMatch(/cache\.sigs\.set\(rows\[i\]\.card_id, sigFor\(rows\[i\]\)\)/);
  });
});

test('the QA import-ask seam cannot reach production', () => {
  const s = read('src/lib/localMode.js');
  expect(s).toMatch(/export function qaForceImportAsk/);
  // Same literal guard every other QA harness uses, so the bundler drops it.
  expect(s).toMatch(/qaForceImportAsk[\s\S]{0,200}import\.meta\.env\.DEV/);
  // Bounded digits — an unbounded run is a free integer overflow (cf. 0198).
  expect(s).toMatch(/\\d\{1,4\}\(,\\d\{1,4\}\)\{3\}/);
});
