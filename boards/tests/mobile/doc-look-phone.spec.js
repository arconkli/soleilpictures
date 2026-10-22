// The doc look on a phone (mockups A-phone, A-phone2 and S-phone; held to a
// dev opt-in, lib/appHost.js docLookAllowed): the header is Close, Pages, the
// title over its line, Share and ⋯, and there's no footer; the row of tools
// rides on the keyboard while the text has the focus, its More formatting
// holding what the row leaves out; ⋯ has Comments, Find, Messages, the doc's
// type, its layout, the zoom, Export and the counts; a reader gets no row,
// and a table's bar takes a finger. The keyboard is faked the way iOS and
// Chrome report one, by the visual viewport. Driven in the ?docqa=1 harness.

import { expect, test } from '@playwright/test';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'tablet', 'phone-width only (≤640px)');
});

async function openDoc(page, { query = '' } = {}) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.dev.docLook', '1'); } catch (_) {}
  });
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const head = (page) => modal(page).locator('.dl-head');
const more = (page) => head(page).getByRole('button', { name: /^More/ });
const row = (page) => page.getByRole('toolbar', { name: 'Formatting', exact: true });
const rowBtn = (page, name) => row(page).getByRole('button', { name, exact: true });
const menu = (page, name) => page.getByRole('menu', { name });
const setDoc = (page, html) => page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h, true), html);
const textFocused = () => !!document.activeElement?.closest?.('.doc-card-modal .ProseMirror');

// A keyboard `kb` px tall, as the visual viewport reports one; 0 puts it away.
const keyboard = (page, kb) => page.evaluate((h) => {
  const vv = window.visualViewport;
  Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - h });
  Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
  vv.dispatchEvent(new Event('resize'));
}, kb);

const WORDS = '<p>A night drive across the desert, told in three long takes.</p>'
  + '<p>The motel sign hums over the empty lot.</p>';

test('the header is Close, Pages, the title over its line and ⋯, and there\'s no footer and no row of tools at rest', async ({ page }) => {
  await openDoc(page);
  const names = await head(page).locator('button, input').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names[0]).toBe('Close document');
  expect(names[1]).toBe('Show pages');
  expect(names[2]).toBe('Document title');
  expect(names[names.length - 1]).toMatch(/^More/);
  await expect(head(page).locator('.dl-psub')).toHaveText(/^(New doc|Saved)$/);
  for (const b of await head(page).locator('button').all()) {
    const box = await b.boundingBox();
    expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  }
  await expect(modal(page).locator('.dl-foot')).toHaveCount(0);
  await expect(row(page)).toHaveCount(0);
});

test('the row of tools rides on the keyboard while the text has the focus, and Hide the keyboard puts both away', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, WORDS);
  await modal(page).locator('.ProseMirror p').first().tap();
  await expect(row(page)).toBeVisible();
  const names = await row(page).getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  expect(names).toEqual(['Text style: Body', 'Bold', 'Italic', 'Underline', 'Bulleted list', 'Numbered list',
    'Task list', 'Link', 'Comment', 'Insert', 'More formatting', 'Hide the keyboard']);
  const vh = page.viewportSize().height;
  let box = await row(page).boundingBox();
  expect(Math.abs(box.y + box.height - vh)).toBeLessThan(2);
  expect(box.width).toBe(page.viewportSize().width);

  // On the keyboard's top edge, as it comes up.
  await keyboard(page, 300);
  await expect.poll(async () => {
    const b = await row(page).boundingBox();
    return Math.round(b.y + b.height);
  }).toBe(vh - 300);
  // Every tool a finger's size; the row scrolls sideways rather than wrap.
  for (const b of await row(page).getByRole('button').all()) {
    const r = await b.boundingBox();
    if (r.x + r.width <= 0 || r.x >= page.viewportSize().width) continue;
    expect(r.height).toBeGreaterThanOrEqual(40);
  }
  box = await row(page).boundingBox();
  expect(box.height).toBeLessThan(56);

  // A tool leaves the focus in the text, and acts on its selection.
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection({ from: 3, to: 8 }));
  await rowBtn(page, 'Bold').tap();
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.isActive('bold'))).toBe(true);
  expect(await page.evaluate(textFocused)).toBe(true);
  await expect(rowBtn(page, 'Bold')).toHaveAttribute('aria-pressed', 'true');

  await row(page).getByRole('button', { name: 'Hide the keyboard' }).tap();
  await expect.poll(() => page.evaluate(textFocused)).toBe(false);
  await expect(row(page)).toHaveCount(0);
});

test('More formatting holds what the row leaves out, over the row', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, WORDS);
  await modal(page).locator('.ProseMirror p').first().tap();
  await keyboard(page, 300);
  await rowBtn(page, 'More formatting').tap();
  const m = menu(page, 'More formatting');
  await expect(m).toBeVisible();
  const rows = m.locator('[role^="menuitem"]');
  for (const name of ['Font', 'Size', 'Strikethrough', 'Inline code', 'Highlight', 'Text colour',
    'Clear formatting', 'Align', 'Undo', 'Redo']) {
    await expect(rows.filter({ hasText: new RegExp(`^${name}`) }), name).toHaveCount(1);
  }
  const mb = await m.boundingBox();
  const rb = await row(page).boundingBox();
  expect(mb.y + mb.height).toBeLessThanOrEqual(rb.y + 1);
  expect(mb.y).toBeGreaterThanOrEqual(0);
  // Its rows keep the text's focus: the keyboard stays up.
  await m.getByRole('menuitemcheckbox', { name: /^Strikethrough/ }).tap();
  await expect(m).toHaveCount(0);
  await expect.poll(() => page.evaluate(textFocused)).toBe(true);
});

test('⋯ has Comments, Find, the doc\'s type and layout, Export and the counts; Find opens the sheet on Find', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, WORDS);
  await more(page).tap();
  const m = menu(page, 'More');
  await expect(m).toBeVisible();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  const rows = await m.getByRole('menuitem').allTextContents();
  for (const name of ['Comments', 'Find', 'Doc type', 'Layout', 'Export']) {
    expect(rows.some((r) => r.startsWith(name)), `${name} in ${rows.join(', ')}`).toBe(true);
  }
  // A paragraph's last word and the next one's first are two (lib/docCounts).
  await expect(m).toContainText('19 words');
  // The zoom, under the doc's other rows.
  await expect(m.getByRole('button', { name: /zoom in/i })).toHaveCount(1);
  await m.getByRole('menuitem', { name: /^Find/ }).tap();
  await expect(m).toHaveCount(0);
  const sheet = page.getByRole('complementary', { name: 'Comments and find' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('tab', { name: 'Find' })).toHaveAttribute('aria-selected', 'true');
});

test('⋯\'s Layout turns the doc into pages and back, a phone showing pages continuous', async ({ page }) => {
  await openDoc(page);
  await more(page).tap();
  await menu(page, 'More').getByRole('menuitem', { name: /^Layout/ }).tap();
  const layout = page.getByRole('menu', { name: /^Layout/ });
  await expect(layout).toBeVisible();
  const pages = layout.getByRole('menuitemradio', { name: /^Pages/ });
  await expect(pages).toHaveAttribute('aria-checked', 'false');
  // A phone shows pages continuous: the row says so, and the page stays one sheet.
  await expect(pages).toContainText('a phone shows it continuous');
  await pages.tap();
  await expect(layout).toHaveCount(0);
  await more(page).tap();
  await expect(menu(page, 'More').getByRole('menuitem', { name: /^Layout/ })).toContainText('Pages');
  await expect(modal(page).locator('.doc-paper')).toHaveClass(/is-pageless/);
  await menu(page, 'More').getByRole('menuitem', { name: /^Layout/ }).tap();
  await page.getByRole('menu', { name: /^Layout/ }).getByRole('menuitemradio', { name: /^Pageless/ }).tap();
  await more(page).tap();
  await expect(menu(page, 'More').getByRole('menuitem', { name: /^Layout/ })).toContainText('Pageless');
});

test('a reader on a phone gets no row of tools, and ⋯ keeps Find and the zoom', async ({ page }) => {
  await openDoc(page, { query: '&viewer=1' });
  await expect(head(page).locator('.dl-psub')).toHaveText('View only');
  await modal(page).locator('.ProseMirror').first().tap();
  await page.waitForTimeout(300);
  await expect(row(page)).toHaveCount(0);
  await more(page).tap();
  const m = menu(page, 'More');
  await expect(m.getByRole('menuitem', { name: /^Find/ })).toHaveCount(1);
  await expect(m.getByRole('menuitem', { name: /^Layout/ })).toHaveCount(0);
  await expect(m.getByRole('menuitem', { name: /^Doc type/ })).toHaveCount(0);
  await expect(m.getByRole('button', { name: /zoom in/i })).toHaveCount(1);
});

test('a table\'s bar takes a finger: over the table\'s right edge, Row adds a row', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, '<p>Night exteriors first.</p>'
    + '<table><tr><th>#</th><th>Shot</th><th>Lens</th></tr><tr><td>1</td><td>Wide</td><td>24mm</td></tr></table>');
  await modal(page).locator('.ProseMirror td').nth(1).tap();
  const bar = modal(page).getByRole('toolbar', { name: 'Table' });
  await expect(bar).toBeVisible();
  const b = await bar.boundingBox();
  const t = await modal(page).locator('.ProseMirror table').boundingBox();
  expect(Math.abs((b.x + b.width) - (t.x + t.width))).toBeLessThan(2);
  expect(b.x).toBeGreaterThanOrEqual(0);
  for (const btn of await bar.getByRole('button').all()) {
    const r = await btn.boundingBox();
    expect(Math.min(r.width, r.height)).toBeGreaterThanOrEqual(40);
  }
  await bar.getByRole('button', { name: 'Row', exact: true }).tap();
  await page.getByRole('menu', { name: 'Row' }).getByRole('menuitem', { name: 'Add row below' }).tap();
  await expect.poll(() => modal(page).locator('.ProseMirror tr').count()).toBe(3);
  expect(await page.evaluate(textFocused)).toBe(true);
});
