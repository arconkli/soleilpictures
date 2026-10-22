// The Team page on a test team (the admin preview): the workspace menu's team
// section, the page's three tabs as the owner, an admin, a member and an
// unpaid team, Esc and the close button, and a phone.
// Mounted through src/local/teamProbe.js (?local=1 renders its own sidebar with
// no workspace menu), like tests/editor-limit.spec.js.
import { expect, test } from '@playwright/test';

async function boot(page, { teamAs = null } = {}) {
  if (teamAs) {
    await page.addInitScript((as) => { try { localStorage.setItem('soleil.preview.teamAs', as); } catch (_) {} }, teamAs);
  }
  await page.goto('/?local=1&reset=1&blank=1&tier=admin');
  await page.waitForLoadState('domcontentloaded');
}

async function mountPage(page, { as = 'owner', tab = 'people' } = {}) {
  await boot(page);
  await page.evaluate(async (args) => {
    const m = await import('/src/local/teamProbe.js');
    m.mountTeamPage(args);
  }, { as, tab });
  const sheet = page.locator('[data-team-page] .tp-sheet');
  await expect(sheet).toBeVisible();
  return sheet;
}

const tab = (sheet, name) => sheet.getByRole('tab', { name });

test('the workspace menu opens with the team: its workspaces, a lock on the private one, and the Team page row', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const m = await import('/src/local/teamProbe.js');
    m.mountTeamMenu({ as: 'owner' });
  });
  const menu = page.locator('.ws-menu');
  await expect(menu).toBeVisible();
  const section = menu.locator('.ws-menu-section').first();
  await expect(section).toContainText('NORTHLIGHT FILMS');
  await expect(section.locator('.ws-menu-tag')).toHaveText('TEAM');
  for (const n of ['Studio', 'Commercials', 'Music videos']) {
    await expect(menu.locator('.ws-menu-row', { hasText: n }).first()).toBeVisible();
  }
  const music = menu.locator('.ws-menu-row', { hasText: 'Music videos' });
  await expect(music).toContainText('Team · private');
  await expect(music.locator('.ws-menu-tail')).toHaveCount(1);
  await menu.locator('.ws-menu-row', { hasText: 'Team page' }).click();
  expect(await page.evaluate(() => window.__teamMenu.openPage)).toBe(1);
});

test('as the owner: the title, the tabs, twelve people and the viewers folded, and Approve clears the request', async ({ page }) => {
  const sheet = await mountPage(page);
  await expect(sheet.locator('h2')).toHaveText('Northlight Films');
  await expect(sheet).toContainText('Test team');
  await expect(sheet.getByRole('tab')).toHaveCount(3);
  await expect(tab(sheet, /People/)).toHaveAttribute('aria-selected', 'true');
  await expect(sheet.locator('.tp-tbl .tp-av')).toHaveCount(12);
  await expect(sheet.locator('.tp-tr.is-group')).toContainText(/Can view\s*·\s*7/);
  await expect(sheet.locator('.tp-req')).toContainText('Lena Fischer asked to edit Commercials');
  await expect(sheet.locator('.tp-req')).toContainText('Approving uses one of the 3 free seats.');
  await sheet.getByRole('button', { name: 'Approve' }).click();
  await expect(sheet.locator('.tp-req')).toHaveCount(0);
});

test('as the owner, Seats & billing: seats, the monthly limit and the when-full choice', async ({ page }) => {
  const sheet = await mountPage(page);
  await tab(sheet, /Seats & billing/).click();
  await expect(sheet).toContainText(/12\s*of 15 used/);
  await expect(sheet).toContainText('When seats run out');
  const cap = sheet.getByLabel('Most new seats a month');
  await expect(cap).toHaveValue('5');
  await cap.fill('12');
  await expect(cap).toHaveValue('12');
  await cap.fill('');
  await expect(cap).toHaveValue('');
  await sheet.locator('.tp-opt', { hasText: 'Add a seat for them' }).click();
  await expect(sheet.locator('.tp-opt.is-on')).toContainText('Add a seat for them');
});

test('as the owner, Joining: the team link, the verified domain, and Send invites adds two to People', async ({ page }) => {
  const sheet = await mountPage(page);
  await tab(sheet, /Joining/).click();
  await expect(sheet).toContainText('clusters.soleilpictures.com/join/nl-7f3k2q');
  await expect(sheet.locator('.tp-dom', { hasText: 'northlight.studio' })).toContainText('Verified');
  await sheet.locator('textarea.tp-ta').fill('a@x.co, b@x.co');
  await sheet.getByRole('button', { name: 'Send invites' }).click();
  const toasts = await page.evaluate(() => window.__team.toasts);
  expect(toasts.length).toBeGreaterThan(0);
  expect(toasts[toasts.length - 1]).toMatch(/^Preview:/);
  await tab(sheet, /People/).click();
  await expect(sheet.locator('.tp-role.is-pending')).toHaveCount(3);
});

test('as an admin: the card is the owner’s, and there is no Close the team', async ({ page }) => {
  const sheet = await mountPage(page, { as: 'admin' });
  await tab(sheet, /Seats & billing/).click();
  await expect(sheet.getByRole('button', { name: 'Change card' })).toHaveCount(0);
  await expect(sheet).toContainText('Only Alex changes the card.');
  await sheet.getByRole('button', { name: 'More' }).click();
  await expect(sheet.getByText('Close the team')).toHaveCount(0);
});

test('as a member: People only, no addresses, and who to ask', async ({ page }) => {
  const sheet = await mountPage(page, { as: 'member' });
  await expect(sheet.getByRole('tab')).toHaveCount(1);
  expect(await sheet.locator('.tp-tbl').innerText()).not.toContain('@');
  await expect(sheet.locator('.tp-note')).toContainText('Alex and Ben');
  await expect(sheet.getByRole('button', { name: 'Invite people' })).toHaveCount(0);
});

test('unpaid: the view-only banner, Update the card, and Invite people off', async ({ page }) => {
  const sheet = await mountPage(page, { as: 'unpaid' });
  await expect(sheet.locator('.tp-banner')).toContainText('Northlight Films is view-only.');
  await expect(sheet.locator('.tp-banner').getByRole('button', { name: 'Update the card' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Invite people' })).toBeDisabled();
});

test('Esc and the close button each close the page', async ({ page }) => {
  const sheet = await mountPage(page);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.__team.closed)).toBe(1);
  await sheet.getByRole('button', { name: 'Close the team page' }).click();
  expect(await page.evaluate(() => window.__team.closed)).toBe(2);
});

test('on a phone the sheet fills the width and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const sheet = await mountPage(page);
  const box = await sheet.boundingBox();
  expect(box.x).toBe(0);
  expect(box.width).toBeGreaterThanOrEqual(389);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// Not covered here: App's own mount. ?local=1 renders LocalBoardsApp, which
// never runs App.jsx's Workspace (where the page and the menu's team prop are
// wired), so openTeamPage() there mounts nothing. teamPreviewWiring.test.mjs
// pins the wiring by source instead.
