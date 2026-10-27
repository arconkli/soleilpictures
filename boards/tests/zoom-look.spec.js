// The canvas's zoom in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21, mockup A-add), shipped 2026-10-25: − and + are icons, not the
// glyphs; the slider's track fills up to its knob as the zoom moves; the
// readout is still the button that puts it back to 100%; and the tooltips say
// each key.
//
// On the real canvas, through ?local=1.
import { expect, test } from '@playwright/test';

const zoom = (page) => page.getByRole('group', { name: 'Zoom' });

async function open(page) {
  await page.goto('/?local=1&reset=1');
  await expect(zoom(page)).toBeVisible({ timeout: 30000 });
}

test('− and + are icons, the track fills to the knob, and the readout puts it back to 100%', async ({ page }) => {
  await open(page);
  const out = zoom(page).getByRole('button', { name: 'Zoom out', exact: true });
  const inn = zoom(page).getByRole('button', { name: 'Zoom in', exact: true });
  await expect(out.locator('svg')).toHaveCount(1);
  await expect(inn.locator('svg')).toHaveCount(1);
  await expect(out).toHaveText('');
  await expect(inn).toHaveAttribute('data-tl-tip', 'Zoom in');
  await expect(inn).toHaveAttribute('data-tl-keys', 'Mod+=');

  const slider = zoom(page).getByRole('slider', { name: 'Zoom' });
  const fill = () => slider.evaluate((el) => parseFloat(el.style.getPropertyValue('--zf')));
  const at = () => slider.evaluate((el) => Number(el.value) / 10);
  expect(await fill()).toBeCloseTo(await at(), 1);
  const before = await fill();
  // dispatchEvent: the local harness's settings gear sits over the bar's
  // corner (canvas-camera-fixes.spec.js says the same).
  await inn.dispatchEvent('click');
  await expect.poll(fill).toBeGreaterThan(before);
  expect(await fill()).toBeCloseTo(await at(), 1);

  const readout = zoom(page).getByRole('button', { name: /% — reset to 100%$/ });
  await readout.click();
  await expect(readout).toHaveText('100%');
});
