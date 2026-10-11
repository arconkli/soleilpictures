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
  await expect(page.locator('.app')).toBeAttached();
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
