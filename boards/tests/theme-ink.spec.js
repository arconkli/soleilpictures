// theme-ink.spec.js — computed colours the stylesheet promises, per theme.
//
// Each test mounts the bare class names into the running app (so the real,
// fully cascaded styles.css applies) and reads getComputedStyle. They pin
// colour decisions that look right in one theme and break in the other.

import { expect, test } from '@playwright/test';

async function boot(page, theme) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.app')).toBeAttached({ timeout: 30000 }); // cold Vite compile
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

const GOLD = 'rgb(255, 165, 0)';

// Gold (--soleil) is reserved for active / selection / focus. These resting
// elements wore it anyway (VIS-09, MOBILE-16, SHARE-17).
test('resting icons and labels are not gold', async ({ page }) => {
  await boot(page, 'dark');
  const resting = [
    ['<button class="mobile-add-tile"><span class="mobile-add-ico">+</span></button>', '.mobile-add-ico', 'color'],
    ['<button class="ac-play" aria-label="Play"></button>', '.ac-play', 'backgroundColor'],
    ['<span class="entity-picker-url">https://x</span>', '.entity-picker-url', 'color'],
    ['<span class="ent-backlinks-row-tag">tag</span>', '.ent-backlinks-row-tag', 'color'],
    ['<span class="tag-picker-kind tag-picker-kind-auto">auto</span>', '.tag-picker-kind-auto', 'color'],
    ['<span class="tag-picker-kind tag-picker-kind-new">new</span>', '.tag-picker-kind-new', 'color'],
    ['<span class="tag-detail-row-attr is-auto">auto</span>', '.is-auto', 'color'],
    ['<span class="tag-detail-block-attr is-auto">auto</span>', '.is-auto', 'color'],
    ['<span class="picker-dot list"></span>', '.picker-dot', 'backgroundColor'],
    ['<button class="tag-disambig-yes">Yes</button>', '.tag-disambig-yes', 'color'],
    // SHARE-17: the doc margin's comment dots.
    ['<div class="comment-gutter"><button class="comment-gutter-dot"></button></div>', '.comment-gutter-dot', 'backgroundColor'],
  ];
  for (const [html, sel, prop] of resting) {
    expect(await computed(page, html, sel, prop), `${sel} ${prop} at rest`).not.toBe(GOLD);
  }
  // The play button still lights up while its card is playing.
  expect(await computed(page, '<button class="ac-play is-playing" aria-label="Pause"></button>', '.ac-play', 'backgroundColor')).toBe(GOLD);
});

// UNREAD-BADGE-NEUTRAL: unread counts share one inverse-ink pill, never gold,
// and the count reads against its pill in both themes.
test('unread counts are inverse ink in both themes', async ({ page }) => {
  for (const theme of ['dark', 'light']) {
    await boot(page, theme);
    for (const [html, sel] of [
      ['<span class="mb-nav-badge">3</span>', '.mb-nav-badge'],
      ['<span class="sb-row-count has-unread">3</span>', '.sb-row-count'],
      ['<span class="msg-row-count">3</span>', '.msg-row-count'],
    ]) {
      const bg = await computed(page, html, sel, 'backgroundColor');
      const fg = await computed(page, html, sel, 'color');
      expect(bg, `${sel} in ${theme}`).not.toBe(GOLD);
      const [hi, lo] = [lum(bg), lum(fg)].sort((a, b) => b - a);
      expect((hi + 0.05) / (lo + 0.05), `${sel} contrast in ${theme}`).toBeGreaterThan(7);
    }
  }
});

// DOCS-23: note headings had no rule and fell to the UA's 2em / 1.5em /
// 1.17em. They follow a scale relative to the note's own text size.
test('note headings use the note scale, not browser defaults', async ({ page }) => {
  await boot(page, 'dark');
  const px = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="note-body"><h1>a</h1><h2>b</h2><h3>c</h3><p>d</p></div>';
    document.body.appendChild(host);
    const size = (sel) => parseFloat(getComputedStyle(host.querySelector(sel)).fontSize);
    const out = { h1: size('h1'), h2: size('h2'), h3: size('h3'), p: size('p') };
    host.remove();
    return out;
  });
  expect(px.h1 / px.p).toBeCloseTo(1.35, 2);
  expect(px.h2 / px.p).toBeCloseTo(1.18, 2);
  expect(px.h3 / px.p).toBeCloseTo(1.05, 2);
});
