// Always-readable colors in the LIVE doc editor: the ReadableColors plugin
// keeps user-chosen text colors legible on the page sheet in either theme
// (scoped-stylesheet override, content never mutated), while preserving accent
// colors that already read fine. Driven via ?docqa=1 (window.__soleilDocTest).
import { expect, test } from '@playwright/test';
import { todaysLook } from './helpers/docFrame.js';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function setTheme(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

function lum(rgb) {
  const m = String(rgb).match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return 0.5;
  return (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255;
}

async function spanColor(page) {
  return page.locator('.doc-card-modal .tt-editor span[style*="color"]').first()
    .evaluate((el) => getComputedStyle(el).color);
}

test('a near-white text color is overridden to readable on the white sheet (light theme)', async ({ page }) => {
  await openDoc(page);
  await setTheme(page, 'light');
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus()
    .setContent('<p>readable check</p>').selectAll().setColor('#f5f5f7').run());
  await expect.poll(() => spanColor(page), { timeout: 4000 }).toMatch(/\d/);
  // On the white page sheet, near-white text would vanish → forced dark.
  await expect.poll(async () => lum(await spanColor(page)), { timeout: 4000 }).toBeLessThan(0.4);
});

test('a near-black text color is overridden to readable on the dark sheet (dark theme)', async ({ page }) => {
  await openDoc(page);
  await setTheme(page, 'dark');
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus()
    .setContent('<p>readable check</p>').selectAll().setColor('#0a0a0c').run());
  await expect.poll(async () => lum(await spanColor(page)), { timeout: 4000 }).toBeGreaterThan(0.6);
});

test('the SAME colored text flips when the theme flips (live)', async ({ page }) => {
  await openDoc(page);
  await setTheme(page, 'dark');
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus()
    .setContent('<p>flip me</p>').selectAll().setColor('#f5f5f7').run());
  // Dark theme: near-white reads fine on the dark sheet → kept light.
  await expect.poll(async () => lum(await spanColor(page)), { timeout: 4000 }).toBeGreaterThan(0.6);
  // Flip to light: now near-white would vanish → forced dark, no edit needed.
  await setTheme(page, 'light');
  await expect.poll(async () => lum(await spanColor(page)), { timeout: 4000 }).toBeLessThan(0.4);
});

test('an accent color that already reads fine is preserved in both themes', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus()
    .setContent('<p>accent</p>').selectAll().setColor('#3b82f6').run());
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await page.waitForTimeout(120);
    const c = await spanColor(page);
    const m = String(c).match(/(\d+),\s*(\d+),\s*(\d+)/);
    // Still a recognizable blue (blue channel dominant).
    expect(Number(m[3])).toBeGreaterThan(Number(m[1]) + 40);
    expect(Number(m[3])).toBeGreaterThan(Number(m[2]));
  }
});

// The toolbar's colours show where they end in either theme: the white one on
// the light menu, the black one on the dark menu, by its fill or by its edge.
test('every colour in the doc toolbar’s menu stands out from the menu, in either theme', async ({ page }) => {
  // Today's colour menu. The look's is doc-bar-a.spec.js's.
  await todaysLook(page);
  await openDoc(page);
  for (const theme of ['light', 'dark']) {
    await setTheme(page, theme);
    await page.locator('.doc-card-modal').getByRole('button', { name: 'Text color', exact: true }).click();
    const pop = page.locator('.doc-tb-colorpop');
    await expect(pop).toBeVisible();
    const faint = await pop.evaluate((menu) => {
      const parse = (s) => { const m = String(s).match(/[\d.]+/g) || []; return { r: +m[0], g: +m[1], b: +m[2], a: m[3] == null ? 1 : +m[3] }; };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a) });
      const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const ratio = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
      const bg = { ...parse(getComputedStyle(menu).backgroundColor), a: 1 };
      return [...menu.querySelectorAll('.doc-tb-sw:not(.doc-tb-sw-x)')].filter((sw) => {
        const cs = getComputedStyle(sw);
        return ratio(over(parse(cs.backgroundColor), bg), bg) < 1.3 && ratio(over(parse(cs.borderTopColor), bg), bg) < 1.3;
      }).map((sw) => sw.getAttribute('aria-label'));
    });
    expect(faint, `${theme}: colours that vanish into the menu`).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  }
});

test('the stored content is never mutated by the readability override', async ({ page }) => {
  await openDoc(page);
  await setTheme(page, 'light');
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus()
    .setContent('<p>pristine</p>').selectAll().setColor('#f5f5f7').run());
  await page.waitForTimeout(150);
  // The override is presentation-only: the mark's stored color is unchanged
  // (Tiptap's Color mark normalizes the stored value to rgb()).
  const html = await page.evaluate(() => window.__soleilDocTest.editor.getHTML());
  expect(html.replace(/\s+/g, '')).toContain('rgb(245,245,247)'.replace(/\s+/g, ''));
});
