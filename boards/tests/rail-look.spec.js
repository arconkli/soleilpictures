// The tool rail in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21, mockup A-add), shipped 2026-10-25 (lib/appHost.js
// toolbarLookAllowed): its tooltips are the look's one tooltip (glass, the
// words, the key in a cap, on the right); the + menu says Draw's key in a cap;
// the + with its menu open is open, not on (gold is for the tool that's on);
// and the guided tour's last step still shows every tool's name at once.
// Today's rail keeps its own tooltips, and nothing of the look.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const rail = (page) => page.locator('.cnv-tools');
const tool = (page, name) => rail(page).getByRole('button', { name, exact: true });
const addMenu = (page) => page.getByRole('menu', { name: 'Add' });

async function open(page, on) {
  await look(page, on);
  await page.goto('/?local=1&reset=1');
  await expect(rail(page)).toBeVisible({ timeout: 30000 });
}

test('a tool shows the look\'s tooltip on the right: its words and its key in a cap', async ({ page }) => {
  await open(page, true);
  await expect(page.locator('html')).toHaveAttribute('data-tb', 'a');
  const select = tool(page, 'Select tool');
  await expect(select).toHaveAttribute('data-tl-tip', 'Select / move');
  await expect(select).toHaveAttribute('data-tl-keys', 'V');
  await select.hover();
  const tip = page.locator('.tl-tip');
  await expect(tip).toHaveClass(/is-shown/);
  await expect(tip).toContainText('Select / move');
  await expect(tip.locator('.tl-keys kbd')).toHaveText(['V']);
  const [t, b] = await Promise.all([tip.boundingBox(), select.boundingBox()]);
  expect(t.x).toBeGreaterThan(b.x + b.width);
  // Today's CSS tip doesn't show beside it.
  expect(await select.evaluate((el) => getComputedStyle(el, '::after').display)).toBe('none');
});

test('the + menu says Draw\'s key in a cap, and the + with it open is open, not on', async ({ page }) => {
  await open(page, true);
  const add = rail(page).getByRole('button', { name: 'Add menu' });
  await add.click();
  await expect(addMenu(page)).toBeVisible();
  const draw = addMenu(page).getByRole('menuitem', { name: 'Draw', exact: true });
  await expect(draw).toHaveAttribute('aria-keyshortcuts', 'D');
  await expect(draw.locator('.tl-keys kbd')).toHaveText(['D']);
  await expect(draw).toHaveAttribute('data-tl-tip', 'Free-draw');
  // Gold (the look's --tl-on, with its ring) is the Select tool's; the open +
  // has the hover's tint and no ring. Read once the background has eased.
  await page.waitForTimeout(400);
  const style = (el) => el.evaluate((n) => ({ bg: getComputedStyle(n).backgroundColor, ring: getComputedStyle(n).boxShadow }));
  const on = await style(tool(page, 'Select tool'));
  const plus = await style(add);
  expect(on.ring).not.toBe('none');
  expect(plus.ring).toBe('none');
  expect(plus.bg).not.toBe(on.bg);
  expect(plus.bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('the guided tour\'s last step still shows every tool\'s name at once, and no hover tooltip', async ({ page }) => {
  await open(page, true);
  await page.evaluate(() => {
    document.body.setAttribute('data-tour-active', '1');
    document.querySelector('.cnv-tools').classList.add('tour-target');
  });
  const after = (name) => tool(page, name).evaluate((el) => {
    const cs = getComputedStyle(el, '::after');
    return { display: cs.display, opacity: cs.opacity, content: cs.content };
  });
  for (const name of ['Select tool', 'Add note tool', 'Arrow tool']) {
    const a = await after(name);
    expect(a.display, name).toBe('block');
    expect(a.opacity, name).toBe('1');
  }
  await tool(page, 'Pan tool').hover();
  await page.waitForTimeout(800);
  await expect(page.locator('.tl-tip.is-shown')).toBeHidden();
});

test('today\'s rail keeps its own tooltips, and nothing of the look', async ({ page }) => {
  await open(page, false);
  await expect(page.locator('html')).not.toHaveAttribute('data-tb', 'a');
  await expect(rail(page).locator('[data-tl-tip]')).toHaveCount(0);
  await expect(tool(page, 'Select tool')).toHaveAttribute('data-tip', 'Select / move (V)');
  await rail(page).getByRole('button', { name: 'Add menu' }).click();
  const draw = addMenu(page).getByRole('menuitem', { name: 'Draw', exact: true });
  await expect(draw).toHaveAttribute('data-tip', 'Free-draw (D)');
  await expect(draw.locator('.tl-keys')).toHaveCount(0);
});
