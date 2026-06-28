import { expect, test } from '@playwright/test';

// WS-11 — copying text OUT of a note must not drag the note's dark chrome
// (the `.note` background + theme text color) into the clipboard. Pasting a
// note's text elsewhere (Word / Docs / email) should land as clean, readable
// text in the destination's own colors, while keeping the inline formatting
// the user applied (bold / italic / underline / links).

async function addEditingNote(page, seed = 'seed ') {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type(seed);
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toBeVisible();
}

test('copying note text strips background/color but keeps bold + links', async ({ page }) => {
  await addEditingNote(page);

  // Put styled content (dark chrome inline + real formatting) in the body,
  // select it all, and fire a copy. The handler should write its OWN clean
  // HTML + plain text to the event's clipboardData.
  const out = await page.evaluate(() => {
    const el = document.querySelector('.card .note-body[contenteditable="true"]');
    el.focus();
    el.innerHTML =
      '<span style="background-color:#0a0a0c;color:#e5e5e7">dark ' +
      '<b style="font-weight:700">bold</b> ' +
      '<a href="https://example.com">link</a></span>';
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const dt = new DataTransfer();
    const ev = new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return {
      html: dt.getData('text/html'),
      text: dt.getData('text/plain'),
      prevented: ev.defaultPrevented,
    };
  });

  // Handler took over the copy.
  expect(out.prevented).toBe(true);
  // Plain text is the visible text, nothing else.
  expect(out.text).toBe('dark bold link');
  // Formatting the user applied survives.
  expect(out.html).toMatch(/<b/i);
  expect(out.html).toContain('href="https://example.com"');
  // The dark chrome is gone — this is the actual bug.
  expect(out.html).not.toMatch(/background/i);
  expect(out.html).not.toMatch(/color\s*:/i);
});

test('real OS copy of note text carries no background-color', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await addEditingNote(page, 'hello world');

  // Select all text inside the contenteditable, then do a real OS copy so the
  // browser's native clipboard serializer runs (this is what bakes the dark
  // .note background into text/html in the buggy build).
  await page.locator('.card .note-body[contenteditable="true"]').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+c');

  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const it of items) {
      if (it.types.includes('text/html')) {
        const blob = await it.getType('text/html');
        return await blob.text();
      }
    }
    return '';
  });

  expect(html).toContain('hello world');
  expect(html).not.toMatch(/background-color/i);
});
