// /pricing/talk-to-us — Talk to us, direction C (auth/TalkToUsPage.jsx): the
// form's checks, the tidied request (request_team_contact, route-intercepted),
// the card's Sent state, a repeat, a busy hour, and the page on a phone. No
// Supabase: the RPC and analytics are fulfilled here.

import { expect, test } from '@playwright/test';
import { routeAnalytics } from './helpers/share-fixture.js';

const json = (status, body) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function routeContact(page, answer) {
  const calls = [];
  let next = answer;
  await page.route('**/rest/v1/rpc/request_team_contact**', async (route) => {
    calls.push(route.request().postDataJSON());
    await route.fulfill(next);
  });
  return { calls, answer: (a) => { next = a; } };
}

async function fillRequired(page, { name = 'Sam Rivera', email = 'sam@example.com', company = 'Northlight Films' } = {}) {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Company').fill(company);
}

test('the form checks, sends the tidied request, and the card says it is with us', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  const rpc = await routeContact(page, json(200, 'sent'));
  await page.goto('/pricing/talk-to-us');

  await expect(page).toHaveTitle('Talk to us — Soleil Clusters');
  await expect(page.getByRole('heading', { level: 1, name: 'Talk to us' })).toBeVisible();
  await expect(page.locator('.tt-back')).toHaveAttribute('href', '/pricing');

  // Nothing filled: the first field that needs a look says so and takes focus.
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#tt-name-err')).toHaveText('Add your name.');
  await expect(page.locator('#tt-name')).toBeFocused();
  await page.getByLabel('Your name').fill('  Sam Rivera ');
  await expect(page.locator('#tt-name-err')).toHaveCount(0);
  await page.getByLabel('Work email').fill('sam@northlight');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('#tt-email-err')).toHaveText('Add an email we can write back to.');
  await expect(page.locator('#tt-email')).toHaveAttribute('aria-invalid', 'true');
  expect(rpc.calls).toHaveLength(0);

  await page.getByLabel('Work email').fill(' Sam@Northlight.Studio');
  await page.getByLabel('Company').fill('Northlight Films');
  await page.getByLabel('People who would edit').fill('140');
  const sso = page.getByRole('button', { name: 'Single sign-on (SSO)' });
  await sso.click();
  await expect(sso).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'More than 100 seats' }).click();
  await page.getByRole('button', { name: 'Something else' }).click();
  await page.getByRole('button', { name: 'Something else' }).click();
  await page.getByLabel(/Anything else/).fill(' SSO through Okta. ');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Thanks, Sam. It’s with us.' })).toBeFocused();
  await expect(page.locator('.tt-done')).toContainText('We’ll write to sam@northlight.studio. Meanwhile a Team trial works for up to 100 seats');
  expect(rpc.calls).toEqual([{
    p_name: 'Sam Rivera', p_email: 'sam@northlight.studio', p_company: 'Northlight Films',
    p_editors: 140, p_needs: ['sso', 'seats'], p_message: 'SSO through Okta.',
  }]);
  await expect(page.getByRole('link', { name: 'Back to pricing' })).toHaveAttribute('href', '/pricing');

  // The view and the send, with needs and counts: never the name, email or company.
  await expect.poll(() => rows.map((r) => r.event)).toEqual(expect.arrayContaining(['team_talk_view', 'team_talk_sent']));
  const sent = rows.find((r) => r.event === 'team_talk_sent');
  expect(JSON.stringify(sent)).toContain('"sso"');
  const all = JSON.stringify(rows);
  for (const s of ['Sam Rivera', 'northlight', 'Northlight']) expect(all).not.toContain(s);

  // Signed out, Start a Team trial keeps the seats (140 asked, 100 the most a
  // team buys itself) and goes to sign in, as the pricing card does.
  await page.getByRole('button', { name: 'Start a Team trial' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem('soleil.boards.pending.team.start')));
  expect(kept).toMatchObject({ seats: 100, billing: 'monthly' });
});

test('a busy hour says so and keeps the form; a repeat within a day says we have it', async ({ page }) => {
  const rows = [];
  await routeAnalytics(page, rows);
  const rpc = await routeContact(page, json(400, {
    code: 'P0001', message: 'too many requests just now', details: null, hint: 'team_contact_busy',
  }));
  await page.goto('/pricing/talk-to-us');
  await fillRequired(page);
  await page.getByRole('button', { name: 'Send' }).click();

  const error = page.locator('.tt-error');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error).toContainText('That didn’t send. A lot of requests came in just now.');
  await expect(page.getByLabel('Company')).toHaveValue('Northlight Films');
  await expect.poll(() => rows.filter((r) => r.event === 'team_talk_failed').length).toBe(1);

  rpc.answer(json(200, 'already'));
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'We already have your request, Sam.' })).toBeVisible();
  expect(rpc.calls).toHaveLength(2);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('one column, nothing wider than the screen', async ({ page }) => {
    await routeAnalytics(page, []);
    await page.goto('/pricing/talk-to-us');
    const name = await page.getByLabel('Your name').boundingBox();
    const email = await page.getByLabel('Work email').boundingBox();
    expect(email.y).toBeGreaterThan(name.y + name.height);
    expect(Math.abs(email.x - name.x)).toBeLessThan(1);
    const card = await page.locator('.tt-card').boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(16);
    expect(card.x + card.width).toBeLessThanOrEqual(390 - 16 + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
