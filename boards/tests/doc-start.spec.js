// How a doc starts in the doc look (the owner's pick of 2026-10-21, mockups
// S-card and S-open), shipped 2026-10-24 (lib/appHost.js docLookAllowed):
// a doc just added opens beside the canvas with its title ready to name, and
// Enter goes on to the body; an empty doc offers A screenplay and Import a
// script under its "Start writing…"; closed, an empty doc's card says Empty
// and offers Start writing, and one with words shows them, its pages, Beside
// and Open. On the real canvas, through ?local=1&richdocs=1.
import { expect, test } from '@playwright/test';

const docCards = (page) => page.locator('.cards-layer .card.card-kind-doc');
const win = (page) => page.locator('.doc-card-modal');
const body = (page) => win(page).locator('.ProseMirror').first();
const starters = (page) => win(page).getByRole('group', { name: 'Or start from' });

async function placeDoc(page) {
  await page.goto('/?local=1&reset=1&blank=1&richdocs=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Add doc tool' }).click();
  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.click(wrap.x + wrap.width * 0.25, wrap.y + wrap.height * 0.45);
  await expect(docCards(page)).toHaveCount(1);
  await expect(win(page)).toBeVisible();
  await expect(body(page)).toBeVisible({ timeout: 15000 });
}

async function closeDoc(page) {
  await win(page).getByRole('button', { name: 'Close document' }).click();
  await expect(win(page)).toHaveCount(0);
}

test('a doc just added opens beside the canvas, its title ready to name; Enter goes on to the body', async ({ page }) => {
  await placeDoc(page);
  await expect(win(page)).toHaveClass(/doc-card-modal-side/);
  const title = win(page).getByRole('textbox', { name: 'Document title' });
  await expect(title).toBeFocused();
  // All of it is selected: typing names it.
  await page.keyboard.type('Sundown Highway');
  await expect(title).toHaveValue('Sundown Highway');
  // Typed straight after Enter, as fast as anyone types: every key lands in
  // the text, none in the title. A busy page holds frames back (here 300ms
  // each), so nothing waits for one to move the focus.
  await page.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf(() => setTimeout(() => raf(cb), 300));
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('A night drive');
  await expect(body(page)).toBeFocused();
  await expect(body(page)).toHaveText('A night drive');
  await expect(title).toHaveValue('Sundown Highway');
  await expect(docCards(page).locator('.doc-card-title')).toHaveText('Sundown Highway');
});

test('an empty doc offers A screenplay and Import a script, until it has words', async ({ page }) => {
  await placeDoc(page);
  await expect(body(page)).toContainText('');
  await expect(starters(page)).toBeVisible();
  await expect(starters(page).getByRole('button')).toHaveText(['A screenplay', 'Import a script']);
  // Under the "Start writing…" line, not over it.
  const line = await body(page).locator('p').first().boundingBox();
  const row = await starters(page).boundingBox();
  expect(row.y).toBeGreaterThanOrEqual(line.y + line.height - 1);
  expect(Math.abs(row.x - line.x)).toBeLessThanOrEqual(2);
  await body(page).click();
  await page.keyboard.type('Words');
  await expect(starters(page)).toHaveCount(0);
});

test('A screenplay makes the new doc a screenplay', async ({ page }) => {
  await placeDoc(page);
  await starters(page).getByRole('button', { name: 'A screenplay' }).click();
  await expect(win(page).locator('.doc-paper.is-screenplay')).toBeVisible();
  await expect(starters(page)).toHaveCount(0);
});

test('Import a script makes the doc that script, named for it', async ({ page }) => {
  await placeDoc(page);
  const chooser = page.waitForEvent('filechooser');
  await starters(page).getByRole('button', { name: 'Import a script' }).click();
  await (await chooser).setFiles({
    name: 'night-drive.fountain',
    mimeType: 'text/plain',
    buffer: Buffer.from('Title: Night Drive\n\nINT. DINER - NIGHT\n\nThe jukebox plays to nobody.\n\nMARA\nTwo coffees.\n'),
  });
  await expect(win(page).locator('.doc-paper.is-screenplay')).toBeVisible();
  await expect(body(page)).toContainText('INT. DINER - NIGHT');
  await expect(body(page)).toContainText('Two coffees.');
  await expect(win(page).getByRole('textbox', { name: 'Document title' })).toHaveValue('Night Drive');
});

test('closed and empty, the card says Empty and offers Start writing, which opens it', async ({ page }) => {
  await placeDoc(page);
  await closeDoc(page);
  const card = docCards(page);
  await expect(card.locator('.doc-card-meta')).toHaveText('Empty');
  await expect(card.getByRole('button', { name: 'Open beside' })).toHaveCount(0);
  await expect(card).toContainText('or double-click the card');
  await card.getByRole('button', { name: 'Start writing' }).click();
  await expect(win(page)).toBeVisible();
  await expect(body(page)).toBeVisible({ timeout: 15000 });
});

test('closed with words, the card shows them, its pages, Beside and Open', async ({ page }) => {
  await placeDoc(page);
  await page.keyboard.press('Enter');
  await page.keyboard.type('A night drive across the desert.');
  await closeDoc(page);
  const card = docCards(page);
  await expect(card.locator('.doc-card-text')).toContainText('A night drive across the desert.');
  await expect(card.locator('.doc-card-meta')).toHaveText('1 page');
  await expect(card.getByRole('button', { name: 'Start writing' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Open beside' })).toContainText('Beside');
  await card.getByRole('button', { name: 'Open fullscreen' }).click();
  await expect(win(page)).toHaveClass(/doc-card-modal-full/);
});
