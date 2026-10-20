// The top of a cluster's Files while the import that made it waits for room
// (components/ImportWaitRow.jsx, mockup r5-Land-Wait), on the import QA page
// (?importqa=1&row=1): its words are importCopy.waitRowCopy's, and its one
// step is the tray's own, through the same entry's act(id).
import { expect, test } from '@playwright/test';

async function open(page, state) {
  const acts = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[importqa] act ')) acts.push(t.slice('[importqa] act '.length));
  });
  await page.goto(`/?importqa=1&row=1&state=${state}`);
  await page.waitForSelector('[data-importqa-ready]');
  return acts;
}
const row = (page) => page.locator('.sbf-card.is-files .imptray-waitrow');

test('a free plan that is full: how many, why, and the tray\'s own trial step', async ({ page }) => {
  const acts = await open(page, 'wait-free');
  await expect(row(page)).toHaveAttribute('role', 'status');
  await expect(row(page).locator('.imptray-waitrow-t')).toHaveText('52 waiting for room');
  await expect(row(page).locator('.imptray-waitrow-s')).toHaveText(
    'The rest of Camera tests. Your free plan is full; with this tab open they come in by themselves once there’s room.',
  );
  const step = row(page).getByRole('button');
  const trayStep = page.locator('.imptray .imptray-wait .imptray-btn.is-primary');
  await expect(step).toHaveText(await trayStep.innerText());
  await step.click();
  await expect.poll(() => acts).toEqual(['upgrade']);
});

test('a paid drive that is full offers the add-on, as the tray does', async ({ page }) => {
  const acts = await open(page, 'wait-storage-paid');
  await expect(row(page).locator('.imptray-waitrow-s')).toContainText('Your drive is full;');
  await row(page).getByRole('button').click();
  await expect.poll(() => acts).toEqual(['addon']);
});

test('someone else\'s full plan: no step to take, only why', async ({ page }) => {
  await open(page, 'wait-guest');
  await expect(row(page).locator('.imptray-waitrow-s')).toHaveText(
    'The rest of Camera tests. Maya Ortiz’s plan is full; with this tab open they come in by themselves once there’s room.',
  );
  await expect(row(page).getByRole('button')).toHaveCount(0);
});

test('an import still uploading has files to come but nothing waiting for room: no row', async ({ page }) => {
  await open(page, 'run');
  await expect(page.locator('.imptray')).toBeVisible();
  await expect(row(page)).toHaveCount(0);
});

test('the row fits the narrowest Files card without spilling sideways', async ({ page }) => {
  await open(page, 'wait-free');
  const card = page.locator('.sbf-card.is-files');
  await card.evaluate((el) => { el.style.width = '232px'; });
  const box = await row(page).boundingBox();
  const cardBox = await card.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
  expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
  const btn = await row(page).getByRole('button').boundingBox();
  expect(btn.x + btn.width).toBeLessThanOrEqual(box.x + box.width);
});
