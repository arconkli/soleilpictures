// On the final guided-tour step ("Now add anything") the left rail is the
// .tour-target, and the Milanote lock should REVEAL every tool's tooltip at once
// (not just on hover) so a new user can read the whole toolset in one glance. On
// every earlier step the rail is NOT the target, so tooltips stay suppressed.
// Drives the real rail (?local=1) and reads the ::after computed style directly.
import { expect, test } from '@playwright/test';

test.describe('tour final-step rail tooltips', () => {
  test('all rail tooltips show when the rail is the tour target, suppressed otherwise', async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await expect(page.locator('.cnv-tools')).toBeVisible();

    const setTour = (targeted) =>
      page.evaluate((targeted) => {
        const rail = document.querySelector('.cnv-tools');
        document.body.setAttribute('data-tour-active', '1');
        rail.classList.toggle('tour-target', targeted);
      }, targeted);
    const clearTour = () =>
      page.evaluate(() => {
        document.querySelector('.cnv-tools').classList.remove('tour-target');
        document.body.removeAttribute('data-tour-active');
      });
    const tipAfter = (prop) =>
      page.evaluate(
        (prop) => getComputedStyle(document.querySelector('.cnv-tools .cnv-tool[data-tip]'), '::after')[prop],
        prop,
      );

    // Earlier steps: rail not the target → tooltips suppressed by the lock.
    await setTour(false);
    expect(await tipAfter('display')).toBe('none');
    await clearTour();

    // Final step: rail IS the .tour-target → every tooltip is shown without hover
    // (poll past the opacity transition the base ::after declares).
    await setTour(true);
    expect(await tipAfter('display')).not.toBe('none');
    await expect.poll(() => tipAfter('opacity')).toBe('1');
    await clearTour();
  });
});
