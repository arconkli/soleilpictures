// A draft's keep page (/keep/<token>, pages/KeepPage.jsx) in the owner's pick
// A: the draft read only under an island that keeps it. The Worker's
// /api/keep/bundle and /api/img/ are answered here, and Supabase is stubbed
// (signed out below, signed in through helpers/signedInStub.js). The token
// travels in bodies only, a new account's first touch carries /keep/:token,
// and every state a link can be in says what it is.
//
//   npx playwright test tests/keep-page.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';
import * as Y from 'yjs';
import { bootSignedIn } from './helpers/signedInStub.js';

const TOKEN = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ROOT = 'b0000000-0000-4000-8000-000000000001';
const SUB = 'b0000000-0000-4000-8000-000000000002';
const NAME = 'Tokyo noir, 1974';
const DEV_HOSTS = new Set(['127.0.0.1', 'localhost']);
const KEPT = { status: 'kept', already: false, workspace_id: 'c0000000-0000-4000-8000-000000000001', board_id: ROOT, beside_own: false, card_count: 9, card_limit: 50 };

function snapshotB64(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const [id, card] of Object.entries(cards)) {
    const m = new Y.Map();
    for (const [k, v] of Object.entries(card)) m.set(k, v);
    map.set(id, m);
  }
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

function treatmentCard() {
  const pages = new Y.Array();
  pages.push([{ id: 'p1', name: 'Treatment', parent_id: null, order: 0, expanded: true }]);
  const content = new Y.Map();
  const frag = new Y.XmlFragment();
  const para = new Y.XmlElement('paragraph');
  para.insert(0, [new Y.XmlText('Rain on sodium-lit streets; a detective who never takes off his coat.')]);
  frag.insert(0, [para]);
  content.set('p1', frag);
  return {
    kind: 'doc', title: 'Treatment', x: 1260, y: 300, w: 300, h: 200,
    docPages: pages, docPageContent: content, docBookmarks: new Y.Map(), docComments: new Y.Map(),
    docPageSheets: new Y.Map(), docSheetContent: new Y.Map(),
  };
}

// Night colours for the six pictures, served as gradients.
const NIGHT = [
  ['#0b1026', '#1f3b73', '#f2a541'], ['#120818', '#5b1d5e', '#ff4f9a'], ['#05141a', '#0f4c5c', '#5fd3c6'],
  ['#1a0f08', '#6b3410', '#ffb347'], ['#0a0a12', '#2b2d42', '#8d99ae'], ['#160b0b', '#7a1f1f', '#ff7a59'],
];
const svgFor = (i) => {
  const [a, b, c] = NIGHT[i % NIGHT.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><defs>`
    + `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="0.65" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient>`
    + `<radialGradient id="r" cx="0.72" cy="0.3" r="0.45"><stop offset="0" stop-color="${c}" stop-opacity="0.85"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
    + `</defs><rect width="1200" height="800" fill="url(#g)"/><rect width="1200" height="800" fill="url(#r)"/></svg>`;
};

function bundles(origin, expiresAt) {
  const images = {};
  const cards = {};
  for (let i = 0; i < 6; i++) {
    const key = `ws-draft/tokyo-${i}.jpg`;
    images[key] = `${origin}/api/img/signed-${i}.sig`;
    cards[`card-img-${i}`] = { kind: 'image', src: `r2:${key}`, x: 100 + (i % 3) * 384, y: 100 + Math.floor(i / 3) * 264, w: 360, h: 240 };
  }
  cards['card-note-1'] = { kind: 'note', body: 'Sodium light, wet asphalt, steam from the vents.', x: 1260, y: 100, w: 300, h: 180 };
  cards['card-doc-1'] = treatmentCard();
  cards[SUB] = { kind: 'board', x: 1260, y: 520, w: 300, h: 184 };
  const base = {
    state: 'live', host: 'chatgpt', expires_at: expiresAt, lifetime_days: 30, card_count: 9, card_limit: 50,
    image_urls: images, image_meta: {}, role: 'viewer', root_id: ROOT, include_subboards: true,
    nav_boards: [{ id: ROOT, name: NAME }, { id: SUB, name: 'Locations' }],
  };
  return {
    [ROOT]: { ...base, board: { id: ROOT, name: NAME, bg_color: null }, snapshot: snapshotB64(cards) },
    [SUB]: {
      ...base,
      board: { id: SUB, name: 'Locations', bg_color: null },
      snapshot: snapshotB64({ 'card-note-2': { kind: 'note', body: 'Shinjuku, under the tracks', x: 120, y: 120, w: 260, h: 160 } }),
    },
  };
}

// The Worker's two routes. While `keep.answer` is set ({ status, body }) the
// bundle answers it, every time (in dev, React runs the page's first read
// twice); otherwise the live draft.
async function routeKeep(page, { answer = null } = {}) {
  const keep = { posts: [], answer };
  const expiresAt = new Date(Date.UTC(2026, 10, 25, 14)).toISOString();
  await page.route('**/api/keep/bundle', async (route) => {
    const req = route.request();
    const body = req.postDataJSON();
    keep.posts.push({ method: req.method(), url: req.url(), body });
    const next = keep.answer;
    if (next) return route.fulfill({ status: next.status, contentType: 'application/json', body: JSON.stringify(next.body) });
    if (body?.token !== TOKEN) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"state":"unknown","lifetime_days":30}' });
    const all = bundles(new URL(req.url()).origin, expiresAt);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(all[body.board_id || ROOT]) });
  });
  await page.route('**/api/img/**', (route) => {
    const i = Number((route.request().url().match(/signed-(\d+)/) || [])[1] || 0);
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svgFor(i) });
  });
  return keep;
}

function sessionFor(email) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const user = { id: '11111111-1111-4111-8111-111111111111', email, aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
  const jwt = [b64url({ alg: 'HS256', typ: 'JWT' }), b64url({ sub: user.id, email, exp: now + 3600, role: 'authenticated', aud: 'authenticated' }), 'sig'].join('.');
  return { access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, user };
}

// Signed out: Supabase answers the code, its check and keep_mcp_draft here.
async function routeSignedOut(page, { keep = KEPT } = {}) {
  const calls = [];
  const session = sessionFor('ren@example.com');
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
    calls.push({ path: url.pathname, body, auth: req.headers().authorization || '' });
    const reply = (status, json) => route.fulfill({ status, headers: { ...cors(req), 'content-type': 'application/json' }, body: JSON.stringify(json) });
    if (url.pathname === '/auth/v1/otp') return reply(200, {});
    if (url.pathname === '/auth/v1/verify') return reply(200, session);
    if (url.pathname === '/auth/v1/user') return reply(200, session.user);
    if (url.pathname === '/rest/v1/rpc/keep_mcp_draft') {
      return keep.error ? reply(keep.error.status, keep.error.body) : reply(200, keep);
    }
    return reply(200, url.pathname.startsWith('/rest/v1/') ? [] : {});
  });
  return calls;
}

// Every request the page makes, but the page itself, leaves the token out of
// its address.
function watchUrls(page) {
  const urls = [];
  page.on('request', (r) => { if (!r.isNavigationRequest()) urls.push(r.url()); });
  return urls;
}

// The analytics rows the page sent, from either stub's record of calls.
const eventRows = (calls) => calls
  .filter((c) => c.path === '/rest/v1/analytics_events' || c.path === 'analytics_events')
  .flatMap((c) => (Array.isArray(c.body) ? c.body : []));

async function picturesDrawn(page) {
  await expect(page.locator('.keep-island')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.public-canvas-host img.r2p-img')]
    .filter((i) => i.complete && i.naturalWidth > 0).length), { timeout: 15_000 }).toBe(6);
}

test('signed out: the draft under the island, then the email, the code, and it is theirs', async ({ page }, testInfo) => {
  const urls = watchUrls(page);
  const { posts } = await routeKeep(page);
  const calls = await routeSignedOut(page);
  await page.goto(`/keep/${TOKEN}`);
  await picturesDrawn(page);

  await expect(page).toHaveTitle(`${NAME} — Soleil Clusters`);
  await expect(page.locator('.keep-name')).toHaveText(NAME);
  await expect(page.locator('.keep-badge')).toHaveText('Draft');
  await expect(page.locator('.keep-viewonly')).toHaveText('View only until you keep it');
  const island = page.locator('.keep-island');
  await expect(island.locator('.keep-island-title')).toHaveText(NAME);
  await expect(island.locator('.keep-island-meta')).toHaveText(/^Made with ChatGPT · 9 cards · deleted (25 Nov|Nov 25) unless you keep it$/);
  await expect(island.locator('.keep-island-foot')).toHaveText(
    'We’ll email you a 6-digit code. Free up to 50 cards and 5GB. Already on Clusters? Use the email you sign in with.');
  // The draft opens whole, above the island.
  const top = (await island.boundingBox()).y;
  const bottoms = await page.locator('.public-canvas-host [data-card-id]').evaluateAll(
    (els) => els.map((e) => e.getBoundingClientRect().bottom));
  expect(bottoms).toHaveLength(9);
  expect(Math.max(...bottoms)).toBeLessThan(top);
  await page.screenshot({ path: testInfo.outputPath('keep-desktop.png') });

  // The bundle is asked for with the token in its body.
  expect(posts[0]).toMatchObject({ method: 'POST', body: { token: TOKEN } });
  expect(posts[0].url).not.toContain(TOKEN);

  await page.getByLabel('Your email').fill('Ren@Example.com');
  await page.getByRole('button', { name: 'Keep it free' }).click();
  await expect(island.locator('.keep-chip')).toHaveText('ren@example.com');
  await expect(page.getByLabel('6-digit code')).toBeFocused();
  await expect(island.locator('.keep-wait')).toHaveText(/^Resend in \d+s$/);
  await page.screenshot({ path: testInfo.outputPath('keep-code.png') });

  // A new account's first touch names the page, never its token.
  const otp = calls.find((c) => c.path === '/auth/v1/otp');
  expect(otp.body.email).toBe('ren@example.com');
  expect(JSON.parse(otp.body.data.first_source).landing_path).toBe('/keep/:token');
  expect(JSON.stringify(otp.body)).not.toContain(TOKEN);

  await page.getByLabel('6-digit code').fill('123456');
  await expect(island.locator('.keep-island-title')).toHaveText('Kept. It’s yours.');
  await expect(island.locator('.keep-island-meta')).toHaveText(`${NAME} is in your Clusters, with room for 41 more cards on the free plan.`);
  await expect(island.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', `/?to=b:${ROOT}`);
  await expect(island.locator('.keep-island-foot')).toHaveText(
    'Back in ChatGPT, keep asking for changes. The first time, ChatGPT asks you to connect Clusters: sign in with the same email.');
  await expect(page.locator('.keep-badge')).toHaveCount(0);
  await expect(page.locator('.keep-avatar')).toHaveText('R');
  await page.screenshot({ path: testInfo.outputPath('keep-kept.png') });

  const verify = calls.find((c) => c.path === '/auth/v1/verify');
  expect(verify.body).toMatchObject({ email: 'ren@example.com', token: '123456', type: 'email' });
  const kept = calls.find((c) => c.path === '/rest/v1/rpc/keep_mcp_draft');
  expect(kept.body).toEqual({ p_token: TOKEN });
  expect(kept.auth).toMatch(/^Bearer /);

  const carrying = urls.filter((u) => u.includes(TOKEN));
  expect(carrying, 'requests with the token in their address').toEqual([]);

  // Its steps reach analytics (keep_kept is beaconed at once, the rest with
  // it), and no row carries the token or the address.
  await expect.poll(() => eventRows(calls).map((r) => r.event)).toEqual(
    expect.arrayContaining(['keep_page_view', 'keep_code_sent', 'keep_kept']));
  const rows = eventRows(calls);
  expect(rows.find((r) => r.event === 'keep_page_view').props).toMatchObject({ state: 'live', host: 'chatgpt', cards: 9 });
  expect(rows.find((r) => r.event === 'keep_code_sent').props).toMatchObject({ resend: false });
  expect(rows.find((r) => r.event === 'keep_kept').props).toMatchObject({ host: 'chatgpt', via: 'code', beside_own: false });
  expect(rows.filter((r) => r.event === 'keep_page_view')).toHaveLength(1);
  const wire = JSON.stringify(rows);
  expect(wire).not.toContain(TOKEN);
  expect(wire.toLowerCase()).not.toContain('ren@example.com');
});

test('signed out: a code that does not match says so, and another email starts over', async ({ page }) => {
  await routeKeep(page);
  const calls = await routeSignedOut(page);
  await page.route('https://example.supabase.co/auth/v1/verify**', (r) => r.fulfill({
    status: 403, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
    body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }),
  }));
  await page.goto(`/keep/${TOKEN}`);
  await picturesDrawn(page);
  await page.getByLabel('Your email').fill('ren@example');
  await page.getByRole('button', { name: 'Keep it free' }).click();
  await expect(page.locator('.keep-island-error')).toHaveText('That address is missing its ending, like .com — check the part after the @.');

  await page.getByLabel('Your email').fill('ren@example.com');
  await page.getByRole('button', { name: 'Keep it free' }).click();
  await page.getByLabel('6-digit code').fill('654321');
  await expect(page.locator('.keep-island-error')).toHaveText("That code didn't match. Check the digits, or request a new one.");
  await expect(page.getByLabel('6-digit code')).toHaveValue('');

  // Edit goes back to the address, and sends nothing.
  await page.locator('.keep-island').getByRole('button', { name: 'edit' }).click();
  await expect(page.getByLabel('Your email')).toHaveValue('ren@example.com');
  expect(calls.filter((c) => c.path === '/auth/v1/otp')).toHaveLength(1);
});

test('signed in: one button keeps it beside their own work', async ({ page }, testInfo) => {
  await routeKeep(page);
  const { calls } = await bootSignedIn(page, {
    path: `/keep/${TOKEN}`,
    rpc: { keep_mcp_draft: { ...KEPT, beside_own: true, card_limit: undefined } },
  });
  await picturesDrawn(page);
  const island = page.locator('.keep-island');
  await expect(page.locator('.keep-avatar')).toHaveText('S');
  await expect(page.locator('.keep-viewonly')).toHaveCount(0);
  await expect(island.locator('.keep-island-foot')).toHaveText(
    'Signed in as sam@example.com. It comes into your Clusters as a workspace of its own. Use another email');
  await page.screenshot({ path: testInfo.outputPath('keep-signed-in.png') });

  await island.getByRole('button', { name: 'Keep it here' }).click();
  await expect(island.locator('.keep-island-title')).toHaveText('Kept. It’s yours.');
  await expect(island.locator('.keep-island-meta')).toHaveText(`${NAME} is in your Clusters.`);
  expect(calls.filter((c) => c.path === 'rpc/keep_mcp_draft').map((c) => c.body)).toEqual([{ p_token: TOKEN }]);
  await expect.poll(() => eventRows(calls).find((r) => r.event === 'keep_kept')?.props).toMatchObject(
    { host: 'chatgpt', via: 'signed_in', beside_own: true });
});

test('signed in: Use another email signs out to the email step', async ({ page }) => {
  await routeKeep(page);
  await bootSignedIn(page, { path: `/keep/${TOKEN}` });
  await picturesDrawn(page);
  await page.getByRole('button', { name: 'Use another email' }).click();
  await expect(page.getByLabel('Your email')).toBeVisible();
  await expect(page.locator('.keep-viewonly')).toBeVisible();
});

test('kept by someone else first: the island gives way to what happened', async ({ page }) => {
  await routeKeep(page);
  const calls = await routeSignedOut(page, {
    keep: { error: { status: 403, body: { code: '42501', message: 'this draft was kept', hint: 'draft_kept', details: null } } },
  });
  await page.goto(`/keep/${TOKEN}`);
  await picturesDrawn(page);
  await page.getByLabel('Your email').fill('ren@example.com');
  await page.getByRole('button', { name: 'Keep it free' }).click();
  await page.getByLabel('6-digit code').fill('123456');
  await expect(page.locator('.keep-state-title')).toHaveText('This draft was kept');
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect.poll(() => eventRows(calls).find((r) => r.event === 'keep_failed')?.props).toMatchObject(
    { step: 'keep', reason: 'kept' });
});

test('opening a cluster inside the draft: crumbs, its address, and back', async ({ page }) => {
  const { posts } = await routeKeep(page);
  await routeSignedOut(page);
  await page.goto(`/keep/${TOKEN}`);
  await picturesDrawn(page);
  await page.locator('.bc-cover').first().click();
  await expect(page.locator('.keep-crumb.here')).toHaveText('Locations');
  await expect(page.locator('.keep-crumbs .keep-crumb').first()).toHaveText(NAME);
  await expect(page).toHaveURL(new RegExp(`/keep/${TOKEN}\\?b=${SUB}$`));
  expect(posts.at(-1).body).toEqual({ token: TOKEN, board_id: SUB });
  // The island keeps the whole draft, under the name it was made with.
  await expect(page.locator('.keep-island-title')).toHaveText(NAME);
  await page.goBack();
  await expect(page.locator('.keep-name')).toHaveText(NAME);
  await expect(page).toHaveURL(new RegExp(`/keep/${TOKEN}$`));
  await page.goForward();
  await expect(page.locator('.keep-crumb.here')).toHaveText('Locations');
  await page.locator('.keep-crumb', { hasText: NAME }).click();
  await expect(page.locator('.keep-name')).toHaveText(NAME);
  await expect(page).toHaveURL(new RegExp(`/keep/${TOKEN}$`));
});

test('every state a link can be in', async ({ page }, testInfo) => {
  await routeSignedOut(page);
  for (const [name, answer, title, body] of [
    ['expired', { status: 200, body: { state: 'expired', host: 'claude', lifetime_days: 30 } }, 'This draft is gone',
      'Drafts are deleted 30 days after their last change, and nobody kept this one. Ask Claude to make it again, then keep it.'],
    ['kept', { status: 200, body: { state: 'kept', host: 'chatgpt', lifetime_days: 30 } }, 'This draft was kept',
      'Whoever kept it has it in their Clusters now. If that was you, sign in to open it.'],
    ['unknown', { status: 404, body: { state: 'unknown', lifetime_days: 30 } }, 'This link doesn’t open a draft',
      'It may have been cut short when it was copied. Ask the AI chat for the keep link again.'],
  ]) {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await routeKeep(page, { answer });
    await page.goto(`/keep/${TOKEN}`);
    await expect(page.locator('.keep-state-title')).toHaveText(title, { timeout: 10_000 });
    await expect(page.locator('.keep-state-body')).toHaveText(body);
    await expect(page.locator('.keep-island')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`keep-${name}.png`) });
  }
});

test('a server that does not answer: Retry, never "gone"', async ({ page }) => {
  const down = { status: 503, body: { error: 'the draft could not be read just now', code: 'temporarily_unavailable' } };
  const keep = await routeKeep(page, { answer: down });
  await routeSignedOut(page);
  await page.goto(`/keep/${TOKEN}`);
  await expect(page.locator('.keep-state-title')).toHaveText('Couldn’t load this draft', { timeout: 10_000 });
  // One read, and one more after a pause, before it says so.
  expect(keep.posts.length).toBeGreaterThanOrEqual(2);
  keep.answer = null;
  await page.getByRole('button', { name: 'Retry' }).click();
  await picturesDrawn(page);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('the island is a sheet along the bottom, its field and button full width', async ({ page }, testInfo) => {
    await routeKeep(page);
    await routeSignedOut(page);
    await page.goto(`/keep/${TOKEN}`);
    await picturesDrawn(page);
    await expect(page.locator('.keep-viewonly')).toBeHidden();
    const sheet = await page.locator('.keep-island').boundingBox();
    expect(sheet.x).toBe(0);
    expect(sheet.width).toBe(390);
    expect(Math.round(sheet.y + sheet.height)).toBe(844);
    const field = await page.getByLabel('Your email').boundingBox();
    const cta = await page.getByRole('button', { name: 'Keep it free' }).boundingBox();
    expect(field.height).toBeGreaterThanOrEqual(44);
    expect(cta.height).toBeGreaterThanOrEqual(44);
    expect(field.width + cta.width).toBeGreaterThan(330);
    await page.screenshot({ path: testInfo.outputPath('keep-phone.png') });
  });
});
