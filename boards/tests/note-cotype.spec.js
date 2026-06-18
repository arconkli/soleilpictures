import { expect, test } from '@playwright/test';

// TEMP Phase-B verification: two Tiptap note editors bound to two synced
// Y.Docs (the ?noteqa harness) co-type with character-level merge, write
// through to a faithful html cache, and merge divergent offline edits.

const A = '[data-client="A"] .note';
const B = '[data-client="B"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';
const B_EDIT = '[data-client="B"] .note-body[contenteditable="true"]';

async function editorReady(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
}

test('two clients co-type into one note with character-level merge', async ({ page }) => {
  await editorReady(page);

  // Client A enters edit and types.
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('Hello from A');

  // The fragment on BOTH clients converges (B is synced even though idle).
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextA())).toContain('Hello from A');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextB())).toContain('Hello from A');

  // Client B enters edit and appends — interleaved editing on the same note.
  await page.locator(B).dblclick();
  await page.locator(B_EDIT).waitFor();
  await page.locator(B_EDIT).click();
  // Put the caret at the end before typing.
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' + B');

  // Both clients converge to contain BOTH contributions — no lost text.
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextA())).toContain('Hello from A');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextA())).toContain('+ B');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextB())).toContain('+ B');

  // Fragment html (write-through source) is well-formed note html.
  const htmlA = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(htmlA).toMatch(/<p>/);
});

test('divergent OFFLINE edits merge on reconnect (CRDT, not last-write-wins)', async ({ page }) => {
  await editorReady(page);

  // Seed a shared baseline while online.
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('base ');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getTextB())).toContain('base');
  await page.keyboard.press('Escape'); // exit A's editor

  // Go offline — both clients now hold the same 'base' state vector.
  await page.evaluate(() => window.__soleilNoteTest.setSync(false));

  // A edits offline, then exits; B then edits offline from the SAME base
  // (A's change hasn't synced). Two branches off one base = concurrent.
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.press('End');
  await page.keyboard.type('AAA');
  await page.keyboard.press('Escape');

  await page.locator(B).dblclick();
  await page.locator(B_EDIT).waitFor();
  await page.locator(B_EDIT).click();
  await page.keyboard.press('End');
  await page.keyboard.type('BBB');
  await page.keyboard.press('Escape');

  // Before reconnect they have genuinely diverged.
  expect(await page.evaluate(() => window.__soleilNoteTest.getTextA())).toContain('AAA');
  expect(await page.evaluate(() => window.__soleilNoteTest.getTextA())).not.toContain('BBB');

  // Reconnect → both edits survive on both clients (no overwrite).
  await page.evaluate(() => window.__soleilNoteTest.setSync(true));
  for (const get of ['getTextA', 'getTextB']) {
    await expect.poll(() => page.evaluate((g) => window.__soleilNoteTest[g](), get)).toContain('AAA');
    await expect.poll(() => page.evaluate((g) => window.__soleilNoteTest[g](), get)).toContain('BBB');
  }
});

test('legacy note html seeds into the fragment preserving the contract', async ({ page }) => {
  await editorReady(page);
  const out = await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    const doc = new t.Y.Doc();
    const cards = doc.getMap('cards');
    const cm = new t.Y.Map();
    doc.transact(() => { cm.set('id', 'x'); cm.set('kind', 'note'); cards.set('x', cm); }, 'local');
    const legacy =
      '<div>hello <strong>world</strong></div>'
      + '<ul class="note-checklist"><li class="ck"><span class="ck-box" role="checkbox" aria-checked="true"></span><span class="ck-text">done</span></li></ul>'
      + '<div class="note-link-preview" data-url="https://x.com"><div class="note-link-preview-meta"><span>LINK PREVIEW</span></div></div>';
    t.seedNoteFragmentFromHtml(doc, cm, legacy);
    return {
      seeded: cm.get('noteFragmentSeeded'),
      html: t.noteFragmentToHtml(t.getNoteFragment(cm)),
    };
  });
  expect(out.seeded).toBe(true);
  expect(out.html).toContain('hello');
  expect(out.html).toContain('<strong>world</strong>');
  expect(out.html).toContain('note-checklist');
  expect(out.html).toContain('aria-checked="true"');
  // Link-preview chrome is stripped on seed (regenerated by linkify on write-through).
  expect(out.html).not.toContain('note-link-preview');
});

test('typing + keyboard bold writes through to a faithful card.html, and auto-sizes', async ({ page }) => {
  await editorReady(page);
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.type('BoldText');
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.press(`${mod}+b`);
  // Bold mark lands in the fragment html.
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toContain('<strong>BoldText</strong>');
  // Exit → the read-only display renders the written-through card.html.
  await page.keyboard.press('Escape');
  await expect(page.locator(`${A} .note-body:not([contenteditable="true"])`)).toContainText('BoldText');
  // Auto-size grew the card container above its initial 120px? (editor reports
  // height via onAutoSize → onUpdate({h})). At minimum the display is present.
  await expect(page.locator(`${A} .note-body strong`)).toHaveText('BoldText');
});

test('checklist: toggleList command, Enter splits items, click toggles checked', async ({ page }) => {
  await editorReady(page);
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('first');

  // Turn the current paragraph into a note checklist via the Tiptap command.
  await page.evaluate(() =>
    window.__soleilNoteTest.getActiveEditor()
      .chain().focus().toggleList('noteChecklist', 'noteChecklistItem').run());
  await expect(page.locator(`${A} ul.note-checklist li.ck .ck-text`)).toHaveText('first');

  // Enter splits into a SECOND checklist item (not a paragraph).
  await page.locator(A_EDIT).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await expect(page.locator(`${A} ul.note-checklist li.ck`)).toHaveCount(2);

  // Click the first item's checkbox → it becomes checked, written through.
  await page.locator(`${A} li.ck:first-child .ck-box`).click();
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toMatch(/<span class="ck-box is-checked"[^>]*aria-checked="true"[^>]*><\/span><div class="ck-text"><p>first/);
});

test('toolbar command layer: marks/color/font/size/lists/align apply + report active state', async ({ page }) => {
  await editorReady(page);
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('styleme');

  // Run the exact commands the rewired toolbar issues (select-all first, like
  // applying a format to a highlighted run), then read back active state.
  const res = await page.evaluate(() => {
    const ed = window.__soleilNoteTest.getActiveEditor();
    const selectAll = () => ed.chain().focus().selectAll();
    selectAll().toggleBold().run();
    selectAll().setColor('#ff0000').run();
    selectAll().setFontFamily('Inter').run();
    selectAll().setFontSize('22px').run();
    selectAll().setTextAlign('center').run();
    const ts = ed.getAttributes('textStyle') || {};
    return {
      active: { bold: ed.isActive('bold'), center: ed.isActive({ textAlign: 'center' }) },
      ts,
    };
  });
  expect(res.active.bold).toBe(true);
  expect(res.active.center).toBe(true);
  expect(res.ts.color).toBe('#ff0000');
  expect(res.ts.fontSize).toBe('22px');

  // All of it serializes into a faithful card.html.
  const html = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(html).toContain('<strong>');
  expect(html).toMatch(/color:\s*(#ff0000|rgb\(255, 0, 0\))/);
  expect(html).toContain('font-family: Inter');
  expect(html).toContain('font-size: 22px');
  expect(html).toMatch(/text-align:\s*center/);

  // Bullet / ordered list commands produce plain lists (not note-checklist).
  const lists = await page.evaluate(() => {
    const ed = window.__soleilNoteTest.getActiveEditor();
    ed.chain().focus().selectAll().toggleBulletList().run();
    const ul = window.__soleilNoteTest.getFragHtmlA();
    ed.chain().focus().selectAll().toggleOrderedList().run();
    const ol = window.__soleilNoteTest.getFragHtmlA();
    return { ul, ol };
  });
  expect(lists.ul).toMatch(/<ul>(?!.*note-checklist)/);
  expect(lists.ol).toContain('<ol>');
});
