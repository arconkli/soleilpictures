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
 * resolved { data, error }.
 */
async function patchRpc(page, overrides) {
  await page.evaluate(async (ov) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const orig = supabase.rpc;
    window.__patchedRpc = [];
    supabase.rpc = (name, params) => {
      if (!Object.prototype.hasOwnProperty.call(ov, name)) return orig(name, params);
      window.__patchedRpc.push([name, params]);
      return Promise.resolve(ov[name]);
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
