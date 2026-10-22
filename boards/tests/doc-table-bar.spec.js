// The doc look's table bar (the owner's pick of 2026-10-21, mockup G-table),
// held to a dev opt-in (lib/appHost.js docLookAllowed): with the caret in a
// table, a bar over the table's top right edge adds a row or a column either
// side of the caret's and deletes it, turns the header row on and off, and
// deletes the table, with Undo. Driven in the ?docqa=1 harness.

import { expect, test } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'the bar under a finger is D7');

async function openDoc(page, { query = '', width = 1440, look = true } = {}) {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript((on) => {
    try { window.localStorage.setItem('soleil.dev.docLook', on ? '1' : '0'); } catch (_) {}
  }, look);
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page)).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

const modal = (page) => page.locator('.doc-card-modal');
const bar = (page) => modal(page).getByRole('toolbar', { name: 'Table' });
const btn = (page, name) => bar(page).getByRole('button', { name, exact: true });
const menu = (page) => page.getByRole('menu');
const item = (page, name) => menu(page).getByRole('menuitem', { name, exact: true });

const SHOTS = '<p>Night exteriors first, in story order.</p>'
  + '<table><tr><th>#</th><th>Shot</th><th>Lens</th></tr>'
  + '<tr><td>1</td><td>Wide</td><td>24mm</td></tr>'
  + '<tr><td>2</td><td>Dash</td><td>50mm</td></tr></table>'
  + '<p>Day-for-night test on the dry lake.</p>';

const setDoc = (page, html) => page.evaluate((h) => window.__soleilDocTest.editor.commands.setContent(h), html);

// The caret in the text `text` first appears in, the editor focused.
const caretIn = async (page, text) => {
  await page.evaluate((t) => {
    const ed = window.__soleilDocTest.editor;
    let at = null;
    ed.state.doc.descendants((node, pos) => {
      if (at != null || !node.isText) return at == null;
      const i = node.text.indexOf(t);
      if (i >= 0) at = pos + i + 1;
      return false;
    });
    ed.chain().focus().setTextSelection(at).run();
  }, text);
  await page.waitForFunction(() => !!document.activeElement?.closest?.('.doc-card-modal .ProseMirror'));
};

// The table's rows as their cells' words, the header's first; null with none.
const table = (page) => page.evaluate(() => {
  let out = null;
  window.__soleilDocTest.editor.state.doc.descendants((n) => {
    if (out || n.type.name !== 'table') return !out;
    out = { header: true, rows: [] };
    n.forEach((row, _o, i) => {
      const cells = [];
      row.forEach((cell) => {
        cells.push(cell.textContent);
        if (i === 0 && cell.type.name !== 'tableHeader') out.header = false;
      });
      out.rows.push(cells);
    });
    return false;
  });
  return out;
});
const size = async (page) => {
  const t = await table(page);
  return t ? `${t.rows.length}×${t.rows[0].length}` : null;
};
const textFocused = (page) => expect(modal(page).locator('.ProseMirror').first()).toBeFocused();

test('the caret in a table shows its bar over the table\'s top right edge, and out of it the bar goes', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, SHOTS);
  await caretIn(page, 'Night exteriors');
  await expect(bar(page)).toHaveCount(0);
  await caretIn(page, 'Wide');
  await expect(bar(page)).toBeVisible();
  const names = await bar(page).getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  expect(names).toEqual(['Row', 'Column', 'Header row', 'Delete table']);
  const b = await bar(page).boundingBox();
  const t = await modal(page).locator('.ProseMirror table').boundingBox();
  expect(Math.abs((b.x + b.width) - (t.x + t.width))).toBeLessThan(2);
  expect(b.y + b.height).toBeLessThanOrEqual(t.y);
  expect(b.y + b.height).toBeGreaterThan(t.y - 16);
  await caretIn(page, 'Day-for-night');
  await expect(bar(page)).toHaveCount(0);
});

test('Row and Column add one either side of the caret\'s and delete it; 3×3 grows to 4×4 and back', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, SHOTS);
  await caretIn(page, 'Wide');
  await btn(page, 'Row').click();
  expect(await menu(page).getByRole('menuitem').allTextContents()).toEqual(['Add row above', 'Add row below', 'Delete row']);
  await item(page, 'Add row below').click();
  await expect.poll(() => size(page)).toBe('4×3');
  // The text keeps the focus, and the caret its cell.
  await textFocused(page);
  expect((await table(page)).rows.map((r) => r[1])).toEqual(['Shot', 'Wide', '', 'Dash']);
  await btn(page, 'Column').click();
  expect(await menu(page).getByRole('menuitem').allTextContents()).toEqual(['Add column left', 'Add column right', 'Delete column']);
  await item(page, 'Add column right').click();
  await expect.poll(() => size(page)).toBe('4×4');
  expect((await table(page)).rows[1]).toEqual(['1', 'Wide', '', '24mm']);
  await btn(page, 'Row').click();
  await item(page, 'Add row above').click();
  await expect.poll(() => size(page)).toBe('5×4');
  expect((await table(page)).rows.map((r) => r[1])).toEqual(['Shot', '', 'Wide', '', 'Dash']);
  await btn(page, 'Column').click();
  await item(page, 'Add column left').click();
  await expect.poll(() => size(page)).toBe('5×5');
  expect((await table(page)).rows[2]).toEqual(['1', '', 'Wide', '', '24mm']);
  // And back: the caret's row and column go, twice each.
  await btn(page, 'Row').click();
  await item(page, 'Delete row').click();
  await expect.poll(() => size(page)).toBe('4×5');
  expect((await table(page)).rows.map((r) => r.join('|'))).not.toContain('1||Wide||24mm');
  await btn(page, 'Column').click();
  await item(page, 'Delete column').click();
  await expect.poll(() => size(page)).toBe('4×4');
  await btn(page, 'Row').click();
  await item(page, 'Delete row').click();
  await btn(page, 'Column').click();
  await item(page, 'Delete column').click();
  await expect.poll(() => size(page)).toBe('3×3');
  await textFocused(page);
  // ⌘Z steps back the last of them.
  await page.keyboard.press('Control+z');
  await expect.poll(() => size(page)).toBe('3×4');
});

test('a table\'s last row and last column can\'t be deleted from the bar', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, '<p>Before.</p><table><tr><td>Only</td></tr></table><p>After.</p>');
  await caretIn(page, 'Only');
  await btn(page, 'Row').click();
  await expect(item(page, 'Delete row')).toBeDisabled();
  await expect(item(page, 'Add row below')).toBeEnabled();
  await page.keyboard.press('Escape');
  await btn(page, 'Column').click();
  await expect(item(page, 'Delete column')).toBeDisabled();
  await page.keyboard.press('Escape');
  expect(await size(page)).toBe('1×1');
});

test('Header row turns the first row\'s header on and off', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, SHOTS);
  await caretIn(page, 'Dash');
  const head = btn(page, 'Header row');
  await expect(head).toHaveAttribute('aria-pressed', 'true');
  await head.click();
  await expect(head).toHaveAttribute('aria-pressed', 'false');
  expect((await table(page)).header).toBe(false);
  await textFocused(page);
  await head.click();
  await expect(head).toHaveAttribute('aria-pressed', 'true');
  expect((await table(page)).header).toBe(true);
  expect((await table(page)).rows[0]).toEqual(['#', 'Shot', 'Lens']);
});

test('Delete table deletes it, and the toast\'s Undo brings it back', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, SHOTS);
  await caretIn(page, 'Wide');
  await btn(page, 'Delete table').click();
  await expect.poll(() => table(page)).toBe(null);
  await expect(bar(page)).toHaveCount(0);
  const toast = page.locator('.toast', { hasText: 'Table deleted' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => size(page)).toBe('3×3');
  expect((await table(page)).rows[1]).toEqual(['1', 'Wide', '24mm']);
});

test('⌥F10 in a table goes to its bar, the arrows along it, and Escape back to the cell', async ({ page }) => {
  await openDoc(page);
  await setDoc(page, SHOTS);
  await caretIn(page, 'Wide');
  await page.keyboard.press('Alt+F10');
  await expect(btn(page, 'Row')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(btn(page, 'Column')).toBeFocused();
  // ↓ opens its menu from the keyboard, its first row focused; one picked
  // runs on the caret's cell.
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Add column left')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect.poll(() => size(page)).toBe('3×4');
  expect((await table(page)).rows[1]).toEqual(['1', 'Wide', '', '24mm']);
  await btn(page, 'Header row').focus();
  await page.keyboard.press('Escape');
  await textFocused(page);
  expect(await page.evaluate(() => window.__soleilDocTest.editor.state.selection.$from.parent.textContent)).toBe('Wide');
  // Out of a table, ⌥F10 is the doc's bar's, as before.
  await caretIn(page, 'Night exteriors');
  await page.keyboard.press('Alt+F10');
  await expect(modal(page).getByRole('toolbar', { name: 'Formatting', exact: true }).locator(':focus')).toHaveCount(1);
});

test('the bar stays in view over a long table, and goes with its last row', async ({ page }) => {
  await openDoc(page);
  const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>${i + 1}</td><td>Take ${i + 1}</td></tr>`).join('');
  await setDoc(page, `<p>Coverage.</p><table><tr><th>#</th><th>Take</th></tr>${rows}</table><p>The end.</p>`);
  await caretIn(page, 'Take 40');
  await expect(bar(page)).toBeVisible();
  const paper = modal(page).locator('.doc-paper');
  await paper.evaluate((el) => {
    const cell = [...el.querySelectorAll('td')].find((td) => td.textContent === 'Take 40');
    el.scrollTop += cell.getBoundingClientRect().top - el.getBoundingClientRect().top - 200;
  });
  const p = await paper.boundingBox();
  await expect.poll(async () => (await bar(page).boundingBox()).y).toBeGreaterThanOrEqual(p.y);
  const b = await bar(page).boundingBox();
  expect(b.y).toBeLessThan(p.y + 24);
  // Scrolled on past the table's end, the bar goes up with its last row.
  await paper.evaluate((el) => {
    const last = [...el.querySelectorAll('td')].find((td) => td.textContent === 'Take 60');
    el.scrollTop += last.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 20;
  });
  await expect.poll(async () => {
    const bb = await bar(page).boundingBox();
    const t = await modal(page).locator('.ProseMirror table').boundingBox();
    return Math.round(bb.y + bb.height - (t.y + t.height));
  }).toBeLessThanOrEqual(0);
});

test('a view-only member gets no table bar', async ({ page }) => {
  await openDoc(page, { query: '&viewer=1' });
  await page.evaluate((h) => {
    const ed = window.__soleilDocTest.editor;
    ed.setEditable(true);
    ed.commands.setContent(h);
    ed.setEditable(false);
  }, SHOTS);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let at = null;
    ed.state.doc.descendants((n, pos) => { if (at == null && n.isText && n.text === 'Wide') at = pos + 1; return at == null; });
    ed.commands.setTextSelection(at);
  });
  await expect(modal(page).locator('.ProseMirror table')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(bar(page)).toHaveCount(0);
});

test('over a table too narrow for its words, Row and Column are icons and Header row is in Row\'s menu', async ({ page }) => {
  await openDoc(page, { width: 440 });
  await setDoc(page, SHOTS);
  await caretIn(page, 'Wide');
  await expect(bar(page)).toBeVisible();
  const names = await bar(page).getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  expect(names).toEqual(['Row', 'Column', 'Delete table']);
  const b = await bar(page).boundingBox();
  const t = await modal(page).locator('.ProseMirror table').boundingBox();
  expect(b.x).toBeGreaterThanOrEqual(t.x - 1);
  expect(Math.abs((b.x + b.width) - (t.x + t.width))).toBeLessThan(2);
  await btn(page, 'Row').click();
  const head = menu(page).getByRole('menuitemcheckbox', { name: 'Header row' });
  await expect(head).toHaveAttribute('aria-checked', 'true');
  await head.click();
  await expect.poll(async () => (await table(page)).header).toBe(false);
  await textFocused(page);
});

test('with the look off, a table being edited is as wide as the page, as a reader\'s is', async ({ page }) => {
  await openDoc(page, { look: false });
  await setDoc(page, SHOTS);
  await expect(bar(page)).toHaveCount(0);
  const w = await page.evaluate(() => {
    const ed = document.querySelector('.doc-card-modal .ProseMirror');
    const t = ed.querySelector('table');
    const cs = getComputedStyle(ed);
    return { table: t.getBoundingClientRect().width, text: ed.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
  });
  expect(w.table).toBeGreaterThan(w.text - 2);
});

