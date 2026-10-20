import { expect, test } from '@playwright/test';

// The Messages panel in the Messages QA harness (?msgqa=1): the real
// MessagesPanel over an in-memory fake of the Supabase client, so everything
// here runs with no backend. Later steps extend this file.

const ME = 'qa-me';
const MAYA = 'maya';

async function open(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`/?msgqa=1${query ? `&${query}` : ''}`);
  await page.waitForSelector('html[data-msgqa-ready="1"]');
  return errors;
}
const thread = (page) => page.locator('.msg-thread-body');
const qa = (page, fn, arg) => page.evaluate(fn, arg);

// [conversation id, what its row is called in the list (null: not in the list)]
const CONVERSATIONS = [
  ['c-maya', 'Maya Ortiz'],
  ['c-cast', 'Casting'],
  ['c-long', 'Jon Park'],
  ['c-empty', 'Priya Nair'],
  ['c-left', null], // a group you left is hidden from the list; reachable by link
];

for (const look of ['card', 'drawer']) {
  test.describe(`every fixture conversation opens (${look})`, () => {
    for (const [id, rowName] of CONVERSATIONS) {
      if (rowName) {
        test(`${id} from the list`, async ({ page }) => {
          const errors = await open(page, `look=${look}`);
          await page.locator('.msg-row', { hasText: rowName }).first().click();
          await expect(thread(page)).toBeVisible();
          expect(errors).toEqual([]);
        });
      }
      test(`${id} by &conv=`, async ({ page }) => {
        const errors = await open(page, `look=${look}&conv=${id}`);
        await expect(thread(page)).toBeVisible();
        if (id === 'c-maya') await expect(page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' })).toBeVisible();
        expect(errors).toEqual([]);
      });
    }
  });
}

test('the list shows c-maya unread on first load', async ({ page }) => {
  await open(page);
  const row = page.locator('.msg-row', { hasText: 'Maya Ortiz' }).first();
  await expect(row).toHaveClass(/is-unread/);
  await expect(row.locator('.msg-row-count')).toHaveText('2');
});

test('sending a message shows it in the thread and in the fake db', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const input = page.locator('.msg-composer-input');
  await input.fill('hello from QA');
  await input.press('Enter');
  await expect(page.locator('.msg-bubble-body', { hasText: 'hello from QA' })).toBeVisible();
  const saved = await qa(page, () => window.__msgQa.db.messages
    .filter((m) => m.conversation_id === 'c-maya' && m.body === 'hello from QA')
    .map((m) => ({ sender: m.sender_id, kind: m.kind })));
  expect(saved).toEqual([{ sender: ME, kind: 'user' }]);
});

test('a message from a peer appears in the open thread', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await expect(page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' })).toBeVisible();
  await qa(page, (id) => window.__msgQa.peer(id).send('c-maya', 'ping'), MAYA);
  await expect(page.locator('.msg-bubble-body', { hasText: /^ping$/ })).toBeVisible();
});

// ── Optimistic actions (C2.3) ──────────────────────────────────────────
const bubble = (page, text) => page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: text }) }).last();
async function send(page, text) {
  const input = page.locator('.msg-composer-input');
  await input.fill(text);
  await input.press('Enter');
  return bubble(page, text);
}
// Reads of the thread's newest page (200 rows), not the pinned list or a nudge's by-id read.
const pageReads = (page) => qa(page, () => window.__msgQa.calls.filter((c) => c.target === 'select:messages' && c.args?.limit === 200).length);

test('a send shows at once and keeps its element when the server confirms it, with no thread re-read', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.setLatency({ 'insert:messages': 700 }));
  const before = await pageReads(page);
  const b = await send(page, 'optimistic hello');
  await expect(b).toBeVisible({ timeout: 300 });
  const handle = await b.elementHandle();
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'optimistic hello'))).toBe(true);
  await expect(b.locator('.msg-bubble-time', { hasText: 'Sending…' })).toHaveCount(0);
  expect(await handle.evaluate((n) => n.isConnected)).toBe(true);
  await page.waitForTimeout(400);
  expect(await pageReads(page)).toBe(before);
});

test('a failed send stays with Retry, and Retry saves it exactly once', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.failNext('insert:messages'));
  const b = await send(page, 'flaky send');
  await expect(b.locator('.msg-bubble-failed')).toBeVisible();
  await b.locator('.msg-bubble-failed button', { hasText: 'Retry' }).click();
  await expect(b.locator('.msg-bubble-failed')).toHaveCount(0);
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.filter((m) => m.body === 'flaky send').length)).toBe(1);
});

test('a reaction shows before the server answers and rolls back with a toast when refused', async ({ page }) => {
  await open(page, 'conv=c-cast');
  await qa(page, () => window.__msgQa.setLatency({ 'rpc:toggle_message_reaction': 700 }));
  const fire = bubble(page, 'Leaning toward the second one.').locator('.msg-reaction', { hasText: '🔥' });
  await expect(fire.locator('.msg-reaction-count')).toHaveText('1');
  await fire.click();
  await expect(fire.locator('.msg-reaction-count')).toHaveText('2', { timeout: 300 });
  await qa(page, () => window.__msgQa.failNext('rpc:toggle_message_reaction'));
  await fire.click();
  await expect(fire.locator('.msg-reaction-count')).toHaveText('1', { timeout: 300 });
  await expect(fire.locator('.msg-reaction-count')).toHaveText('2');
  await expect(page.locator('.toast-msg', { hasText: "Couldn't save your reaction" })).toBeVisible();
});

test('delete asks nothing, goes at once, and Undo brings it back', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const b = await send(page, 'delete me');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'delete me'))).toBe(true);
  await b.hover();
  await b.locator('button[title="Delete"]').click();
  await expect(page.locator('.feedback-dialog')).toHaveCount(0);
  await expect(page.locator('.msg-bubble-body', { hasText: 'delete me' })).toHaveCount(0);
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await expect(page.locator('.msg-bubble-body', { hasText: 'delete me' })).toBeVisible();
  await expect.poll(() => qa(page, () => { const m = window.__msgQa.db.messages.find((x) => x.body === 'delete me'); return m ? m.deleted_at : 'gone'; })).toBe(null);
});

test('a failed edit shows at once, then reopens the editor with your text', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const b = await send(page, 'before edit');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'before edit'))).toBe(true);
  // Editing replaces the body with the editor: hold on to the bubble by its id.
  const id = await b.getAttribute('data-msg-id');
  const row = page.locator(`[data-msg-id="${id}"]`);
  await qa(page, () => window.__msgQa.failNext('update:messages'));
  await row.hover();
  await row.locator('button[title="Edit"]').click();
  await row.locator('textarea').fill('after edit');
  await row.locator('textarea').press('Enter');
  await expect(row.locator('textarea')).toHaveValue('after edit');
  await expect(page.locator('.toast-msg', { hasText: 'Could not save your edit' })).toBeVisible();
  expect(await qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'after edit'))).toBe(false);
});
