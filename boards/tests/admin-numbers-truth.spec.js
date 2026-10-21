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

// Records the params of every call to the named RPCs, so a test can see what a
// toggle actually sends.
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

// Both universe surfaces boot a WebGL graph of thousands of nodes, which takes
// ~20s on its own and longer beside other workers.
const UNIVERSE_TIMEOUT = 60_000;

test.describe('Universe HUD', () => {
  test('clusters are the ones people made, chips are the last 24 hours, and the team is named once', async ({ page }) => {
    test.setTimeout(UNIVERSE_TIMEOUT);
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
    test.setTimeout(UNIVERSE_TIMEOUT);
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
    test.setTimeout(UNIVERSE_TIMEOUT);
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

test.describe('Analytics › Overview', () => {
  test('the rail is what exists now, under the toggles, with clusters made apart from the Studios', async ({ page }) => {
    await openAdmin(page, { view: 'overview' });
    const rail = page.locator('.adm-rail .admin-lifetime');
    await expect(rail).toContainText('Accounts', { timeout: 20000 });
    await expect(rail).toContainText('Clusters made');
    await expect(rail).toContainText('+628 Studios');
    await expect(rail.locator('.admin-lifetime-scope')).toHaveText('totals now · team excluded · entered the code');

    await recordRpc(page, ['admin_lifetime_totals', 'admin_recent_signups', 'admin_active_now']);
    await page.getByRole('switch', { name: /Internal/ }).click();
    await expect(rail.locator('.admin-lifetime-scope')).toHaveText('totals now · incl. team · entered the code');
    await expect.poll(() => page.evaluate(() => window.__rpcSeen.map(([n, p]) => `${n}:${p?.p_exclude_internal}`)))
      .toEqual(expect.arrayContaining([
        'admin_lifetime_totals:false', 'admin_recent_signups:false', 'admin_active_now:false',
      ]));
  });

  test('the hero totals say what they are', async ({ page }) => {
    await openAdmin(page, { view: 'overview' });
    const tile = (label) => page.locator('.admin-stat-card', { has: page.locator('.admin-stat-label', { hasText: new RegExp(`^${label}$`) }) });
    // The figure and its label are sibling elements, so the text runs together.
    await expect(tile('Signups')).toContainText(/1,276\s*accounts/, { timeout: 20000 });
    await expect(tile('Cards created')).toContainText(/17\.3K\s*exist now/);
    await expect(page.locator('.admin-stat-card', { hasText: 'all time' })).toHaveCount(0);
  });

  test('Just arrived counts work done in someone else\'s cluster, and a card since deleted', async ({ page }) => {
    await openAdmin(page, { view: 'overview' });
    const list = page.locator('.admin-people-list').first();
    await expect(list).toContainText('3 cards · 1 cluster made · 2 as a guest', { timeout: 20000 });
    await expect(list).toContainText("7 cards in someone else's cluster");
    await expect(list).toContainText('placed a card, none left');
    await expect(list).toContainText('nothing yet');
    await expect(list.locator('.admin-people-row')).toHaveCount(20);
  });
});

test.describe('Analytics › Funnel', () => {
  test('the money and referral reads follow the code-entry toggle, and what banned accounts did is named', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    const paths = page.getByRole('button', { name: /Other paths into the product/ });
    await expect(paths).toBeVisible({ timeout: 20000 });
    await recordRpc(page, ['admin_referral_stats', 'admin_paid_reach', 'admin_trial_funnel']);
    await paths.click();
    await page.getByRole('button', { name: /Checkout, upsell and the biggest accounts/ }).click();

    // 0490 leaves out what a banned account did and the panel says how much,
    // so a figure never drops without a word.
    const referrals = page.locator('.admin-chart-panel', { has: page.locator('.admin-chart-title', { hasText: /^Referrals$/ }) });
    await expect(referrals.locator('.admin-panel-note'))
      .toHaveText('Left out: 340 invites, 2 invite links from 1 banned account.', { timeout: 20000 });
    // 0491: answered emailed invites over the same invites, never every
    // collaboration referral (links included) over emailed invites alone.
    const rate = referrals.locator('.admin-stat-card', { has: page.locator('.admin-stat-label', { hasText: /^Invite → signup$/ }) });
    await expect(rate).toContainText('57.1%');
    await expect(rate).toContainText('12 of 21 emailed invites');

    const sent = () => page.evaluate(() => window.__rpcSeen.map(([n, p]) => `${n}:${p?.p_verified_only}`));
    await expect.poll(sent).toEqual(expect.arrayContaining([
      'admin_referral_stats:true', 'admin_paid_reach:true', 'admin_trial_funnel:true',
    ]));
    await page.getByRole('switch', { name: 'Entered the code' }).click();
    await expect.poll(sent).toEqual(expect.arrayContaining([
      'admin_referral_stats:false', 'admin_paid_reach:false', 'admin_trial_funnel:false',
    ]));
  });

  test('with one trial and nobody paying, the money line names the trial', async ({ page }) => {
    await openAdmin(page, { view: 'funnel', query: '&mrr=0' });
    await page.getByRole('button', { name: /Checkout, upsell and the biggest accounts/ }).click();
    await expect(page.locator('.adm-detail-body .admin-section-sub').first())
      .toHaveText('Nobody is paying right now. 1 subscription is a trial, never counted as revenue.', { timeout: 20000 });
  });
});

test.describe('Analytics › System', () => {
  test('a milestone nobody has reached reads "nobody yet", and the caveats say what is true now', async ({ page }) => {
    await openAdmin(page, { view: 'system', query: '&mrr=0' });
    const row = page.locator('.adm-bar-row', { hasText: 'joined_by_link' });
    await expect(row).toContainText('nobody yet', { timeout: 20000 });
    await expect(row.locator('.adm-bar-value')).toHaveText('—');

    const limits = page.locator('.admin-dq-list');
    await expect(limits).toContainText('1 subscription is a trial: paid access, no money yet, never counted as revenue.');
    await expect(limits).not.toContainText('No subscription has ever existed');
    await expect(limits).toContainText('Universe always counts them');
    await expect(limits).toContainText('metrics_daily has a row for every day');
  });
});
