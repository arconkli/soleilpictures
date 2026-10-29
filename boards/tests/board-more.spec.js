// The first board asks for more (lib/boardMore.js, components/BoardMoreNudge.jsx):
// in a ?more=B tab, the third card on an open board brings one toast after a
// quiet moment; ?more=A logs the moment and shows nothing. The real signed-in
// app, Supabase stubbed (helpers/signedInStub.js).
//
//   PW_PORT=5293 npx playwright test tests/board-more.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';
import { bootSignedIn } from './helpers/signedInStub.js';

const SHOTS = '/tmp/bm-shots';
const rpc = { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] };

const actions = (calls) => calls
  .filter((c) => c.path === 'analytics_events')
  .flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]))
  .filter((r) => r && JSON.stringify(r).includes('board_more_nudge'))
  .map((r) => {
    const p = r.props || r.properties || r.metadata || r.data || {};
    return p.action;
  });

async function open(browser, arm, contextOpts = {}) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  // A power reveal (the third note's "Notes can grow into docs") holds the
  // ask slot for a minute, and this toast waits for a free screen. Mark this
  // tab's reveal as spent so the spec sees the toast without that wait.
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch {} });
  const { calls } = await bootSignedIn(page, { rpc, path: `/?more=${arm}` });
  await page.waitForSelector('.canvas-wrap', { timeout: 30_000 });
  await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
  return { context, page, calls };
}

async function placeNotes(page, n, { phone = false } = {}) {
  for (let i = 0; i < n; i++) {
    if (phone) {
      // A phone places a note with a tap and doesn't open it for typing.
      await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
      const box = await page.locator('.canvas-wrap').boundingBox();
      await page.touchscreen.tap(box.x + 80 + i * 90, box.y + 160 + i * 60);
      await expect(page.locator('.card')).toHaveCount(i + 1);
      await page.waitForTimeout(400);
      continue;
    }
    await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
    await page.locator('.canvas-wrap').click({ position: { x: 100 + i * 100, y: 200 + i * 20 } });
    await page.locator('.note-body[contenteditable="true"]').waitFor();
    await page.keyboard.type(`note ${i + 1}`);
    await page.locator('.canvas-wrap').click({ position: { x: 50 + i * 20, y: 600 } });
    await expect(page.locator('.card')).toHaveCount(i + 1);
    await expect(page.locator('.note-body[contenteditable="true"]')).toHaveCount(0);
    await page.waitForTimeout(300);
  }
}

const toast = (page, text) => page.locator('.toast-msg', { hasText: text });

test('B on a desktop: toast after the third card, Add a note adds one', async ({ browser }) => {
  const { context, page, calls } = await open(browser, 'B');
  await placeNotes(page, 3);
  await page.waitForTimeout(5500);
  await expect(toast(page, 'Good start. Add more?')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/desktop-b.png` });
  await page.getByRole('button', { name: 'Add a note' }).click();
  await expect(page.locator('.card')).toHaveCount(4);
  await expect(toast(page, 'Good start')).toHaveCount(0);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/desktop-b-note.png` });
  await page.waitForTimeout(5500);
  expect(actions(calls)).toEqual(expect.arrayContaining(['eligible', 'view', 'note']));
  await context.close();
});

test('A on a desktop: the moment is logged, nothing shows', async ({ browser }) => {
  const { context, page, calls } = await open(browser, 'A');
  await placeNotes(page, 3);
  await page.waitForTimeout(6500);
  await expect(toast(page, 'Good start')).toHaveCount(0);
  await page.waitForTimeout(5500);
  const seen = actions(calls);
  expect(seen).toContain('eligible');
  expect(seen).not.toContain('view');
  await context.close();
});

test('B on a phone: phone wording, Add photos, x logs dismiss', async ({ browser }) => {
  const { context, page, calls } = await open(browser, 'B', {
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });
  await placeNotes(page, 3, { phone: true });
  await page.waitForTimeout(5500);
  await expect(toast(page, 'Good start. Add more?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add photos' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/phone-b.png` });
  await page.locator('.toast', { has: page.locator('.toast-msg', { hasText: 'Good start' }) }).locator('.toast-dismiss').tap();
  await expect(toast(page, 'Good start')).toHaveCount(0);
  await page.waitForTimeout(5500);
  expect(actions(calls)).toEqual(expect.arrayContaining(['eligible', 'view', 'dismiss']));
  await context.close();
});
