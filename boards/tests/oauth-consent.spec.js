// The consent screen (/oauth/authorize) in direction D, "Trust banner": signed
// in with Supabase stubbed (helpers/signedInStub.js) and the Worker's
// /oauth/client and /oauth/authorize answered here. Who vouches for the app,
// what the connection gets, a new account's refusal (0704), and Switch.
//
//   npx playwright test tests/oauth-consent.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';
import { bootSignedIn } from './helpers/signedInStub.js';

const CLAUDE = {
  client_id: 'https://claude.ai/oauth/mcp-oauth-client-metadata', client_name: 'Claude',
  client_kind: 'metadata', client_host: 'claude.ai',
};
const CLAUDE_CODE = {
  client_id: 'https://claude.ai/oauth/claude-code-client-metadata', client_name: 'Claude Code',
  client_kind: 'metadata', client_host: 'claude.ai',
};
const SELF_NAMED_CLAUDE = { client_id: 'soleil_abc', client_name: 'Claude', client_kind: 'registered', client_host: null };

async function openConsent(page, client, { redirect, scope = 'read write', answer } = {}) {
  const posts = [];
  await page.route(/\/oauth\/client\?/, (r) => r.fulfill({
    json: { ...client, redirect_uri_registered: true, scopes_supported: ['read', 'write', 'delete'] },
  }));
  await page.route(/\/oauth\/authorize$/, (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    posts.push({ auth: r.request().headers().authorization || '', body: r.request().postDataJSON() });
    return r.fulfill(answer || { json: { redirect_to: '/consent-test-done?code=ac_x&state=s' } });
  });
  await page.route(/\/consent-test-done/, (r) => r.fulfill({ contentType: 'text/html', body: '<p>back in the app</p>' }));
  const q = new URLSearchParams({
    response_type: 'code', client_id: client.client_id, redirect_uri: redirect, scope, state: 's',
    code_challenge: 'c'.repeat(43), code_challenge_method: 'S256',
  });
  await bootSignedIn(page, { path: `/oauth/authorize?${q}` });
  await expect(page.locator('.oauth-allow')).toBeVisible({ timeout: 20_000 });
  return posts;
}

test('Claude on the web is verified, and Allow deleting adds delete to what is granted', async ({ page }) => {
  const posts = await openConsent(page, CLAUDE, { redirect: 'https://claude.ai/api/mcp/auth_callback' });
  const banner = page.locator('.oauth-banner');
  await expect(banner).toHaveAttribute('data-trust', 'verified');
  await expect(banner).toHaveText('Verified app · identified by claude.ai');
  await expect(page.locator('.oauth-account')).toContainText('sam@example.com');
  await expect(page.locator('.oauth-chip')).toHaveText(['Read', 'Create and change', 'Allow deleting']);
  await expect(page.locator('.oauth-sentence')).toHaveText('It can see and change your clusters. It can’t delete anything.');

  const toggle = page.getByRole('button', { name: 'Allow deleting' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('.oauth-chip-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.oauth-chip-toggle')).toHaveText('Delete');
  await expect(page.locator('.oauth-sentence')).toContainText('It can see, change and delete.');

  await page.getByRole('button', { name: 'Connect Claude' }).click();
  await page.waitForURL(/\/consent-test-done\?code=/);
  expect(posts).toHaveLength(1);
  expect(posts[0].auth).toMatch(/^Bearer /);
  expect(posts[0].body.scope).toEqual(['read', 'write', 'delete']);
  expect(posts[0].body.redirect_uri).toBe('https://claude.ai/api/mcp/auth_callback');
});

test('without the toggle, the app gets exactly what it asked for', async ({ page }) => {
  const posts = await openConsent(page, CLAUDE, { redirect: 'https://claude.ai/api/mcp/auth_callback' });
  await page.getByRole('button', { name: 'Connect Claude' }).click();
  await page.waitForURL(/\/consent-test-done/);
  expect(posts[0].body.scope).toEqual(['read', 'write']);
});

test('a program on this computer warns, whoever published its name', async ({ page }) => {
  await openConsent(page, CLAUDE_CODE, { redirect: 'http://localhost:53682/callback' });
  const banner = page.locator('.oauth-banner');
  await expect(banner).toHaveAttribute('data-trust', 'local');
  await expect(banner).toHaveText('Runs on this computer. Only continue if you just started this from Claude Code yourself.');
  await expect(page.locator('.oauth-foot')).toContainText('Returns to this computer (localhost)');
});

test('a registered client is not verified, even one that calls itself Claude', async ({ page }) => {
  await openConsent(page, SELF_NAMED_CLAUDE, { redirect: 'https://claude.ai/api/mcp/auth_callback', scope: 'read' });
  const banner = page.locator('.oauth-banner');
  await expect(banner).toHaveAttribute('data-trust', 'unverified');
  await expect(banner).toHaveText('Not verified. It registered itself. Only continue if you trust claude.ai.');
  // It asked only to read, so deleting is not offered.
  await expect(page.locator('.oauth-chip')).toHaveText(['Read']);
  await expect(page.locator('.oauth-sentence')).toHaveText('It can see your clusters. It can’t change or delete anything.');
});

test('a new account is told which apps connect today', async ({ page }) => {
  await openConsent(page, CLAUDE_CODE, {
    redirect: 'http://127.0.0.1:40111/callback',
    answer: {
      status: 403,
      json: { error: 'new_account', error_description: 'Connecting an app opens up once an account is three days old' },
    },
  });
  await page.getByRole('button', { name: 'Connect Claude Code' }).click();
  await expect(page.locator('.empty-title')).toHaveText('Not yet for a new account');
  await expect(page.locator('.empty-body')).toHaveText(
    'Connecting an app opens up once an account is three days old. '
    + 'ChatGPT and Claude can connect straight away. Nothing has been shared.');
});

test('Switch signs out and keeps the request for whoever signs in next', async ({ page }) => {
  await openConsent(page, CLAUDE, { redirect: 'https://claude.ai/api/mcp/auth_callback' });
  await page.locator('.oauth-account').click();
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10_000 });
  const url = new URL(page.url());
  expect(url.pathname).toBe('/oauth/authorize');
  expect(url.searchParams.get('client_id')).toBe(CLAUDE.client_id);
});
