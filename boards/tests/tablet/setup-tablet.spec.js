// The first-run setup on a tablet held sideways (?setupqa=1): the desktop
// layout with a finger for a pointer. Its fields stay at 16px or more, or iOS
// zooms the page onto them; the tips keep clear of the whole sidebar, whose
// two cards stand side by side here; the re-ask is the centred card.
import { test, expect } from '@playwright/test';

const T0 = new Date('2026-10-21T10:00:00Z');

async function open(page, query) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: T0 });
  await page.goto(`/?setupqa=1&fresh=1&${query}`);
  await expect(page.locator('html[data-setupqa-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  return errors;
}

const fontPx = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test('the setup steps by touch, with fields iOS won\'t zoom onto', async ({ page }) => {
  const errors = await open(page, 'setup=B');
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.su')).not.toHaveClass(/is-phone/);
  const name = page.getByLabel('Workspace name');
  expect(await fontPx(name)).toBeGreaterThanOrEqual(16);
  await name.fill('Lost Time');
  await page.getByRole('button', { name: 'Continue' }).tap();
  await expect(page.getByRole('heading', { name: 'Tell us about Lost Time' })).toBeVisible();
  await page.getByRole('button', { name: 'A few people' }).tap();
  await page.getByRole('button', { name: 'Film & video' }).tap();
  await page.getByRole('button', { name: 'Continue' }).tap();
  await expect(page.getByRole('button', { name: 'Skip for now' })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
  const email = page.locator('.su-email').first();
  expect(await fontPx(email)).toBeGreaterThanOrEqual(16);
  await page.getByRole('button', { name: 'Skip for now' }).tap();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 10000 });
  expect(errors).toEqual([]);
});

test('the tips keep clear of the whole sidebar, and the ring says which card', async ({ page }) => {
  const errors = await open(page, 'inws=tips');
  await expect(page.locator('html[data-inws-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  const tip = page.locator('.su-tip');
  await page.clock.fastForward(16000);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });
  await expect(tip).not.toHaveClass(/is-phone/);
  await expect(page.locator('.sbf-card.is-tree')).toHaveClass(/su-tip-target/);
  const frame = await box(page.locator('.sbf-frame'));
  expect((await box(tip)).left).toBeGreaterThanOrEqual(frame.right);
  // Its words sit beside the spark on one row, not under it.
  const spark = await box(tip.locator('.onboarding-coachmark-spark'));
  const title = await box(tip.locator('.onboarding-coachmark-title'));
  expect(title.left).toBeGreaterThan(spark.right);

  await tip.getByRole('button', { name: 'Next' }).tap();
  await expect(tip).toHaveAttribute('data-tip', 'files');
  await expect(page.locator('.sbf-card.is-files')).toHaveClass(/su-tip-target/);
  await expect(tip.locator('.su-tip-arrow')).toHaveCount(1);   // the files card is the sidebar's edge
  await tip.getByRole('button', { name: 'Next' }).tap();
  await expect(tip).toHaveAttribute('data-tip', 'import');
  await tip.getByRole('button', { name: 'Done' }).tap();
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the re-ask is the centred card, its field at 16px', async ({ page }) => {
  await open(page, 'inws=reask&setup=B');
  const dialog = page.getByRole('dialog', { name: /Northlight is taking shape/ });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog).not.toHaveClass(/is-phone/);
  expect(await fontPx(dialog.locator('.su-input').first())).toBeGreaterThanOrEqual(16);
  await dialog.getByRole('button', { name: 'Not now' }).tap();
  await expect(dialog).toHaveCount(0);
});
