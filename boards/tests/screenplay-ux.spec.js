// Real-editor screenplay tests in the ?docqa=1 harness: toggling screenplay
// mode, the Courier layout class, Tab/Enter element cycling, and auto-uppercase.

import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function enableScreenplay(page) {
  await page.locator('.doc-tb-screenplay-toggle').click();
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  // Editor rebuilds on mode change — wait for the re-handed live editor + the
  // seeded scene block.
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toBeVisible({ timeout: 10000 });
}

test('toggling screenplay mode seeds a Scene Heading + Courier layout', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const font = await page.evaluate(() => {
    const pm = document.querySelector('.doc-paper.is-screenplay .ProseMirror');
    return getComputedStyle(pm).fontFamily.toLowerCase();
  });
  expect(font).toContain('courier');
  // Persisted mode in the data layer.
  const mode = await page.evaluate(() =>
    window.__soleilDocTest.getDocMode(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()));
  expect(mode).toBe('screenplay');
});

test('the Screenplay toggle is a labeled pill that does not overlap its toolbar neighbors', async ({ page }) => {
  await openDoc(page);
  // The toggle exists in both modes; check it in prose mode (where the `+`
  // button and the heading <select> flank it) and again in screenplay mode.
  const toggle = page.locator('.doc-tb-screenplay-toggle');
  await expect(toggle).toBeVisible();
  // It's rendered as a real-width pill (icon + word), not the 28px square.
  await expect(toggle).toHaveClass(/doc-tb-pill/);

  const rects = async () => page.evaluate(() => {
    const tb = document.querySelector('.doc-tb');
    const toggle = tb.querySelector('.doc-tb-screenplay-toggle');
    const plus = tb.querySelector('button[aria-label="Insert a block"]');
    const select = tb.querySelector('.doc-tb-select');
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
    return { toggle: r(toggle), plus: r(plus), select: r(select) };
  });

  const before = await rects();
  // The pill is wider than a 28px icon button — proof the label has room.
  expect(before.toggle.width).toBeGreaterThan(40);
  // No horizontal overlap with the `+` button (left) or the <select> (right).
  expect(before.toggle.left).toBeGreaterThanOrEqual(before.plus.right - 0.5);
  expect(before.select.left).toBeGreaterThanOrEqual(before.toggle.right - 0.5);

  // Still clean in screenplay mode (where the element <select> sits to its right).
  await enableScreenplay(page);
  const after = await rects();
  expect(after.toggle.width).toBeGreaterThan(40);
  expect(after.toggle.left).toBeGreaterThanOrEqual(after.plus.right - 0.5);
  expect(after.select.left).toBeGreaterThanOrEqual(after.toggle.right - 0.5);
});

test('Title Page toggle adds an editable on-page title page that persists', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);

  // The toolbar exposes a screenplay-only Title Page pill.
  const tpToggle = page.locator('.doc-tb-titlepage-toggle');
  await expect(tpToggle).toBeVisible();
  await tpToggle.click();

  // A real on-page title page appears as the first sheet.
  const titlePage = page.locator('.doc-card-modal .sp-title-page');
  await expect(titlePage).toBeVisible();

  // Type directly on the title field.
  const titleField = titlePage.locator('.sp-tp-title');
  await titleField.click();
  await titleField.fill('MY GREAT SCRIPT');
  // Blur to flush the commit.
  await titlePage.locator('.sp-tp-authors').click();
  await titlePage.locator('.sp-tp-authors').fill('Andrew Conklin');
  await page.locator('.doc-paper').click({ position: { x: 5, y: 5 } });

  // Persisted into docMeta.
  const tp = await page.evaluate(() =>
    window.__soleilDocTest.getTitlePage(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()));
  expect(tp.enabled).toBe(true);
  expect(tp.title).toBe('MY GREAT SCRIPT');
  expect(tp.authors).toBe('Andrew Conklin');

  // Toggling it off removes the page.
  await tpToggle.click();
  await expect(titlePage).toHaveCount(0);
});

test('Tab/Enter cycle elements and scene/character lines auto-uppercase', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);

  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();

  // Scene heading auto-uppercases.
  await page.keyboard.type('int. kitchen - day');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toHaveText('INT. KITCHEN - DAY');

  // Enter → action (not uppercased).
  await page.keyboard.press('Enter');
  await page.keyboard.type('John enters.');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="action"]').first()).toHaveText('John enters.');

  // Tab cycles action → character; character auto-uppercases.
  await page.keyboard.press('Enter');           // new action line
  await page.keyboard.press('Tab');             // action → character
  await page.keyboard.type('mary');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="character"]').first()).toHaveText('MARY');

  // Enter → dialogue (not uppercased).
  await page.keyboard.press('Enter');
  await page.keyboard.type('Hello there.');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first()).toHaveText('Hello there.');
});

test('on-screen auto (CONT’D) appears on a resuming character cue', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hello.' },
      { element: 'action', text: 'A beat.' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Still here.' },
    ]));
  });
  const contd = page.locator('.doc-paper.is-screenplay .sp-auto-contd');
  await expect(contd).toHaveCount(1);
  await expect(contd).toContainText("(CONT'D)");
});

test('a long screenplay shows on-screen page-break markers', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  // Load enough script to exceed one 54-line page.
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const ed = window.__soleilDocTest.editor;
    const blocks = [{ element: 'scene', text: 'INT. OFFICE - DAY' }];
    for (let i = 0; i < 90; i++) blocks.push({ element: 'action', text: 'The clock ticks forward another beat.' });
    ed.chain().focus().setContent(S.blocksToDocJSON(blocks)).run();
  });
  await expect(page.locator('.doc-card-modal .sp-page-break').first()).toBeVisible({ timeout: 5000 });
  // Page label reads "Page 2" on the first break.
  await expect(page.locator('.doc-card-modal .sp-page-break-rule[data-page="2"]').first()).toBeAttached();
});

test('character-name autocomplete suggests + completes a known name', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();

  // Establish a character (MARGARET) earlier in the script.
  await page.keyboard.type('int. room - day');
  await page.keyboard.press('Enter');           // action
  await page.keyboard.press('Tab');             // → character
  await page.keyboard.type('margaret');
  await page.keyboard.press('Enter');           // → dialogue
  await page.keyboard.type('Hello.');
  await page.keyboard.press('Enter');           // → action
  await page.keyboard.press('Tab');             // → character
  await page.keyboard.type('mar');

  // Popup offers MARGARET; Enter accepts it.
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'MARGARET' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="character"]').last()).toHaveText('MARGARET');
});

test('screenplay export menu offers Fountain + Final Draft import/export', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.locator('.doc-card-modal .doc-export-wrap button').first().click();
  await expect(page.getByRole('menuitem', { name: /Export Fountain/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Export Final Draft/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Import Fountain/ })).toBeVisible();
});
