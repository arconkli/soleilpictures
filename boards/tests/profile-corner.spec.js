// The sidebar corner is you: one button with your picture and name that opens
// Settings on Profile, and "Add your name" until you have set one. ⌘K finds
// "Edit profile" and "Plan & billing". Driven through the REAL signed-in app
// with every Supabase call stubbed (helpers/signedInStub.js).
//
//   cd boards && PW_PORT=5199 npx playwright test tests/profile-corner.spec.js --project=desktop-chrome --workers=2
import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID } from './helpers/signedInStub.js';

const settings = (page) => page.getByRole('dialog', { name: 'Settings' });
const corner = (page) => page.locator('.sb-foot').getByRole('button', { name: /, edit profile$/ });
const nameField = (page) => settings(page).locator('.settings-field', { hasText: 'Display name' }).locator('input');
const profileWrites = (calls) => calls.filter((c) => c.path === 'profiles' && c.method !== 'GET');
const profilePane = (page) => settings(page).getByRole('heading', { name: 'Profile', exact: true });

// getOwnProfile reads one object (maybeSingle). The stub's default "no rows"
// 406 is a failed read, and the corner never asks for a name on a failed read.
// The setup tips and the one-shot reveals would hold the screen; both are spent.
async function boot(page, profile = {}) {
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('soleil.revealSession', '1');
      for (const k of ['grids', 'list_drive', 'docs', 'palette']) localStorage.setItem(`soleil.reveal.${k}`, '1');
    } catch (_) {}
  });
  const { calls } = await bootSignedIn(page, {
    rest: {
      profiles: (url, method) => (method === 'GET'
        ? { user_id: USER_ID, display_name: null, color: null, avatar_url: null, settings: { setup_tips: { v: 1, done: true } }, ...profile }
        : []),
    },
  });
  await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.addStyleTag({ content: '.toast-stack,.toast-stack *{pointer-events:none!important}' });
  return calls;
}

const openPalette = async (page) => {
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.locator('.cmdk-input')).toBeVisible();
};

test('with no name the corner says "Add your name" and opens Settings on Profile', async ({ page }) => {
  await boot(page);
  await expect(corner(page)).toHaveText(/Add your name/);
  await corner(page).click();
  await expect(settings(page)).toBeVisible();
  await expect(settings(page).locator('.settings-tab[aria-selected="true"]')).toHaveText(/Profile/);
  await expect(profilePane(page)).toBeVisible();
  await expect(settings(page).getByRole('button', { name: 'Add a picture', exact: true })).toBeVisible();
});

test('with a name the corner shows it', async ({ page }) => {
  await boot(page, { display_name: 'Maya Torres' });
  await expect(corner(page).locator('.sb-foot-name')).toHaveText('Maya Torres');
  await expect(corner(page)).not.toHaveText(/Add your name/);
});

test('⌘K "edit profile" opens Profile', async ({ page }) => {
  await boot(page, { display_name: 'Maya Torres' });
  await openPalette(page);
  await page.locator('.cmdk-input').fill('edit profile');
  await expect(page.locator('.cmdk-row.is-active')).toHaveText(/Edit profile/);
  await page.keyboard.press('Enter');
  await expect(settings(page).locator('.settings-tab[aria-selected="true"]')).toHaveText(/Profile/);
  await expect(profilePane(page)).toBeVisible();
});

test('⌘K "billing" lists Plan & billing', async ({ page }) => {
  await boot(page, { display_name: 'Maya Torres' });
  await openPalette(page);
  await page.locator('.cmdk-input').fill('billing');
  await expect(page.locator('.cmdk-row', { hasText: 'Plan & billing' })).toBeVisible();
});

// The field holds only a name that is stored. The suggestion (the name on the
// account) is its placeholder, so it can't be saved by a blur, or by a colour
// or picture save, without being typed.
test('with no name the Display name field is empty, and typing one saves it', async ({ page }) => {
  const calls = await boot(page);
  await corner(page).click();
  const field = nameField(page);
  await expect(field).toBeEnabled();
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', 'Sam Rivera');

  await field.focus();
  await field.blur();
  await settings(page).getByRole('heading', { name: 'Profile', exact: true }).click();
  expect(profileWrites(calls)).toHaveLength(0);

  await field.fill('Dana Lee');
  await field.press('Enter');
  await expect.poll(() => profileWrites(calls).length).toBeGreaterThan(0);
  expect(profileWrites(calls)[0].body).toMatchObject({ display_name: 'Dana Lee' });
  await expect(page.locator('.sb-foot .sb-foot-name')).toHaveText('Dana Lee');
});

test('the corner is named for what it shows', async ({ page }) => {
  await boot(page, { display_name: 'Maya Torres' });
  await expect(page.locator('.sb-foot').getByRole('button', { name: 'Maya Torres, edit profile', exact: true })).toBeVisible();
});

test('pointing at a long name does not move Help or the cog', async ({ page }) => {
  await boot(page, { display_name: 'Bartholomew Featherstonehaugh-Montgomery the Third' });
  const cog = page.locator('.sb-foot').getByRole('button', { name: 'Settings', exact: true });
  const help = page.locator('.sb-foot .sb-foot-icon').first();
  const before = [await cog.boundingBox(), await help.boundingBox()];
  await corner(page).hover();
  await expect(corner(page).locator('.sb-foot-cue')).toBeVisible();
  expect([await cog.boundingBox(), await help.boundingBox()]).toEqual(before);
  const foot = await page.locator('.sb-foot').boundingBox();
  expect(before[0].x + before[0].width).toBeLessThanOrEqual(foot.x + foot.width);
});
