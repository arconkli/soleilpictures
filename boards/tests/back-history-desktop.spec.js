// A computer with a mouse keeps the history it has always had.
//
// Under a finger each cluster visited is a browser history entry and Back
// returns to it (tests/mobile/back-history.spec.js). With a mouse nothing
// changed: opening clusters writes no entries and no state, the toolbar's
// Back and Forward walk the in-app history on their own, the dialogs that
// gained a Back layer on touch add nothing here, and the browser's Back
// leaves the page as it always did.

import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from './helpers/signedInStub.js';

const ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const created = '2026-10-01T00:00:00Z';
const board = (id, name, parent) => ({
  id, workspace_id: WS_ID, parent_board_id: parent, deleted_at: null, name,
  kind: 'canvas', created_by: USER_ID, created_at: created,
});
const BOARDS = [board(ROOT_ID, 'Studio', null), board(ALPHA, 'Alpha', ROOT_ID), board(BETA, 'Beta', ALPHA)];

const hist = (page) => page.evaluate(() => ({ length: window.history.length, state: window.history.state }));
const onCluster = (page, name) => expect(page).toHaveTitle(new RegExp(`^${name} — `), { timeout: 15000 });

// A cluster by name through Search (⌘K), with the mouse.
async function openBySearch(page, name) {
  await page.keyboard.press('ControlOrMeta+k');
  await page.locator('.cmdk-input').fill(name);
  await page.locator('.cmdk-row', { hasText: name }).first().click();
  await expect(page.locator('.cmdk')).toHaveCount(0);
  await onCluster(page, name);
}

test('opening clusters with a mouse adds no history entries, and the browser\'s Back leaves as before', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
    rest: { boards: BOARDS },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await onCluster(page, 'Studio');
  const start = await hist(page);
  expect(start.state?.soleilNav).toBeUndefined();

  await openBySearch(page, 'Alpha');
  await openBySearch(page, 'Beta');
  let now = await hist(page);
  expect(now.length).toBe(start.length);
  expect(now.state).toEqual(start.state);

  // The toolbar's Back and Forward are the in-app history, as before.
  const backBtn = page.getByRole('button', { name: 'Back', exact: true });
  const fwdBtn = page.getByRole('button', { name: 'Forward', exact: true });
  await backBtn.click();
  await onCluster(page, 'Alpha');
  await backBtn.click();
  await onCluster(page, 'Studio');
  await expect(backBtn).toBeDisabled();
  await fwdBtn.click();
  await onCluster(page, 'Alpha');
  now = await hist(page);
  expect(now.length).toBe(start.length);
  expect(now.state).toEqual(start.state);

  // Share (a Modal) takes a Back layer on touch only.
  await page.locator('.tb-share').click();
  await expect(page.locator('.share-modal')).toBeVisible();
  now = await hist(page);
  expect(now.length).toBe(start.length);
  expect(now.state).toEqual(start.state);
  await page.keyboard.press('Escape');
  await expect(page.locator('.share-modal')).toHaveCount(0);

  // The browser's Back: out of the app, to the page before it.
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});
