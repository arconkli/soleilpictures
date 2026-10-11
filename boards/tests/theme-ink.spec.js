// theme-ink.spec.js — computed colours the stylesheet promises, per theme.
//
// Each test mounts the bare class names into the running app (so the real,
// fully cascaded styles.css applies) and reads getComputedStyle. They pin
// colour decisions that look right in one theme and break in the other.

import { expect, test } from '@playwright/test';

async function boot(page, theme) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.app')).toBeAttached();
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
}

// Mount `html` in a throwaway host and return the computed `prop` of the
// element matching `sel` inside it.
async function computed(page, html, sel, prop) {
  return page.evaluate(({ html, sel, prop }) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    const v = getComputedStyle(host.querySelector(sel))[prop];
    host.remove();
    return v;
  }, { html, sel, prop });
}

// Relative luminance of an rgb()/rgba() string, ignoring alpha.
function lum(rgb) {
  const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// VIS-06: chips that sit on media are dark in both themes, so their ink must
// be fixed light ink, not the theme's --ink-* (near-black in light theme).
test('dark media chips keep light ink in light theme', async ({ page }) => {
  await boot(page, 'light');
  const chips = [
    ['<div class="ic"><a class="ic-link">x</a></div>', '.ic-link'],
    ['<div class="bc-cover-ovl"><span class="bc-tag">Board</span></div>', '.bc-tag'],
    ['<button class="lc-embed-title-add">title</button>', '.lc-embed-title-add'],
  ];
  for (const [html, sel] of chips) {
    const color = await computed(page, html, sel, 'color');
    expect(lum(color), `${sel} ink is ${color} on a dark chip`).toBeGreaterThan(0.5);
  }
});
