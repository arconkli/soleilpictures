// Language choice: Settings › Appearance › Language (development-only row for
// now), and the account following the person between devices
// (lib/accountLocale.js). The signed-in app runs on tests/helpers/signedInStub.js
// with a stateful profile: the profile GET returns the current settings and
// merge_profile_settings merges its patch into them (top-level keys replaced).
//
// bootSignedIn re-plants the session on every load, so after a reload
// user_metadata is back to the planted one: the account write is asserted as
// "some PUT carried data.locale X", never as a count of PUTs.
import { test, expect } from '@playwright/test';
import { bootSignedIn, USER_ID } from './helpers/signedInStub.js';

function statefulProfile(initialSettings = {}) {
  const state = { settings: initialSettings };
  const row = () => ({
    user_id: USER_ID, display_name: 'Sam Rivera', color: null, avatar_url: null,
    settings: state.settings, updated_at: '2026-10-01T00:00:00Z',
  });
  return {
    state,
    rest: { profiles: (url, method) => (method === 'GET' ? [row()] : []) },
    rpc: {
      merge_profile_settings: (body) => {
        state.settings = { ...state.settings, ...((body && body.p_patch) || {}) };
        return state.settings;
      },
    },
  };
}

async function open(browser, { locale = 'en-US', settings = {}, userMetadata, init } = {}) {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  let loads = 0;
  page.on('load', () => { loads += 1; });
  if (init) await page.addInitScript(init);
  const profile = statefulProfile(settings);
  const { calls } = await bootSignedIn(page, { rpc: profile.rpc, rest: profile.rest, userMetadata });
  return { context, page, calls, problems, profile, loads: () => loads };
}

// Console errors that come from the network and the missing backend in the
// harness, not from the page's own code.
const own = (problems) => problems.filter((p) => p.startsWith('pageerror') || /i18n|lingui|catalog|locale/i.test(p));

const accountWrites = (calls) => calls.filter((c) => c.path === 'auth/user' && c.method === 'PUT');

test.describe('language setting', () => {
  test('choosing Español in Settings saves it, reloads once and writes the account', async ({ browser }) => {
    const { context, page, calls, problems, profile, loads } = await open(browser);
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    expect(loads()).toBe(1);

    await page.locator('button[aria-label="Settings"]').first().click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Appearance' }).click();
    const select = settings.locator('select.settings-input').first();
    await expect(select).toBeVisible();
    await select.selectOption('es');

    await expect(page.locator('html')).toHaveAttribute('lang', 'es', { timeout: 30000 });
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    expect(loads()).toBe(2);

    const merges = calls.filter((c) => c.path === 'rpc/merge_profile_settings');
    expect(merges.length).toBeGreaterThan(0);
    expect(merges.some((c) => c.body && c.body.p_patch && c.body.p_patch.ui && c.body.p_patch.ui.lang === 'es')).toBe(true);
    expect(profile.state.settings.ui.lang).toBe('es');
    await expect.poll(() => accountWrites(calls).some((c) => c.body && c.body.data && c.body.data.locale === 'es')).toBe(true);
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('a new device follows the account: one reload into the account language', async ({ browser }) => {
    const { context, page, problems, loads } = await open(browser, { settings: { ui: { lang: 'fr' } } });
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr', { timeout: 30000 });
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    expect(loads()).toBe(2);
    await page.waitForTimeout(2000);
    expect(loads()).toBe(2);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('a boot that loses the choice reloads once, not in a loop', async ({ browser }) => {
    const { context, page, problems, loads } = await open(browser, {
      settings: { ui: { lang: 'fr' } },
      init: () => { try { localStorage.setItem('soleil.ui', '{"lang":"en"}'); } catch (_) { /* ignore */ } },
    });
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    await expect.poll(() => loads(), { timeout: 30000 }).toBe(2);
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    await page.waitForTimeout(2000);
    expect(loads()).toBe(2);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(own(problems)).toEqual([]);
    await context.close();
  });

  test('an English account on an English browser loads once and writes nothing to the account', async ({ browser }) => {
    const { context, page, calls, problems, loads } = await open(browser);
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    await page.waitForTimeout(2000);
    expect(loads()).toBe(1);
    expect(accountWrites(calls)).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(own(problems)).toEqual([]);
    await context.close();
  });
});
