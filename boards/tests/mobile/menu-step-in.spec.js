// A submenu on a phone steps in (mockup "A · Step in", the owner's pick
// 2026-10-27): it takes its menu's place in the same panel, under ‹ and its
// own name, and ‹ goes back. A phone has no room beside a menu, so a submenu
// used to land on it, the menu's words showing through its glass. Driven in
// the ?docqa=1 harness: the header's ⋯ (Export, Layout) and More formatting
// over the keyboard (Font, Text colour), the keyboard faked the way iOS and
// Chrome report one, by the visual viewport.

import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');
});

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await modal(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

const modal = (page) => page.locator('.doc-card-modal');
const more = (page) => modal(page).locator('.dl-head').getByRole('button', { name: /^More/ });
const row = (page) => page.getByRole('toolbar', { name: 'Formatting', exact: true });
const rowBtn = (page, name) => row(page).getByRole('button', { name, exact: true });
const menu = (page, name) => page.getByRole('menu', { name, exact: true });
const setDoc = (page, html) => page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h, true), html);
const textFocused = () => !!document.activeElement?.closest?.('.doc-card-modal .ProseMirror');
const keyboard = (page, kb) => page.evaluate((h) => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - h });
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
  vv.dispatchEvent(new Event('resize'));
}, kb);

// Every menu a finger can see, by name.
const shown = (page) => page.evaluate(() => [...document.querySelectorAll('[role="menu"]')]
  .filter((m) => m.getClientRects().length && getComputedStyle(m).visibility !== 'hidden')
  .map((m) => m.getAttribute('aria-label')));
const near = (a, b) => Math.abs(a - b) < 1.5;

const WORDS = '<p>A quiet street before dawn. A van idles with its lights off.</p>'
  + '<p>MARA checks her watch, then the mirror, then her watch again.</p>';

test('⋯\'s Export takes ⋯\'s place, under ‹ Export, and ‹ brings ⋯ back where it was', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, WORDS);
  await more(page).tap();
  const m = menu(page, 'More');
  await expect(m).toBeVisible();
  const was = await m.boundingBox();
  await m.getByRole('menuitem', { name: /^Export/ }).tap();
  const sub = menu(page, 'Export');
  await expect(sub).toBeVisible();
  // One panel, where ⋯'s was: its top, its right edge, its width.
  await expect.poll(() => shown(page)).toEqual(['Export']);
  const box = await sub.boundingBox();
  expect(near(box.y, was.y), `top ${box.y} vs ${was.y}`).toBe(true);
  expect(near(box.x + box.width, was.x + was.width), 'right edge').toBe(true);
  expect(near(box.width, was.width), `width ${box.width} vs ${was.width}`).toBe(true);
  // ‹ Export, a hairline, then Export's own rows.
  const rows = sub.getByRole('menuitem');
  await expect(rows.first()).toHaveAccessibleName('Export, back to More');
  await expect(rows.first()).toHaveClass(/is-back/);
  await expect(sub.locator('.tl-msep').first()).toBeVisible();
  await expect(rows.nth(1)).toHaveAccessibleName('HTML');
  await expect(rows.nth(2)).toHaveAccessibleName('Markdown');
  await expect(rows.nth(3)).toHaveAccessibleName(/PDF/);
  for (const r of await rows.all()) {
    const b = await r.boundingBox();
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
  // ‹ brings ⋯ back, in the same place, and Export is gone.
  await rows.first().tap();
  await expect(sub).toHaveCount(0);
  await expect(m).toBeVisible();
  const back = await m.boundingBox();
  expect(near(back.y, was.y) && near(back.x, was.x) && near(back.width, was.width)).toBe(true);
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
});

test('a row picked in a stepped-in submenu closes the whole menu: ⋯ › Layout › Pages', async ({ page }) => {
  await openDoc(page);
  await more(page).tap();
  await menu(page, 'More').getByRole('menuitem', { name: /^Layout/ }).tap();
  const layout = menu(page, 'Layout');
  await expect(layout).toBeVisible();
  await expect.poll(() => shown(page)).toEqual(['Layout']);
  await layout.getByRole('menuitemradio', { name: /^Pages/ }).tap();
  await expect(layout).toHaveCount(0);
  await expect.poll(() => shown(page)).toEqual([]);
  await expect(more(page)).toHaveAttribute('aria-expanded', 'false');
  await more(page).tap();
  await expect(menu(page, 'More').getByRole('menuitem', { name: /^Layout/ })).toContainText('Pages');
});

test('More formatting › Font keeps the menu\'s place over the row; the list scrolls under ‹ Font, and the text keeps the focus', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, WORDS);
  await modal(page).locator('.ProseMirror p').first().tap();
  await keyboard(page, 300);
  await rowBtn(page, 'More formatting').tap();
  const m = menu(page, 'More formatting');
  await expect(m).toBeVisible();
  const was = await m.boundingBox();
  await m.getByRole('menuitem', { name: /^Font/ }).tap();
  const sub = menu(page, 'Font');
  await expect(sub).toBeVisible();
  await expect.poll(() => shown(page)).toEqual(['Font']);
  const box = await sub.boundingBox();
  const rb = await row(page).boundingBox();
  // Its foot where the menu's was, over the row; its right edge; its width.
  expect(near(box.y + box.height, was.y + was.height), `foot ${box.y + box.height} vs ${was.y + was.height}`).toBe(true);
  expect(box.y + box.height).toBeLessThanOrEqual(rb.y + 1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(near(box.x + box.width, was.x + was.width), 'right edge').toBe(true);
  expect(near(box.width, was.width), `width ${box.width} vs ${was.width}`).toBe(true);
  // The fonts scroll under ‹ Font, which stays at the top.
  const back = sub.getByRole('menuitem', { name: 'Font, back to More formatting' });
  const top = (await back.boundingBox()).y;
  const list = sub.locator('.tl-mstep-body');
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight + 20)).toBe(true);
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(sub.getByRole('menuitemradio', { name: /^Default/ })).not.toBeInViewport();
  expect(near((await back.boundingBox()).y, top)).toBe(true);
  await expect(back).toBeInViewport();
  // The text kept the focus: the keyboard stayed up. ‹ goes back, and it still has it.
  expect(await page.evaluate(textFocused)).toBe(true);
  await back.tap();
  await expect(sub).toHaveCount(0);
  await expect(m).toBeVisible();
  await expect.poll(() => page.evaluate(textFocused)).toBe(true);
});

test('More formatting › Text colour: its swatches under ‹ Text colour, with no head that says it again; a colour picked closes it and colours the words', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, WORDS);
  await modal(page).locator('.ProseMirror p').first().tap();
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection({ from: 3, to: 8 }));
  await keyboard(page, 300);
  await rowBtn(page, 'More formatting').tap();
  await menu(page, 'More formatting').getByRole('menuitem', { name: /^Text colour/ }).tap();
  const sub = menu(page, 'Text colour');
  await expect(sub).toBeVisible();
  await expect.poll(() => shown(page)).toEqual(['Text colour']);
  await expect(sub.getByRole('menuitem').first()).toHaveAccessibleName('Text colour, back to More formatting');
  await expect(sub.locator('.tl-mh', { hasText: /^Text colour$/i })).toHaveCount(0);
  await sub.getByRole('menuitemradio', { name: 'Red' }).tap();
  await expect(sub).toHaveCount(0);
  await expect.poll(() => shown(page)).toEqual([]);
  await expect.poll(() => page.evaluate(textFocused)).toBe(true);
  expect(await page.evaluate(() => window.__soleilDocTest.editor.getAttributes('textStyle').color)).toBe('#ef4444');
});
