// The setup's part inside the workspace (components/setup/SetupInWorkspace),
// against ?setupqa=1&inws=…: the real host, tips and re-ask over the real
// sidebar (SidebarQaHarness), with the setup harness's fake keeping the
// profile writes and the analytics rows. The clock is Playwright's, so the
// quiet the tips wait for is skipped rather than waited out.
//
// Covers: the three tips pointing at the clusters, Files and Upload; when
// they're due (quiet, something on the board, nothing uploading); how they
// end and the once-ever record; the import tip without the guide; the one
// invite re-ask (who gets it, what it shows, how it ends, once ever) and that
// it goes before the tips; and where a link joiner landed.
import { test, expect } from '@playwright/test';

const T0 = new Date('2026-10-21T10:00:00Z');

async function open(page, query, { reload = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (!reload) await page.clock.install({ time: T0 });
  await page.goto(`/?setupqa=1${reload ? '' : '&fresh=1'}&${query}`);
  await expect(page.locator('html[data-setupqa-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('[data-sidebarqa-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator('html[data-inws-ready="1"]')).toHaveCount(1, { timeout: 20000 });
  return errors;
}

const events = (page) => page.evaluate(() => window.__setupQa.events());
const settings = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__setupQa.db.profiles[0].settings)));
const hostLog = (page) => page.evaluate(() => [...window.__setupQa.inws.log]);
const pick = (list, name, match = {}) => list.filter((e) => e.event === name
  && Object.entries(match).every(([k, v]) => e.props?.[k] === v));
const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });

// The quiet the tips wait for.
async function quiet(page, ms = 16000) {
  await page.clock.fastForward(ms);
}

test('three tips point at the clusters, Files and Upload, and See how opens the guide', async ({ page }) => {
  const errors = await open(page, 'inws=tips');
  const tip = page.locator('.su-tip');
  await page.clock.fastForward(5000);
  await expect(tip).toHaveCount(0);           // still in the quiet

  await quiet(page, 11000);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });
  await expect(tip).toContainText('Your clusters live here');
  await expect(tip).toContainText('Once you’ve added a few things, start one for each project, scene or client.');
  await expect(tip).toContainText('1 of 3');
  const tree = page.locator('.sbf-card.is-tree');
  await expect(tree).toHaveClass(/su-tip-target/);
  // Beside the clusters' card, not over it, and inside the window.
  const [t1, a1] = [await box(tip), await box(tree)];
  expect(t1.left).toBeGreaterThanOrEqual(a1.right);
  expect(t1.bottom).toBeLessThanOrEqual(800);
  await expect(tip).toHaveClass(/at-right/);

  await tip.getByRole('button', { name: 'Next' }).click();
  await expect(tip).toHaveAttribute('data-tip', 'files');
  await expect(tip).toContainText('Drop any file, or paste a link');
  await expect(tip).toContainText('Paste a link from any tab onto the board and it becomes a card.');
  await expect(page.locator('.sbf-card.is-files')).toHaveClass(/su-tip-target/);
  await expect(tree).not.toHaveClass(/su-tip-target/);
  expect((await box(tip)).left).toBeGreaterThanOrEqual((await box(page.locator('.sbf-card.is-files'))).right);

  await tip.getByRole('button', { name: 'Next' }).click();
  await expect(tip).toHaveAttribute('data-tip', 'import');
  await expect(tip).toContainText('Coming from Google Drive or Dropbox?');
  await expect(tip).toContainText('3 of 3');
  await expect(tip.getByRole('button', { name: 'Skip' })).toHaveCount(0);
  await expect(page.locator('.sbf-upload')).toHaveClass(/su-tip-target/);
  await tip.getByRole('button', { name: /See how/ }).click();

  await expect(tip).toHaveCount(0);
  await expect(page.locator('.su-tip-target')).toHaveCount(0);
  expect(await hostLog(page)).toEqual(['guide']);
  const rec = (await settings(page)).setup_tips;
  expect(rec).toMatchObject({ v: 1, done: true, last: 'import', action: 'how' });
  const ev = await events(page);
  expect(pick(ev, 'setup_tips', { action: 'view' }).map((e) => e.props.tip)).toEqual(['clusters', 'files', 'import']);
  expect(pick(ev, 'setup_tips', { action: 'next' }).map((e) => e.props.tip)).toEqual(['clusters', 'files']);
  expect(pick(ev, 'setup_tips', { action: 'how' })).toHaveLength(1);
  expect(pick(ev, 'setup_tips', { action: 'how' })[0].props).toMatchObject({ tip: 'import', cards: 3, phone: false });

  // Once ever: not on the next visit, on the profile's record alone.
  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('soleil.setup.')) localStorage.removeItem(k); });
  await open(page, 'inws=tips', { reload: true });
  await quiet(page, 30000);
  await page.waitForTimeout(500);
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Skip ends them where they are; an empty board and an upload in flight hold them back', async ({ page }) => {
  await open(page, 'inws=tips&cards=0');
  const tip = page.locator('.su-tip');
  await quiet(page, 30000);
  await page.waitForTimeout(300);
  await expect(tip).toHaveCount(0);           // nothing on the board yet

  // A card lands: the quiet starts from it. An upload starting holds them.
  await page.evaluate(() => window.__setupQa.inws.setCards(2));
  await page.clock.fastForward(10000);
  await page.evaluate(() => window.__setupQa.inws.setUploading(true));
  await quiet(page, 30000);
  await page.waitForTimeout(300);
  await expect(tip).toHaveCount(0);
  await page.evaluate(() => window.__setupQa.inws.setUploading(false));
  await page.clock.fastForward(10000);
  await page.waitForTimeout(300);
  await expect(tip).toHaveCount(0);           // the quiet restarts when it ends
  await quiet(page, 6000);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });

  await tip.getByRole('button', { name: 'Skip' }).click();
  await expect(tip).toHaveCount(0);
  expect((await settings(page)).setup_tips).toMatchObject({ done: true, last: 'clusters', action: 'skip' });
  expect(pick(await events(page), 'setup_tips', { action: 'skip' })[0].props).toMatchObject({ tip: 'clusters', cards: 2 });
});

test('without the import guide the last tip says to unzip and ends on Done', async ({ page }) => {
  await open(page, 'inws=tips&import=0');
  const tip = page.locator('.su-tip');
  await quiet(page);
  await expect(tip).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });
  await tip.getByRole('button', { name: 'Next' }).click();
  await tip.getByRole('button', { name: 'Next' }).click();
  await expect(tip).toContainText('Download the folder, unzip it, and drop its files here. They land in Files.');
  await expect(tip.getByRole('button', { name: /See how/ })).toHaveCount(0);
  await tip.getByRole('button', { name: 'Done' }).click();
  await expect(tip).toHaveCount(0);
  expect(await hostLog(page)).toEqual([]);
  expect((await settings(page)).setup_tips).toMatchObject({ done: true, last: 'import', action: 'done' });
});

test('the re-ask: their pictures, the link first, Not now, and never again', async ({ page }) => {
  const errors = await open(page, 'inws=reask&setup=B');
  const dialog = page.getByRole('dialog', { name: /Northlight is taking shape/ });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await expect(dialog.getByRole('heading')).toHaveText('Northlight is taking shape.Who should see it?');
  await expect(dialog).toContainText('Send a collaborator or a client the link. They see what you add, as you add it.');
  await expect(dialog.locator('.su-ra-pic img')).toHaveCount(5);
  await expect(dialog.getByRole('button', { name: 'Not now' })).toBeVisible();
  // The tips wait while it's up.
  await quiet(page, 30000);
  await expect(page.locator('.su-tip')).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Not now' }).click();
  await expect(dialog).toHaveCount(0);
  const rec = (await settings(page)).invite_reask;
  expect(rec).toMatchObject({ v: 1, action: 'not_now', emails: 0, links: 0 });
  const ev = await events(page);
  expect(pick(ev, 'invite_reask', { action: 'view' })[0].props).toMatchObject({ cards: 6, phone: false });
  expect(pick(ev, 'invite_reask', { action: 'not_now' })).toHaveLength(1);

  // The tips get a quiet of their own after it, then come.
  await page.clock.fastForward(5000);
  await page.waitForTimeout(300);
  await expect(page.locator('.su-tip')).toHaveCount(0);
  await quiet(page, 12000);
  await expect(page.locator('.su-tip')).toHaveAttribute('data-tip', 'clusters', { timeout: 10000 });

  await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('soleil.setup.')) localStorage.removeItem(k); });
  await open(page, 'inws=reask&setup=B', { reload: true });
  await page.clock.fastForward(10000);
  await page.waitForTimeout(500);
  await expect(page.getByRole('dialog', { name: /taking shape/ })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the re-ask waits for six cards, and a copied link turns Not now into Done', async ({ page }) => {
  await open(page, 'inws=reask&setup=B&cards=5');
  const dialog = page.getByRole('dialog', { name: /taking shape/ });
  await page.clock.fastForward(10000);
  await page.waitForTimeout(300);
  await expect(dialog).toHaveCount(0);
  await page.evaluate(() => window.__setupQa.inws.setCards(6));
  await page.clock.fastForward(2000);
  await page.waitForTimeout(200);
  await expect(dialog).toHaveCount(0);        // a beat after the card that tipped it
  await page.clock.fastForward(3000);
  await expect(dialog).toBeVisible({ timeout: 10000 });

  await dialog.getByRole('button', { name: /Copy/ }).click();
  await expect(dialog.getByRole('button', { name: 'Done' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await settings(page)).invite_reask).toMatchObject({ action: 'done', links: 1, emails: 0 });
  const done = pick(await events(page), 'invite_reask', { action: 'done' });
  expect(done[0].props).toMatchObject({ links: 1, emails: 0, cards: 6 });
});

test('the re-ask is only for arm B and someone who skipped the invite; Escape closes it', async ({ page }) => {
  await open(page, 'inws=reask&setup=A');
  await page.clock.fastForward(10000);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: /taking shape/ })).toHaveCount(0);

  await open(page, 'inws=tips&setup=B&cards=8');
  await page.clock.fastForward(10000);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: /taking shape/ })).toHaveCount(0);   // they sent one

  await open(page, 'inws=reask&setup=B');
  const dialog = page.getByRole('dialog', { name: /taking shape/ });
  await expect(dialog).toBeVisible({ timeout: 10000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await settings(page)).invite_reask).toMatchObject({ action: 'close' });
});

test('a link joiner\'s landing is noted once, with whether the workspace had anything in it', async ({ page }) => {
  await open(page, 'inws=joiner');
  await page.clock.fastForward(3000);
  await expect.poll(async () => pick(await events(page), 'joiner_landed').length).toBe(1);
  const [landed] = pick(await events(page), 'joiner_landed');
  expect(landed.props).toMatchObject({ via: 'workspace_link', on_root: false, ws_cards: 0, empty: true, phone: false });
  expect(await page.evaluate(() => sessionStorage.getItem('soleil.setup.joined.qa-me'))).toBeNull();
  // Not someone else's re-ask to give.
  await page.evaluate(() => window.__setupQa.inws.setCards(9));
  await page.clock.fastForward(10000);
  await page.waitForTimeout(300);
  await expect(page.getByRole('dialog', { name: /taking shape/ })).toHaveCount(0);
});
