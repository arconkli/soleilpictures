// A cluster's copy can be replaced under a doc someone has open — a version
// restore, cards moved into the cluster — and the cluster reloads, taking
// every card on it with it. The doc used to vanish mid-sentence and come back
// closed and older, with no word of why, and the last keys typed before the
// reload landed went with the old copy. Now it reopens where it was, says
// what happened, and offers back what its page lost (lib/docResets.js). The
// ?docqa harness's reload() plays the cluster's part, as useYBoard does.
import { expect, test } from '@playwright/test';

// The clipboard, one per page, keeping what the doc's copy wrote in each
// flavour: the system one is shared by every test running at once, and
// refuses a page that doesn't have focus.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const copies = [];
    window.__copies = copies;
    const flavour = async (item, type) => (item.types.includes(type) ? (await item.getType(type)).text() : null);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async ([item]) => { copies.push({ text: await flavour(item, 'text/plain'), html: await flavour(item, 'text/html') }); },
        writeText: async (text) => { copies.push({ text, html: null }); },
      },
    });
  });
});

async function openDoc(page) {
  await page.goto('/?docqa=1&reload=1');
  await page.waitForFunction(() => !!window.__soleilDocTest?.reload, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
}

// The open doc's text, once its editor is a live one.
const liveText = (page) => page.evaluate(() => {
  const ed = window.__soleilDocTest.editor;
  return ed && !ed.isDestroyed && document.querySelector('.doc-card-modal .tt-editor') ? ed.getText() : null;
});
const write = (page, html) => page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), html);
async function typeAtEnd(page, text) {
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus('end').run());
  await expect(page.locator('.doc-card-modal .tt-editor')).toBeFocused();
  await page.keyboard.type(text);
}
const snapshot = (page) => page.evaluate(() => { window.__docSnap = window.__soleilDocTest.snapshot(); });
// Starts the reload and returns at once, as a signal from the server would.
const reload = (page, opts = {}) => page.evaluate((o) => {
  window.__reloaded = window.__soleilDocTest.reload({ from: window.__docSnap, ...o });
}, opts);
const reloaded = (page) => page.evaluate(() => window.__reloaded);
const toasts = (page) => page.locator('.toast:not(.toast-exiting)');
// What the toasts say, without their buttons.
const said = (page) => page.locator('.toast:not(.toast-exiting) .toast-msg');
// Take the toast up on its offer, and what went onto the clipboard.
async function copyBack(page) {
  await toasts(page).getByRole('button', { name: 'Copy what you had' }).click();
  await expect(said(page)).toHaveText(['Copied — paste it anywhere.']);
  return page.evaluate(() => window.__copies.at(-1) || null);
}

test('a restore by someone else reopens the doc where it was, says why, and hands back what the page lost', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>Rain on the glass.</p>');
  await snapshot(page);
  await typeAtEnd(page, ' She counts the drops.');
  await reload(page, { reason: 'restore' });
  await expect(said(page)).toHaveText(['This cluster was restored to an earlier version — reopening the doc.']);
  await reloaded(page);
  // Back, open as it was, on the version restored.
  await expect(page.locator('.doc-card-modal-full')).toBeVisible();
  await expect.poll(() => liveText(page)).toBe('Rain on the glass.');
  // One toast, the first one's place taken by what happened.
  await expect(said(page)).toHaveText(['This cluster was restored to an earlier version, which changed this page.']);
  // Formatted, where it is pasted into something that takes formatting.
  expect(await copyBack(page)).toEqual({
    text: 'Rain on the glass. She counts the drops.',
    html: '<p>Rain on the glass. She counts the drops.</p>',
  });
});

test('keys typed after the reload starts, before the doc goes, are in what it hands back', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>First line here.</p>');
  await snapshot(page);
  await reload(page, { delay: 1500 });
  await typeAtEnd(page, ' Typed while it reloads.');
  await reloaded(page);
  await expect.poll(() => liveText(page)).toBe('First line here.');
  expect((await copyBack(page)).text).toBe('First line here. Typed while it reloads.');
});

test('a restore that leaves the page as it was says so, with nothing to copy', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>Rain on the glass.</p>');
  await snapshot(page);
  await reload(page);
  await reloaded(page);
  await expect.poll(() => liveText(page)).toBe('Rain on the glass.');
  await expect(said(page)).toHaveText(['This cluster was restored to an earlier version.']);
  await expect(toasts(page).getByRole('button', { name: 'Copy what you had' })).toHaveCount(0);
});

test('a restore made here stays quiet, unless it changed the page you had open', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>Rain on the glass.</p>');
  await snapshot(page);
  await reload(page, { local: true });
  await reloaded(page);
  await expect.poll(() => liveText(page)).toBe('Rain on the glass.');
  await page.waitForTimeout(800);
  await expect(toasts(page)).toHaveCount(0);

  await typeAtEnd(page, ' And then some.');
  await reload(page, { local: true });
  await reloaded(page);
  await expect(said(page)).toHaveText(['The restore changed the page you had open.']);
  expect((await copyBack(page)).text).toBe('Rain on the glass. And then some.');
});

test('a doc docked beside the canvas comes back docked', async ({ page }) => {
  await page.goto('/?docqa=1&reload=1');
  await page.waitForFunction(() => !!window.__soleilDocTest?.reload, null, { timeout: 15000 });
  await page.locator('.doc-card').getByRole('button', { name: 'Open beside' }).click();
  await expect(page.locator('.doc-card-modal-side')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
  await write(page, '<p>Notes beside the board.</p>');
  await snapshot(page);
  await reload(page);
  await reloaded(page);
  await expect(page.locator('.doc-card-modal-side')).toBeVisible();
  await expect(page.locator('.doc-card-modal-full')).toHaveCount(0);
  await expect.poll(() => liveText(page)).toBe('Notes beside the board.');
});

test('the doc reopens on the page you were on, not its first', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>The first page.</p>');
  const two = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.addPage(T.ydoc, { name: 'Two', scope: T.getScope() });
  });
  await page.evaluate((id) => window.__soleilDocTest.openCard(id), two);
  await expect.poll(() => liveText(page)).toBe('');
  await typeAtEnd(page, 'The second page, as it was.');
  await snapshot(page);
  await typeAtEnd(page, ' And after.');
  await reload(page);
  await reloaded(page);
  await expect.poll(() => liveText(page)).toBe('The second page, as it was.');
  await expect(said(page)).toHaveText(['This cluster was restored to an earlier version, which changed this page.']);
});

test('a restore to before the page you were on reopens the doc on one it has, and says so', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>The first page, as it was then.</p>');
  await snapshot(page);
  const two = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.addPage(T.ydoc, { name: 'Two', scope: T.getScope() });
  });
  await page.evaluate((id) => window.__soleilDocTest.openCard(id), two);
  await expect.poll(() => liveText(page)).toBe('');
  await typeAtEnd(page, 'Words on the second page.');
  await reload(page);
  await reloaded(page);
  await expect.poll(() => liveText(page)).toBe('The first page, as it was then.');
  await expect(said(page)).toHaveText(['This cluster was restored to an earlier version, without the page you were on.']);
  expect((await copyBack(page)).text).toBe('Words on the second page.');
});

test('a restore to before the doc existed says so, with what it held', async ({ page }) => {
  await openDoc(page);
  await page.locator('.doc-card-modal .doc-card-title-input').fill('Pilot');
  await write(page, '<p>Everything in the pilot so far.</p>');
  await page.evaluate(() => { window.__docSnap = window.__soleilDocTest.Y.encodeStateAsUpdate(new window.__soleilDocTest.Y.Doc()); });
  await reload(page);
  expect(await reloaded(page)).toBe(false);
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  await expect(said(page)).toHaveText(['This cluster was restored to a version from before “Pilot” existed.']);
  expect((await copyBack(page)).text).toBe('Everything in the pilot so far.');
});

test('a doc closed while its cluster reloads stays closed', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>Rain on the glass.</p>');
  await snapshot(page);
  await reload(page, { delay: 1200 });
  await page.locator('.doc-card-modal').getByRole('button', { name: 'Close document' }).click();
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
  await reloaded(page);
  await expect(page.locator('.doc-card')).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.locator('.doc-card-modal')).toHaveCount(0);
});

test('another cluster reloading leaves the doc alone', async ({ page }) => {
  await openDoc(page);
  await write(page, '<p>Nothing to do with it.</p>');
  await reload(page, { boardId: 'some-other-cluster' });
  await reloaded(page);
  await page.waitForTimeout(800);
  await expect(page.locator('.doc-card-modal-full')).toBeVisible();
  expect(await liveText(page)).toBe('Nothing to do with it.');
  await expect(toasts(page)).toHaveCount(0);
});
