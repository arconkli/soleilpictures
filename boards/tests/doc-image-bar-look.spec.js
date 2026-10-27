// A doc image's bar in the doc look: the look's bars' glass and corners, its
// icons, the look's tooltip, and the image's alignment on in the look's gold
// tint and ring, which its alignments say too (aria-pressed).
// ?docqa=1 harness (window.__soleilDocTest).
import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent(
    `${'<p>Before.</p>'.repeat(6)}<img src="/apple-touch-icon.png" style="width: 240px">${'<p>After.</p>'.repeat(6)}`));
  const img = page.locator('.doc-card-modal .tt-img').first();
  await expect.poll(() => img.evaluate((el) => el.naturalHeight)).toBeGreaterThan(0);
  await img.click();
  const bar = page.locator('.doc-card-modal .tt-img-wrap.is-selected .tt-img-tb');
  await expect(bar).toBeVisible();
  return bar;
}

// A computed colour's alpha: "oklab(… / 0.94)", "rgba(…, 0.94)", or 1.
function alpha(c) {
  const slash = c.match(/\/\s*([\d.]+)\)$/);
  if (slash) return Number(slash[1]);
  const rgba = c.match(/^rgba\([^)]*,\s*([\d.]+)\)$/);
  return rgba ? Number(rgba[1]) : 1;
}

const NAMES = ['Align left', 'Align center', 'Align right', 'Full width', 'Delete image'];
// The look's on (components/toolbar/toolbar.css --tl-on, --tl-on-line), in
// the dark theme and the light one.
const ON_TINT = /^rgba\(255, 165, 0, 0\.1[34]\)$/;
const ON_RING = /rgba\((255, 165|230, 140), 0, 0\.(34|45)\)/;

test('in the doc look the bar is the look\'s: its glass, its icons, its tooltip, the alignment on', async ({ page }) => {
  const bar = await openDoc(page);
  const css = await bar.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { radius: cs.borderRadius, bg: cs.backgroundColor, blur: cs.backdropFilter };
  });
  expect(css.radius).toBe('12px');
  expect(alpha(css.bg)).toBeCloseTo(0.94, 2);
  expect(css.blur).toContain('blur');
  for (const name of NAMES) {
    const b = bar.getByRole('button', { name, exact: true });
    await expect(b.locator('svg'), name).toHaveAttribute('viewBox', '0 0 256 256');
    await expect(b, name).toHaveText('');
    await expect(b, name).not.toHaveAttribute('title', /.*/);
  }
  expect(await bar.getByRole('button', { name: 'Align left', exact: true }).evaluate((el) => el.offsetWidth)).toBe(32);
  // A new image is centred: that alignment is on.
  const center = bar.getByRole('button', { name: 'Align center', exact: true });
  const left = bar.getByRole('button', { name: 'Align left', exact: true });
  await expect(center).toHaveAttribute('aria-pressed', 'true');
  await expect(left).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => center.evaluate((el) => getComputedStyle(el).backgroundColor)).toMatch(ON_TINT);
  expect(await center.evaluate((el) => getComputedStyle(el).boxShadow)).toMatch(ON_RING);
  await left.hover();
  await expect(page.locator('.tl-tip')).toContainText('Align left');
  // Aligning moves the on, and the bar stays the look's.
  await left.click();
  await expect(left).toHaveAttribute('aria-pressed', 'true');
  await expect(center).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.doc-card-modal .tt-img-wrap')).toHaveClass(/tt-img-align-left/);
  await expect(left.locator('svg')).toHaveCount(1);
});
