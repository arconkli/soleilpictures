// comments-island-studio-bar.spec.js
//
// On a phone the Studio bar ("8 loose cards …") and the comments island share
// the top of the canvas: the island at the top left, the bar beside it. The
// bar's phone rule (styles.css, .cnv-studio-bar under max-width: 640px) was
// written when the island was a bare eye button; the island now carries a
// count. Neither may cover the other, with no comments, with a few, and with
// a two- or three-digit count.

import { expect, test } from '@playwright/test';
import { seedComments, commentRows } from '../commentSeed.js';

test.use({ viewport: { width: 390, height: 780 } });

const SHOTS = process.env.CMT_SHOTS || '';

const points = (n) => {
  const base = commentRows().find((r) => r.anchor_kind === 'point');
  return Array.from({ length: n }, (_, i) => ({
    ...base, id: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, anchor_x: 200 + i * 40, anchor_y: 900,
  }));
};

async function boxes(page) {
  return page.evaluate(() => {
    const r = (sel) => { const b = document.querySelector(sel)?.getBoundingClientRect(); return b ? { l: b.left, r: b.right, t: b.top, b: b.bottom } : null; };
    return { eye: r('.cnv-comments-eye'), bar: r('.cnv-studio-bar') };
  });
}

for (const [name, n] of [['no comments', 0], ['three open', 3], ['a two-digit count', 12], ['a three-digit count', 120]]) {
  for (const scheme of ['dark', 'light']) {
    test(`the Studio bar and the comments island stand apart: ${name}, ${scheme}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'mobile-chrome', 'phone width, one engine');
      await seedComments(page, { rows: points(n), voteCard: false });
      await page.goto('/?local=1&reset=1&blank=1&mixqa=8');
      const bar = page.locator('.cnv-studio-bar');
      await expect(bar.locator('.cnv-studio-bar-txt')).toContainText('8 loose cards');
      await page.evaluate((th) => document.documentElement.setAttribute('data-theme', th), scheme);
      const eye = page.locator('.cnv-comments-eye');
      await expect(eye).toBeVisible();
      if (n) await expect(eye.locator('.cnv-comments-eye-count')).toHaveText(String(n));
      // the bar slides in: wait until it stops moving
      await expect.poll(async () => { const a = await boxes(page); await page.waitForTimeout(120); const b = await boxes(page); return a.bar.l === b.bar.l && a.bar.t === b.bar.t; }).toBe(true);
      const { eye: e, bar: b } = await boxes(page);
      const apart = e.r + 6 <= b.l || b.r + 6 <= e.l || e.b + 6 <= b.t || b.b + 6 <= e.t;
      expect(apart, `island ${JSON.stringify(e)} bar ${JSON.stringify(b)}`).toBe(true);
      expect(b.l).toBeGreaterThanOrEqual(0);
      expect(b.r).toBeLessThanOrEqual(390);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/island-studio-bar-${n}-${scheme}.png`, clip: { x: 0, y: 0, width: 390, height: 220 }, scale: 'css' });
    });
  }
}
