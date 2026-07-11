import { expect, test } from '@playwright/test';

// Note list behaviour (the "- " bugs):
//  - typing "- " must NOT auto-convert into a real <ul> (the StarterKit
//    markdown input rule is stripped in noteExtensions.js) — same for "1. ";
//  - Enter on a "- item" line auto-continues the literal dash prefix, and
//    Enter on a bare "- " clears it and ends the run;
//  - real lists stay reachable via the toolbar commands AND render visible
//    markers (the global CSS reset used to zero the ul padding, painting the
//    outside-position bullets into a clipped gutter).

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

async function editorReady(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
}

async function openEditorA(page) {
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
}

test('typing "- " stays literal text and Enter auto-continues the dash prefix', async ({ page }) => {
  await editorReady(page);
  await openEditorA(page);

  await page.keyboard.type('- item');
  await page.keyboard.press('Enter');

  // No auto-list, and the new line is pre-seeded with the dash prefix.
  let html = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(html).not.toMatch(/<ul|<ol|<li/);
  expect(html).toContain('- item');

  await page.keyboard.type('second');
  html = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(html).toContain('- second');
});

test('Enter on a bare "- " clears the prefix and ends the run', async ({ page }) => {
  await editorReady(page);
  await openEditorA(page);

  await page.keyboard.type('- item');
  await page.keyboard.press('Enter'); // auto-prefixed "- " line
  await page.keyboard.press('Enter'); // bare "- " → cleared

  const html = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(html).not.toMatch(/<ul|<ol|<li/);
  // The trailing paragraph is empty — the bare dash prefix is gone.
  expect(html.replace(/<p>- item<\/p>/, '')).not.toContain('- ');
});

test('"1. " does not auto-convert into an ordered list', async ({ page }) => {
  await editorReady(page);
  await openEditorA(page);

  await page.keyboard.type('1. first');
  await page.keyboard.press('Enter');

  const html = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(html).not.toMatch(/<ol|<li/);
  expect(html).toContain('1. first');
});

test('toolbar bullet list still works and its markers are visible (indented)', async ({ page }) => {
  await editorReady(page);
  await openEditorA(page);

  await page.keyboard.type('alpha');
  // Toolbar path (applyToggleList drives the same command layer).
  await page.evaluate(() => {
    const ed = window.__soleilNoteTest.getActiveEditor();
    ed.chain().focus().selectAll().toggleBulletList().run();
  });

  const ul = page.locator(`${A_EDIT} ul`);
  await expect(ul).toHaveCount(1);
  // The reset used to leave padding-left at 0, clipping the outside markers.
  const style = await ul.evaluate((el) => {
    const s = getComputedStyle(el);
    return { paddingLeft: s.paddingLeft, listStyleType: s.listStyleType };
  });
  expect(style.paddingLeft).not.toBe('0px');
  expect(style.listStyleType).toBe('disc');
});
