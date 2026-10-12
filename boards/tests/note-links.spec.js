import { expect, test } from '@playwright/test';

// NOTES-09: the note schema had no link mark, so a named link ("Read the
// brief" → https://…) lost its URL the moment a note was opened for editing
// or a hyperlink was pasted in. Bare URLs survived only because linkify
// re-links them on every write-through.

const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';

async function ready(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
}

const setLegacyHtml = (page, html) => page.evaluate((h) => {
  const t = window.__soleilNoteTest;
  t.docA.transact(() => t.cardA.set('html', h), 'local');
}, html);

async function openAndClose(page) {
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.mouse.click(5, 5);
  await expect(page.locator(A_EDIT)).toHaveCount(0);
}

test('a legacy note keeps its named link when opened for editing', async ({ page }) => {
  await ready(page);
  await setLegacyHtml(page, '<p>Before the call <a href="https://docs.example.com/brief" target="_blank" rel="noopener noreferrer">Read the brief</a> today</p>');
  await openAndClose(page);

  const frag = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(frag).toContain('href="https://docs.example.com/brief"');
  expect(frag).toContain('>Read the brief</a>');
  // The cache every reader renders, and the other client's copy of the CRDT.
  const html = await page.evaluate(() => window.__soleilNoteTest.cardA.get('html'));
  expect(html).toContain('href="https://docs.example.com/brief"');
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlB()))
    .toContain('href="https://docs.example.com/brief"');
  await expect(page.locator(`${A} a[href="https://docs.example.com/brief"]`)).toHaveText('Read the brief');
});

test('a bare URL stays plain text in the note and keeps exactly one preview', async ({ page }) => {
  await ready(page);
  // What the old linkify wrote: an auto-link plus its preview block.
  await setLegacyHtml(page, '<p>Deck <a href="https://example.com/deck" target="_blank" rel="noopener noreferrer">https://example.com/deck</a></p>'
    + '<div class="note-link-preview" data-url="https://example.com/deck"><div class="note-link-preview-meta"><span>LINK PREVIEW</span><strong>example.com</strong><small>https://example.com/deck</small></div><button type="button" class="note-preview-remove" aria-label="Remove link preview">x</button></div>');
  await openAndClose(page);

  const frag = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(frag).not.toContain('<a');
  expect(frag).toContain('https://example.com/deck');
  const html = await page.evaluate(() => window.__soleilNoteTest.cardA.get('html'));
  expect(html.match(/class="note-link-preview"/g)).toHaveLength(1);
  expect(html).toContain('href="https://example.com/deck"');
});

test('a pasted hyperlink keeps its URL', async ({ page }) => {
  await ready(page);
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('See ');
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<meta charset="utf-8"><a href="https://example.org/spec" style="color:#1155cc;font-family:Arial">the spec</a>');
    dt.setData('text/plain', 'the spec');
    document.querySelector('[data-client="A"] .note-body[contenteditable="true"]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toContain('href="https://example.org/spec"');
  const frag = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(frag).toContain('>the spec</a>');
});

test('a javascript: link is not kept', async ({ page }) => {
  await ready(page);
  await setLegacyHtml(page, '<p><a href="javascript:alert(1)">click</a></p>');
  await openAndClose(page);
  const frag = await page.evaluate(() => window.__soleilNoteTest.getFragHtmlA());
  expect(frag).not.toContain('javascript:');
  expect(frag).toContain('click');
});
