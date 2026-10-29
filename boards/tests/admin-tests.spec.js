// Analytics › Tests (0810; the owner's ask of 2026-10-29, look A).
//
// On the DEV-only fixture harness (?adminpreview=1): no auth, no network. The
// read is invented (adminFixtures.js, testsReadFixture) as of 2026-11-20: the
// share ask is past its verdict date, the rest are mid-run, and the sign-up box
// is putting nobody in, so it is the one that needs a look.

import { test, expect } from '@playwright/test';

async function openTests(page, { theme = 'dark' } = {}) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto('/?adminpreview=1&tab=overview&view=tests');
  await expect(page.locator('.adm-tests')).toBeVisible({ timeout: 20000 });
}

function watchConsole(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

// Answers the named RPCs with `value` instead of the fixture.
async function patchRpc(page, overrides) {
  await page.evaluate(async (ov) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const orig = supabase.rpc;
    supabase.rpc = (name, params) => (Object.prototype.hasOwnProperty.call(ov, name)
      ? Promise.resolve(ov[name])
      : orig(name, params));
  }, overrides);
}

const row = (page, name) => page.locator('.adm-tests-row').filter({ has: page.locator('.adm-tests-rn b', { hasText: name }) });

test.describe('Analytics › Tests', () => {
  for (const theme of ['dark', 'light']) {
    test(`it mounts with every test and no console error (${theme})`, async ({ page }) => {
      const errors = watchConsole(page);
      await openTests(page, { theme });
      await expect(page.getByRole('tab', { name: /^tests$/i })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('.adm-tests-sec')).toHaveText([/Running/, /Just changed/, /Waiting or off/, /Earlier tests/]);
      await expect(page.locator('.adm-tests-row')).toHaveCount(7);
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }

  test('no range control and no population toggles; the strip says what it counts', async ({ page }) => {
    await openTests(page);
    await expect(page.getByRole('group', { name: 'Time range' })).toHaveCount(0);
    await expect(page.locator('.admin-toolbar').getByRole('switch')).toHaveCount(0);
    const status = page.locator('.adm-status');
    await expect(status).toContainText('TESTS');
    await expect(status).toContainText(/RUNNING\s*4/);
    await expect(status).toContainText(/NEEDS A LOOK\s*1/);
    await expect(status).toContainText('left out');
    await expect(status).not.toContainText('WINDOW');
  });

  test('the test that needs a look opens by itself, and says why', async ({ page }) => {
    await openTests(page);
    const box = row(page, 'Sign-up box');
    await expect(box.locator('.adm-tests-row-h')).toHaveAttribute('aria-expanded', 'true');
    await expect(box.locator('.adm-tests-rk')).toContainText('Needs a look');
    await expect(box.locator('.adm-tests-checks li.c-look').first()).toBeVisible();
    // Only one open at a time.
    await expect(page.locator('.adm-tests-det')).toHaveCount(1);
  });

  test('a row opens into both sides, the comparison and the checks', async ({ page }) => {
    await openTests(page);
    const setup = row(page, 'Workspace setup');
    await setup.locator('.adm-tests-row-h').click();
    await expect(setup.locator('.adm-tests-row-h')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.adm-tests-det')).toHaveCount(1);
    const det = setup.locator('.adm-tests-det');
    await expect(det.locator('h4')).toHaveText([/What it tests/, /Compared to as before/, /Running properly\?/]);
    await expect(det.locator('.adm-tests-mt tbody tr')).toHaveCount(4);
    await expect(det.locator('.adm-tests-split-n')).toContainText('214');
    await expect(det.locator('.adm-tests-split-n')).toContainText('209');
    // Before the read date the verdict waits, and no range is coloured.
    await expect(setup.locator('.adm-tests-rv')).toContainText('Too early');
    await expect(det.locator('.adm-tests-plot.good, .adm-tests-plot.bad')).toHaveCount(0);
  });

  test('past its read date, a clear gap names the side that is ahead', async ({ page }) => {
    await openTests(page);
    const share = row(page, 'Share ask');
    await expect(share.locator('.adm-tests-rv')).toContainText('Since Oct 29 ahead');
    await share.locator('.adm-tests-row-h').click();
    await expect(share.locator('.adm-tests-det h4').nth(1)).toContainText('Compared to before');
    // Coloured in the row's headline and in the open read's table; only the
    // measure it is read on, never the guardrail.
    await expect(share.locator('.adm-tests-rh .adm-tests-plot.good')).toHaveCount(1);
    await expect(share.locator('.adm-tests-det .adm-tests-plot.good')).toHaveCount(1);
    await expect(share.locator('.adm-tests-det .adm-tests-plot.bad')).toHaveCount(0);
  });

  test('a switched-off test is off, as planned', async ({ page }) => {
    await openTests(page);
    const trial = row(page, 'Free trial');
    await expect(trial.locator('.adm-tests-rv')).toContainText('Off');
    await expect(trial.locator('.adm-tests-rk')).toContainText('Off, as planned');
  });

  test('a read that fails for one test says so on that test only', async ({ page }) => {
    await openTests(page);
    const read = await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.js');
      return (await supabase.rpc('admin_tests_read')).data;
    });
    read.tests.workspace_setup = { error: '57014' };
    await patchRpc(page, { admin_tests_read: { data: read, error: null } });
    await page.locator('.admin-toolbar').getByRole('button', { name: /refresh/i }).click();
    await expect(row(page, 'Workspace setup').locator('.adm-tests-rk')).toContainText('Needs a look');
    await expect(row(page, 'Share ask').locator('.adm-tests-rk')).toContainText('Running properly');
  });

  test('the old scoreboards moved here from System, which links to them', async ({ page }) => {
    await openTests(page);
    await expect(page.getByText('The old onboarding scoreboards')).toBeVisible();
    await page.goto('/?adminpreview=1&tab=overview&view=system');
    await expect(page.getByText('Onboarding experiments', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'Tests →' }).click();
    await expect(page.getByRole('tab', { name: /^tests$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.adm-tests')).toBeVisible({ timeout: 20000 });
  });

  test('on a phone nothing scrolls sideways but the measures table', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTests(page);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(wide).toBeLessThanOrEqual(0);
  });
});
