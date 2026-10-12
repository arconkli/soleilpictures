// Admin audit fixes (2026-10-11 platform audit, ADMIN-*).
//
// Each guard here pins one finding on the DEV-only fixture harness
// (?adminpreview=1): no auth, no network, nothing written anywhere. The harness
// numbers are synthetic, so what is asserted is the rule, never a figure.

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

/**
 * Override named RPCs on the harness's already-mocked client, for states the
 * shared fixture does not hold. Vite serves one module instance per URL, so the
 * import below is the very client the dashboard calls. Every call to a patched
 * name is recorded in window.__patchedRpc as [name, params]. A value is the
 * resolved { data, error }, or { withParam, yes, no } to answer differently
 * depending on whether the call passed that argument.
 */
async function patchRpc(page, overrides) {
  await page.evaluate(async (ov) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const orig = supabase.rpc;
    window.__patchedRpc = [];
    supabase.rpc = (name, params) => {
      if (!Object.prototype.hasOwnProperty.call(ov, name)) return orig(name, params);
      window.__patchedRpc.push([name, params]);
      const v = ov[name];
      if (v && v.withParam) {
        const has = !!params && Object.prototype.hasOwnProperty.call(params, v.withParam);
        return Promise.resolve(has ? v.yes : v.no);
      }
      return Promise.resolve(v);
    };
  }, overrides);
}

/** The harness draws its own flat tab bar (no More menu): switch in place, so a patch survives. */
async function switchTab(page, label) {
  await page.getByRole('tab', { name: new RegExp(`^${label}$`, 'i') }).click();
}

test.describe('admin funnel (ADMIN-1)', () => {
  test('the retired Welcome page is not drawn, and the ⚠ and Biggest leak agree', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    const hero = page.locator('.admin-hero-funnel').first();
    await expect(hero).toBeVisible({ timeout: 15000 });

    await expect(hero.locator('.admin-funnel-row-label', { hasText: 'Welcome page' })).toHaveCount(0);
    await expect(hero.locator('.admin-funnel-fork')).not.toContainText(/Welcome/);

    const flagged = (await hero.locator('.is-biggest-leak .admin-funnel-row-label').innerText()).trim();
    const leak = (await page.locator('.adm-leak-step').innerText()).trim();
    expect(leak).not.toMatch(/Welcome/);
    expect(leak.endsWith(`→ ${flagged}`)).toBe(true);
  });
});

test.describe('admin Discover (ADMIN-3)', () => {
  const LIVE = {
    board_id: '00000000-0000-4000-8000-000000000001', board_name: 'Moodboard', slug: 'moodboard',
    is_published: true, seo_title: 'A title', seo_description: 'A description', seo_body: '',
    target_keyword: '', priority: 0, deleted: false,
  };

  test('saving a live board as a draft asks first, like Unpublish', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    await expect(page.getByRole('tab', { name: /^users$/i })).toHaveAttribute('aria-selected', 'true');
    await patchRpc(page, {
      admin_list_public_boards: { data: [LIVE], error: null },
      admin_set_public_board: { data: { board_id: LIVE.board_id, slug: LIVE.slug, published: false }, error: null },
    });
    await switchTab(page, 'Discover');
    await page.getByRole('button', { name: /Moodboard/ }).click();

    await page.getByRole('button', { name: 'Save & unpublish' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Save and unpublish?');
    await expect(dialog).toContainText('/c/moodboard');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);

    const calls = await page.evaluate(() => window.__patchedRpc.map(([n]) => n));
    expect(calls).not.toContain('admin_set_public_board');
  });
});

test.describe('admin Discover in light theme (ADMIN-12)', () => {
  test('the editor fields and status chips are readable', async ({ page }) => {
    await openAdmin(page, { tab: 'users', theme: 'light' });
    await expect(page.getByRole('tab', { name: /^users$/i })).toHaveAttribute('aria-selected', 'true');
    await patchRpc(page, {
      admin_list_public_boards: { data: [{
        board_id: '00000000-0000-4000-8000-000000000002', board_name: 'Lookbook', slug: 'lookbook',
        is_published: true, seo_title: 'Title', seo_description: 'Desc', seo_body: '', target_keyword: '', priority: 0,
      }], error: null },
    });
    await switchTab(page, 'Discover');
    await page.getByRole('button', { name: /Lookbook/ }).click();
    const slug = page.locator('input[placeholder="backrooms-fanart"]');
    await expect(slug).toHaveValue('lookbook');

    // WCAG contrast of an element's text against the first opaque background up its tree.
    const contrast = (loc) => loc.evaluate((el) => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => {
        const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const fg = rgb(getComputedStyle(el).color);
      let n = el; let bg = null;
      while (n && !bg) {
        const c = rgb(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0.9)) bg = c;
        n = n.parentElement;
      }
      bg = bg || [255, 255, 255];
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });
    expect(await contrast(slug)).toBeGreaterThan(4.5);
    expect(await contrast(page.getByText('LIVE', { exact: true }).first())).toBeGreaterThan(3);
  });
});

test.describe('admin background refresh (ADMIN-5)', () => {
  test('a failed refresh keeps the view and a half-typed note, under a notice', async ({ page }) => {
    await openAdmin(page, { view: 'today' });
    const form = page.getByRole('form', { name: 'Add a dated note' });
    await expect(form).toBeVisible({ timeout: 15000 });
    const field = form.getByRole('textbox', { name: 'Label', exact: true });
    await field.fill('half-typed note');

    await patchRpc(page, { admin_kpi_summary: { data: null, error: { message: 'statement timeout' } } });
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect.poll(() => page.evaluate(() => window.__patchedRpc.length)).toBeGreaterThan(0);

    await expect(page.locator('.admin-stale-notice')).toBeVisible();
    await expect(page.locator('.admin-error')).toHaveCount(0);
    await expect(page.getByText('The last seven days')).toBeVisible();
    await expect(field).toHaveValue('half-typed note');
  });
});

test.describe('admin Today people (ADMIN-6)', () => {
  test('Arrived and stalled lists recent signups by signup age, never-opened ones included', async ({ page }) => {
    const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    await openAdmin(page, { view: 'today' });
    await expect(page.getByText('The last seven days')).toBeVisible({ timeout: 15000 });
    await patchRpc(page, {
      admin_user_dormancy: { error: null, data: [
        { user_id: 'n', email: 'never@example.com', signup: iso(3), last_active_day: null, days_dormant: null,
          active_day_count: 0, did_card: false },
        { user_id: 'o', email: 'old@example.com', signup: iso(120), last_active_day: iso(2), days_dormant: 2,
          active_day_count: 7, did_card: false },
      ] },
    });
    await page.getByRole('button', { name: 'Refresh' }).first().click();

    const panel = page.locator('.admin-people-list').filter({ hasText: 'example.com' });
    await expect(panel.getByText('never@example.com')).toBeVisible();
    await expect(panel).toContainText('never opened the app');
    await expect(panel).toContainText('joined 3d ago');
    await expect(panel.getByText('old@example.com')).toHaveCount(0);
  });
});

test.describe('admin Funnel money detail (ADMIN-7)', () => {
  test('comped paid-tier accounts are not called paying', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    await expect(page.locator('.admin-hero-funnel').first()).toBeVisible({ timeout: 15000 });
    await patchRpc(page, {
      admin_stats: { error: null, data: {
        tier_counts: { admin: 1, paid: 3, demo: 40 }, sub_counts: {}, comped_paid: 3, subscribed_paid: 0, mrr_cents: 0,
      } },
    });
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect.poll(() => page.evaluate(() => window.__patchedRpc.some(([n]) => n === 'admin_stats'))).toBe(true);

    await page.getByRole('button', { name: /Checkout, upsell/ }).click();
    const line = page.locator('.adm-detail-body .admin-section-sub').first();
    await expect(line).toContainText('No subscription has ever existed');
    await expect(line).toContainText('3 comped accounts are on the paid tier without paying.');
    await expect(line).not.toContainText('paying account');
  });
});

test.describe('admin Discover GSC import (ADMIN-8)', () => {
  test('an undated import leaves p_as_of to the SQL default instead of sending null', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    await expect(page.getByRole('tab', { name: /^users$/i })).toHaveAttribute('aria-selected', 'true');
    await patchRpc(page, { admin_import_gsc_csv: { data: 1, error: null } });
    await switchTab(page, 'Discover');

    const csv = 'Top pages,Clicks,Impressions,CTR,Position\nhttps://clusters.example/c/moodboard,3,40,7.5%,8.1\n';
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles({
      name: 'pages.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
    });
    await expect(page.getByText(/Imported GSC stats for 1 board/)).toBeVisible();

    const params = await page.evaluate(() => window.__patchedRpc.find(([n]) => n === 'admin_import_gsc_csv')?.[1]);
    expect(params.p_rows).toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(params, 'p_as_of')).toBe(false);
  });
});

test.describe('admin Retention return curve (ADMIN-10)', () => {
  const ROWS = Array.from({ length: 10 }, (_, d) => ({
    segment: 'all', day_offset: d, eligible: 50, active: Math.max(1, 30 - d * 3), active_pct: Math.max(1, 30 - d * 3) / 50,
  }));
  const panel = (page) => page.locator('section').filter({ has: page.locator('.adm-well-title', { hasText: /^Return curve$/ }) });

  test('the curve asks for work-days and says so', async ({ page }) => {
    await openAdmin(page, { view: 'retention' });
    await expect(page.getByText('Return curve', { exact: true })).toBeVisible({ timeout: 15000 });
    await patchRpc(page, { admin_retention_curve: { data: ROWS, error: null } });
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect.poll(() => page.evaluate(() => window.__patchedRpc.length)).toBeGreaterThan(0);
    const params = await page.evaluate(() => window.__patchedRpc[0][1]);
    expect(params.p_require_work).toBe(true);
    await expect(panel(page)).toContainText('Work-days, not app-open days');
  });

  test('against a database without the work argument, it falls back and captions presence', async ({ page }) => {
    await openAdmin(page, { view: 'retention' });
    await expect(page.getByText('Return curve', { exact: true })).toBeVisible({ timeout: 15000 });
    await patchRpc(page, { admin_retention_curve: {
      withParam: 'p_require_work',
      yes: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } },
      no: { data: ROWS, error: null },
    } });
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(panel(page)).toContainText('App-open days (presence), not work');
    await expect(page.locator('.admin-error')).toHaveCount(0);
  });
});

test.describe('admin live console (ADMIN-13)', () => {
  test('pushed rows are named, and internal ones stay out under Internal: excluded', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    await expect(page.locator('.admin-hero-funnel').first()).toBeVisible({ timeout: 15000 });
    // Capture the console's realtime handler before Today mounts it: the
    // harness stub never pushes, so the test does.
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.js');
      const orig = supabase.channel;
      supabase.channel = (topic, ...rest) => {
        const ch = orig(topic, ...rest);
        if (topic !== 'admin:activity') return ch;
        const on = ch.on;
        ch.on = (type, filter, cb) => { window.__pushActivity = (row) => cb({ new: row }); return on(type, filter, cb); };
        return ch;
      };
    });
    await patchRpc(page, { admin_events_by_id: { error: null, data: [
      { id: '00000000-0000-4000-8000-0000000000e1', event: 'qa_external_evt', occurred_at: new Date().toISOString(),
        user_id: '00000000-0000-4000-8000-0000000000a1', email: 'outside@example.com', path: '/' },
    ] } });
    await page.getByRole('tab', { name: /^today$/i }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__pushActivity)).toBe('function');

    await page.evaluate(() => {
      const at = new Date().toISOString();
      window.__pushActivity({ id: '00000000-0000-4000-8000-0000000000e1', event: 'qa_external_evt', occurred_at: at,
        user_id: '00000000-0000-4000-8000-0000000000a1', props: {} });
      window.__pushActivity({ id: '00000000-0000-4000-8000-0000000000e2', event: 'qa_internal_evt', occurred_at: at,
        user_id: '00000000-0000-4000-8000-0000000000a2', props: {} });
    });

    const ext = page.locator('.adm-console-row', { hasText: 'qa_external_evt' });
    await expect(ext).toHaveCount(1);
    await expect(ext.locator('.adm-console-who')).toHaveText('outside');
    await expect(page.locator('.adm-console-row', { hasText: 'qa_internal_evt' })).toHaveCount(0);

    const call = await page.evaluate(() => window.__patchedRpc.find(([n]) => n === 'admin_events_by_id')?.[1]);
    expect(call.p_exclude_internal).toBe(true);
    expect(call.p_ids).toHaveLength(2);
  });
});

test.describe('admin segment filter (ADMIN-14)', () => {
  test('a campaign with no traffic in the window still shows as the applied filter', async ({ page }) => {
    await openAdmin(page, { view: 'funnel', query: '&camp=spring-old' });
    const select = page.getByRole('combobox', { name: 'Campaign' });
    await expect(select).toBeVisible({ timeout: 15000 });
    await expect(select).toHaveValue('spring-old');
    expect(await select.evaluate((el) => el.options[el.selectedIndex].text)).toBe('spring-old (none in this window)');
    // A value that IS in the window is listed once, with its count.
    await select.selectOption('launch-q3');
    await expect(select.locator('option', { hasText: 'spring-old' })).toHaveCount(0);
  });
});

test.describe('admin Errors tab (ADMIN-15)', () => {
  const G = (message, kind, extra = {}) => ({
    message, kind, occurrences: 5, sessions: 2, users: 1, first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(), sample_stack: `${message}\n    at somewhere (x.js:1:1)`, ...extra,
  });

  test('an open stack stays with its group when a group above it goes away', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    await expect(page.getByRole('tab', { name: /^users$/i })).toHaveAttribute('aria-selected', 'true');
    const all = [G('First error', 'window'), G('Second error', 'window'), G('Third error', 'react')];
    await patchRpc(page, {
      admin_error_summary: { data: all, error: null },
      admin_recent_errors: { data: [], error: null },
    });
    await switchTab(page, 'Errors');
    await page.locator('tr.admin-error-grouprow', { hasText: 'Third error' }).click();
    await expect(page.locator('pre.admin-error-stack', { hasText: 'Third error' })).toBeVisible();

    // What muting the first group does to Active mode: it leaves the list.
    await patchRpc(page, { admin_error_summary: { data: all.slice(1), error: null }, admin_recent_errors: { data: [], error: null } });
    await page.getByRole('button', { name: 'Refresh' }).first().click();
    await expect(page.locator('tr.admin-error-grouprow', { hasText: 'First error' })).toHaveCount(0);
    await expect(page.locator('pre.admin-error-stack', { hasText: 'Third error' })).toBeVisible();
  });

  test('when everything is muted, Active mode says so instead of rendering nothing', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    await expect(page.getByRole('tab', { name: /^users$/i })).toHaveAttribute('aria-selected', 'true');
    await patchRpc(page, {
      admin_error_summary: { data: [G('Muted one', 'window', { muted: true })], error: null },
      admin_recent_errors: { data: [], error: null },
    });
    await switchTab(page, 'Errors');
    await expect(page.getByText('Nothing unmuted')).toBeVisible();
  });
});

test.describe('admin System onboarding failures (ADMIN-16)', () => {
  test('the "N more" rollup carries no single reason', async ({ page }) => {
    await openAdmin(page, { view: 'funnel' });
    await expect(page.locator('.admin-hero-funnel').first()).toBeVisible({ timeout: 15000 });
    const rows = Array.from({ length: 10 }, (_, i) => ({
      event: `qa_fail_${i}`, sessions: 20 - i, users: 20 - i, total: 20 - i, top_reason: `reason ${i}`, ord: i,
    }));
    await patchRpc(page, { admin_onboarding_error_coverage: { data: rows, error: null } });
    await page.getByRole('tab', { name: /^system$/i }).click();

    const well = page.locator('section').filter({ has: page.locator('.adm-well-title', { hasText: /^Onboarding failures$/ }) });
    const rollup = well.locator('.adm-bar-row', { hasText: '2 more' });
    await expect(rollup).toBeVisible({ timeout: 15000 });
    await expect(rollup).not.toContainText('reason 8');
    await expect(well.locator('.adm-bar-row', { hasText: 'qa_fail_7' })).toContainText('reason 7');
  });
});

test.describe('admin Tagging card titles (ADMIN-17)', () => {
  test('card_index is read by id in small chunks, never as one capped select', async ({ page }) => {
    await openAdmin(page, { tab: 'users' });
    await expect(page.getByRole('tab', { name: /^users$/i })).toHaveAttribute('aria-selected', 'true');
    await page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.js');
      const orig = supabase.from;
      window.__cardIndexReads = [];
      supabase.from = (table) => {
        const b = orig(table);
        if (table !== 'card_index') return b;
        const read = { in: null };
        window.__cardIndexReads.push(read);
        const inner = b.in;
        b.in = (col, vals) => { read.in = [col, vals.length]; return inner.call(b, col, vals); };
        return b;
      };
    });
    await switchTab(page, 'Tagging');
    await expect(page.locator('.admin-error')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__cardIndexReads.length)).toBeGreaterThan(0);
    const reads = await page.evaluate(() => window.__cardIndexReads);
    for (const r of reads) {
      expect(r.in?.[0]).toBe('card_id');
      expect(r.in?.[1]).toBeLessThanOrEqual(150);
    }
  });
});

test.describe('admin cohort matrix (ADMIN-11)', () => {
  test('the week still under way is outlined and kept out of the All row', async ({ page }) => {
    // This UTC Monday and the one before, from the clock, as the RPC would.
    const monday = (weeksAgo) => {
      const d = new Date();
      const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      const dow = (new Date(day).getUTCDay() + 6) % 7;
      return new Date(day - (dow + 7 * weeksAgo) * 86_400_000).toISOString().slice(0, 10);
    };
    const cell = (wk, off, size, n) => ({
      cohort_week: wk, week_offset: off, cohort_size: size, active_n: n,
      active_pct: n / size, measurable: true, work_floor: '2026-08-17',
    });
    const rows = [
      cell(monday(1), 0, 40, 30), // complete: 75%
      cell(monday(1), 1, 40, 2),  // this week, so far
      cell(monday(0), 0, 20, 1),  // this week, so far
    ];

    await openAdmin(page, { view: 'retention' });
    await expect(page.locator('.adm-cohort-grid')).toBeVisible({ timeout: 15000 });
    await patchRpc(page, { admin_retention_cohort_matrix: { data: rows, error: null } });
    await page.getByRole('button', { name: 'Refresh' }).first().click();

    const grid = page.locator('.adm-cohort-grid');
    await expect(grid.locator('.adm-cohort-cell.is-partial')).toHaveCount(2);
    const avg = grid.locator('.adm-cohort-row.is-avg .adm-cohort-cell');
    // W0 is last week's cohort alone (30/40), not pooled with this week's 1/20.
    await expect(avg.nth(0)).toHaveText('75');
    // W1 has only a week in progress: nothing measurable yet.
    await expect(avg.nth(1)).toHaveText('·');
  });
});
