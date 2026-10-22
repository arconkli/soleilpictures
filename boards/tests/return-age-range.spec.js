// The optional age range under "What best describes you?" — rendered for real
// through ?returnqa=1 (dev-only, localMode.js), which skips only the clock. The
// ids and labels are pinned against the server by src/lib/feedbackContract.test.mjs;
// this proves the row shows with the roles, takes one tap, sends the band to
// submit_age_range and to nothing else, and fits on the screen it is given.
import { test, expect } from '@playwright/test';

const URL = '/?local=1&reset=1&onboarded=1&returnqa=1';
const BANDS = ['Under 18', '18–24', '25–34', '35–44', '45+'];

async function open(page, { ageWrite = { status: 200, body: 'true' } } = {}) {
  const rows = [];
  const rpcs = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.route(/\/rest\/v1\/rpc\/submit_(return_reason|role|age_range)/, async (route) => {
    const fn = route.request().url().match(/rpc\/(submit_[a-z_]+)/)[1];
    rpcs.push({ fn, args: route.request().postDataJSON() });
    const res = fn === 'submit_age_range' ? ageWrite : { status: 200, body: 'true' };
    await route.fulfill({ status: res.status, contentType: 'application/json', body: res.body });
  });
  await page.goto(URL);
  const ask = page.locator('.rr-ask');
  await expect(ask).toBeVisible({ timeout: 15_000 });
  return { ask, rows, rpcs };
}
const props = (rows, name) => rows.filter((r) => r.event === name).map((r) => r.props || {});
const like = (o) => expect.objectContaining(o);
const FLUSH = { timeout: 15_000 };
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});

test('the age row sits under the roles, takes one tap, and the band goes to the table alone', async ({ page }) => {
  const { ask, rows, rpcs } = await open(page);
  const ages = ask.getByRole('group', { name: 'Your age, optional' });
  // Not before the first answer: the first step is one question.
  await expect(ages).toHaveCount(0);

  await ask.getByRole('button', { name: 'Starting something new' }).click();
  await expect(ask.locator('.fv-banner-body')).toHaveText('And what best describes you?');
  await expect(ask.getByRole('group', { name: 'What best describes you?' })).toBeVisible();
  await expect(ages).toBeVisible();
  await expect(ages.locator('.rr-age-label')).toHaveText('Your ageoptional');
  await expect(ages.locator('.rr-chip')).toHaveText(BANDS);
  // Five across, each label whole, at whatever width this project runs.
  const clipped = await ages.locator('.rr-chip').evaluateAll((els) => els
    .filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
  expect(clipped).toEqual([]);
  const tops = await ages.locator('.rr-chip').evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top)))]);
  expect(tops).toHaveLength(1);

  // Either order: the age first, then the role.
  await ages.getByRole('button', { name: '25–34' }).click();
  await expect(ages.getByRole('button', { name: '25–34' })).toHaveClass(/is-picked/);
  for (const b of BANDS) await expect(ages.getByRole('button', { name: b })).toBeDisabled();
  await ask.getByRole('button', { name: 'Designer' }).click();
  await expect(ask.getByRole('button', { name: 'Designer' })).toHaveClass(/is-picked/);

  await expect.poll(() => rpcs.map((r) => r.fn)).toEqual(['submit_return_reason', 'submit_age_range', 'submit_role']);
  expect(rpcs[1].args).toEqual({ p_range: '25_34' });
  // This device keeps that it was answered, not the band, and owes nothing.
  expect(await page.evaluate(() => localStorage.getItem('soleil.age.v1:anon'))).toBe('answered');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('soleil.age.pending.v1'))).toBeNull();

  await hide(page);
  await expect.poll(() => props(rows, 'age_range_answered'), FLUSH).toEqual([like({ surface: 'return_banner', after_role: false })]);
  expect(props(rows, 'return_reason_answered')).toEqual([like({ choice: 'starting', role_asked: true, age_asked: true })]);
  expect(props(rows, 'role_answered')).toEqual([like({ role: 'designer' })]);
  // The band is on no row at all.
  expect(JSON.stringify(rows)).not.toMatch(/25_34|25–34/);
});

// This file runs in desktop-chrome only (the phone projects match mobile/**,
// touch/** and visual/**), so the phone widths are set here: five segments in a
// banner 24px narrower than the screen.
for (const width of [320, 390]) {
  test(`five across, each band whole, on a ${width}px screen`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    const { ask } = await open(page);
    await ask.getByRole('button', { name: 'Starting something new' }).click();
    const segs = ask.getByRole('group', { name: 'Your age, optional' }).locator('.rr-chip');
    await expect(segs).toHaveText(BANDS);
    const layout = await segs.evaluateAll((els) => {
      const banner = els[0].closest('.rr-ask').getBoundingClientRect();
      return {
        clipped: els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent),
        rows: new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))).size,
        outside: els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.left < banner.left || r.right > banner.right || r.right > window.innerWidth;
        }).map((el) => el.textContent),
      };
    });
    expect(layout).toEqual({ clipped: [], rows: 1, outside: [] });
  });
}

test('"Nothing in particular" ends it without the second step', async ({ page }) => {
  const { ask, rows } = await open(page);
  await ask.getByRole('button', { name: 'Nothing in particular' }).click();
  await expect(page.locator('.rr-ask')).toHaveCount(0);
  await hide(page);
  await expect.poll(() => props(rows, 'return_reason_answered'), FLUSH)
    .toEqual([like({ choice: 'nothing', role_asked: false, age_asked: false })]);
});

test('a refused write is reported by its code, and not retried', async ({ page }) => {
  const { ask, rows } = await open(page, {
    ageWrite: { status: 400, body: JSON.stringify({ code: '22023', message: 'unknown age range', details: null, hint: null }) },
  });
  await ask.getByRole('button', { name: 'Picking up where I left off' }).click();
  await ask.getByRole('group', { name: 'Your age, optional' }).getByRole('button', { name: '45+' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('soleil.age.pending.v1'))).toBeNull();
  await hide(page);
  await expect.poll(() => props(rows, 'age_range_write_failed'), FLUSH).toEqual([like({ code: '22023', terminal: true })]);
  expect(JSON.stringify(rows)).not.toContain('unknown age range');
});
