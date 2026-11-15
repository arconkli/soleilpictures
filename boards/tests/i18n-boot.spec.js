// Language boot: main.jsx picks the interface language from the saved choice
// (soleil.ui → lang) or the browser's, loads its catalog before the first paint
// and sets <html lang>. The public site (/docs, /c/…) stays English. ?lang=pseudo
// is the dev-only pseudo-locale. Runs on the signed-out front door, where
// nothing else writes <html lang>.
import { test, expect } from '@playwright/test';

async function open(browser, { locale, cache, path = '/' }) {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  if (cache) {
    await page.addInitScript((c) => {
      try { localStorage.setItem('soleil.ui', JSON.stringify(c)); } catch (_) { /* ignore */ }
    }, cache);
  }
  await page.goto(path);
  return { context, page, problems };
}

// Console errors that come from the network and the missing backend in the
// harness, not from the page's own code.
const own = (problems) => problems.filter((p) => p.startsWith('pageerror') || /i18n|lingui|catalog|locale/i.test(p));

test.describe('language boot', () => {
  test('a Spanish browser on / gets Spanish', async ({ browser }) => {
    const { context, page, problems } = await open(browser, { locale: 'es-ES' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('a Spanish browser on /docs stays English', async ({ browser }) => {
    const { context, page, problems } = await open(browser, { locale: 'es-ES', path: '/docs' });
    await page.waitForLoadState('load');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('an English browser on / stays English', async ({ browser }) => {
    const { context, page, problems } = await open(browser, { locale: 'en-US' });
    await page.waitForLoadState('load');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('the saved language beats the browser', async ({ browser }) => {
    const { context, page, problems } = await open(browser, { locale: 'en-US', cache: { lang: 'ja' } });
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('?lang=pseudo (dev) stays English with no errors', async ({ browser }) => {
    const { context, page, problems } = await open(browser, { locale: 'en-US', path: '/?lang=pseudo' });
    await page.waitForLoadState('load');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(own(problems)).toEqual([]);
    await context.close();
  });
});
