// On a phone, Settings opens with you: a card with your picture, name and
// email that is the way into Profile, with Sign out on it, in place of a
// separate Profile row. The drawer's corner row is you too. Driven through the
// REAL signed-in app with every Supabase call stubbed (helpers/signedInStub.js).
//
//   cd boards && PW_PORT=5199 npx playwright test tests/mobile/profile-card.spec.js --project=mobile-chrome --workers=2
import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID } from '../helpers/signedInStub.js';

const settings = (page) => page.getByRole('dialog', { name: 'Settings' });
const heightOf = async (loc) => (await loc.boundingBox()).height;

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome' && testInfo.project.name !== 'mobile-safari',
    'phone-width only');
  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('soleil.revealSession', '1');
      for (const k of ['grids', 'list_drive', 'docs', 'palette']) localStorage.setItem(`soleil.reveal.${k}`, '1');
    } catch (_) {}
  });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
    // One object, as maybeSingle() reads it: a profile with no name or picture.
    rest: {
      profiles: (url, method) => (method === 'GET'
        ? { user_id: USER_ID, display_name: null, color: null, avatar_url: null, settings: { setup_tips: { v: 1, done: true } } }
        : []),
    },
  });
  await page.waitForSelector('.canvas-wrap', { timeout: 30000 });
  await page.addStyleTag({ content: '.toast-stack,.toast-stack *{pointer-events:none!important}' });
});

test('Settings opens with a card for you, and the card opens Profile', async ({ page }) => {
  await page.locator('.mb-nav-tab', { hasText: 'Settings' }).tap();
  const panel = settings(page);
  await expect(panel).toBeVisible();

  const card = panel.locator('.settings-me');
  const main = card.locator('.settings-me-main');
  const out = card.getByRole('button', { name: 'Sign out', exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText('sam@example.com');
  await expect(card).toContainText('Add your name and picture');
  await expect(out).toBeVisible();
  // The card stands in for the Profile row.
  await expect(panel.locator('.settings-tab', { hasText: /^Profile$/ })).toHaveCount(0);
  await expect(panel.locator('.settings-tab', { hasText: 'Appearance' })).toBeVisible();

  // Polled: the panel scales in, and a box read mid-way is a hair short.
  await expect.poll(() => heightOf(main)).toBeGreaterThanOrEqual(44);
  await expect.poll(() => heightOf(out)).toBeGreaterThanOrEqual(44);

  await main.tap();
  await expect(panel.locator('.settings-title')).toHaveText('Profile');
  const add = panel.getByRole('button', { name: 'Add a picture', exact: true });
  await expect(add).toBeVisible();

  // The picture sits at the left under its label, and its button spans the row.
  const field = panel.locator('.settings-field', { hasText: 'Profile picture' });
  const label = await field.locator('.settings-field-label').boundingBox();
  const face = await field.locator('.settings-avatar-pick').boundingBox();
  const row = await field.boundingBox();
  const btn = await add.boundingBox();
  expect(Math.abs(face.x - label.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(btn.x - row.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(btn.width - row.width)).toBeLessThanOrEqual(1);
  expect(btn.y).toBeGreaterThanOrEqual(face.y + face.height);

  // Only a stored name is in the field; the suggestion is its placeholder.
  const name = panel.locator('.settings-field', { hasText: 'Display name' }).locator('input');
  await expect(name).toHaveValue('');
  await expect(name).toHaveAttribute('placeholder', 'Sam Rivera');
});

test("the drawer's corner row is a full-size target", async ({ page }) => {
  await page.getByLabel('Open menu').first().tap();
  await expect(page.locator('.sidebar').first()).toHaveClass(/is-mobile-open/);
  const me = page.locator('.sidebar .sb-foot .sb-foot-me').first();
  await expect(me).toBeVisible();
  await expect(me).toContainText('Add your name');
  expect(await heightOf(me)).toBeGreaterThanOrEqual(40);
});
