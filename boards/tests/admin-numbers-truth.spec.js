// The admin numbers say what they count (0460, 2026-10-20).
//
// These run on the DEV-only fixture harness (?adminpreview=1): no auth, no
// network, nothing written anywhere. The fixture figures are synthetic, but they
// are distinct on purpose — clusters made (1,170) is not every board (1,810),
// the last 24 hours (+9) is not today since midnight UTC (+12) — so a cell that
// reads the wrong key shows the wrong number, and that is what is asserted.

import { test, expect } from '@playwright/test';

async function openAdmin(page, { tab = 'overview', view, theme = 'dark', query = '' } = {}) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto(`/?adminpreview=1&tab=${tab}${view ? `&view=${view}` : ''}${query}`);
}

test.describe('Universe HUD', () => {
  test('clusters are the ones people made, chips are the last 24 hours, and the team is named once', async ({ page }) => {
    await openAdmin(page, { tab: 'universe' });
    const cell = (label) => page.locator('.universe-ticker-cell', {
      has: page.locator('.universe-ticker-label', { hasText: new RegExp(`^${label}`, 'i') }),
    });

    await expect(cell('Clusters')).toBeVisible({ timeout: 20000 });
    await expect(cell('Boards')).toHaveCount(0);
    await expect(cell('Clusters').locator('.universe-ticker-value')).toHaveText('1.2K');
    await expect(cell('Clusters')).toHaveAttribute('title', /Plus 640 Studios/);
    await expect(cell('Clusters').locator('.universe-ticker-today')).toHaveText('+9');
    await expect(cell('Cards').locator('.universe-ticker-today')).toHaveText('+72');
    await expect(cell('Users').locator('.universe-ticker-today')).toHaveText('+7');
    await expect(page.locator('.universe-ticker-scope')).toHaveText(/incl\. team/i);

    // Nothing in the HUD is "since midnight" any more.
    const titles = await page.locator('.universe-ticker [title]').evaluateAll((els) => els.map((e) => e.title).join('\n'));
    expect(titles).not.toMatch(/midnight|today/i);
  });
});

test.describe('Command Center', () => {
  const kpi = (page, label) => page.locator('.cc-kpi', { has: page.locator('.cc-kpi-label', { hasText: label }) });
  const uni = (page, label) => page.locator('.cc-uni-cell', {
    has: page.locator('.cc-uni-label', { hasText: new RegExp(`^${label}$`, 'i') }),
  });

  test('cards are the last 24 hours, MRR splits trials from payers, and the funnel says it leaves the team out', async ({ page }) => {
    await openAdmin(page, { tab: 'command' });
    await expect(kpi(page, 'Cards · 24h')).toBeVisible({ timeout: 20000 });
    await expect(kpi(page, 'Cards · 24h').locator('.cc-kpi-value')).toHaveText('72');
    await expect(kpi(page, 'Cards · 24h').locator('.cc-kpi-sub')).toHaveText('18.4K exist now');
    await expect(kpi(page, 'Weekly active').locator('.cc-kpi-value')).toHaveText('91');
    await expect(kpi(page, 'Weekly active').locator('.cc-kpi-sub')).toHaveText('86 the 7 days before');
    await expect(kpi(page, /^MRR$/).locator('.cc-kpi-sub')).toHaveText('4 trialing · 138 paying · 6 comped');

    await expect(page.locator('.cc-panel-head', { hasText: 'Activation funnel' })).toContainText('team excluded');
    await expect(page.locator('.cc-panel-head', { hasText: 'Content mix' })).toContainText('last 12 months');
    await expect(page.locator('.cc-scope')).toHaveText(/incl\. team/i);

    await expect(uni(page, 'Boards')).toHaveCount(0);
    await expect(uni(page, 'Clusters').locator('.cc-uni-num')).toHaveText('1.2K');
    await expect(uni(page, 'Clusters').locator('.cc-uni-delta')).toHaveText('+9 · 24h');
    await expect(uni(page, 'Cards').locator('.cc-uni-delta')).toHaveText('+72 · 24h');
  });

  test('before revenue: one trial is a trial, not a subscriber', async ({ page }) => {
    // ?mrr=0 is production's state: one trialing subscription and $0 MRR. The
    // old sub-line read "1 subscribed" under $0, which looked like a broken sum.
    await openAdmin(page, { tab: 'command', query: '&mrr=0' });
    const mrr = kpi(page, /^MRR$/);
    await expect(mrr).toBeVisible({ timeout: 20000 });
    await expect(mrr.locator('.cc-kpi-sub')).toHaveText('1 trialing · 0 paying · 0 comped');
    await expect(mrr).not.toContainText('subscribed');
  });
});

test.describe('Users', () => {
  test('the activity filter says what it means, and the source counts follow it', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    const activity = page.getByRole('combobox', { name: 'Filter by activity' });
    await expect(activity).toBeVisible({ timeout: 20000 });
    await expect(activity.locator('option')).toHaveText(['Made something', 'Made nothing yet', 'All activity']);
    await expect(activity).toHaveValue('active');

    // The channel "(n)" counts used to ignore this filter entirely.
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.js');
      const orig = supabase.rpc;
      window.__channelCalls = [];
      supabase.rpc = (name, params) => {
        if (name === 'admin_acquisition_channels') window.__channelCalls.push(params);
        return orig(name, params);
      };
    });
    await activity.selectOption('inactive');
    await expect.poll(() => page.evaluate(() => window.__channelCalls.map((p) => p?.p_activity)))
      .toContain('inactive');
  });

  test('a profile counts clusters made apart from the Studio, keeps two units of time, and counts days', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    await page.locator('.admin-user-row').first().click();
    const dd = (label) => page.locator('.admin-detail-kv dt', { hasText: new RegExp(`^${label}$`) })
      .locator('xpath=following-sibling::dd[1]');

    await expect(dd('Clusters')).toHaveText('1 made · plus a Studio', { timeout: 20000 });
    await expect(page.locator('.admin-detail-kv dt', { hasText: /^Boards$/ })).toHaveCount(0);
    await expect(dd('Time in app')).toHaveText(/^\d+(y|mo|d|h|m|s)( \d+(y|mo|d|h|m|s))?$/);
    await expect(dd('Days here')).toContainText('3 days, 1 with real work');
    await expect(dd('Days here')).toContainText(/first \w{3} \d{1,2} · last \w{3} \d{1,2}/);
  });

  test('share signups count who made something, by the list\'s rule', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    const stats = page.locator('.admin-share-stat');
    await expect(stats.first()).toHaveText('14 signups · 9 made something', { timeout: 20000 });
    await expect(stats.last()).toHaveText('2 signups');
  });
});
