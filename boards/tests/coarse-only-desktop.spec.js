// The other half of tests/touch/finger-fields.spec.js: the finger sizes and the
// 16px fields are for a coarse pointer only. A computer with a mouse keeps the
// sizes its stylesheets give it, and its own wording.
import { expect, test } from '@playwright/test';

test('a mouse keeps its field sizes, its small Done and its wording', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'a computer with a mouse');
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  const sizes = await page.evaluate(() => {
    const make = (tag, cls) => {
      const el = document.createElement(tag);
      if (cls) el.className = cls; else el.style.font = '400 11px/1 sans-serif';
      document.body.appendChild(el);
      const cs = getComputedStyle(el);
      const out = { font: parseFloat(cs.fontSize), h: parseFloat(cs.height), minH: cs.minHeight };
      el.remove();
      return out;
    };
    return {
      input: make('input').font, select: make('select').font,
      done: make('button', 'cnv-hint-btn').h,
      settingsX: make('button', 'settings-x').h,
      scope: make('button', 'share-scope-btn').minH,
    };
  });
  expect(sizes).toEqual({ input: 11, select: 11, done: 22, settingsX: 24, scope: expect.stringMatching(/^(auto|0px)$/) });
  await expect(page.locator('.cnv-empty-tiles-sub-fine')).toBeVisible();
  await expect(page.locator('.cnv-empty-tiles-sub-coarse')).toBeHidden();
});
