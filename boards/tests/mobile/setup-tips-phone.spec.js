// The setup's tips and re-ask in the phone shell (?setupqa=1&inws=…): the
// first tip points at the menu button, Next opens the drawer for the other
// two, and however they end the drawer closes again. Opening the drawer by the
// button itself moves them on, and shutting it ends them. What they point at
// in the drawer is scrolled into sight, above the meter where it's pinned at
// the drawer's bottom. The re-ask is a
// bottom sheet whose field doesn't zoom iOS on focus. Runs on the phone
// projects and the portrait tablet, which App gives the same drawer.
import { test, expect } from '@playwright/test';

const T0 = new Date('2026-10-21T10:00:00Z');

async function open(page, query) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install({ time: T0 });
  await page.goto(`/?setupqa=1&fresh=1&drawer=0&${query}`);
  await expect(page.locator('html[data-inws-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  return errors;
}

const events = (page) => page.evaluate(() => window.__setupQa.events());
const pick = (list, name, match = {}) => list.filter((e) => e.event === name
  && Object.entries(match).every(([k, v]) => e.props?.[k] === v));
const settings = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__setupQa.db.profiles[0].settings)));
const hostLog = (page) => page.evaluate(() => [...window.__setupQa.inws.log]);
// A part of the drawer in sight: on screen, and above the meter where the
// meter is pinned at the drawer's bottom.
const inSight = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const r = el?.getBoundingClientRect();
  if (!r) return false;
  const meter = document.querySelector('.sidebar.is-mobile-open .sbf-meter');
  const to = meter && !meter.contains(el) && getComputedStyle(meter).position === 'sticky'
    ? meter.getBoundingClientRect().top : window.innerHeight;
  return r.top >= 0 && r.bottom <= to + 0.5;
}, sel);
const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width }; });

test('the tips start at the menu button, go on inside the drawer, and close it when done', async ({ page }) => {
  const errors = await open(page, 'inws=tips');
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  const tip = page.locator('.su-tip');
  const menu = page.locator('.topbar .tb-left .tb-icon[aria-label="Open menu"]');
  await page.clock.fastForward(16000);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });
  await expect(tip).toHaveClass(/is-phone/);
  await expect(tip).toContainText('Your clusters and files live here');
  await expect(menu).toHaveClass(/su-tip-target/);
  const t1 = await box(tip);
  expect(t1.top).toBeGreaterThanOrEqual((await box(menu)).bottom);
  expect(Math.round(t1.width)).toBe(vw - 24);
  expect(t1.left).toBeGreaterThanOrEqual(0);
  await expect(page.locator('.sidebar.is-mobile-open')).toHaveCount(0);

  await tip.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.sidebar.is-mobile-open')).toHaveCount(1);
  await expect(tip).toHaveAttribute('data-tip', 'files');
  await expect(tip).toContainText('Every file lands in Files');
  await expect(page.locator('.sidebar.is-mobile-open .sbf-files-head')).toHaveClass(/su-tip-target/, { timeout: 5000 });
  await expect.poll(() => inSight(page, '.sidebar.is-mobile-open .sbf-files-head')).toBe(true);
  await expect(menu).not.toHaveClass(/su-tip-target/);
  const t2 = await box(tip);
  expect(t2.top).toBeGreaterThanOrEqual(0);
  expect(t2.bottom).toBeLessThanOrEqual(vh);

  // Over the drawer and its backdrop, so its buttons are the ones tapped.
  await tip.getByRole('button', { name: 'Next' }).click();
  await expect(tip).toHaveAttribute('data-tip', 'import');
  await expect(tip).toContainText('Bring a whole folder in from a computer');
  // Upload, low in a long drawer, is brought into sight to be pointed at.
  await expect(page.locator('.sidebar.is-mobile-open .sbf-upload')).toHaveClass(/su-tip-target/, { timeout: 5000 });
  await expect.poll(() => inSight(page, '.sidebar.is-mobile-open .sbf-upload')).toBe(true);
  await expect(tip.locator('.su-tip-arrow')).toHaveCount(1);
  await tip.getByRole('button', { name: 'Done' }).click();
  await expect(tip).toHaveCount(0);
  await expect(page.locator('.sidebar.is-mobile-open')).toHaveCount(0);
  expect(await hostLog(page)).toEqual(['open', 'close']);
  expect((await settings(page)).setup_tips).toMatchObject({ done: true, last: 'import', action: 'done' });
  expect(errors).toEqual([]);
});

test('Skip on the first tip never opens the drawer', async ({ page }) => {
  await open(page, 'inws=tips');
  const tip = page.locator('.su-tip');
  await page.clock.fastForward(16000);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });
  await tip.getByRole('button', { name: 'Skip' }).click();
  await expect(tip).toHaveCount(0);
  await expect(page.locator('.sidebar.is-mobile-open')).toHaveCount(0);
  expect((await settings(page)).setup_tips).toMatchObject({ last: 'clusters', action: 'skip' });
});

test('the menu button itself moves the tips on, and shutting the drawer ends them', async ({ page }) => {
  const errors = await open(page, 'inws=tips');
  const vw = page.viewportSize().width;
  const vh = page.viewportSize().height;
  const tip = page.locator('.su-tip');
  await page.clock.fastForward(16000);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });
  await page.locator('.topbar .tb-left .tb-icon[aria-label="Open menu"]').click();
  await expect(page.locator('.sidebar.is-mobile-open')).toHaveCount(1);
  await expect(tip).toHaveAttribute('data-tip', 'files');
  await expect(page.locator('.sidebar.is-mobile-open .sbf-files-head')).toHaveClass(/su-tip-target/, { timeout: 5000 });

  // The strip of backdrop beside the drawer, clear of the tip.
  await page.locator('.sidebar-mobile-backdrop').click({ position: { x: vw - 6, y: Math.round(vh / 2) } });
  await expect(page.locator('.sidebar.is-mobile-open')).toHaveCount(0);
  await expect(tip).toHaveCount(0);
  await expect(page.locator('.su-tip-target')).toHaveCount(0);
  expect(await hostLog(page)).toEqual([]);   // the person opened and shut it, not the tips
  expect((await settings(page)).setup_tips).toMatchObject({ done: true, last: 'files', action: 'dismiss' });
  const ev = await events(page);
  expect(pick(ev, 'setup_tips', { action: 'view' }).map((e) => e.props.tip)).toEqual(['clusters', 'files']);
  expect(pick(ev, 'setup_tips', { action: 'drawer' }).map((e) => e.props.tip)).toEqual(['clusters']);
  expect(pick(ev, 'setup_tips', { action: 'next' })).toHaveLength(0);
  expect(pick(ev, 'setup_tips', { action: 'dismiss' })[0].props).toMatchObject({ tip: 'files', phone: true });
  expect(errors).toEqual([]);
});

test('the re-ask is a bottom sheet: share the link, then Done', async ({ page }) => {
  const errors = await open(page, 'inws=reask&setup=B');
  const sheet = page.getByRole('dialog', { name: /Northlight is taking shape/ });
  await expect(sheet).toBeVisible({ timeout: 10000 });
  await expect(sheet).toHaveClass(/is-phone/);
  const vh = page.viewportSize().height;
  // Where it comes to rest, once it has slid up.
  await expect.poll(async () => Math.round((await box(sheet)).bottom)).toBe(vh);
  // 16px or more, or iOS zooms the page onto the field when it's tapped.
  const size = await sheet.locator('.su-input').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(16);

  await sheet.getByRole('button', { name: /Share invite link/ }).click();
  await expect.poll(() => page.evaluate(() => window.__setupQa.shared.length)).toBe(1);
  await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);
  expect((await settings(page)).invite_reask).toMatchObject({ action: 'done', links: 1 });
  expect(errors).toEqual([]);
});
