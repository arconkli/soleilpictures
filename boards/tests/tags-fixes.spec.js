// Runtime checks for the tags / entities / feedback audit fixes that can be
// exercised without a live Supabase. Components are mounted on their own by
// tests/helpers/tagsProbe.js (served by the dev server), on top of the
// ?local=1&blank=1 shell so the page has the app's styles.
import { expect, test } from '@playwright/test';

async function probe(page, fn, ...args) {
  await page.evaluate(async ({ fn, args }) => {
    const m = await import('/tests/helpers/tagsProbe.js');
    m[fn](...args);
  }, { fn, args });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
});

test('TAGS-13: Escape while feedback is sending keeps the modal, and a failed send is shown', async ({ page }) => {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/functions/v1/send-feedback', async (route) => {
    await held;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'probe failure' }) });
  });
  await probe(page, 'mountFeedback');

  await page.locator('.feedback-trigger').click();
  const modal = page.locator('.feedback-modal');
  await expect(modal).toBeVisible();
  await page.locator('.feedback-kind').first().click();
  await modal.locator('.btn-primary').click();
  await expect(modal.locator('.btn-primary')).toHaveText('Sending…');

  await page.keyboard.press('Escape');
  await expect(modal, 'Escape must not close the modal mid-send').toBeVisible();

  release();
  await expect(modal.locator('.feedback-error')).toContainText('probe failure');
  // Once the send has settled, Escape works again.
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});
