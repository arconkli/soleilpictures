// Analytics › Money (0492, 0493; the owner's pick of 2026-10-20).
//
// On the DEV-only fixture harness (?adminpreview=1): no auth, no network. The
// figures are invented; ?mrr=0 is one trial running and nobody paying yet, the
// state these mostly look at.

import { test, expect } from '@playwright/test';

async function openMoney(page, { theme = 'dark', query = '&mrr=0' } = {}) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto(`/?adminpreview=1&tab=overview&view=money${query}`);
  await expect(page.locator('.mny-path')).toBeVisible({ timeout: 20000 });
}

// Records the params of every call to the named RPCs.
async function recordRpc(page, names) {
  await page.evaluate(async (watch) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const orig = supabase.rpc;
    window.__rpcSeen = [];
    supabase.rpc = (name, params) => {
      if (watch.includes(name)) window.__rpcSeen.push([name, params]);
      return orig(name, params);
    };
  }, names);
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

const tile = (page, key) => page.locator(`.mny-tile[data-tile="${key}"]`);

test.describe('Analytics › Money', () => {
  test('it is a view of its own, the range control is hidden, and the status strip says what it counts', async ({ page }) => {
    await openMoney(page);
    await expect(page.getByRole('tab', { name: /^money$/i })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('group', { name: 'Time range' })).toHaveCount(0);
    const status = page.locator('.adm-status');
    await expect(status).toContainText('MONEY');
    await expect(status).toContainText(/since [A-Z][a-z]{2} \d{1,2} · first price shown/);
    await expect(status).toContainText('from Stripe, all accounts');
  });

  test('an old Revenue link lands on Money', async ({ page }) => {
    await page.goto('/?adminpreview=1&tab=overview&view=revenue');
    await expect(page.getByRole('tab', { name: /^money$/i })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  });

  test('with one trial and nobody paying, the tiles say so and never call the trial money', async ({ page }) => {
    await openMoney(page);
    await expect(tile(page, 'mrr').locator('.mny-t-val')).toHaveText('$0');
    await expect(tile(page, 'mrr')).toContainText('nothing collected');
    await expect(tile(page, 'mrr')).toContainText('No paying subscription yet.');
    await expect(tile(page, 'mrr')).toContainText(/First charge due [A-Z][a-z]{2} \d{1,2}/);
    await expect(tile(page, 'trial').locator('.mny-t-val')).toHaveText('1');
    await expect(tile(page, 'trial')).toContainText('Not cancelling.');
    await expect(tile(page, 'paying').locator('.mny-t-val')).toHaveText('0');
    await expect(tile(page, 'paying')).toContainText('Nobody has been charged yet.');
    await expect(tile(page, 'comped').locator('.mny-t-val')).toHaveText('4');
    await expect(tile(page, 'comped')).toContainText('5 on paid plans');
    await expect(tile(page, 'near')).toContainText('9 active in 7 days');
    await expect(tile(page, 'eligible').locator('.mny-t-val')).toHaveText('146');
  });

  test('the path is in people, nested, and never goes up', async ({ page }) => {
    await openMoney(page);
    const nums = await page.locator('.mny-num').allInnerTexts();
    expect(nums).toEqual(['214', '3', '3', '2', '1', '0']);
    const n = nums.map((s) => Number(s.replace(/,/g, '')));
    for (let i = 1; i < n.length; i += 1) expect(n[i]).toBeLessThanOrEqual(n[i - 1]);

    // Every press offered the trial, so the step says so; the last one is
    // waiting on a charge that is due, not lost.
    const labels = page.locator('.mny-lab');
    await expect(labels.nth(1)).toContainText('Pressed Start trial');
    await expect(page.locator('.mny-lab', { hasText: 'Clicked to upgrade' })).toHaveCount(0);
    await expect(page.locator('.mny-conv')).toHaveText(['1.4%', '100%', '67%', '50%', 'not yet']);
    await expect(page.locator('.mny-leak')).toContainText('211 of the 214 stop here.');
    await expect(page.locator('.mny-routes')).toContainText('the cap wall 31 → 3 pressed');
    await expect(page.locator('.adm-money-pathwell .adm-well-foot'))
      .toContainText('Checkout is not where they are lost: 3 opened it, 2 finished, 0 errors, 0 stalled.');
  });

  test('a step says what it counts on hover and from the keyboard', async ({ page }) => {
    await openMoney(page);
    await page.locator('.mny-hit').nth(5).hover();
    const tip = page.locator('.mny-tip');
    await expect(tip).toContainText('Paid');
    await expect(tip).toContainText('of 1 at the step before');
    await expect(tip).toContainText('Nobody has paid yet; the first charge is due');
    // Every drawn bar but the one pointed at dims; Paid has no bar, only its zero mark.
    await expect(page.locator('.mny-bar.is-dim')).toHaveCount(5);

    await page.mouse.move(2, 2);
    await page.locator('.mny-path').focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.mny-path .sr-only')).toContainText('Pressed Start trial: 3 of 214 at the step before.');
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);
  });

  test('the reads follow both toggles, and Detail fetches only once opened', async ({ page }) => {
    await openMoney(page);
    await recordRpc(page, ['admin_money_path', 'admin_money_people', 'admin_trial_funnel', 'admin_conversion_funnel', 'admin_paid_reach']);
    const sent = () => page.evaluate(() => window.__rpcSeen.map(([n, p]) => `${n}:${p?.p_exclude_internal}:${p?.p_verified_only}`));

    await page.getByRole('switch', { name: 'Entered the code' }).click();
    await expect.poll(sent).toEqual(expect.arrayContaining([
      'admin_money_path:true:false', 'admin_money_people:true:false', 'admin_trial_funnel:true:false',
    ]));
    await page.getByRole('switch', { name: /Internal: excluded/ }).click();
    await expect.poll(sent).toEqual(expect.arrayContaining([
      'admin_money_path:false:false', 'admin_money_people:false:false', 'admin_conversion_funnel:false:undefined',
    ]));
    // The placements count the same span as the path: from its first price.
    const since = await page.evaluate(() => window.__rpcSeen.find(([n]) => n === 'admin_conversion_funnel')?.[1]?.p_since);
    expect(since).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(await sent()).not.toEqual(expect.arrayContaining([expect.stringMatching(/^admin_paid_reach:/)]));
    await expect(page.locator('.adm-money-details .adm-detail-body')).toHaveCount(0);
    await page.getByRole('button', { name: /Who has seen the price/ }).click();
    await expect.poll(sent).toEqual(expect.arrayContaining(['admin_paid_reach:false:false']));
  });

  test('everyone who hit the cap: twelve newest, then all of them', async ({ page }) => {
    await openMoney(page);
    const rows = page.locator('.adm-money-caps tbody tr');
    await expect(rows).toHaveCount(12);
    await expect(page.locator('.adm-money-caps .adm-well-meta')).toHaveText('12 newest of 14');
    await expect(rows.first()).toContainText('Too early to tell');
    await expect(rows.first()).toContainText('64 refused at once');
    await expect(rows.nth(1)).toContainText('In trial');

    const more = page.getByRole('button', { name: /Show all 14/ });
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(rows).toHaveCount(14);
    await expect(page.getByRole('button', { name: /Show the 12 newest/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('a read that fails says so, and never shows a zero', async ({ page }) => {
    await openMoney(page);
    await patchRpc(page, { admin_money_people: { data: null, error: { message: 'boom' } } });
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(tile(page, 'paying').locator('.mny-t-val')).toHaveText('—', { timeout: 15000 });
    await expect(tile(page, 'comped').locator('.mny-t-val')).toHaveText('—');
    await expect(page.locator('.adm-money-trials')).toContainText('The trials read did not answer.');
    await expect(page.locator('.admin-section-sub', { hasText: 'The people read did not answer' })).toBeVisible();
    // The path has its own read, and stays.
    await expect(page.locator('.mny-num').first()).toHaveText('214');
  });

  test('too narrow to draw, the path is a list of the same steps', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.addInitScript(() => {
      try { window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: 'dark' })); } catch { /* ignore */ }
    });
    await page.goto('/?adminpreview=1&tab=overview&view=money&mrr=0');
    const list = page.locator('.mny-plist');
    await expect(list).toBeVisible({ timeout: 20000 });
    await expect(list.locator('.mny-pl')).toHaveCount(6);
    await expect(list.locator('.mny-pl').last()).toContainText('not yet: the trial is still running');
    await expect(page.locator('.mny-path > svg')).toBeHidden();
    await expect(page.locator('.mny-leak-under')).toContainText('211 of the 214 stop here.');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
