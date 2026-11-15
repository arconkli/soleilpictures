// The desktop admin keeps the last visit's numbers in localStorage
// (lib/adminSnapshot.js, key adminSnap:<uid>:<key>) and paints them at once,
// marked "Updating…" until the fresh read lands. Driven in the dev-only fixture
// harness (?adminpreview=1, uid `preview`); &rpcdelay=<ms> holds every answer.

import { test, expect } from '@playwright/test';

const BASE = '/?adminpreview=1&tab=overview&view=overview';
const updating = (page) => page.locator('.admin-toolbar-updated', { hasText: 'Updating…' });
const values = (page) => page.locator('.admin-stat-value');

/** First visit: fresh numbers, nothing marked Updating…, and the snapshot written. */
async function firstVisit(page) {
  await page.goto(BASE);
  await expect(values(page).first()).not.toHaveText('—', { timeout: 20000 });
  await expect(updating(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(
    () => Object.keys(localStorage).filter((k) => k.startsWith('adminSnap:preview:')).length,
  ), { timeout: 10000 }).toBeGreaterThan(0);
}

test.describe('kept numbers on the computer admin', () => {
  test('the last visit\'s numbers paint before the network answers, marked Updating…', async ({ page }) => {
    await firstVisit(page);

    await page.goto(`${BASE}&rpcdelay=4000`);
    await expect(updating(page)).toBeVisible({ timeout: 1500 });
    await expect(values(page).first()).not.toHaveText('—', { timeout: 1500 });
    const shown = await values(page).allInnerTexts();
    expect(shown.filter((t) => t.trim() && t.trim() !== '—').length).toBeGreaterThan(0);

    await expect(updating(page)).toHaveCount(0, { timeout: 15000 });
    await expect(values(page).first()).not.toHaveText('—');
  });

  test('fresh numbers that replace the kept ones are not announced as new', async ({ page }) => {
    await firstVisit(page);

    // Make the kept overview read 3 signups lower than what the harness will
    // answer, so the swap to fresh numbers is a rise of 3 on the first tile.
    // It is done by a script that runs before the reload's own, because the
    // page still open can write its snapshot again over an edit made in it.
    await page.addInitScript(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('adminSnap:preview:overview.q:'));
      const snap = k ? JSON.parse(localStorage.getItem(k)) : null;
      const cur = snap?.data?.kpi?.current;
      if (!cur || typeof cur.signups !== 'number') { window.__lowered = false; return; }
      cur.signups -= 3;
      localStorage.setItem(k, JSON.stringify(snap));
      window.__lowered = true;
    });

    await page.goto(`${BASE}&rpcdelay=2000`);
    expect(await page.evaluate(() => window.__lowered)).toBe(true);
    await expect(updating(page)).toBeVisible({ timeout: 1500 });
    await expect(updating(page)).toHaveCount(0, { timeout: 15000 });
    await page.waitForTimeout(3000);
    // Counted once, not retried: a chip lives 8 s, so a retrying assertion
    // would wait it out and pass.
    expect(await page.locator('.adm-live-chip').count()).toBe(0);
  });
});
