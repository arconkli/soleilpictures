// Quick look closes on Escape only when it is the top layer.
//
// Its key handler runs in the capture phase, so it used to see Escape before
// anything opened over it — a review player, a viewer — and closed itself,
// leaving that layer standing over the Files panel. Layers register with
// lib/modalGuard.js; Quick look now asks isTopModal() first. Driven through
// the ?local=1 harness, with a stand-in layer registered through the app's
// own modalGuard module (Vite serves the one instance the app imported).
import { expect, test } from '@playwright/test';

async function openQuickLook(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const tile = page.locator('.list-wrap.is-panel .ct-jg [data-item-id]').nth(1);
  await tile.click();
  await page.keyboard.press('Space');
  await expect(page.locator('.ql')).toBeVisible();
}

test('Escape with a layer over Quick look closes that layer, not Quick look', async ({ page }) => {
  await openQuickLook(page);
  await page.evaluate(async () => {
    const guard = await import('/src/lib/modalGuard.js');
    window.__qlTop = { closed: 0 };
    window.__qlTop.unregister = guard.registerModalOpen({
      onEscape: () => { window.__qlTop.closed += 1; window.__qlTop.unregister(); },
    });
  });
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.__qlTop.closed)).toBe(1);
  await expect(page.locator('.ql')).toBeVisible();
  // With the layer gone, Quick look is on top again and Escape is its own.
  await page.keyboard.press('Escape');
  await expect(page.locator('.ql')).toHaveCount(0);
});

test('arrow keys under a layer stay with that layer', async ({ page }) => {
  await openQuickLook(page);
  const before = await page.locator('.ql').getAttribute('aria-label');
  await page.evaluate(async () => {
    const guard = await import('/src/lib/modalGuard.js');
    window.__qlUnreg = guard.registerModalOpen();
  });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.ql')).toHaveAttribute('aria-label', before || '');
  await page.evaluate(() => window.__qlUnreg());
});
