// Pasting from Google Docs / Word must not plant the source's typography
// (11pt Arial, black ink, backgrounds) as marks — the pasted run should take
// the surface's own formatting while keeping emphasis and real colours.
import { expect, test } from '@playwright/test';

const GDOCS = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc">'
  + '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">'
  + '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;">plain words </span>'
  + '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:#ffff00;font-weight:700;">bold words </span>'
  + '<span style="font-size:11pt;font-family:Arial,sans-serif;color:#cc0000;font-weight:400;">red words</span>'
  + '</p></b>';

async function pasteHtml(page, selector, html) {
  await page.evaluate(({ selector, html }) => {
    const el = document.querySelector(selector);
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', 'plain words bold words red words');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { selector, html });
}

function assertClean(html) {
  expect(html).toContain('plain words');
  expect(html).not.toMatch(/font-size:\s*11pt/i);
  expect(html).not.toMatch(/Arial/i);
  expect(html).not.toMatch(/#000000|rgb\(0,\s*0,\s*0\)/i);
  expect(html).not.toMatch(/ffff00|background/i);
  expect(html).toMatch(/<strong>bold words|font-weight:\s*700/);
  expect(html).toMatch(/#cc0000|rgb\(204,\s*0,\s*0\)/i);
}

test('doc: a Google Docs paste keeps emphasis + real colour, drops typography', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => window.__soleilDocTest.editor.commands.clearContent());
  await pasteHtml(page, '.doc-card-modal .tt-editor', GDOCS);
  assertClean(await page.evaluate(() => window.__soleilDocTest.editor.getHTML()));
});

test('note: a Google Docs paste keeps emphasis + real colour, drops typography', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  const body = page.locator('.note-body[contenteditable="true"]');
  await body.waitFor();
  await pasteHtml(page, '.note-body[contenteditable="true"]', GDOCS);
  await expect(body).toContainText('red words');
  assertClean(await body.innerHTML());
});

test('doc: ⌘\\ clears formatting but keeps the words', async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await page.evaluate(() => window.__soleilDocTest.editor.commands.setContent(
    '<p><strong><em><span style="color: #cc0000; font-size: 30px">loud</span></em></strong> text</p>'));
  await page.locator('.doc-card-modal .tt-editor').click();
  await page.evaluate(() => window.__soleilDocTest.editor.commands.selectAll());
  // ProseMirror resolves Mod from navigator.platform, which this project
  // spoofs (Win32) while the host may be a Mac — where a real Ctrl+\ arrives
  // as a control character. Dispatch the keydown the page's platform expects.
  await page.evaluate(() => {
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform);
    document.querySelector('.doc-card-modal .tt-editor').dispatchEvent(new KeyboardEvent('keydown', {
      key: '\\', code: 'Backslash', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true,
    }));
  });
  const html = await page.evaluate(() => window.__soleilDocTest.editor.getHTML());
  expect(html).toBe('<p>loud text</p>');
});
