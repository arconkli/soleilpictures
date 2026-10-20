// What the owner's Share dialog records: every confirmed write (people added,
// one person's access changed, removed, put back by Undo, the link's access),
// each with what kind of file it is, and every failed read or write by the
// server's code, never its message. Driven through ?fileshareqa=<fixture>
// (src/local/FileShareQaHarness.jsx), whose fake RPCs can be made to fail.
import { expect, test } from '@playwright/test';

async function open(page, fixture) {
  const rows = [];
  await page.route('**/rest/v1/analytics_events*', async (route) => {
    try {
      const body = route.request().postDataJSON();
      for (const r of Array.isArray(body) ? body : [body]) rows.push(r);
    } catch { /* non-JSON */ }
    await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?fileshareqa=${fixture}`);
  await page.waitForSelector('[data-fileshareqa-ready]', { state: 'attached' });
  return rows;
}
const hide = (page) => page.evaluate(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
});
const props = (rows, name) => rows.filter((r) => r.event === name).map((r) => r.props || {});
// Every row also carries the session's context, so each is matched on the
// event's own fields.
const like = (o) => expect.objectContaining(o);
const FLUSH = { timeout: 15_000 };
const dlg = (page) => page.locator('.fsd-modal');

test('each confirmed write has its row, with the kind of file', async ({ page }) => {
  const rows = await open(page, 'dialog');
  await expect(dlg(page).getByText('Jun Park')).toBeVisible();
  const input = dlg(page).getByLabel('Add people by email');
  await input.pressSequentially('sam@example.com,');
  await input.pressSequentially('not-an-email,');
  await dlg(page).getByRole('button', { name: 'Send' }).click();
  await expect(dlg(page).locator('.fsd-person[data-email="sam@example.com"]')).toBeVisible();
  await dlg(page).getByLabel('Access for Jun Park').selectOption('view');
  await expect(dlg(page).getByLabel('Access for Jun Park')).toHaveValue('view');
  await page.waitForTimeout(300);
  await dlg(page).getByLabel('Access for Jun Park').selectOption('__remove');
  await dlg(page).getByRole('button', { name: 'Undo' }).click();
  await expect(dlg(page).locator('.fsd-person[data-email="jun@example.com"]')).toBeVisible();
  await dlg(page).getByLabel('Who can open it').selectOption('anyone');
  await expect(dlg(page).getByLabel('What anyone with the link can do')).toBeVisible();
  await page.waitForTimeout(300);
  await hide(page);

  await expect.poll(() => props(rows, 'file_share_person_set').length, FLUSH).toBe(3);
  expect(props(rows, 'file_share_people_add')).toEqual([like({ n: 1, role: 'comment', skipped: 1, kind: 'video' })]);
  expect(props(rows, 'file_share_person_set')).toEqual([
    like({ role: 'view', undo: false, kind: 'video' }),
    like({ role: null, undo: false, kind: 'video' }),
    like({ role: 'view', undo: true, kind: 'video' }),
  ]);
  expect(props(rows, 'file_share_access_set').at(-1)).toMatchObject({ link_access: 'view', kind: 'video' });
  expect(props(rows, 'file_share_fail')).toEqual([]);
});

test('a write that fails is logged by its code, and the message stays out', async ({ page }) => {
  const rows = await open(page, 'dialog-fail');
  await expect(dlg(page).getByText('Jun Park')).toBeVisible();
  await dlg(page).getByLabel('Who can open it').selectOption('anyone');
  await expect(dlg(page).locator('.fsd-error')).toBeVisible();
  await dlg(page).getByLabel('Access for Jun Park').selectOption('__remove');
  await dlg(page).getByLabel('Access for Sam Lee').selectOption('view');
  await page.waitForTimeout(1200);   // both queued answers (400ms each) land
  await hide(page);

  await expect.poll(() => props(rows, 'file_share_fail').length, FLUSH).toBe(3);
  expect(props(rows, 'file_share_fail')).toEqual([
    like({ action: 'access', code: 'P0001', kind: 'video' }),
    like({ action: 'remove', code: 'P0001', kind: 'video' }),
    like({ action: 'role', code: 'P0001', kind: 'video' }),
  ]);
  expect(JSON.stringify(rows)).not.toContain('new_account_risky');
  expect(props(rows, 'file_share_person_set')).toEqual([]);
  expect(props(rows, 'file_share_access_set')).toEqual([]);
});
