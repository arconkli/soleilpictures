import { expect, test } from '@playwright/test';

// WS-5 — note-editor text-selection & paste robustness, on ?local=1, which
// renders the legacy editor (a dev harness only). The drag-select cases moved
// to tests/note-editing-real.spec.js ('drag-select in an open note'), where
// they run on the production note editor.

test('wrapSelectionStyle formats boundary text across a line break (collectTextNodes fix)', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
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
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
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

test('note editor: Grammarly off, native spellcheck off on a computer', async ({ page }) => {
  // Regression guard for the drag-select-across-line-breaks bug + its spell-check
  // follow-up. Grammarly overlays the raw contenteditable and intercepts native
  // mouse selection, so the note editor must NOT opt into Grammarly (the Docs
  // editor, which uses ProseMirror, may — it manages its own selection). If
  // data-gramm flips back to "true", multi-line mouse drag-select silently
  // breaks for users who have the Grammarly extension installed — and CI/clean
  // browsers can't catch it, because they have no Grammarly. Native spellcheck
  // is off too on a computer (its squiggles don't follow the board's zoom);
  // phones and tablets turn it on (lib/noteTouchTyping.js).
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('hello');

  const body = page.locator('.card .note-body').last();
  await expect(body).toHaveAttribute('data-gramm', 'false');
  await expect(body).toHaveAttribute('data-gramm_editor', 'false');
  await expect(body).toHaveAttribute('spellcheck', 'false');
});
