// A finger on the canvas's tool rail. A tap arms the tool under it, as a click
// does; a swipe that starts on a tool scrolls the rail and arms nothing. On a
// phone held sideways the rail is a short window onto eleven tools and nothing
// else, so a swipe can only start on one: it used to arm that tool (the tools
// armed on the press) and scroll nothing (the tool kept the press from the
// rail), and the rail squeezed its tools to half a finger instead of scrolling.
// CDP touch: Chromium only (helpers.js).
import { expect, test } from '@playwright/test';
import { needsHold, swipe, tap } from './helpers.js';

const rail = (page) => page.locator('.cnv-tools');
const tool = (page, name) => rail(page).getByRole('button', { name, exact: true });
const addMenu = (page) => page.locator('.cnv-add-menu');

async function open(page, { sideways = false } = {}) {
  if (sideways) {
    const v = page.viewportSize();
    if (v.height > v.width) await page.setViewportSize({ width: v.height, height: v.width });
  }
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.waitForTimeout(600);
}
const centre = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const armed = (page) => rail(page).locator('.cnv-tool[aria-pressed="true"]')
  .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const scrolled = (page) => rail(page).evaluate((el) => el.scrollTop);
// A tool that isn't armed, whole inside the rail's window as it is scrolled now.
const toolInView = (page) => rail(page).evaluate((r) => {
  const box = r.getBoundingClientRect();
  const t = [...r.querySelectorAll(':scope > .cnv-tool[aria-pressed="false"]')].find((el) => {
    const b = el.getBoundingClientRect();
    return b.top >= box.top && b.bottom <= box.bottom;
  });
  if (!t) return null;
  const b = t.getBoundingClientRect();
  return { name: t.getAttribute('aria-label'), x: b.left + b.width / 2, y: b.top + b.height / 2 };
});

test('a tap on a tool arms it, and a tap on + opens the add menu', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  await tap(page, await centre(tool(page, 'Add note tool')));
  await expect(tool(page, 'Add note tool')).toHaveAttribute('aria-pressed', 'true');
  await tap(page, await centre(tool(page, 'Add menu')));
  await expect(addMenu(page)).toBeVisible();
});

test('a swipe that starts on a tool arms nothing, and one that starts on + opens nothing', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  const from = await centre(tool(page, 'Add note tool'));
  await swipe(page, from, { x: from.x, y: from.y + 70 });
  await page.waitForTimeout(300);
  expect(await armed(page)).toEqual(['Select tool']);
  const plus = await centre(tool(page, 'Add menu'));
  await swipe(page, plus, { x: plus.x, y: plus.y + 70 });
  await page.waitForTimeout(300);
  await expect(addMenu(page)).toHaveCount(0);
});

test('held sideways, the rail keeps its tools a finger tall and scrolls under a swipe that starts on one', async ({ page, browserName }, info) => {
  needsHold(test, browserName);
  test.skip(info.project.name !== 'mobile-chrome', 'a phone held sideways');
  await open(page, { sideways: true });
  const heights = await rail(page).locator('.cnv-tool')
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
  expect(Math.min(...heights), `the rail's tool heights: ${heights.join(', ')}`).toBeGreaterThanOrEqual(40);
  // From +, the rail's first control: up the screen scrolls the rail on, and
  // the menu stays shut.
  const plus = await centre(tool(page, 'Add menu'));
  await swipe(page, plus, { x: plus.x, y: plus.y - 80 });
  await expect.poll(() => scrolled(page)).toBeGreaterThan(30);
  await expect(addMenu(page)).toHaveCount(0);
  // From a tool now in view: back down the screen scrolls it back, and the
  // tool under the finger isn't armed.
  const t = await toolInView(page);
  expect(t, 'a tool in the rail\'s window').not.toBeNull();
  const at = await scrolled(page);
  await swipe(page, t, { x: t.x, y: t.y + 50 });
  await expect.poll(() => scrolled(page)).toBeLessThan(at - 20);
  expect(await armed(page)).toEqual(['Select tool']);
});

// On a phone the rail scrolls, so it clips whatever hangs out of it: the menu
// opened (the + lit up) and none of it could be seen or tapped. Each item must
// be under the finger where it's drawn.
test('the add menu opens beside the rail, whole, and a tap on an item takes it', async ({ page }) => {
  await open(page);
  await tool(page, 'Add menu').tap();
  await expect(addMenu(page)).toBeVisible();
  const missed = await addMenu(page).getByRole('menuitem').evaluateAll((els) => els.filter((el) => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !at || !el.contains(at);
  }).map((el) => el.getAttribute('aria-label')));
  expect(missed, 'items a finger can\'t reach').toEqual([]);
  await addMenu(page).getByRole('menuitem', { name: 'Shape', exact: true }).tap();
  await expect(addMenu(page)).toHaveCount(0);
  await expect(page.locator('.tob[aria-label="Shape"]')).toBeVisible();
});

test('a tap outside the add menu closes it, a card\'s included', async ({ page, browserName }) => {
  needsHold(test, browserName);
  await open(page);
  await tap(page, await centre(tool(page, 'Add menu')));
  await expect(addMenu(page)).toBeVisible();
  await tap(page, await centre(page.locator('.canvas-wrap .card[data-card-id="home-note"]')));
  await expect(addMenu(page)).toHaveCount(0);
});
