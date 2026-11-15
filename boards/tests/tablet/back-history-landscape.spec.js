// A landscape iPad has the desktop layout under a finger: its toolbar shows
// Back and Forward. There they go through the browser's history, the same
// list the edge swipe walks (lib/modalGuard.js; App.jsx navHistStep), so the
// buttons and the gesture never disagree.

import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';

const ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const created = '2026-10-01T00:00:00Z';
const board = (id, name, parent) => ({
  id, workspace_id: WS_ID, parent_board_id: parent, deleted_at: null, name,
  kind: 'canvas', created_by: USER_ID, created_at: created,
});
const BOARDS = [board(ROOT_ID, 'Studio', null), board(ALPHA, 'Alpha', ROOT_ID), board(BETA, 'Beta', ALPHA)];

const onCluster = (page, name) => expect(page).toHaveTitle(new RegExp(`^${name} — `), { timeout: 15000 });
const entries = (page) => page.evaluate(() => window.history.length);

async function openBySearch(page, name) {
  await page.locator('.sb-mid-search').tap();
  await page.locator('.cmdk-input').fill(name);
  await page.locator('.cmdk-row', { hasText: name }).first().tap();
  await expect(page.locator('.cmdk')).toHaveCount(0);
  await onCluster(page, name);
}

async function boot(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
    rest: { boards: BOARDS },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await onCluster(page, 'Studio');
}

test('the toolbar\'s Back closes docked Messages and goes to the cluster before in one tap', async ({ page }) => {
  await boot(page);
  await openBySearch(page, 'Alpha');
  await openBySearch(page, 'Beta');
  await page.locator('.sbf-quickbtn', { hasText: 'Messages' }).tap();
  await expect(page.locator('.msg-panel')).toBeVisible();
  await onCluster(page, 'Beta');
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await onCluster(page, 'Alpha');
  await expect(page.locator('.msg-panel')).toHaveCount(0);
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/$/);
  // Nothing was skipped: the next Back is the place before Alpha.
  await page.goBack();
  await onCluster(page, 'Studio');
});

test('the toolbar\'s Back and Forward and the browser\'s walk one history', async ({ page }) => {
  await boot(page);
  const start = await entries(page);
  const backBtn = page.getByRole('button', { name: 'Back', exact: true });
  const fwdBtn = page.getByRole('button', { name: 'Forward', exact: true });
  await expect(backBtn).toBeDisabled();

  await openBySearch(page, 'Alpha');
  await openBySearch(page, 'Beta');
  expect(await entries(page)).toBe(start + 2);

  // The button, then the browser, then the button again: one list.
  await backBtn.tap();
  await onCluster(page, 'Alpha');
  await page.goBack();
  await onCluster(page, 'Studio');
  await expect(backBtn).toBeDisabled();
  await expect(page).toHaveURL(/^http:\/\/[^/]+\/$/);
  await fwdBtn.tap();
  await onCluster(page, 'Alpha');
  await page.goForward();
  await onCluster(page, 'Beta');
  await expect(fwdBtn).toBeDisabled();
  expect(await entries(page)).toBe(start + 2);

  // A panel opened after going back drops what was forward, in both.
  await backBtn.tap();
  await onCluster(page, 'Alpha');
  await expect(fwdBtn).toBeEnabled();
  await page.locator('.tb-share').tap();
  await expect(page.locator('.share-modal')).toBeVisible();
  await page.goBack();
  await expect(page.locator('.share-modal')).toHaveCount(0);
  await onCluster(page, 'Alpha');
  await expect(fwdBtn).toBeDisabled();
});
