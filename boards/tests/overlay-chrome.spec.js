// overlay-chrome.spec.js — fixed chrome must not sit on top of what it
// shares the screen with.
//
// These mount bare class names into the running app so the real cascaded
// styles.css applies, then measure. They pin layering and placement rules
// that only show up on a particular account tier or device.

import { expect, test } from '@playwright/test';

async function boot(page, size = { width: 1280, height: 800 }) {
  await page.setViewportSize(size);
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.app')).toBeAttached({ timeout: 30000 }); // cold Vite compile
}

// VIS-05: the demo Upgrade chip (z near INT_MAX, top-right) landed on Quick
// Look's Close button and on every full-screen overlay's top-right controls.
test('the Upgrade chip steps aside while a full-screen overlay is open', async ({ page }) => {
  await boot(page);
  const overlays = ['ql', 'doc-card-modal doc-card-modal-full', 'doc-card-modal doc-card-modal-side', 'schedc-fs', 'iem', 'lightbox'];
  const shown = await page.evaluate((overlays) => {
    const chip = document.createElement('button');
    chip.className = 'upgrade-chip';
    document.body.appendChild(chip);
    const out = { alone: getComputedStyle(chip).visibility };
    for (const cls of overlays) {
      const ov = document.createElement('div');
      ov.className = cls;
      document.body.appendChild(ov);
      out[cls] = getComputedStyle(chip).visibility;
      ov.remove();
    }
    chip.remove();
    return out;
  }, overlays);
  expect(shown.alone, 'the chip must show when nothing covers the screen').toBe('visible');
  for (const cls of overlays) expect(shown[cls], `chip over .${cls}`).toBe('hidden');
});

// VIS-08: the note bar's keyboard lift wrote `bottom: 8px` inline even with
// no keyboard up, beating the stylesheet's nav clearance and parking the bar
// behind the fixed bottom nav.
test('the note formatting bar clears the phone bottom nav with no keyboard up', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  await page.locator('.canvas-wrap').click({ position: { x: 195, y: 300 } });
  await page.locator('.note-body[contenteditable="true"]').waitFor();
  const bar = page.locator('.tob').first();
  await expect(bar).toBeVisible();
  const nav = await page.locator('.mb-nav').boundingBox();
  const box = await bar.boundingBox();
  expect(nav, 'the bottom nav must be laid out').not.toBeNull();
  expect(box.y + box.height, 'the bar must sit above the bottom nav').toBeLessThanOrEqual(nav.y);
  // The keyboard lift measures from the viewport, so the bar must be fixed
  // to it — the grain layering block's `position: absolute` used to win.
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
});

// VIS-13: on a phone a long toast filled the width from the right gutter and
// touched the left screen edge.
test('a long toast keeps a gutter on both sides on a phone', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  const { left, right } = await page.evaluate(() => {
    const stack = document.createElement('div');
    stack.className = 'toast-stack';
    stack.innerHTML = '<div class="toast">' + 'A long toast message that wraps. '.repeat(6) + '</div>';
    document.body.appendChild(stack);
    // Measure the resting place, not the toastIn slide's first frame.
    stack.firstElementChild.getAnimations().forEach((a) => a.finish());
    const r = stack.firstElementChild.getBoundingClientRect();
    stack.remove();
    return { left: r.left, right: window.innerWidth - r.right };
  });
  expect(left, 'left gutter').toBeGreaterThanOrEqual(12);
  expect(right, 'right gutter').toBeGreaterThanOrEqual(12);
});

// MOBILE-03: Share / Trash / History mount in ModalShell, whose desktop
// backdrop padding (24px) left the "full-screen" phone panel inset on three
// sides and running off the bottom, with the backdrop scrolling as well.
test('ModalShell dialogs are full-bleed on a phone', async ({ page }) => {
  await boot(page, { width: 390, height: 844 });
  for (const cls of ['modal', 'share-modal']) {
    const r = await page.evaluate((cls) => {
      const bg = document.createElement('div');
      bg.className = 'modal-shell-bg';
      bg.innerHTML = `<div class="modal-shell ${cls}" role="dialog"></div>`;
      document.body.appendChild(bg);
      const panel = bg.firstElementChild;
      panel.getAnimations().forEach((a) => a.finish());
      const box = panel.getBoundingClientRect();
      const out = { left: box.left, right: box.right, bottom: box.bottom, scrolls: bg.scrollHeight > bg.clientHeight };
      bg.remove();
      return out;
    }, cls);
    expect(r.left, `.${cls} left edge`).toBe(0);
    expect(r.right, `.${cls} right edge`).toBe(390);
    expect(r.bottom, `.${cls} must end on screen`).toBeLessThanOrEqual(844);
    expect(r.scrolls, `.${cls} backdrop must not scroll`).toBe(false);
  }
});

// MOBILE-04: iOS zooms the app on focus of any field under 16px. Coarse
// pointers get 16px on every field a phone user types into.
test('text fields are at least 16px on a touch device', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.app')).toBeAttached({ timeout: 30000 }); // cold Vite compile
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'the context must report a coarse pointer').toBe(true);
  // The comment box's styles arrive with the comment parts, the first time
  // one is wanted: focusing the comments island asks for them.
  await page.locator('.cnv-comments-eye').focus();
  await page.waitForFunction(() => [...document.styleSheets].some((s) => {
    try { return [...s.cssRules].some((r) => /\.cmt-input\b/.test(r.selectorText || '')); } catch (_) { return false; }
  }));
  const sizes = await page.evaluate(() => {
    const out = {};
    // [tag, class, the class of what it sits in]: a comment's box (new
    // comment, reply and edit alike) takes its size from the card it is in.
    for (const [tag, cls, within] of [['textarea', 'msg-composer-input'], ['input', 'share-input'],
      ['textarea', 'cmt-input', 'cmt-card cmt-card--sheet'], ['textarea', 'cmt-input', 'cmt-card cmt-card--float'], ['input', 'cmdk-input']]) {
      const host = document.createElement('div');
      if (within) host.className = within;
      const el = document.createElement(tag);
      el.className = cls;
      host.appendChild(el);
      document.body.appendChild(host);
      out[within ? `${within.split(' ').pop()} .${cls}` : cls] = parseFloat(getComputedStyle(el).fontSize);
      host.remove();
    }
    return out;
  });
  expect(Object.keys(sizes)).toHaveLength(5);
  for (const [cls, px] of Object.entries(sizes)) expect(px, `.${cls}`).toBeGreaterThanOrEqual(16);
  await ctx.close();
});
