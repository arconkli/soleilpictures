// Runtime checks for the tags / entities / feedback audit fixes that can be
// exercised without a live Supabase. Components are mounted on their own by
// tests/helpers/tagsProbe.js (served by the dev server), on top of the
// ?local=1&blank=1 shell so the page has the app's styles.
import { expect, test } from '@playwright/test';

async function probe(page, fn, ...args) {
  await page.evaluate(async ({ fn, args }) => {
    const m = await import('/tests/helpers/tagsProbe.js');
    m[fn](...args);
  }, { fn, args });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForLoadState('domcontentloaded');
});

test('TAGS-13: Escape while feedback is sending keeps the modal, and a failed send is shown', async ({ page }) => {
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route('**/functions/v1/send-feedback', async (route) => {
    await held;
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'probe failure' }) });
  });
  await probe(page, 'mountFeedback');

  await page.locator('.feedback-trigger').click();
  const modal = page.locator('.feedback-modal');
  await expect(modal).toBeVisible();
  await page.locator('.feedback-kind').first().click();
  await modal.locator('.btn-primary').click();
  await expect(modal.locator('.btn-primary')).toHaveText('Sending…');

  await page.keyboard.press('Escape');
  await expect(modal, 'Escape must not close the modal mid-send').toBeVisible();

  release();
  await expect(modal.locator('.feedback-error')).toContainText('probe failure');
  // Once the send has settled, Escape works again.
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('MOBILE-14: the tag popover footer shows under keyboard focus and on touch', async ({ page }) => {
  await probe(page, 'mountTagPopover');
  const footer = page.locator('.tag-pop-footer');
  await expect(footer).toHaveCount(2);           // Remove tag + View tag
  const opacity = (i) => footer.nth(i).evaluate((el) => getComputedStyle(el).opacity);
  // Not hovered, not focused: hidden at rest on a pointer device.
  await page.mouse.move(1, 1);
  await expect.poll(() => opacity(0)).toBe('0');
  // Keyboard focus on either footer button reveals both.
  await footer.nth(1).focus();
  await expect.poll(() => opacity(0)).toBe('1');
  await expect.poll(() => opacity(1)).toBe('1');
  // Touch: the coarse-pointer block always shows it (the media query can't
  // be emulated on desktop-chrome, so assert the rule the browser parsed).
  const touchRule = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch (_) { continue; }
      for (const r of Array.from(rules || [])) {
        if (r.type !== CSSRule.MEDIA_RULE) continue;
        if (!/hover:\s*none/.test(r.conditionText) || !/pointer:\s*coarse/.test(r.conditionText)) continue;
        for (const inner of Array.from(r.cssRules)) {
          if (inner.selectorText === '.tag-pop-footer' && inner.style.opacity === '1') return true;
        }
      }
    }
    return false;
  });
  expect(touchRule).toBe(true);
});

test('TAGS-15: the sidebar tag menu opened near the bottom of the window stays on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await probe(page, 'mountSidebarTags', 40);
  const rows = page.locator('.tags-probe-host .sb-tag-row');
  await expect(rows.first()).toBeVisible();
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  const box = await last.boundingBox();
  // Right-click the bottom row a few px above the window's bottom edge.
  await last.click({ button: 'right', position: { x: 20, y: Math.max(2, box.height - 4) } });
  const menu = page.locator('.sb-tag-menu');
  await expect(menu).toBeVisible();
  const m = await menu.boundingBox();
  expect(m.y).toBeGreaterThanOrEqual(0);
  expect(m.y + m.height, 'menu bottom inside the viewport').toBeLessThanOrEqual(700);
  expect(m.x + m.width, 'menu right edge inside the viewport').toBeLessThanOrEqual(1200);
  const del = await menu.getByText('Delete tag').boundingBox();
  expect(del.y + del.height, '"Delete tag" reachable').toBeLessThanOrEqual(700);
});
