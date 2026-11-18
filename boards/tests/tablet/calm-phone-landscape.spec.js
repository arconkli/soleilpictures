// A tablet held sideways keeps the desktop layout inside a cluster. The calm
// phone (tests/mobile/calm-phone.spec.js) is for phones and the upright iPad
// only: here the tool rail stays, there is no floating +, the Comments button
// stays on the canvas, the plan chip stays over the board, and typing in a
// note takes nothing out of the top bar.
import { test, expect } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';

const OTHER = '66666666-6666-4666-8666-666666666666';
const comment = {
  id: '77777777-7777-4777-8777-777777777777', board_id: ROOT_ID, workspace_id: WS_ID,
  author: OTHER, author_name: 'Nora', body: 'Can we get the dusk shot too?', anchor_kind: 'board', anchor_id: null,
  reply_to: null, resolved: false, hidden: false, deleted_at: null, created_at: new Date(Date.now() - 60_000).toISOString(),
};
const FAB = '.mb-add-fab';
const EYE = '.cnv-comments-eye';
const CHIP = '.upgrade-chip';
// The right island's buttons, by name.
const BAR_BUTTONS = ['Undo', 'Redo', 'Search', 'Notifications', 'Share this cluster', 'More'];

async function boot(page) {
  await page.addInitScript((uid) => {
    try {
      sessionStorage.setItem('soleil.revealSession', '1');
      localStorage.setItem(`soleil_first_card_logged_${uid}`, '1');
    } catch {}
  }, USER_ID);
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 22, onboarding: { seeded: true, done: true } }] },
    rest: { comments: (url, method) => (method === 'GET' ? [comment] : []) },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.cnv-tools')).toBeVisible({ timeout: 15_000 });
}
const flag = (page) => page.evaluate(() => document.body.getAttribute('data-text-editing'));
const wrapHas = (page, cls) => page.evaluate((c) => document.querySelector('.canvas-wrap').classList.contains(c), cls);
const barButton = (page, name) => page.locator('.chrome-island.chrome-right').getByRole('button', { name, exact: true });

test('inside a cluster: the rail stays, no floating +, nothing of the phone layout', async ({ page }) => {
  await boot(page);
  const rail = page.locator('.cnv-tools');
  await expect(rail).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add note tool', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Arrow tool', exact: true })).toBeVisible();
  await expect(rail.locator('[aria-label="Add menu"]')).toBeVisible();
  await expect(page.locator(FAB)).toHaveCount(0);
  await expect(page.locator('.mb-nav')).toHaveCount(0);
  await expect(page.locator('.tb-menu-dot')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-phone-cluster');
  await expect(page.locator('body')).not.toHaveAttribute('data-phone-drawer');

  // A tool is picked from the rail.
  await page.getByRole('button', { name: 'Arrow tool', exact: true }).tap();
  await expect.poll(() => wrapHas(page, 'tool-arrow')).toBe(true);
  await page.keyboard.press('Escape');
  await expect.poll(() => wrapHas(page, 'tool-select')).toBe(true);

  // Comments: on the canvas, not in the bar, and its list hangs under it.
  const eye = page.locator(EYE);
  await expect(eye).toBeVisible();
  await expect(page.locator(`${EYE}.is-in-bar`)).toHaveCount(0);
  await expect(page.locator('.tb-comments-slot')).toHaveCount(0);
  expect(await eye.evaluate((el) => !!el.closest('.canvas-wrap') && !el.closest('.topbar') && getComputedStyle(el).position)).toBe('absolute');
  await eye.tap();
  const list = page.locator('.cmt-list');
  await expect(list).toBeVisible();
  await expect.poll(async () => Math.abs((await list.boundingBox()).x - (await eye.boundingBox()).x)).toBeLessThanOrEqual(1);
  await eye.tap();
  await expect(list).toHaveCount(0);

  // The plan chip stays over the board, and takes a tap.
  const chip = page.locator(CHIP);
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveCSS('visibility', 'visible');
  expect(await chip.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return !!at && (at === el || el.contains(at));
  })).toBe(true);

  // The faces stay in the bar.
  await expect(page.locator('.ws-presence')).toHaveCount(1);
});

test('typing in a note: no Done, the bar keeps its buttons, the rail stays', async ({ page }) => {
  await boot(page);
  for (const name of BAR_BUTTONS) await expect(barButton(page, name), name).toBeVisible();

  await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
  const b = await page.locator('.canvas-wrap').boundingBox();
  await page.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height * 0.3);
  await expect(page.locator('.cards-layer .card.card-kind-note')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.isContentEditable && !!a.closest('.cards-layer');
  })).toBe(true);
  await page.keyboard.type('Location scout');
  // The keyboard up.
  await page.evaluate(() => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - 300 });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
  });
  await page.keyboard.type(' at dusk');
  await expect(page.locator('.cards-layer .card.card-kind-note')).toContainText('Location scout at dusk');
  // The note's format bar is up, so the app knows a note is being typed in.
  await expect(page.locator('.tob.nb-a')).toBeVisible();

  expect(await flag(page)).toBeNull();
  await expect(page.locator('.tb-done')).toHaveCount(0);
  await expect(page.locator('.tob.nb-a.is-docked')).toHaveCount(0);
  await expect(page.locator('.cnv-tools')).toBeVisible();
  await expect(page.locator(EYE)).toBeVisible();
  await expect(page.locator(FAB)).toHaveCount(0);
  for (const name of BAR_BUTTONS) await expect(barButton(page, name), name).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-phone-cluster');
});
