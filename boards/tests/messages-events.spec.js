import { expect, test } from '@playwright/test';

// What the Messages panel logs, in the Messages QA harness (?msgqa=1): every
// analytics row it inserts lands in window.__msgQa.events, on the queue's 5s
// flush. The events carry a message's shape, never its words
// (lib/messageEvents.js).

async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/?msgqa=1${query ? `&${query}` : ''}`);
  await page.waitForSelector('html[data-msgqa-ready="1"]');
  return errors;
}
const qa = (page, fn, arg) => page.evaluate(fn, arg);
const composerInput = (page) => page.locator('.msg-composer-input').last();
const bubble = (page, text) => page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: text }) }).last();
async function send(page, text) {
  await composerInput(page).fill(text);
  await composerInput(page).press('Enter');
  return bubble(page, text);
}
const props = (page, name) => qa(page, (n) => window.__msgQa.events.filter((e) => e.event === n).map((e) => e.props), name);
const msgEventsText = (page) => qa(page, () => JSON.stringify(window.__msgQa.events.filter((e) => e.event.startsWith('msg_'))));
const FLUSH = { timeout: 15_000 };
const pick = (keys) => (rows) => rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k]])));

test('a send logs its answer and its shape, never its words', async ({ page }) => {
  const errors = await open(page, 'conv=c-maya');
  await send(page, 'the north gate at noon');
  await expect.poll(async () => pick(['ok', 'attempt', 'chars', 'attach_n', 'mention_n', 'reply'])(await props(page, 'msg_send')), FLUSH)
    .toEqual([{ ok: true, attempt: 1, chars: 's', attach_n: 0, mention_n: 0, reply: false }]);
  const [sent] = await props(page, 'msg_send');
  expect(sent.ms).toBeGreaterThanOrEqual(0);
  expect(await msgEventsText(page)).not.toContain('north gate');
  expect(errors).toEqual([]);
});

test('a failed send logs its code, and Retry logs the second attempt', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.failNext('insert:messages'));
  const b = await send(page, 'flaky send');
  await b.locator('.msg-bubble-failed button', { hasText: 'Retry' }).click();
  await expect(b.locator('.msg-bubble-failed')).toHaveCount(0);
  await expect.poll(async () => pick(['ok', 'attempt', 'code'])(await props(page, 'msg_send')), FLUSH)
    .toEqual([{ ok: false, attempt: 1, code: 'QA000' }, { ok: true, attempt: 2, code: undefined }]);
});

test('a failed send that is discarded says how many tries it had', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.failNext('insert:messages'));
  const b = await send(page, 'never mind');
  await b.locator('.msg-bubble-failed button', { hasText: 'Discard' }).click();
  await expect.poll(async () => pick(['action', 'attempts'])(await props(page, 'msg_action')), FLUSH)
    .toEqual([{ action: 'discard', attempts: 1 }]);
});

test('a delete and its Undo each log how they went', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const b = await send(page, 'delete me');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'delete me'))).toBe(true);
  await b.hover();
  await b.locator('button[title="Delete"]').click();
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await expect(page.locator('.msg-bubble-body', { hasText: 'delete me' })).toBeVisible();
  await expect.poll(async () => pick(['action', 'ok'])(await props(page, 'msg_action')), FLUSH)
    .toEqual([{ action: 'delete', ok: true }, { action: 'undo_delete', ok: true }]);
});

test('a search logs its length and what it found once, and that a result was opened', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await composerInput(page).press('ControlOrMeta+f');
  await page.locator('.msg-search-input').fill('talk');
  const row = page.locator('.msg-search-result').first();
  await expect(row).toBeVisible();
  const shown = await page.locator('.msg-search-result').count();
  await row.click();
  await expect(page.locator('.msg-search')).toHaveCount(0);
  await expect.poll(async () => props(page, 'msg_search'), FLUSH)
    .toEqual([expect.objectContaining({ q_len: 4, results_n: shown, failed: false, picked: true })]);
  expect(await msgEventsText(page)).not.toMatch(/"talk"/);
});
