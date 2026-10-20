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
