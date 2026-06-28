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

test('native drag-selection still spans plain line breaks (baseline guard)', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
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
  // Assert the selection SPANS all three lines in document order. The earlier
  // guard only checked the trailing lines and would miss a first-line drop bug.
  // (The leading "a" of "alpha" can be clipped depending on exactly where the
  // mouse-down lands in the first line, so match "lpha" — the point is that the
  // first line is present and the selection crosses both breaks.)
  expect(sel).toMatch(/lpha[\s\S]*bravo[\s\S]*charlie/);
});

test('note editor: Grammarly off, native spellcheck on', async ({ page }) => {
  // Regression guard for the drag-select-across-line-breaks bug + its spell-check
  // follow-up. Grammarly overlays the raw contenteditable and intercepts native
  // mouse selection, so the note editor must NOT opt into Grammarly (the Docs
  // editor, which uses ProseMirror, may — it manages its own selection). If
  // data-gramm flips back to "true", multi-line mouse drag-select silently
  // breaks for users who have the Grammarly extension installed — and CI/clean
  // browsers can't catch it, because they have no Grammarly. With Grammarly off,
  // notes rely on the browser's native spellchecker, so also guard that
  // spellcheck stays explicitly on.
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('hello');

  const body = page.locator('.card .note-body').last();
  await expect(body).toHaveAttribute('data-gramm', 'false');
  await expect(body).toHaveAttribute('data-gramm_editor', 'false');
  await expect(body).toHaveAttribute('spellcheck', 'true');
});

test('drag-select spans a BLANK line (forward)', async ({ page }) => {
  // The owner's real-world repro: two text lines with an empty line between
  // (Enter pressed twice → <div><br></div>). The original baseline guard only
  // covered CONSECUTIVE lines; this covers the empty <div><br></div> block.
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter'); // empty line between
  await page.keyboard.type('bravo');

  // Derive drag endpoints from the actual first/last CHARACTER rects (via
  // Range.getBoundingClientRect) so the mouse-down always lands on a glyph —
  // short, left-aligned words leave the note's corners empty, which would
  // collapse a corner-anchored drag. Endpoints straddle the blank <div><br></div>.
  const pts = await page.evaluate(() => {
    const body = [...document.querySelectorAll('.card .note-body')].pop();
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    let last = first, n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim()) last = n;
    const r1 = document.createRange();
    r1.setStart(first, 0); r1.setEnd(first, Math.min(1, first.length));
    const r2 = document.createRange();
    r2.setStart(last, Math.max(0, last.length - 1)); r2.setEnd(last, last.length);
    const a = r1.getBoundingClientRect(), b = r2.getBoundingClientRect();
    return {
      first: { x: a.left + 1, y: a.top + a.height / 2 },
      last: { x: b.right - 1, y: b.top + b.height / 2 },
    };
  });

  // Drag forward (down) across the blank line. (Backward/drag-up was verified
  // to span equally in a real Grammarly-free browser via the chrome-devtools
  // drag tool; it's omitted from CI only because a second synthetic drag picks
  // up stale post-scroll coordinates and flakes — not a product difference.)
  await page.mouse.move(pts.first.x, pts.first.y);
  await page.mouse.down();
  await page.mouse.move(pts.last.x, pts.last.y, { steps: 8 });
  await page.mouse.up();
  const sel = await page.evaluate(() => window.getSelection().toString());
  expect(sel).toMatch(/alpha[\s\S]*bravo/);
});

test('slow backward drag-select is not hijacked by the canvas marquee', async ({ page }) => {
  // Regression: a pointerdown inside the editing note bubbled past
  // onCardPointerDown (which deliberately returns early for editor targets)
  // into onBackgroundPointerDown, whose select-tool marquee armed after 4px
  // of drift — its overlay + selection-state churn froze the native text
  // selection mid-drag. Fast synthetic drags could finish before React
  // painted the marquee (which is why the forward tests above never caught
  // it); a SLOW drag with real inter-move delays reliably lost the race,
  // and backward (drag-up) selections failed almost always for real users.
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).click();
  const cb = await page.locator('.canvas-wrap').boundingBox();
  await page.locator('.canvas-wrap').click({ position: { x: cb.width / 2, y: cb.height / 2 } });
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.type('bravo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('charlie');

  // Anchor endpoints on actual glyph rects (same idiom as the blank-line
  // test, but scoped to the EDITING body — the seeded boards contain other
  // .note-body elements and DOM order doesn't guarantee ours is last).
  const pts = await page.evaluate(() => {
    const body = document.querySelector('.card .note-body[contenteditable="true"]');
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode();
    let last = first, n;
    while ((n = walker.nextNode())) if (n.nodeValue.trim()) last = n;
    const r1 = document.createRange();
    r1.setStart(first, 0); r1.setEnd(first, Math.min(1, first.length));
    const r2 = document.createRange();
    r2.setStart(last, Math.max(0, last.length - 1)); r2.setEnd(last, last.length);
    const a = r1.getBoundingClientRect(), b = r2.getBoundingClientRect();
    return {
      first: { x: a.left + 1, y: a.top + a.height / 2 },
      last: { x: b.right - 1, y: b.top + b.height / 2 },
    };
  });

  // BACKWARD: press at the end of "charlie", crawl up to the start of "alpha"
  // with real delays so the marquee (if armed) has frames to paint.
  await page.mouse.move(pts.last.x, pts.last.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(
      pts.last.x + (pts.first.x - pts.last.x) * (i / 8),
      pts.last.y + (pts.first.y - pts.last.y) * (i / 8));
    await page.waitForTimeout(30);
  }
  const marqueeDuringDrag = await page.locator('.marquee').count();
  await page.mouse.up();

  const sel = await page.evaluate(() => window.getSelection().toString());
  expect(sel).toMatch(/lpha[\s\S]*bravo[\s\S]*charli/);
  expect(marqueeDuringDrag).toBe(0);

  // Blur-commit must still work: the guard is target-scoped, so a click on
  // the bare canvas (outside the editor) still reaches the background
  // handler, blurs the note, and commits the text.
  await page.mouse.click(60, cb.height - 60);
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator('.card .note').last()).toContainText('charlie');
});
