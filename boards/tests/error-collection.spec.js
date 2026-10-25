// error-collection.spec.js — a failure becomes a row, and no row holds what
// anyone made. On ?local=1 a dev build hands its rows to window.__errorSink
// instead of sending them (lib/errorSender.js), so this reads what production
// would have sent.
//
// The pure halves (what a failed request is, what a route may keep, the
// allowlists against 0580's) are in src/lib/errorCore.test.mjs; this is the
// wiring: the fetch watch, the resource listener, console capture, toasts,
// the crumb trail, and the batch.
import { expect, test } from '@playwright/test';

// Typed into a note, quoted by a failing request's body and by a toast's
// words. It must reach no row.
const SECRET = 'Zq7 unicorn ledger 4471';

async function go(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await page.evaluate(() => { try { localStorage.removeItem('soleil-boards-tweaks'); } catch (_) {} });
  await page.goto('/?local=1&reset=1&blank=1');
  await page.evaluate(() => window.history.replaceState(null, '', '/?local=1&blank=1'));
  await expect(page.locator('.rail-brand')).toBeVisible();
}

const sink = (page) => page.evaluate(() => window.__errorSink || []);

async function rowWhere(page, what, pred) {
  let found = null;
  await expect.poll(async () => {
    found = (await sink(page)).find(pred) || null;
    return !!found;
  }, { message: what, timeout: 15_000 }).toBe(true);
  return found;
}

test('each kind of failure lands as a row, with its trail and none of the content', async ({ page }) => {
  await page.route('**/rest/v1/rpc/qa_probe', (r) => r.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ code: '57014', message: `canceling statement: ${SECRET}`, details: SECRET }),
  }));
  await page.route('**/qa-missing.png', (r) => r.fulfill({ status: 404, body: '' }));
  await go(page);

  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width - 220, y: 140 } });
  await page.locator('.note-body[contenteditable="true"]').last().click();
  await page.keyboard.type(SECRET);
  await page.locator('.canvas-wrap').click({ position: { x: 120, y: cb.height - 120 } });
  await expect(page.locator('.card', { hasText: SECRET }).last()).toBeVisible();

  await page.evaluate((secret) => {
    setTimeout(() => { throw new Error('qa thrown error'); }, 0);
    fetch('https://example.supabase.co/rest/v1/rpc/qa_probe', { method: 'POST', body: JSON.stringify({ text: secret }) })
      .catch(() => {});
    const img = document.createElement('img');
    img.src = '/qa-missing.png';
    document.body.append(img);
    // A logged line keeps its leading [tag] alone: the rest can name a file.
    console.error(`[qa-console] could not open ${secret}`, new Error('qa console error'));
    console.warn('[qa-warn] best effort failed', new Error('qa console warning'));
    // A rejection whose reason is a PostgrestError's shape: its details (the
    // refused row) must not come through.
    Promise.reject({ message: 'permission denied for table cards', code: '42501', details: `Failing row contains (${secret})` });
    // An address in a message: the chunk's name stays, the link's key goes.
    setTimeout(() => { throw new Error('Failed to fetch https://clusters.soleilpictures.com/s/AbCdEf123456?x=1'); }, 0);
    window.__soleilToast({ type: 'error', message: `Couldn't save ${secret}`, code: 'qa_toast_failed' });
  }, SECRET);

  const thrown = await rowWhere(page, 'a thrown error', (r) => r.kind === 'window' && r.message === 'qa thrown error');
  expect(thrown.severity).toBeNull();   // the trigger names it from the kind
  expect(thrown.env).toBe('dev');
  expect(thrown.context).toMatchObject({ online: true, vis: 'visible' });

  // (The harness's own calls to the fake Supabase fail too, and are rows.)
  const http = await rowWhere(page, 'a failed RPC', (r) => r.kind === 'http' && r.context?.http?.route === 'qa_probe');
  expect(http.message).toBe('POST rpc/qa_probe: statement timeout (57014)');
  expect(http.severity).toBe('error');
  expect(http.context.http).toMatchObject({ method: 'POST', svc: 'rpc', route: 'qa_probe', pg: '57014', status: 500 });

  const img = await rowWhere(page, 'a picture that did not load', (r) => r.kind === 'resource');
  expect(img.message).toBe('img worker/:x .png did not load');
  expect(img.severity).toBe('warning');

  const rejected = await rowWhere(page, 'an unhandled rejection', (r) => r.kind === 'unhandledrejection' && /42501/.test(r.message));
  expect(rejected.message).toBe('Unhandled rejection: permission denied for table cards code=42501');
  expect(rejected.name).toBe('PostgrestError');

  const scrubbed = await rowWhere(page, 'an address in a message', (r) => r.kind === 'window' && /^Failed to fetch/.test(r.message));
  expect(scrubbed.message).toBe('Failed to fetch worker/s/:x');

  const logged = await rowWhere(page, 'a logged Error', (r) => r.kind === 'console' && r.message === 'qa console error');
  expect(logged.context.op).toBe('qa-console');
  const warned = await rowWhere(page, 'a warned Error', (r) => r.kind === 'console' && r.message === 'qa console warning');
  expect(warned.context.op).toBe('qa-warn');
  expect(warned.severity).toBe('warning');

  const toast = await rowWhere(page, 'an error toast', (r) => r.kind === 'toast');
  expect(toast.message).toBe('toast:qa_toast_failed');
  expect(toast.context).toMatchObject({ code: 'qa_toast_failed' });

  // The trail: names of steps, the failed request by its route, never an
  // address. A failure after all of them carries all of them.
  await page.evaluate(() => { setTimeout(() => { throw new Error('qa after'); }, 0); });
  const after = await rowWhere(page, 'a failure after the rest', (r) => r.message === 'qa after');
  const trail = after.breadcrumbs || [];
  expect(trail.some((c) => c.k === 'ev')).toBe(true);
  expect(trail).toContainEqual(expect.objectContaining({ k: 'http', n: 'POST rpc/qa_probe 500' }));
  expect(trail).toContainEqual(expect.objectContaining({ k: 'toast', n: 'qa_toast_failed' }));
  expect(trail).toContainEqual(expect.objectContaining({ k: 'err', n: 'window' }));
  for (const row of await sink(page)) {
    for (const c of row.breadcrumbs || []) {
      expect(Object.keys(c).sort()).toEqual(['k', 'n', 't']);
      expect(c.n).not.toMatch(/https?:|supabase\.co|\?/);
    }
  }

  // One failure, one row: the same toast again in this page is not a second.
  await page.evaluate(() => window.__soleilToast({ type: 'error', message: 'again', code: 'qa_toast_failed' }));
  await page.waitForTimeout(2500);
  const rows = await sink(page);
  expect(rows.filter((r) => r.kind === 'toast' && r.message === 'toast:qa_toast_failed')).toHaveLength(1);

  // What was typed, what the failing body quoted and the toast's words reach
  // no row anywhere.
  const all = JSON.stringify(rows);
  expect(all).not.toContain(SECRET);
  expect(all).not.toContain('unicorn');
  expect(all).not.toContain("Couldn't save");
});

test('a request the page called off, and one made while offline, are nobody\'s problem', async ({ page, context }) => {
  await page.route('**/rest/v1/rpc/qa_slow', async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.fulfill({ status: 500, body: '{}' }).catch(() => {});
  });
  await go(page);
  await page.evaluate(() => {
    const ctl = new AbortController();
    fetch('https://example.supabase.co/rest/v1/rpc/qa_slow', { method: 'POST', signal: ctl.signal }).catch(() => {});
    setTimeout(() => ctl.abort(), 100);
  });
  await context.setOffline(true);
  await page.evaluate(() => fetch('https://example.supabase.co/rest/v1/rpc/qa_offline', { method: 'POST' }).catch(() => {}));
  await context.setOffline(false);
  // A real failure after them, so the batch is known to have gone out.
  await page.evaluate(() => { setTimeout(() => { throw new Error('qa marker'); }, 0); });
  await rowWhere(page, 'the marker', (r) => r.message === 'qa marker');
  const rows = await sink(page);
  expect(rows.filter((r) => r.kind === 'http' && /qa_slow|qa_offline/.test(r.message))).toEqual([]);
});
