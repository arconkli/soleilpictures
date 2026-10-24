// Korean typing on the canvas. The Enter that picks a syllable belongs to the
// IME: a field that acts on it posts, names or tags with the word cut short,
// and the syllable then lands again where the field has gone (the doc's title
// page once read 봄날날). Each field here leaves a syllable still being
// composed alone, and acts on the next Enter. tests/imeHelpers.js drives
// Chromium's IME the way a Korean keyboard does.
import { expect, test } from '@playwright/test';
import { korean } from './imeHelpers.js';

test.skip(({ browserName }) => browserName !== 'chromium', 'CDP drives Chromium\'s IME');

// The body of every comment the canvas posts. The harness has no backend, so
// each is refused at once: left to the network, the refusal takes seconds, and
// a post made mid-syllable showed only after the test had stopped looking.
async function commentPosts(page) {
  const bodies = [];
  await page.route('**/rest/v1/comments**', (route) => {
    const req = route.request();
    if (req.method() !== 'POST') return route.fallback();
    bodies.push(JSON.parse(req.postData() || '{}').body);
    return route.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"refused by the test"}' });
  });
  return bodies;
}

test('a comment on the canvas: Enter mid-syllable posts nothing; the next Enter posts it whole', async ({ page }) => {
  const posts = await commentPosts(page);
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.click(cb.x + cb.width - 90, cb.y + 110, { button: 'right' });
  await page.locator('.ctx-menu').first().locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('menuitem', { name: 'Comment', exact: true }).click();
  const input = page.locator('.canvas-comment-draft-input');
  await expect(input).toBeFocused();
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('컷이 늦다');
  await expect(input).toHaveValue('컷이 늦다');
  await page.waitForTimeout(400);
  expect(posts).toEqual([]);
  await page.keyboard.press('Enter');
  await expect.poll(() => posts).toEqual(['컷이 늦다']);
  await expect(input).toHaveValue('컷이 늦다');
});

test('a project\'s name: Enter mid-syllable keeps the field; the next Enter names it', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.locator('.sb-row', { hasText: 'Home' }).first().click();
  await page.locator('.ph-tile-new').click();
  await page.locator('.ph-new-input').press('Enter');
  const name = page.locator('.cnv-empty-project-name');
  await expect(name).toHaveValue('');
  await name.click();
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('봄 광고');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('봄 광고');
  await page.keyboard.press('Enter');
  await expect(name).not.toBeFocused();
  await expect(name).toHaveValue('봄 광고');
  await expect(page.locator('.crumbs .crumb').last()).toHaveText('봄 광고');
});

test('the tag picker: Enter mid-syllable keeps it open with the whole word', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
  await page.locator('.canvas-wrap .card[data-card-id="home-note"]').click({ button: 'right', position: { x: 12, y: 12 } });
  await page.locator('.ctx-menu').first().getByRole('menuitem', { name: 'Tag…', exact: true }).click();
  const input = page.locator('.tag-picker-input');
  await expect(input).toBeFocused();
  const ko = await korean(page);
  await ko.typeThenEnterMidSyllable('색감');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('색감');
});
