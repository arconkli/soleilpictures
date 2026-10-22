// Doc fixes from the platform audit (group G5), driven through the ?docqa=1
// harness (window.__soleilDocTest).
import { expect, test } from '@playwright/test';
import { pageListButton, setScreenplay } from './helpers/docFrame.js';

async function openDoc(page, query = '') {
  await page.goto('/?docqa=1' + query);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function pagedMode(page) {
  await page.evaluate(() => { const T = window.__soleilDocTest; T.setPageless(T.ydoc, T.getScope(), false); });
  await page.locator('.doc-card-modal .doc-pages-bg').waitFor({ timeout: 8000 });
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

// ── DOCS-07 ───────────────────────────────────────────────────────────────
// y-prosemirror applies every remote change as ONE whole-document replace.
// Mapping the page-gap widgets through it deletes them all, and the re-measure
// found the same breaks, so the paginator treated it as converged and never put
// them back: text ran across the gutters until a local edit moved a break.
test('DOCS-07: page gaps come back after a whole-document (remote-style) replace', async ({ page }) => {
  await openDoc(page);
  await pagedMode(page);
  await page.evaluate(() => {
    const para = '<p>' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(12) + '</p>';
    window.__soleilDocTest.editor.commands.setContent(para.repeat(14));
  });
  const gaps = page.locator('.doc-card-modal .doc-page-gap');
  await expect.poll(() => gaps.count(), { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  const before = await gaps.count();
  // What a collaborator's keystroke looks like to this tab.
  const right = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.view.dispatch(ed.state.tr.replaceWith(0, ed.state.doc.content.size, ed.state.doc.content));
    return document.querySelectorAll('.doc-card-modal .doc-page-gap').length;
  });
  expect(right).toBe(0);   // the replace really did drop them
  await expect.poll(() => gaps.count(), { timeout: 5000 }).toBe(before);
});

// ── DOCS-08 ───────────────────────────────────────────────────────────────
test('DOCS-08: Undo on deleting the only page brings it back with its text', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [p] = T.readPages(T.ydoc, scope);
    T.renamePage(T.ydoc, p.id, 'Chapter One', scope);
    T.editor.commands.setContent('<p>Every word of the only page.</p>');
  });
  const modal = page.locator('.doc-card-modal');
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-name')).toHaveText('Chapter One');
  await modal.locator('.doc-tree-row').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  // A blank replacement takes its place, named like a freshly seeded page
  // (the card title; the harness card has none, so 'Untitled doc')…
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-name')).toHaveText('Untitled doc');
  // …and one Undo restores the page and its text, not "the board changed".
  await expect(page.locator('.toast-msg').filter({ hasText: 'Page deleted' })).toBeVisible();
  await page.locator('.toast').filter({ has: page.locator('.toast-msg', { hasText: 'Page deleted' }) })
    .locator('.toast-action').click();
  await expect(page.locator('.toast-msg').filter({ hasText: 'changed since' })).toHaveCount(0);
  await expect(modal.locator('.doc-tree-row')).toHaveCount(1);
  await expect(modal.locator('.doc-tree-name')).toHaveText('Chapter One');
  await expect(modal.locator('.ProseMirror')).toContainText('Every word of the only page.');
});

// ── DOCS-15 ───────────────────────────────────────────────────────────────
// A print whose afterprint never fires (the app's WebView has no print at all)
// used to hold the export menu open and busy for the 60 s safety net.
test('DOCS-15: Print / Save as PDF closes the menu at once and leaves the other exports usable', async ({ page }) => {
  // Every frame, the print iframe included: print() does nothing, no afterprint.
  await page.addInitScript(() => { window.print = () => {}; });
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>Printable words.</p>'));
  const trigger = page.locator('.doc-card-modal button[aria-label="Export"]');
  await trigger.click();
  const menu = page.locator('.doc-export-menu');
  await menu.getByRole('menuitem', { name: 'Print / Save as PDF' }).click();
  await expect(menu).toHaveCount(0, { timeout: 3000 });
  await trigger.click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    menu.getByRole('menuitem', { name: 'Export Markdown' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

// ── DOCS-16 ───────────────────────────────────────────────────────────────
test('DOCS-16: a bookmark shows under the page tree, jumps there, and removes with Undo', async ({ page }) => {
  await openDoc(page);
  const modal = page.locator('.doc-card-modal');
  await expect(modal.locator('.doc-bookmarks')).toHaveCount(0);   // nothing to list yet
  const pos = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent('<p>Opening.</p>' + '<p>Filler line.</p>'.repeat(60) + '<p>The end of act two.</p>');
    let pos = null;
    ed.state.doc.descendants((n, p) => { if (pos == null && n.isText && n.text.startsWith('The end')) pos = p; });
    ed.commands.setTextSelection(pos);
    return pos;
  });
  await modal.locator('.doc-tb button[title="Bookmark this spot"]').click();
  const dialog = page.locator('.feedback-bg');
  await dialog.locator('input').fill('Act two out');
  await dialog.getByRole('button', { name: 'Add' }).click();
  const item = modal.locator('.doc-bookmarks-item');
  await expect(item).toHaveText('Act two out');
  // Move away, then jump back through the list.
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection(2));
  await item.click();
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.state.selection.from)).toBe(pos);
  // Remove → Undo toast brings it back.
  await modal.locator('.doc-bookmarks-row').hover();
  await modal.locator('.doc-bookmarks-x').click();
  await expect(modal.locator('.doc-bookmarks')).toHaveCount(0);
  await page.locator('.toast').filter({ has: page.locator('.toast-msg', { hasText: 'Bookmark removed' }) })
    .locator('.toast-action').click();
  await expect(item).toHaveText('Act two out');
});

// ── DOCS-17 ───────────────────────────────────────────────────────────────
test('DOCS-17: the resize handle and align bar sit on the image, and a drag tracks the pointer under zoom', async ({ page }) => {
  await openDoc(page);
  // Zoom the doc first: 3 × +10%.
  const zoomIn = page.locator('.doc-card-modal .doc-tb button[aria-label="Zoom in"]');
  for (let i = 0; i < 3; i++) await zoomIn.click();
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent(`<p>a</p><img src="${location.origin}/apple-touch-icon.png" style="width: 160px">`);
  });
  const img = page.locator('.doc-card-modal .tt-img').first();
  await expect(img).toBeVisible();
  await img.click();
  await expect(page.locator('.doc-card-modal .tt-img-wrap.is-selected')).toHaveCount(1);
  const geo = async () => page.evaluate(() => {
    const im = document.querySelector('.doc-card-modal .tt-img').getBoundingClientRect();
    const h = document.querySelector('.doc-card-modal .tt-img-resize').getBoundingClientRect();
    const tb = document.querySelector('.doc-card-modal .tt-img-tb').getBoundingClientRect();
    return { im: { l: im.left, r: im.right, b: im.bottom, w: im.width }, h: { cx: h.left + h.width / 2, cy: h.top + h.height / 2 }, tbc: tb.left + tb.width / 2 };
  });
  const g = await geo();
  // Handle on the image's bottom-right corner, bar centred over the image.
  expect(Math.abs(g.h.cx - g.im.r)).toBeLessThan(20);
  expect(Math.abs(g.h.cy - g.im.b)).toBeLessThan(20);
  expect(Math.abs(g.tbc - (g.im.l + g.im.w / 2))).toBeLessThan(4);
  expect(await page.locator('.doc-card-modal .tt-img-resize').evaluate(el => getComputedStyle(el).touchAction)).toBe('none');
  // Drag the handle 60 screen px right: the image's right edge follows it.
  await page.mouse.move(g.h.cx, g.h.cy);
  await page.mouse.down();
  await page.mouse.move(g.h.cx + 30, g.h.cy, { steps: 3 });
  await page.mouse.move(g.h.cx + 60, g.h.cy, { steps: 3 });
  const mid = await geo();
  await page.mouse.up();
  expect(Math.abs((mid.im.w - g.im.w) - 60)).toBeLessThan(4);
});

// ── DOCS-18 ───────────────────────────────────────────────────────────────
test('DOCS-18: find & replace fits a phone-width screen with Replace open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDoc(page);
  await page.locator('.doc-card-modal .doc-tb button[title="Find (⌘F)"]').click();
  const bar = page.locator('.doc-find');
  await expect(bar).toBeVisible();
  await bar.locator('button[aria-label="Toggle replace"]').click();
  await expect(bar.locator('input[aria-label="Replace with"]')).toBeVisible();
  const out = await page.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('.doc-find input, .doc-find button')].map(el => {
      const r = el.getBoundingClientRect();
      return { label: el.getAttribute('aria-label') || el.textContent, l: r.left, r: r.right, w: r.width };
    }).filter(x => x.l < 0 || x.r > vw);
  });
  expect(out).toEqual([]);
  // The word buttons are wide enough for their words.
  const one = bar.getByRole('button', { name: 'One' });
  expect(await one.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});

// ── SHARE-13 ──────────────────────────────────────────────────────────────
// The gutter now re-lays out on doc changes and reflow only (batched per
// frame) — check the dot still follows its comment when text moves it.
test('SHARE-13: a comment dot follows its text when a paragraph is added above', async ({ page }) => {
  await openDoc(page);
  const id = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ed = T.editor;
    ed.commands.setContent('<p>Intro.</p><p>The commented phrase.</p>');
    let from = null;
    ed.state.doc.descendants((n, p) => { if (from == null && n.isText && n.text.startsWith('The commented')) from = p; });
    const id = T.addCommentThread(T.ydoc, { body: 'x', author: 'QA', authorColor: '#4f8df8', scope: T.getScope(), pageId: T.readPages(T.ydoc, T.getScope())[0].id });
    ed.chain().setTextSelection({ from, to: from + 3 }).setMark('comment', { id }).run();
    return id;
  });
  const aligned = () => page.evaluate((id) => {
    const dot = document.querySelector(`.comment-gutter-dot[data-thread="${id}"]`);
    const mark = document.querySelector(`.tt-comment[data-comment-id="${id}"]`);
    if (!dot || !mark) return 'missing';
    const d = dot.getBoundingClientRect(), m = mark.getBoundingClientRect();
    return Math.abs((d.top + d.height / 2) - (m.top + m.height / 2)) < 24 ? 'aligned' : `off ${Math.round(d.top - m.top)}`;
  }, id);
  await expect.poll(aligned).toBe('aligned');
  await page.evaluate(() => window.__soleilDocTest.editor.commands.insertContentAt(0, '<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>'));
  await expect.poll(aligned).toBe('aligned');
});

// ── DOCS-20 ───────────────────────────────────────────────────────────────
test('DOCS-20: renaming a cue updates the on-screen "(CONT\'D)" page-break marker', async ({ page }) => {
  await openDoc(page);
  await setScreenplay(page.locator('.doc-card-modal'), true);
  await page.waitForFunction(() =>
    window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
  null, { timeout: 10000 });
  // Enough action to fill most of page 1, then a long speech that splits.
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [{ element: 'scene', text: 'INT. HALL - DAY' }];
    for (let i = 0; i < 40; i++) blocks.push({ element: 'action', text: `Beat ${i + 1}.` });
    blocks.push({ element: 'character', text: 'JON' });
    blocks.push({ element: 'dialogue', text: 'I have a great deal to say about this. '.repeat(40) });
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON(blocks));
  });
  const contd = page.locator('.doc-card-modal .sp-page-break-contd');
  await expect(contd.first()).toHaveText("JON (CONT'D)", { timeout: 5000 });
  // Rename the cue in place.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let at = null;
    ed.state.doc.descendants((n, p) => { if (at == null && n.attrs?.element === 'character' && n.textContent === 'JON') at = p + 1; });
    ed.chain().insertContentAt({ from: at, to: at + 3 }, 'JOHN').run();
  });
  await expect(contd.first()).toHaveText("JOHN (CONT'D)", { timeout: 5000 });
});

// ── DOCS-21 ───────────────────────────────────────────────────────────────
test('DOCS-21: on a phone, "+" keeps the page drawer open to name the new page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDoc(page);
  const surface = page.locator('.doc-card-modal .doc-surface');
  await pageListButton(page.locator('.doc-card-modal')).click();
  await expect(surface).toHaveClass(/mobile-rail-open/);
  await page.locator('.doc-card-modal .doc-tree-add-root').click();
  const name = page.locator('.doc-card-modal .doc-tree-rename');
  await expect(name).toBeVisible();
  await expect(name).toBeFocused();
  await expect(surface).toHaveClass(/mobile-rail-open/);
  await name.fill('Act Two');
  await name.press('Enter');
  await expect(surface).not.toHaveClass(/mobile-rail-open/);
  const names = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.readPages(T.ydoc, T.getScope()).map(p => p.name);
  });
  expect(names).toContain('Act Two');
});

// ── DOCS-22 ───────────────────────────────────────────────────────────────
async function recordContextMenus(page) {
  await page.evaluate(() => {
    window.__ctx = [];
    document.addEventListener('contextmenu', (e) => window.__ctx.push(e.defaultPrevented));
  });
}

test('DOCS-22: right-clicking a word, or Shift+right-click, gets the browser menu (spelling)', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>Thsi word is misspelt.</p>'));
  await recordContextMenus(page);
  const word = page.locator('.doc-card-modal .tt-editor p').first();
  const box = await word.boundingBox();
  // On a word, nothing selected → native (not prevented), no custom menu.
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection(1));
  await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });
  await expect(page.locator('.doc-ctx')).toHaveCount(0);
  // With a selection, Shift+right-click is still native.
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setTextSelection({ from: 1, to: 5 }));
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });
  await page.keyboard.up('Shift');
  await expect(page.locator('.doc-ctx')).toHaveCount(0);
  expect(await page.evaluate(() => window.__ctx)).toEqual([false, false]);
});

test('DOCS-22: the custom menu on a selection offers Cut, Copy and Paste that work', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openDoc(page);
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent('<p>alpha beta</p>'));
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection({ from: 1, to: 6 }).run());
  const word = page.locator('.doc-card-modal .tt-editor p').first();
  const box = await word.boundingBox();
  await page.mouse.click(box.x + 10, box.y + box.height / 2, { button: 'right' });
  const menu = page.locator('.doc-ctx');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('button', { name: /Cut/ })).toBeVisible();
  await menu.getByRole('button', { name: /Copy/ }).click();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('alpha');
  // Paste at the end through the menu.
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().setTextSelection(ed.state.doc.content.size - 1).run();
  });
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2, { button: 'right' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: /Paste/ }).click();
  await expect.poll(() => page.evaluate(() => window.__soleilDocTest.editor.state.doc.textContent)).toBe('alpha betaalpha');
});

// ── DOCS-14 ───────────────────────────────────────────────────────────────
// A collaborator's edit arrives while the comment composer is open. It lands
// as a whole-document replace, so raw offsets captured at "Add comment" no
// longer point at the selected word.
test('DOCS-14: a comment posted after a collaborator edit still highlights the selected word', async ({ page }) => {
  await openDoc(page);
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.commands.setContent('<p>The quick brown fox jumps.</p>');
    const text = 'The quick brown fox jumps.';
    const from = text.indexOf('brown') + 1;
    ed.chain().focus().setTextSelection({ from, to: from + 'brown'.length }).run();
  });
  await page.locator('.doc-card-modal .doc-tb button[title^="Add comment"]').click();
  const input = page.locator('.inline-composer-input');
  await expect(input).toBeVisible();
  await input.fill('Right animal?');
  // The collaborator: a paragraph typed above, written straight into the Y
  // fragment the way a remote update arrives.
  await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const scope = T.getScope();
    const [p] = T.readPages(T.ydoc, scope);
    const frag = T.getOrCreatePageContent(T.ydoc, p.id, scope);
    const para = new T.Y.XmlElement('paragraph');
    const t = new T.Y.XmlText();
    t.insert(0, 'A whole new opening line from someone else.');
    para.insert(0, [t]);
    T.ydoc.transact(() => { frag.insert(0, [para]); }, 'remote-peer');
  });
  await expect(page.locator('.doc-card-modal .ProseMirror')).toContainText('A whole new opening line');
  await input.press('Enter');
  const mark = page.locator('.doc-card-modal .tt-comment');
  await expect(mark).toHaveCount(1);
  await expect(mark).toHaveText('brown');
});
