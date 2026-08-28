// cap-wall-loss.spec.js
//
// The cap-hit wall must say what the cap just COST, and it must arrive alone.
//
// Both behaviours come from live traces: a user signs up, drops a folder of
// photos minutes later, watches part of the batch silently fail to persist, is
// shown several upgrade surfaces stacked within seconds of each other, and then
// starts deleting their own cards to make room. The screen said nothing at all
// about the photos that went missing.
//
// SPLIT COVERAGE, deliberately. The real cap-hit modal is opened by App.jsx's
// `soleil:card-index-capped` listener, and App.jsx early-returns to
// LocalBoardsApp under ?local=1 — so neither that listener nor pitchCapWall
// mounts in this harness. The rendering is therefore driven through the
// qaForceCapWall render seam, and the App.jsx-only plumbing is asserted against
// source, the same way collab-nudge-wiring.spec.js does. The arbitration rules
// themselves are unit-tested (upsellSlot.test.mjs, demoCardCap.test.mjs).

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const app        = () => read('src/App.jsx');
const chip       = () => read('src/components/UpgradeChip.jsx');
const boardsApi  = () => read('src/lib/boardsApi.js');
const modal      = () => read('src/components/PricingModal.jsx');

test.describe('the wall names what it cost', () => {
  test('the cap-hit modal reports the refused photos, in the units the user was working in', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&capwall=28');

    const wall = page.locator('.upgrade-modal');
    await expect(wall).toBeVisible();
    // The wall framing, not the warm first-value one.
    await expect(wall.getByText(/Your work outgrew the demo/i)).toBeVisible();
    // The whole point: the concrete loss, named.
    await expect(wall.getByText(/28 photos couldn't be added/i)).toBeVisible();
    await expect(wall.getByRole('button', { name: 'Get Creator' })).toBeVisible();
  });

  test('a single refused card reads as singular, never "1 photos"', async ({ page }) => {
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&capwall=1');
    await expect(page.locator('.upgrade-modal').getByText(/1 photo couldn't be added/i)).toBeVisible();
  });

  test('with nothing refused the modal says nothing about it', async ({ page }) => {
    // The generic/first-value pitches share this component; a count left over
    // from an earlier episode must never describe something that didn't happen.
    await page.goto('/?local=1&reset=1&tier=demo&onboarded=1&firstvalue=1');
    await page.locator('.fv-banner').getByRole('button', { name: 'See Creator' }).click();
    const m = page.locator('.upgrade-modal');
    await expect(m).toBeVisible();
    await expect(m.locator('.upgrade-caphit-lost')).toHaveCount(0);
  });
});

test.describe('the refused count reaches the wall (App.jsx-only path)', () => {
  test('syncCardIndex reports how many were refused AND what they were', () => {
    const s = boardsApi();
    // Without the per-kind tally the wall can only say "cards", which a user who
    // just dropped a folder of photos has to translate.
    expect(s).toMatch(/rejected: fresh\.length/);
    expect(s).toMatch(/kinds,/);
    expect(s).toMatch(/kinds\[k\] = \(kinds\[k\] \|\| 0\) \+ 1/);
  });

  test('the capped listener forwards the count instead of discarding it', () => {
    const s = app();
    expect(s).toMatch(/Number\(e\?\.detail\?\.rejected\)/);
    expect(s).toMatch(/rejected: nRejected/);
    expect(s).toMatch(/kinds: rejectedKinds/);
    // The collaborator branch is owed the same accounting, even though the fix
    // isn't theirs to make.
    expect(s).toMatch(/couldn't be added\. This cluster is at the owner's/);
  });

  test('the count is threaded to the modal and cleared with it', () => {
    const s = app();
    expect(s).toMatch(/rejected=\{upgradeReason === 'cap-hit' \? capRejected : null\}/);
    // A count from an earlier cap episode must not surface on the storage or
    // generic pitch, so closing clears it.
    expect(s).toMatch(/setUpgradeReason\(null\); setCapRejected\(null\)/);
    expect(modal()).toMatch(/rejected\?\.n > 0/);
  });

  test('the repeat-episode toast carries the number too', () => {
    // The modal is latched to once per limit, so every refusal after the first
    // is a toast — and it was the branch that said the least.
    expect(app()).toMatch(/more \$\{rejectedNoun\(cs\?\.kinds, rejected\)\} didn't fit/);
  });
});

test.describe('one upgrade surface at a time', () => {
  test('the wall claims the shared slot so the ambient surfaces stand down', () => {
    const s = app();
    expect(s).toMatch(/claimUpsellSlot\('cap-hit'\)/);
    // It claims BEFORE the once-per-limit latch returns, so the repeat-toast
    // path stands the other surfaces down too.
    expect(s.indexOf("claimUpsellSlot('cap-hit')"))
      .toBeLessThan(s.indexOf('capPitchedAtRef.current === limit'));
  });

  test('first-value stands down at the wall and behind another surface', () => {
    const s = chip();
    expect(s).toMatch(/atCapWall\(\{ demoCardCount, cardLimit \}\)/);
    expect(s).toMatch(/standDown\('cap_reached'\)/);
    expect(s).toMatch(/claimUpsellSlot\('first-value'\)/);
    expect(s).toMatch(/standDown\('slot_busy'\)/);
  });

  test('standing down NEVER burns the once-per-account one-shot', () => {
    // The dead-gate bug: stamping at a gate that declines retires the banner
    // for that account permanently, for everyone it declines.
    const s = chip();
    const stamp = s.indexOf('firedRef.current = true');
    expect(stamp).toBeGreaterThan(-1);
    for (const gate of ["standDown('cap_reached')", "standDown('slot_busy')"]) {
      expect(s.indexOf(gate)).toBeLessThan(stamp);
    }
    // …and the persisted stamp is downstream of the local one.
    expect(s.indexOf('first_value_shown_at: at')).toBeGreaterThan(stamp);
  });

  test('the QA cap-wall seam cannot reach production', () => {
    const s = read('src/lib/localMode.js');
    expect(s).toMatch(/export function qaForceCapWall/);
    // Same literal guard every other QA harness uses, so the bundler drops it.
    expect(s).toMatch(/qaForceCapWall[\s\S]{0,200}import\.meta\.env\.DEV/);
    // Bounded digits — an unbounded run is a free integer overflow (cf. 0198).
    expect(s).toMatch(/\^\\d\{1,4\}\$/);
  });
});
