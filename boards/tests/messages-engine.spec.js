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
  await expect(page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' })).toBeVisible();
  // Let the opening reads (StrictMode mounts twice in dev) land before counting.
  await expect.poll(async () => { const a = await pageReads(page); await page.waitForTimeout(250); return a === await pageReads(page); }).toBe(true);
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

// ── Staying where the reader is (C2.4) ─────────────────────────────────
const fromBottom = (page) => page.locator('.msg-thread-body').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
const scrollTo = (page, top) => page.locator('.msg-thread-body').evaluate((el, t) => { el.scrollTop = t; el.dispatchEvent(new Event('scroll')); }, top);
// The first message showing at the top of the view, and where its top sits.
const topAnchor = (page) => page.locator('.msg-thread-body').evaluate((el) => {
  const box = el.getBoundingClientRect();
  const first = [...el.querySelectorAll('[data-msg-id]')].find((n) => n.getBoundingClientRect().bottom > box.top);
  return first ? { id: first.getAttribute('data-msg-id'), offset: first.getBoundingClientRect().top - box.top } : null;
});

test('a conversation opens at the bottom and stays there while slow images load', async ({ page }) => {
  await page.route('**/qa-photos/**', async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue(); });
  await open(page, 'conv=c-maya');
  await expect(page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await fromBottom(page)).toBeLessThanOrEqual(2);
});

test('sending while reading history goes to the bottom at once', async ({ page }) => {
  await open(page, 'conv=c-long');
  await scrollTo(page, 200);
  expect(await fromBottom(page)).toBeGreaterThan(200);
  await send(page, 'from up in history');
  await expect.poll(() => fromBottom(page), { timeout: 400 }).toBeLessThanOrEqual(2);
  await expect(page.locator('.msg-bubble-body', { hasText: 'from up in history' })).toBeInViewport();
});

test('a peer’s message while you read history doesn’t move you; the jump button counts it and takes you down', async ({ page }) => {
  await open(page, 'conv=c-long');
  await scrollTo(page, 3000);
  await page.waitForTimeout(100);
  const before = await topAnchor(page);
  await expect(page.locator('.msg-jump-pill')).toHaveText(/Latest/);
  await qa(page, () => window.__msgQa.peer('jon').send('c-long', 'news while you read'));
  await expect(page.locator('.msg-jump-pill')).toHaveText(/1 new message/);
  const after = await topAnchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
  await page.locator('.msg-jump-pill').click();
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(2);
  await expect(page.locator('.msg-jump-pill')).toHaveCount(0);
});

test('older history loads above without moving what you are reading', async ({ page }) => {
  await open(page, 'conv=c-long');
  const count = () => page.locator('.msg-thread-body [data-msg-id]').count();
  const first = await count();
  await scrollTo(page, 400);
  await scrollTo(page, 60); // an upward scroll near the top pages back
  const before = await topAnchor(page);
  await expect.poll(count).toBeGreaterThan(first);
  await page.waitForTimeout(150);
  const after = await topAnchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
});

test('a reaction landing above where you read keeps your place', async ({ page }) => {
  await open(page, 'conv=c-long');
  await scrollTo(page, 2500);
  await page.waitForTimeout(100);
  const before = await topAnchor(page);
  // React to a message a little above the view, as a peer.
  const above = await page.locator('.msg-thread-body').evaluate((el) => {
    const box = el.getBoundingClientRect();
    const rows = [...el.querySelectorAll('[data-msg-id]')].filter((n) => n.getBoundingClientRect().bottom < box.top);
    return rows[rows.length - 3]?.getAttribute('data-msg-id');
  });
  await qa(page, ([id]) => { const p = window.__msgQa.peer('jon'); ['👍', '🔥', '🎬'].forEach((e) => p.react(id, e)); }, [above]);
  await page.waitForTimeout(400);
  const after = await topAnchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
});

test('a thread is marked read only once its newest message has been on screen', async ({ page }) => {
  await open(page, 'conv=c-long');
  const reads = () => qa(page, () => window.__msgQa.calls.filter((c) => c.target === 'update:conversation_participants').length);
  await expect.poll(reads).toBeGreaterThan(0); // opened at the bottom: seen
  await scrollTo(page, 1500);
  await page.waitForTimeout(150);
  const marked = await reads();
  await qa(page, () => window.__msgQa.peer('jon').send('c-long', 'unseen for now'));
  await expect(page.locator('.msg-jump-pill')).toHaveText(/1 new message/);
  await page.waitForTimeout(300);
  expect(await reads()).toBe(marked);
  await page.locator('.msg-jump-pill').click();
  await expect.poll(reads).toBeGreaterThan(marked);
});

// ── The "New" line (C2.5) ──────────────────────────────────────────────
test('the "New" line sits above what arrived since you last read; when it all fits you open at the bottom', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const line = page.locator('.msg-new-divider');
  await expect(line).toHaveCount(1);
  // The two unread messages from Maya follow it.
  const after = await line.evaluate((n) => [...n.parentElement.children].slice([...n.parentElement.children].indexOf(n) + 1)
    .filter((x) => x.hasAttribute('data-msg-id')).length);
  expect(after).toBeGreaterThanOrEqual(2);
  await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(2);
});

test('with more unread than fits, it opens on the "New" line and marks nothing read until you reach the bottom', async ({ page }) => {
  await open(page);
  // Pretend you last read c-long 60 messages ago, then let the list read that.
  await qa(page, () => {
    const rows = window.__msgQa.db.messages.filter((m) => m.conversation_id === 'c-long' && !m.deleted_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const me = window.__msgQa.db.conversation_participants.find((p) => p.conversation_id === 'c-long' && p.user_id === 'qa-me');
    me.last_read_at = rows[rows.length - 61].created_at;
    window.__msgQa.dropSocket();
  });
  await expect(page.locator('.msg-row', { hasText: 'Jon Park' }).first()).toHaveClass(/is-unread/);
  const reads = () => qa(page, () => window.__msgQa.calls.filter((c) => c.target === 'update:conversation_participants'
    && c.args?.filters?.some((f) => f[2] === 'c-long')).length);
  await page.locator('.msg-row', { hasText: 'Jon Park' }).first().click();
  const line = page.locator('.msg-new-divider');
  await expect(line).toBeVisible();
  const offset = await line.evaluate((n) => n.getBoundingClientRect().top - n.closest('.msg-thread-body').getBoundingClientRect().top);
  expect(Math.abs(offset - 64)).toBeLessThanOrEqual(4);
  expect(await fromBottom(page)).toBeGreaterThan(200);
  await expect(page.locator('.msg-jump-pill')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await reads()).toBe(0);
  await page.locator('.msg-jump-pill').click();
  await expect.poll(reads).toBeGreaterThan(0);
});

// ── Changes confirmed while a read is out (review fixes) ───────────────
// A slow page read keeps a read in flight; dropSocket() starts one.
async function readInFlight(page, ms = 1500) {
  await qa(page, (t) => { window.__msgQa.setLatency({ 'select:messages': t }); window.__msgQa.dropSocket(); }, ms);
  await page.waitForTimeout(350); // the resync coalesces, then reads
}
const bodyOf = (page, id) => qa(page, (x) => window.__msgQa.db.messages.find((m) => m.id === x)?.body, id);

test('two edits while a read is out: the second one stays', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const b = await send(page, 'edit me twice');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'edit me twice'))).toBe(true);
  const id = await b.getAttribute('data-msg-id');
  const row = page.locator(`[data-msg-id="${id}"]`);
  await readInFlight(page);
  for (const text of ['first edit', 'second edit']) {
    await row.hover();
    await row.locator('button[title="Edit"]').click();
    await row.locator('textarea').fill(text);
    await row.locator('textarea').press('Enter');
    await expect(row.locator('.msg-bubble-body')).toContainText(text);
  }
  await page.waitForTimeout(1800); // the read lands
  await expect(row.locator('.msg-bubble-body')).toContainText('second edit');
  expect(await bodyOf(page, id)).toBe('second edit');
});

test('delete and Undo while a read is out: the message comes back and stays', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const b = await send(page, 'undo me mid-read');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'undo me mid-read'))).toBe(true);
  const id = await b.getAttribute('data-msg-id');
  await readInFlight(page);
  await b.hover();
  await b.locator('button[title="Delete"]').click();
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await page.waitForTimeout(1800);
  await expect(page.locator(`[data-msg-id="${id}"]`)).toBeVisible();
});

test('a peer’s message deleted while a read is out leaves the screen', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await readInFlight(page);
  const msgId = await qa(page, () => window.__msgQa.peer('maya').send('c-maya', 'here then gone')?.id);
  await expect(page.locator('.msg-bubble-body', { hasText: 'here then gone' })).toBeVisible();
  await qa(page, (x) => window.__msgQa.peer('maya').delete(x), msgId);
  await page.waitForTimeout(1800);
  await expect(page.locator('.msg-bubble-body', { hasText: 'here then gone' })).toHaveCount(0);
});

test('opening and closing search keeps your place in history', async ({ page }) => {
  await open(page, 'conv=c-long');
  await scrollTo(page, 3000);
  await page.waitForTimeout(100);
  const before = await topAnchor(page);
  await page.locator('button[aria-label="Search messages"], button[title^="Search"]').first().click();
  await page.locator('.msg-search-input').fill('zzz no match');
  await page.waitForTimeout(300);
  await page.locator('.msg-search-input').press('Escape');
  await page.waitForTimeout(300);
  const after = await topAnchor(page);
  expect(after.id).toBe(before.id);
  expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(2);
});

// ── Seen, in a DM (C2.6) ───────────────────────────────────────────────
test('Seen shows under your newest message once they read it, and goes when they reply', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const mine = await send(page, 'did you get the permit?');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'did you get the permit?'))).toBe(true);
  await expect(page.locator('.msg-bubble-seen')).toHaveCount(0);
  await qa(page, () => window.__msgQa.peer('maya').read('c-maya'));
  await expect(mine.locator('.msg-bubble-seen')).toHaveText('Seen');
  await expect(page.locator('.msg-bubble-seen')).toHaveCount(1);
  await qa(page, () => window.__msgQa.peer('maya').send('c-maya', 'yes, signed'));
  await expect(page.locator('.msg-bubble-seen')).toHaveCount(0);
});

test('a peer whose client never says it read catches up on the next resync', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await send(page, 'ping from an old client test');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'ping from an old client test'))).toBe(true);
  // No chat-read from this client: a resync (or any list refresh) still finds it.
  await qa(page, () => { const p = window.__msgQa.peer('maya'); p.legacy = true; p.read('c-maya'); window.__msgQa.dropSocket(); });
  await expect(page.locator('.msg-bubble-seen')).toHaveCount(1);
});

test('a group never says Seen', async ({ page }) => {
  await open(page, 'conv=c-cast');
  await send(page, 'room 4 confirmed');
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.some((m) => m.body === 'room 4 confirmed'))).toBe(true);
  await qa(page, () => { for (const id of ['lena', 'jon', 'sam']) window.__msgQa.peer(id).read('c-cast'); });
  await page.waitForTimeout(400);
  await expect(page.locator('.msg-bubble-seen')).toHaveCount(0);
});

// ── Replies, inline (C2.7) ─────────────────────────────────────────────
test('a reply quotes what it answers, in the conversation, with no thread view', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const original = page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' }) }).last();
  const originalId = await original.getAttribute('data-msg-id');
  await original.hover();
  await original.locator('button[title="Reply"]').click();
  await expect(page.locator('.msg-reply-bar-who')).toHaveText(/^Replying to /);
  await expect(page.locator('.msg-composer-input')).toBeFocused();
  const reply = await send(page, 'same time works');
  await expect(reply.locator('.msg-reply-preview-body')).toContainText('Thanks! Talk tomorrow.');
  await expect(page.locator('.msg-reply-bar')).toHaveCount(0);
  await expect.poll(() => qa(page, () => window.__msgQa.db.messages.find((m) => m.body === 'same time works')?.parent_id)).toBe(originalId);
  await expect(page.locator('.msg-bubble-replies, .msg-thread-header')).toHaveCount(0);
});

test('Escape lets a reply go and keeps the panel open', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const original = page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' }) }).last();
  await original.hover();
  await original.locator('button[title="Reply"]').click();
  await expect(page.locator('.msg-reply-bar')).toBeVisible();
  await page.locator('.msg-composer-input').press('Escape');
  await expect(page.locator('.msg-reply-bar')).toHaveCount(0);
  await expect(page.locator('.msg-panel')).toBeVisible();
});

test('a reply to a deleted message says the original is gone', async ({ page }) => {
  await open(page, 'conv=c-cast');
  await expect(page.locator('.msg-reply-preview.is-gone')).toContainText('Original message deleted');
});

test('a quote of an old message beyond the loaded pages is read by id, and clicking it pages back to it', async ({ page }) => {
  await open(page, 'conv=c-long');
  const oldId = await qa(page, () => window.__msgQa.db.messages.filter((m) => m.conversation_id === 'c-long')
    .sort((a, b) => a.created_at.localeCompare(b.created_at))[5].id);
  await qa(page, (id) => window.__msgQa.peer('jon').send('c-long', 'about that early one', { parentId: id }), oldId);
  const reply = page.locator('.msg-bubble', { has: page.locator('.msg-bubble-body', { hasText: 'about that early one' }) });
  await expect(reply.locator('.msg-reply-preview-body')).not.toHaveText('…');
  await reply.locator('.msg-reply-preview').click();
  await expect(page.locator(`[data-msg-id="${oldId}"]`)).toBeInViewport({ timeout: 10000 });
});

// ── The composer (C2.8) ────────────────────────────────────────────────
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const png = (name) => ({ name, mimeType: 'image/png', buffer: PNG });
const uploadCalls = (page) => qa(page, () => window.__msgQa.calls.filter((c) => c.kind === 'storage' && c.target === 'upload').length);
const attach = (page, files) => page.locator('.msg-composer input[type="file"]').setInputFiles(files);
const messageCount = (page) => qa(page, () => window.__msgQa.db.messages.length);

test('Enter while an input method is composing picks the word; it doesn’t send', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const input = page.locator('.msg-composer-input');
  await input.fill('こんにちは');
  const before = await messageCount(page);
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    await input.evaluate((el, extra) => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra })), init);
  }
  await page.waitForTimeout(200);
  await expect(input).toHaveValue('こんにちは');
  expect(await messageCount(page)).toBe(before);
  await input.press('Enter');
  await expect(page.locator('.msg-bubble-body', { hasText: 'こんにちは' })).toBeVisible();
});

test('Shift+Enter makes a new line and ⌘/Ctrl+Enter sends', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const input = page.locator('.msg-composer-input');
  await input.click();
  await page.keyboard.type('first');
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('second');
  await expect(input).toHaveValue('first\nsecond');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.locator('.msg-bubble-body', { hasText: 'second' })).toBeVisible();
  await expect(input).toHaveValue('');
});

test('the field grows with what you write up to its cap, then scrolls, and the thread stays at the bottom', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const input = page.locator('.msg-composer-input');
  await expect(page.locator('.msg-bubble-body', { hasText: 'Thanks! Talk tomorrow.' })).toBeVisible();
  const h0 = await input.evaluate((el) => el.offsetHeight);
  await input.fill('x');
  expect(await input.evaluate((el) => el.offsetHeight), 'one line at rest and with one line in it').toBe(h0);
  await input.fill('one\ntwo\nthree');
  expect(await input.evaluate((el) => el.offsetHeight)).toBeGreaterThan(h0 + 20);
  await input.fill(Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n'));
  const m = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    return { h: el.offsetHeight, cap: parseFloat(cs.lineHeight) * 8 + chrome, scrolls: el.scrollHeight > el.clientHeight + 1, overflow: cs.overflowY };
  });
  expect(m.h).toBeLessThanOrEqual(Math.ceil(m.cap) + 1);
  expect(m.scrolls).toBe(true);
  expect(m.overflow).toBe('auto');
  await expect.poll(() => fromBottom(page)).toBeLessThan(2);
  await input.fill('');
  expect(await input.evaluate((el) => el.offsetHeight)).toBe(h0);
});

test('files upload while you type, three at a time, each on its own chip; Send waits for them', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.setLatency({ upload: 1500 }));
  await attach(page, [1, 2, 3, 4, 5].map((i) => png(`frame-${i}.png`)));
  await expect(page.locator('.msg-composer-att-chip.is-uploading')).toHaveCount(5);
  await expect(page.locator('.msg-composer-att-chip.is-uploading .msg-composer-att-thumb')).toHaveCount(5);
  const input = page.locator('.msg-composer-input');
  await expect(input).toBeEnabled();
  await input.fill('five frames');
  await expect(input).toHaveValue('five frames');
  await expect(page.locator('.msg-composer-send')).toBeDisabled();
  await input.press('Enter');
  expect(await page.locator('.msg-bubble-body', { hasText: 'five frames' }).count()).toBe(0);
  await expect.poll(() => uploadCalls(page)).toBe(3);
  await page.waitForTimeout(500);
  expect(await uploadCalls(page)).toBe(3);
  await expect(page.locator('.msg-composer-att-chip.is-done')).toHaveCount(5, { timeout: 10000 });
  await expect(page.locator('.msg-composer-send')).toBeEnabled();
  await input.press('Enter');
  await expect(bubble(page, 'five frames').locator('.msg-attachment-image')).toHaveCount(5);
  await expect(page.locator('.msg-composer-att-chip')).toHaveCount(0);
});

test('a file that fails to upload says so on its chip, and Retry sends it up again', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.failNext('upload'));
  await attach(page, png('frame.png'));
  const failed = page.locator('.msg-composer-att-chip.is-failed');
  await expect(failed).toContainText("Couldn't upload");
  await expect(page.locator('.msg-composer-send')).toBeDisabled();
  await failed.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.msg-composer-att-chip.is-done')).toHaveCount(1);
  await expect(page.locator('.msg-composer-send')).toBeEnabled();
  expect(await uploadCalls(page)).toBe(2);
});

test('a file removed while it uploads stays removed when the upload lands', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.setLatency({ upload: 800 }));
  await attach(page, png('frame.png'));
  await page.locator('.msg-composer-att-chip.is-uploading').getByRole('button', { name: 'Remove attachment' }).click();
  await expect(page.locator('.msg-composer-att-chip')).toHaveCount(0);
  await page.waitForTimeout(1200);
  await expect(page.locator('.msg-composer-att-chip')).toHaveCount(0);
});

test('a draft waits in its conversation — text, a file still uploading, the reply — and none of it shows in another', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await qa(page, () => window.__msgQa.setLatency({ upload: 900 }));
  const original = bubble(page, 'Thanks! Talk tomorrow.');
  await original.hover();
  await original.locator('button[title="Reply"]').click();
  const input = page.locator('.msg-composer-input');
  await input.fill('half a thought');
  await attach(page, png('frame.png'));
  await qa(page, () => window.__msgQa.openConversation('c-cast'));
  await expect(page.locator('.msg-panel-title')).toContainText('Casting');
  await expect(input).toHaveValue('');
  await expect(page.locator('.msg-composer-att-chip')).toHaveCount(0);
  await expect(page.locator('.msg-reply-bar')).toHaveCount(0);
  await page.waitForTimeout(1300); // the upload lands while you're away
  await qa(page, () => window.__msgQa.openConversation('c-maya'));
  await expect(input).toHaveValue('half a thought');
  await expect(page.locator('.msg-composer-att-chip.is-done')).toHaveCount(1);
  await expect(page.locator('.msg-reply-bar-who')).toHaveText(/^Replying to /);
  await input.press('Enter');
  const sent = bubble(page, 'half a thought');
  await expect(sent.locator('.msg-reply-preview-body')).toContainText('Thanks! Talk tomorrow.');
  await expect(sent.locator('.msg-attachment-image')).toHaveCount(1);
});

test('a draft survives a reload straight after typing', async ({ page }) => {
  await open(page, 'conv=c-maya');
  await page.locator('.msg-composer-input').fill('typed, then reloaded');
  await page.reload();
  await page.waitForSelector('html[data-msgqa-ready="1"]');
  await expect(page.locator('.msg-composer-input')).toHaveValue('typed, then reloaded');
  await page.locator('.msg-composer-input').press('Enter');
  await page.reload();
  await page.waitForSelector('html[data-msgqa-ready="1"]');
  await expect(page.locator('.msg-composer-input')).toHaveValue('', { timeout: 5000 });
});

test('the emoji palette opens clear of its button and inside the window, and the button closes it again', async ({ page }) => {
  await open(page, 'conv=c-maya');
  const btn = page.locator('.msg-composer button[title="Emoji"]');
  await btn.click();
  const pal = page.locator('.emoji-palette');
  await expect(pal).toBeVisible();
  const [p, b, vh] = await Promise.all([pal.boundingBox(), btn.boundingBox(), page.evaluate(() => window.innerHeight)]);
  expect(p.y + p.height <= b.y + 1 || p.y >= b.y + b.height - 1).toBe(true);
  expect(p.y + p.height).toBeLessThanOrEqual(vh);
  await btn.click();
  await expect(pal).toHaveCount(0);
  await btn.click();
  await pal.locator('button').first().click();
  await expect(pal).toHaveCount(0);
  await expect(page.locator('.msg-composer-input')).toHaveValue('👍');
});
