// The sign-up box on the public SEO pages (components/public/SignupBox.jsx,
// arm B of the visitor test signup_box). Pins, on /vs/* and /best/*:
//   - arm B swaps only the hero's and the closing band's gold button for the box,
//     and keeps the secondary links and the fine line; arm A (?sbox=A, or no
//     parameter) is today's page, with the hrefs unchanged
//   - the box is client-only: the Worker's HTML has none of it
//   - one flow for both boxes: send a code, see the code step in both, verify,
//     land on /; a wrong ending, a failed code, "Use a different email" and a
//     reload mid-code all behave; no address in any event
//
// Supabase is stubbed (fake credentials); ?sbox= is the dev-only arm override.
//
//   PW_PORT=5291 npx playwright test tests/signup-box.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';
import { SEO_LISTICLE_PAGES } from '../src/lib/seoListicles.js';

const DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);
const PENDING_KEY = 'soleil.auth.pendingCode';
const ADDRESS = 'ren@example.com';
const COMPARE = '/vs/pureref';
const LISTICLE = SEO_LISTICLE_PAGES[0].path;   // /best/pureref-alternatives
const FINE = "We'll email you a 6-digit code. Free to start.";

function sessionFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const user = { id: '11111111-1111-4111-8111-111111111111', email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
  const jwt = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: user.id, email, exp: now + 3600, role: 'authenticated', aud: 'authenticated' }), 'sig'].join('.');
  return { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
}

// Answers Supabase (the code send, its check, every other call) and records
// each call. verifyFails answers the check with a 400 the way Supabase does.
async function stubAuth(page, { verifyFails = false } = {}) {
  const calls = [];
  const session = sessionFor(ADDRESS);
  const cors = (req) => ({
    'access-control-allow-origin': req.headers().origin || '*',
    'access-control-allow-headers': req.headers()['access-control-request-headers'] || '*',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  });
  await page.context().route(/.*/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (DEV_HOSTS.has(url.hostname)) return route.continue();
    if (url.hostname !== 'example.supabase.co') return route.abort();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(req) });
    let body = null;
    try { body = req.postDataJSON(); } catch (_) {}
    calls.push({ path: url.pathname, body, raw: req.postData() || '' });
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors(req), 'content-type': 'application/json' }, body: JSON.stringify(json) });
    if (url.pathname === '/auth/v1/otp') return reply(200, {});
    if (url.pathname === '/auth/v1/verify') {
      return verifyFails
        ? reply(400, { code: 400, error_code: 'otp_expired', msg: 'Token has expired or is invalid' })
        : reply(200, session);
    }
    if (url.pathname === '/auth/v1/user') return reply(200, session.user);
    return reply(200, url.pathname.startsWith('/rest/v1/') ? [] : {});
  });
  return calls;
}

const hero = (page) => page.locator('[data-signup-box="hero"]');
const closing = (page) => page.locator('[data-signup-box="closing"]');
const pathOf = (calls, p) => calls.filter((c) => c.path === p);

// Types an address in the hero box and sends the code.
async function sendFromHero(page, address = ADDRESS) {
  await hero(page).locator('input[type=email]').fill(address);
  await hero(page).locator('button.sgb-btn').click();
}

for (const [kind, path, secondary] of [
  ['compare page', COMPARE, ['See a real board ↓']],
  ['listicle page', LISTICLE, ['Skip to the rankings ↓']],
]) {
  test.describe(`${kind} (${path})`, () => {
    test('?sbox=B: the box stands where the gold buttons stood, secondary links stay', async ({ page }) => {
      await page.goto(`${path}?sbox=B`);
      await expect(page.locator('[data-signup-box]')).toHaveCount(2);
      await expect(page.locator('.seo-hero-cta [data-signup-box="hero"]')).toHaveCount(1);
      await expect(page.locator('.seo-cta-band [data-signup-box="closing"]')).toHaveCount(1);
      await expect(page.locator('.seo-hero-cta .seo-cta-primary')).toHaveCount(0);
      await expect(page.locator('.seo-cta-band .seo-cta-primary')).toHaveCount(0);
      for (const text of secondary) {
        await expect(page.locator('.seo-hero-cta .seo-cta-secondary', { hasText: text })).toBeVisible();
      }
      await expect(hero(page).locator('.sgb-fine')).toHaveText(FINE);
      await expect(closing(page).locator('.sgb-fine')).toHaveText(FINE);
    });

    for (const query of ['?sbox=A', '']) {
      test(`${query || 'no parameter'}: today's page, no box`, async ({ page }) => {
        await page.goto(`${path}${query}`);
        await expect(page.locator('.seo-hero-cta .seo-cta-primary')).toBeVisible();
        await expect(page.locator('[data-signup-box]')).toHaveCount(0);
        for (const where of ['.seo-hero-cta', '.seo-cta-band']) {
          const link = page.locator(`${where} .seo-cta-primary`);
          await expect(link).toHaveCount(1);
          expect(await link.getAttribute('href')).toMatch(/^\/\?utm_source=seo/);
        }
      });
    }
  });
}

test.describe('crawler-visible text', () => {
  test('the Worker\'s HTML never carries the box', async ({ page }) => {
    for (const path of [COMPARE, LISTICLE]) {
      const res = await page.request.get(`${path}?sbox=B`);
      expect(res.ok()).toBe(true);
      const html = await res.text();
      expect(html).not.toContain('sgb-');
      expect(html).not.toContain('data-signup-box');
    }
  });
});

test.describe('the preview link (?preview=signupbox, production too)', () => {
  for (const signedIn of [false, true]) {
    test(`shows the box ${signedIn ? 'signed in' : 'signed out'}, enrols nobody, and its events are marked synthetic`, async ({ page }) => {
      const calls = await stubAuth(page);
      if (signedIn) {
        await page.addInitScript((s) => { localStorage.setItem('sb-example-auth-token', JSON.stringify(s)); }, sessionFor(ADDRESS));
      }
      await page.goto(`${COMPARE}?preview=signupbox`);
      await expect(page.locator('[data-signup-box]')).toHaveCount(2);
      await expect(page.locator('.seo-hero-cta .seo-cta-primary')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('soleil_visitor_arms'))).toBeNull();
      await expect.poll(() => pathOf(calls, '/rest/v1/analytics_events').length, { timeout: 15000 }).toBeGreaterThan(0);
      const rows = pathOf(calls, '/rest/v1/analytics_events').flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
      expect(rows.some((r) => r?.event === 'lp_view')).toBe(true);
      for (const r of rows) expect(r?.props?.synthetic).toBe(true);
    });
  }

  test('without it, a page view is not marked', async ({ page }) => {
    const calls = await stubAuth(page);
    await page.goto(COMPARE);
    await expect.poll(() => pathOf(calls, '/rest/v1/analytics_events').length, { timeout: 15000 }).toBeGreaterThan(0);
    const rows = pathOf(calls, '/rest/v1/analytics_events').flatMap((c) => (Array.isArray(c.body) ? c.body : [c.body]));
    expect(rows.some((r) => r?.props?.synthetic === true)).toBe(false);
  });
});

test.describe('sign-up flow on /vs/pureref', () => {
  test('send, both boxes show the code step, verify, land on /', async ({ page }) => {
    const calls = await stubAuth(page);
    await page.goto(`${COMPARE}?sbox=B`);
    await expect(hero(page)).toBeVisible();
    await sendFromHero(page);

    for (const box of [hero(page), closing(page)]) {
      await expect(box.locator('.sgb-sent')).toContainText(ADDRESS);
    }
    await expect(hero(page).getByText(/Send again in \d+s/)).toBeVisible();

    const otp = pathOf(calls, '/auth/v1/otp');
    expect(otp).toHaveLength(1);
    expect(otp[0].body.email).toBe(ADDRESS);
    expect(typeof otp[0].body.data?.first_source).toBe('string');
    expect(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)).email, PENDING_KEY)).toBe(ADDRESS);

    // Typing the sixth digit sends the check on its own.
    await hero(page).locator('input.is-code').fill('123456');
    await page.waitForURL((u) => new URL(u).pathname === '/');
    const verify = pathOf(calls, '/auth/v1/verify');
    expect(verify).toHaveLength(1);
    expect(verify[0].body).toMatchObject({ email: ADDRESS, token: '123456', type: 'email' });
    expect(await page.evaluate((k) => localStorage.getItem(k), PENDING_KEY)).toBeNull();

    // Counts only: the address is in the auth calls and nowhere else.
    const elsewhere = calls.filter((c) => !c.path.startsWith('/auth/v1/'));
    for (const c of elsewhere) expect(c.raw.toLowerCase()).not.toContain(ADDRESS);
  });

  test('an address without an ending is refused before anything is sent', async ({ page }) => {
    const calls = await stubAuth(page);
    await page.goto(`${COMPARE}?sbox=B`);
    await sendFromHero(page, 'you@studio');
    await expect(hero(page).locator('p.sgb-error')).toContainText('.com');
    await expect(hero(page).locator('input[type=email]')).toBeVisible();
    await expect(hero(page).locator('input.is-code')).toHaveCount(0);
    expect(pathOf(calls, '/auth/v1/otp')).toHaveLength(0);
  });

  test('a code that does not match says so and clears the field', async ({ page }) => {
    const calls = await stubAuth(page, { verifyFails: true });
    await page.goto(`${COMPARE}?sbox=B`);
    await sendFromHero(page);
    const code = hero(page).locator('input.is-code');
    await code.fill('654321');
    await expect(hero(page).locator('.sgb-error')).toContainText("didn't match");
    await expect(code).toHaveValue('');
    await expect(code).toBeFocused();
    await expect(hero(page).locator('.sgb-sent')).toContainText(ADDRESS);
    expect(pathOf(calls, '/auth/v1/verify')).toHaveLength(1);
    expect(page.url()).toContain(COMPARE);
  });

  test('"Use a different email" returns both boxes to the email step', async ({ page }) => {
    await stubAuth(page);
    await page.goto(`${COMPARE}?sbox=B`);
    await sendFromHero(page);
    await expect(closing(page).locator('.sgb-sent')).toContainText(ADDRESS);

    await hero(page).getByRole('button', { name: 'Use a different email' }).click();
    for (const box of [hero(page), closing(page)]) {
      await expect(box.locator('input[type=email]')).toBeVisible();
      await expect(box.locator('input.is-code')).toHaveCount(0);
    }
    expect(await page.evaluate((k) => localStorage.getItem(k), PENDING_KEY)).toBeNull();
  });

  test('a reload during the code step comes back to it, same address', async ({ page }) => {
    await stubAuth(page);
    await page.goto(`${COMPARE}?sbox=B`);
    await sendFromHero(page);
    await expect(hero(page).locator('.sgb-sent')).toContainText(ADDRESS);

    await page.reload();
    for (const box of [hero(page), closing(page)]) {
      await expect(box.locator('.sgb-sent')).toContainText(ADDRESS);
      await expect(box.locator('input.is-code')).toBeVisible();
    }
  });
});
