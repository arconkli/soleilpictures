// The first-run setup on a phone and on a tablet held upright (?setupqa=1, see
// tests/setup-flow.spec.js for the harness). A phone shares the invite link
// through its own share sheet, and closing the sheet still counts as out; with
// no sheet the button copies and says so; a tablet gets the computer's Copy
// link. Neither scrolls sideways.
import { test, expect } from '@playwright/test';

const PHONE_MAX = 640;   // hooks/useBreakpoint.js

async function open(page, query) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?setupqa=1&fresh=1&${query}`);
  await expect(page.locator('html[data-setupqa-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  return errors;
}

const events = (page) => page.evaluate(() => window.__setupQa.events());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function toInvite(page) {
  await expect(page.getByRole('heading', { name: 'Name your workspace' })).toBeVisible({ timeout: 20000 });
  expect(await noSideScroll(page)).toBe(true);
  await page.getByLabel('Workspace name').fill('Lost Time');
  await page.getByRole('button', { name: 'Continue' }).tap();
  await expect(page.getByRole('heading', { name: 'Tell us about Lost Time' })).toBeVisible();
  await page.getByRole('button', { name: 'Just me' }).tap();
  await page.getByRole('button', { name: 'Photo' }).tap();
  expect(await noSideScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Continue' }).tap();
  await expect(page.getByRole('heading', { name: 'Want a second pair of eyes?' })).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
}

test('on a phone the link goes out through the share sheet, then the workspace opens', async ({ page, viewport }) => {
  test.skip(viewport.width > PHONE_MAX, 'phones only');
  const errors = await open(page, 'setup=B');
  await toInvite(page);
  await expect(page.getByRole('button', { name: 'Copy link' })).toHaveCount(0);
  const share = page.getByRole('button', { name: 'Share invite link' });
  await expect(share).toBeEnabled();
  await share.tap();
  const shared = await page.evaluate(() => window.__setupQa.shared);
  expect(shared).toHaveLength(1);
  expect(shared[0].title).toBe('Join Lost Time on Clusters');
  expect(shared[0].url).toMatch(/\/\?wsjoin=[0-9a-f-]{36}$/);

  const open_ = page.getByRole('button', { name: 'Open Lost Time' });
  await expect(open_).toBeInViewport();
  await open_.tap();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 15000 });
  const ev = await events(page);
  expect(ev.filter((e) => e.event === 'workspace_link_shared' && e.props.method === 'share' && e.props.completed === true)).toHaveLength(1);
  expect(ev.find((e) => e.event === 'setup_done')?.props).toMatchObject({ phone: true, team: 'solo', work: 'photo', invite: 'sent', links: 1 });
  expect(errors).toEqual([]);
});

test('on a phone, closing the share sheet still moves them on', async ({ page, viewport }) => {
  test.skip(viewport.width > PHONE_MAX, 'phones only');
  await open(page, 'setup=B&share=cancel');
  await toInvite(page);
  await page.getByRole('button', { name: 'Share invite link' }).tap();
  await expect(page.getByRole('button', { name: 'Open Lost Time' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
  const ev = await events(page);
  expect(ev.filter((e) => e.event === 'workspace_link_shared' && e.props.method === 'share' && e.props.completed === false)).toHaveLength(1);
});

test('on a phone with no share sheet, the button copies the link and says so', async ({ page, viewport }) => {
  test.skip(viewport.width > PHONE_MAX, 'phones only');
  const errors = await open(page, 'setup=B&share=none');
  await toInvite(page);
  await page.getByRole('button', { name: 'Share invite link' }).tap();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const clip = await page.evaluate(() => window.__setupQa.clipboard);
  expect(clip).toHaveLength(1);
  expect(clip[0]).toMatch(/\/\?wsjoin=[0-9a-f-]{36}$/);
  await expect(page.getByRole('button', { name: 'Open Lost Time' })).toBeVisible();
  const ev = await events(page);
  expect(ev.filter((e) => e.event === 'workspace_link_shared' && e.props.method === 'copy' && e.props.ok === true)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('on a phone where copying is refused too, the link is shown to press and hold', async ({ page, viewport }) => {
  test.skip(viewport.width > PHONE_MAX, 'phones only');
  const errors = await open(page, 'setup=B&share=none&clip=fail');
  await toInvite(page);
  await page.getByRole('button', { name: 'Share invite link' }).tap();
  const field = page.getByRole('textbox', { name: 'Invite link' });
  await expect(field).toBeVisible();
  await expect(field).toHaveValue(/\/\?wsjoin=[0-9a-f-]{36}$/);
  await expect(page.locator('.su-linknote')).toContainText('Press and hold the link to copy it.');
  await expect(page.getByRole('button', { name: 'Copied' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Lost Time' })).toHaveCount(0);
  // 16px, so focusing it never zooms the page.
  expect(await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await noSideScroll(page)).toBe(true);

  await field.dispatchEvent('copy');
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Lost Time' })).toBeVisible();
  const ev = await events(page);
  expect(ev.filter((e) => e.event === 'workspace_link_shared' && e.props.ok === false)).toHaveLength(1);
  expect(ev.filter((e) => e.event === 'workspace_link_shared' && e.props.by === 'hand')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('on a phone, the email limit points at sharing the link', async ({ page, viewport }) => {
  test.skip(viewport.width > PHONE_MAX, 'phones only');
  await open(page, 'setup=B&resume=invite&invitelimit=0');
  await expect(page.getByRole('heading', { name: 'Invite the people you work with' })).toBeVisible({ timeout: 20000 });
  await page.getByLabel('Email address').fill('ana@studio.com');
  await page.getByRole('button', { name: 'Send invite' }).tap();
  await expect(page.locator('.su-note')).toContainText('Share the invite link for everyone else.');
  expect(await noSideScroll(page)).toBe(true);
});

test('on a tablet the link is copied, as on a computer', async ({ page, viewport }) => {
  test.skip(viewport.width <= PHONE_MAX, 'tablets only');
  const errors = await open(page, 'setup=B');
  await toInvite(page);
  await expect(page.getByRole('button', { name: 'Share invite link' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy link' }).tap();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  await page.getByRole('button', { name: 'Open Lost Time' }).tap();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 15000 });
  expect(errors).toEqual([]);
});

test('someone joining from a link on a phone gets the one step', async ({ page }) => {
  await open(page, 'setup=B&invitee=1');
  await expect(page.getByRole('heading', { name: 'You’re joining Lost Time' })).toBeVisible({ timeout: 20000 });
  expect(await noSideScroll(page)).toBe(true);
  const go = page.getByRole('button', { name: 'Open Lost Time' });
  await go.scrollIntoViewIfNeeded();
  await go.tap();
  await expect(page.getByTestId('qa-app')).toBeVisible({ timeout: 15000 });
});
