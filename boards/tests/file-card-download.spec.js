// A file card's Download button says it is working, and says when it failed.
//
// Before: a big file sat for minutes with no sign anything was happening (so
// people clicked again), and a download that failed past the helper's own
// fallback was swallowed by an empty catch. Driven through ?local=1: a pasted
// .zip becomes a file card whose source is a blob: URL, and the page's fetch
// (and window.open, the helper's last resort) are stubbed to hold or fail it.
import { expect, test } from '@playwright/test';

async function fileCard(page, query = '') {
  await page.goto(`/?local=1&reset=1&blank=1${query}`);
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.mouse.move(640, 420);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['PK\u0003\u0004 not really a zip'], 'reference-pack.zip', { type: 'application/zip' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const card = page.locator('.filec').first();
  await expect(card).toBeVisible();
  return card;
}

// Hold every blob: fetch until window.__release() is called.
async function holdBlobFetches(page) {
  await page.evaluate(() => {
    const real = window.fetch;
    window.__release = null;
    window.fetch = (url, opts) => (String(url).startsWith('blob:')
      ? new Promise((resolve) => { window.__release = () => resolve(real.call(window, url, opts)); })
      : real(url, opts));
  });
}

test('the download chip shows a busy state while the file is being prepared', async ({ page }) => {
  const card = await fileCard(page);
  // Hold every blob: fetch until released.
  await page.evaluate(() => {
    const real = window.fetch;
    window.__release = null;
    window.fetch = (url, opts) => (String(url).startsWith('blob:')
      ? new Promise((resolve) => { window.__release = () => resolve(real.call(window, url, opts)); })
      : real(url, opts));
  });
  const chip = card.locator('.ic-expand');
  await card.hover();
  await chip.click();
  await expect(chip).toHaveClass(/is-busy/);
  await expect(chip).toHaveAttribute('aria-busy', 'true');
  await expect(chip).toHaveAttribute('title', 'Preparing download…');
  await expect.poll(() => page.evaluate(() => typeof window.__release)).toBe('function');
  await page.evaluate(() => window.__release());
  await expect(chip).not.toHaveClass(/is-busy/);
});

test('a download that fails says so instead of doing nothing', async ({ page }) => {
  const card = await fileCard(page);
  await page.evaluate(() => {
    const real = window.fetch;
    window.fetch = (url, opts) => (String(url).startsWith('blob:')
      ? Promise.reject(new TypeError('Failed to fetch'))
      : real(url, opts));
    window.open = () => { throw new Error('popup blocked'); };
  });
  await card.hover();
  await card.locator('.ic-expand').click();
  await expect(page.locator('.toast.toast-error')).toContainText('Download failed');
});

// The canvas's own Download (context menu) has no control left to show a
// spinner on once the menu closes. With no activity tray on the page (the
// local shell has none; the app's loads just after boot) a held download gets
// one toast.
test('a slow Download from the card menu says "Preparing download…" until it lands', async ({ page }) => {
  const card = await fileCard(page);
  await holdBlobFetches(page);
  await card.click({ button: 'right' });
  await page.locator('.ctx-item', { hasText: /^Download$/ }).first().click();
  const busy = page.locator('.toast', { hasText: 'Preparing download…' });
  await expect(busy).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__release)).toBe('function');
  await page.evaluate(() => window.__release());
  await expect(busy).toHaveCount(0);
});

// With the tray up, as in the signed-in app (?activity=1 mounts it in the
// local shell), the wait is a row in the tray instead: a chip, since it is
// one file, after the tray's one-second beat. No toast.
test('with the activity tray up, a slow card-menu Download is a "Preparing <name>…" chip until it lands', async ({ page }) => {
  const card = await fileCard(page, '&activity=1');
  await expect(page.locator('.atr-col')).toBeAttached();
  await holdBlobFetches(page);
  await card.click({ button: 'right' });
  await page.locator('.ctx-item', { hasText: /^Download$/ }).first().click();
  const busy = page.locator('.atr-chip', { hasText: /Preparing reference-pack\.zip…/ });
  await expect(busy).toBeVisible();
  await expect(page.locator('.toast', { hasText: 'Preparing download…' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => typeof window.__release)).toBe('function');
  await page.evaluate(() => window.__release());
  await expect(busy).toHaveCount(0);
});

// A plain file opens full screen like everything else (Quick look, with its
// Download there), instead of downloading on the spot (owner, 2026-10-18).
test('double-clicking a plain file opens it full screen instead of downloading', async ({ page }) => {
  const card = await fileCard(page);
  let downloads = 0;
  page.on('download', () => { downloads += 1; });
  await card.locator('.filec-body').dblclick();
  const ql = page.getByRole('dialog', { name: /Quick look: reference-pack\.zip/ });
  await expect(ql).toBeVisible();
  await expect(ql.getByRole('button', { name: 'Download' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(ql).toHaveCount(0);
  expect(downloads).toBe(0);
});
