import { expect, test } from '@playwright/test';

// Regression: every image entry point must open a MULTI-select picker.
//
// The empty board's hero tile is the primary affordance of the shipped
// image-first onboarding (onboarding_v2 arm B), and it used to call
// mutators.addImageAt — a picker with no `multiple` that read files[0]. So the
// one action the onboarding teaches could only ever produce a single card,
// while returning at all is sharply gated on reaching ~6 cards on day one.
//
// The picker is a detached <input> that is .click()ed to open the OS dialog,
// which Playwright cannot drive. Patching HTMLInputElement.prototype.click to
// capture the element instead of opening anything lets us assert the thing that
// actually matters — `multiple` and `accept` — without a native dialog.
async function capturePickers(page) {
  await page.addInitScript(() => {
    window.__pickers = [];
    const realClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') {
        window.__pickers.push({ multiple: this.multiple, accept: this.accept || '' });
        return; // swallow — never open a native dialog mid-test
      }
      return realClick.apply(this, arguments);
    };
  });
}

const lastPicker = (page) => page.evaluate(() => window.__pickers.at(-1) || null);

test('the empty board image tile opens a multi-select picker', async ({ page }) => {
  await capturePickers(page);
  // blank=1 gates autoFrame and leaves the board genuinely empty, which is what
  // renders the "Start your …" tiles.
  await page.goto('/?local=1&reset=1&blank=1');

  const tile = page.getByRole('button', { name: /Add images/i });
  await expect(tile).toBeVisible({ timeout: 15000 });
  await tile.click();

  await expect.poll(() => lastPicker(page), { timeout: 5000 }).toEqual({
    multiple: true,
    accept: 'image/*',
  });
});

test('the rail image tool opens a multi-select picker too', async ({ page }) => {
  await capturePickers(page);
  await page.goto('/?local=1&reset=1&blank=1');

  await page.getByRole('button', { name: /image tool/i }).click();
  // The tool is armed; it places on the next canvas click.
  await page.mouse.click(600, 500);

  await expect.poll(() => lastPicker(page), { timeout: 5000 }).toEqual({
    multiple: true,
    accept: 'image/*',
  });
});
