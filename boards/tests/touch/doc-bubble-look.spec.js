// A selection's bubble in a doc on a touch device, in the doc look (lib/
// appHost.js docLookAllowed, a dev opt-in): the look's glass and corners, its
// bar's icons in place of today's letters, and a format that's on in the
// look's gold tint and ring rather than a gold fill. A phone in the look has
// no bubble (the row on the keyboard has its formats: mobile/doc-look-
// phone.spec.js). ?docqa=1 harness (window.__soleilDocTest).
import { expect, test } from '@playwright/test';

async function select(page, look) {
  await page.addInitScript((on) => {
    try { window.localStorage.setItem('soleil.dev.docLook', on ? '1' : '0'); } catch (_) {}
  }, look);
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('bubble target').selectAll().run());
  const bubble = page.locator('.doc-bubble');
  await expect(bubble).toBeVisible({ timeout: 5000 });
  return bubble;
}

// The look's on (components/toolbar/toolbar.css --tl-on, --tl-on-line), in
// the dark theme and the light one.
const ON_TINT = /^rgba\(255, 165, 0, 0\.1[34]\)$/;
const ON_RING = /rgba\((255, 165|230, 140), 0, 0\.(34|45)\)/;

function alpha(c) {
  const slash = c.match(/\/\s*([\d.]+)\)$/);
  if (slash) return Number(slash[1]);
  const rgba = c.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

test('in the doc look the bubble is the look\'s: its glass, its icons, its on', async ({ page }) => {
  test.skip(page.viewportSize().width <= 640, 'a phone in the doc look has no bubble');
  const bubble = await select(page, true);
  const css = await bubble.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { radius: cs.borderRadius, bg: cs.backgroundColor };
  });
  expect(css.radius).toBe('14px');
  expect(alpha(css.bg)).toBeCloseTo(0.94, 2);
  for (const name of ['Bold', 'Italic', 'Underline', 'Highlight', 'Link']) {
    const b = bubble.getByRole('button', { name, exact: true });
    await expect(b.locator('svg'), name).toHaveAttribute('viewBox', '0 0 256 256');
    await expect(b, name).toHaveText('');
    // A finger's 40px.
    expect(await b.evaluate((el) => [el.offsetWidth, el.offsetHeight]), name).toEqual([40, 40]);
  }
  const bold = bubble.getByRole('button', { name: 'Bold', exact: true });
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => bold.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(ON_TINT);
  expect(await bold.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(ON_RING);
  expect(await page.evaluate(() => window.__soleilDocTest.editor.getHTML())).toContain('<strong>');
});

test('today\'s look keeps the bubble\'s letters and its gold fill', async ({ page }) => {
  const bubble = await select(page, false);
  await expect(bubble.getByRole('button', { name: 'Bold', exact: true })).toHaveText('B');
  await expect(bubble.getByRole('button', { name: 'Highlight', exact: true })).toHaveText('H');
  const bold = bubble.getByRole('button', { name: 'Bold', exact: true });
  await bold.click();
  await expect.poll(() => bold.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 165, 0)');
});
