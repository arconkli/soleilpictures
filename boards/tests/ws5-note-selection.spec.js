import { expect, test } from '@playwright/test';

// WS-5 — note-editor text-selection & paste robustness.

test('wrapSelectionStyle formats boundary text across a line break (collectTextNodes fix)', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  // Drive the real editorSelection module against a contenteditable whose
  // selection spans a line break (`alpha` text node → `bravo` inside a div).
  // Before the fix, intersectsNode dropped the start-boundary text node so the
  // first line ('alpha') was skipped; after, both lines get the style.
  const count24 = await page.evaluate(async () => {
    const mod = await import('/src/lib/editorSelection.js');
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    div.innerHTML = 'alpha<div>bravo</div>';
    document.body.appendChild(div);
    const alphaText = div.firstChild;
    const bravoText = div.querySelector('div').firstChild;
    const range = document.createRange();
    range.setStart(alphaText, 0);
    range.setEnd(bravoText, bravoText.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    mod.wrapSelectionStyle({ fontSize: '24px' });
    const html = div.innerHTML;
    document.body.removeChild(div);
    return (html.match(/24px/g) || []).length;
  });
  // Both lines wrapped → two font-size spans.
  expect(count24).toBe(2);
});

test('pasting rich HTML into a note is sanitized', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByTitle('Add note').click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('start ');

  // Dispatch a synthetic paste with hostile/rich HTML at the caret.
  await page.evaluate(() => {
    const el = document.querySelector('.card .note-body[contenteditable="true"]');
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html',
      '<script>window.__pwned=1<\/script><style>x{}</style>' +
      '<b style="font-weight:bold;color:red" onclick="evil()" class="z">Bold</b>' +
      '<img src=x onerror="evil()">mid <div class="foreign" data-x="1">block</div>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });

  const body = page.locator('.card .note-body').last();
  const html = await body.innerHTML();
  // Visible text survives...
  expect(await body.textContent()).toContain('Bold');
  expect(await body.textContent()).toContain('block');
  // ...but scripts/styles/images and foreign attributes are gone.
  expect(html).not.toMatch(/<script|<style|<img|onclick|onerror|class="z"|class="foreign"|data-x/i);
  expect(await page.evaluate(() => window.__pwned)).toBeFalsy();
});

test('native drag-selection still spans plain line breaks (baseline guard)', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByTitle('Add note').click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('bravo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('charlie');

  const body = page.locator('.card .note-body').last();
  const box = await body.boundingBox();
  await page.mouse.move(box.x + 4, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width - 4, box.y + box.height - 6, { steps: 6 });
  await page.mouse.up();

  const sel = await page.evaluate(() => window.getSelection().toString());
  expect(sel).toContain('bravo');
  expect(sel).toContain('charlie');
});
