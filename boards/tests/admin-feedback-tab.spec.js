// The admin Feedback tab — the surface where everything anyone tells us lands.
//
// It had no coverage, which mattered more than usual here: the tab is the only
// place a return answer or an attached screenshot is ever read, and BOTH were
// broken in ways no test could see. Return answers never reached the table at
// all (the CHECK forbade their kind — see src/lib/feedbackContract.test.mjs),
// and every screenshot the feedback widget has stored since 0095 was omitted
// from the list RPC's return type, so no surface in the product had ever
// rendered one.
//
// Drives the DEV-only fixture harness (?adminpreview=1) — no auth, no network.
// Both themes, because light is where this surface has historically broken.

import { test, expect } from '@playwright/test';

const THEMES = ['light', 'dark'];

async function openTab(page, theme) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript((t) => { try { localStorage.setItem('soleil.theme', t); } catch (_) {} }, theme);
  await page.goto('/admin?adminpreview=1&tab=feedback');
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await page.locator('.fbk-row').first().waitFor({ timeout: 20000 });
  return errors;
}

for (const theme of THEMES) {
  test(`the tab renders both sources in ${theme}`, async ({ page }) => {
    const errors = await openTab(page, theme);

    // Both writers are represented: the widget and the return question.
    const kinds = await page.locator('.fbk-kind').allInnerTexts();
    expect(kinds.some((k) => k.trim() === 'bug')).toBe(true);
    expect(kinds.some((k) => k.trim() === 'return')).toBe(true);

    // ONE indicator per row. A return row used to carry two filled pills side
    // by side, which made the labels louder than the message under them.
    for (const row of await page.locator('.fbk-row').all()) {
      expect(await row.locator('.fbk-kind').count()).toBe(1);
    }

    // The message must be the loudest thing in its row, not the filing.
    const msg = page.locator('.fbk-msg').first();
    const size = (el) => el.evaluate((n) => parseFloat(getComputedStyle(n).fontSize));
    expect(await size(msg)).toBeGreaterThan(await size(page.locator('.fbk-meta').first()));

    // And set to a readable measure rather than across the whole panel.
    const width = await msg.evaluate((n) => n.getBoundingClientRect().width);
    expect(width, 'the reading column must stay narrow').toBeLessThan(760);

    expect(errors, `console errors in ${theme}`).toEqual([]);
  });
}

test('a screenshot can actually be looked at', async ({ page }) => {
  const errors = await openTab(page, 'dark');

  // The affordance must exist for an image-only row too: gating expansion on
  // message length alone left the picture unreachable.
  const row = page.locator('.fbk-row').filter({ hasText: 'screenshot' }).first();
  await expect(row).toHaveClass(/is-openable/);
  await row.click();

  const shot = page.locator('.fbk-shot');
  await expect(shot).toBeVisible({ timeout: 10000 });
  // Rendered, not merely present — a 1x1 placeholder satisfies toBeVisible.
  const box = await shot.boundingBox();
  expect(box.width).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test('answers to the return question are filterable and counted', async ({ page }) => {
  const errors = await openTab(page, 'dark');

  const options = await page.locator('.admin-filter-select option').allInnerTexts();
  expect(options, 'a kind the table can store must be askable for')
    .toContain('return_reason');

  await page.selectOption('.admin-filter-select', 'return_reason');
  await expect(page.locator('.fbk-tally')).toBeVisible({ timeout: 10000 });
  expect(await page.locator('.fbk-tally-item').count()).toBeGreaterThan(0);

  // Every row on screen is now a return answer, and each names its choice.
  for (const row of await page.locator('.fbk-row').all()) {
    await expect(row.locator('.fbk-kind')).toHaveText('return');
    expect(await row.locator('.fbk-choice').count()).toBe(1);
  }
  expect(errors).toEqual([]);
});

test('a message the server wrote is not presented as something a person typed', async ({ page }) => {
  await openTab(page, 'dark');
  await page.selectOption('.admin-filter-select', 'return_reason');
  await page.locator('.fbk-tally').waitFor({ timeout: 10000 });

  // Someone who tapped an answer and skipped the follow-up has a message column
  // holding OUR label for their choice. The privacy page calls this field
  // "written text you chose to send", and the GDPR export ships it verbatim, so
  // it has to be visibly distinguishable from prose.
  const filler = page.locator('.fbk-msg.is-filler').first();
  await expect(filler).toBeVisible();
  await expect(filler).toContainText('wrote nothing');
  expect(await filler.evaluate((n) => getComputedStyle(n).fontStyle)).toBe('italic');

  const prose = page.locator('.fbk-msg:not(.is-filler)').first();
  expect(await prose.evaluate((n) => getComputedStyle(n).fontStyle)).toBe('normal');
});
