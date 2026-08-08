import { expect, test } from '@playwright/test';

// Stored XSS in note / grid-cell HTML.
//
// A note card's `html` is rendered with dangerouslySetInnerHTML — cards.jsx's
// NoteAutoLinkBody (both the read-only canvas/share path and the collab path),
// and cards/gridCellShared.jsx's CellText. Neither had a sanitizer; the `safe`
// name in CellText is the output of remapHtmlColors, which rewrites colours and
// is not one.
//
// That html arrives over the CRDT from board_state. The PartyKit server relays
// document updates without inspecting their content, so anything with write
// access to a board — a workspace member, an invited editor, anyone holding a
// collab link — can put arbitrary markup into another user's DOM, on the app's
// own origin, where the Supabase session lives in localStorage.
//
// React's dangerouslySetInnerHTML will not run a <script> tag (innerHTML never
// does). That is exactly why this needs a real test rather than an eyeball:
// the vector is handler ATTRIBUTES and javascript: URLs, which do still fire.
//
// These tests are the proof, written before the fix and failing against it.
// They stay as the regression guard.

const READY = { timeout: 15000 };

// Each payload sets window.__xss when it executes. Nothing here reaches out to
// the network or touches app state — the flag is the entire side effect.
const PAYLOADS = [
  {
    name: 'img onerror',
    html: `<p>hello</p><img src="x" onerror="window.__xss='img-onerror'">`,
    expect: 'img-onerror',
  },
  {
    name: 'svg onload',
    html: `<p>hi</p><svg onload="window.__xss='svg-onload'"></svg>`,
    expect: 'svg-onload',
  },
  {
    name: 'body-less iframe srcdoc',
    html: `<iframe srcdoc="&lt;script&gt;parent.__xss='iframe-srcdoc'&lt;/script&gt;"></iframe>`,
    expect: 'iframe-srcdoc',
  },
  {
    name: 'details ontoggle',
    html: `<details open ontoggle="window.__xss='details-ontoggle'"><summary>s</summary></details>`,
    expect: 'details-ontoggle',
  },
];

async function mountReadOnlyNote(page, html) {
  await page.evaluate(() => { delete window.__xss; });
  await page.evaluate((h) => window.__soleilNoteTest.setRo({ html: h }), html);
  // Give any handler a frame or two to fire. A passing (sanitized) run costs
  // this wait; that's cheap for a security guard.
  await page.waitForTimeout(250);
  return page.evaluate(() => window.__xss ?? null);
}

test.describe('note html is sanitized before it reaches the DOM', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?noteqa=1');
    await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', READY);
  });

  for (const p of PAYLOADS) {
    test(`read-only note does not execute: ${p.name}`, async ({ page }) => {
      const fired = await mountReadOnlyNote(page, p.html);
      expect(fired, `payload "${p.name}" executed in the read-only note renderer`).toBeNull();
    });
  }

  test('javascript: hrefs are stripped from note links', async ({ page }) => {
    await page.evaluate(() =>
      window.__soleilNoteTest.setRo({ html: `<a href="javascript:window.__xss='href'">click</a>` }));
    await page.waitForTimeout(100);
    const href = await page.locator('[data-ro-note] a').first().getAttribute('href').catch(() => null);
    // Either the anchor is gone or its href no longer carries a javascript: URL.
    expect(String(href || '').toLowerCase()).not.toContain('javascript:');
  });

  test('benign formatting still renders untouched', async ({ page }) => {
    // The fix must not be a blunt instrument: notes are rich text and the
    // ordinary markup has to survive intact, or sanitizing quietly eats
    // everyone's content.
    await page.evaluate(() => window.__soleilNoteTest.setRo({
      html: '<p>Hello <b>bold</b> <i>italic</i> <u>u</u> <s>strike</s></p>'
          + '<ul><li>one</li><li>two</li></ul>'
          + '<ol><li>first</li></ol>'
          + '<h2>heading</h2><blockquote>quote</blockquote>'
          + '<p><a href="https://example.com" target="_blank">link</a></p>'
          + '<p><span style="color: rgb(255, 0, 0)">red</span></p>'
          + '<pre><code>code()</code></pre>',
    }));
    const body = page.locator('[data-ro-note] .note-body');
    await expect(body.locator('b')).toHaveText('bold');
    await expect(body.locator('i')).toHaveText('italic');
    await expect(body.locator('u')).toHaveText('u');
    await expect(body.locator('s')).toHaveText('strike');
    await expect(body.locator('li')).toHaveCount(3);
    await expect(body.locator('h2')).toHaveText('heading');
    await expect(body.locator('blockquote')).toHaveText('quote');
    await expect(body.locator('code')).toHaveText('code()');
    await expect(body.locator('a')).toHaveAttribute('href', 'https://example.com');
    // Inline colour is how painted notes stay legible (readableColor.js) — it
    // must survive, or every coloured note goes flat.
    await expect(body.locator('span')).toHaveAttribute('style', /color/);
  });

  test('checklist markup survives (its classes drive note rendering)', async ({ page }) => {
    await page.evaluate(() => window.__soleilNoteTest.setRo({
      html: '<ul class="ck"><li class="ck-item ck-done"><span class="ck-box"></span>done</li></ul>',
    }));
    const body = page.locator('[data-ro-note] .note-body');
    await expect(body.locator('ul.ck')).toHaveCount(1);
    await expect(body.locator('li.ck-item.ck-done')).toHaveCount(1);
  });

  test('legacy pasted markup survives (notes predate the Tiptap schema)', async ({ page }) => {
    // Notes originally came from a contentEditable that accepted pasted HTML
    // wholesale, so saved notes contain tags Tiptap would never emit now. An
    // allowlist scoped to just noteExtensions would silently delete them on the
    // next render — content loss, not a security win.
    await page.evaluate(() => window.__soleilNoteTest.setRo({
      html: '<h4>legacy heading</h4>'
          + '<pre>preformatted</pre>'
          + '<table><tbody><tr><td colspan="2">cell</td></tr></tbody></table>'
          + '<img src="https://example.com/x.png" alt="pasted">'
          + '<hr>',
    }));
    const body = page.locator('[data-ro-note] .note-body');
    await expect(body.locator('h4')).toHaveText('legacy heading');
    await expect(body.locator('pre')).toHaveText('preformatted');
    await expect(body.locator('table td')).toHaveAttribute('colspan', '2');
    await expect(body.locator('img')).toHaveAttribute('src', 'https://example.com/x.png');
    await expect(body.locator('hr')).toHaveCount(1);
  });

  test('an img is kept but its onerror is not', async ({ page }) => {
    // The pair that justifies allowing <img> at all: the tag is content, the
    // handler is the exploit, and they are allowlisted independently.
    await page.evaluate(() => { delete window.__xss; });
    await page.evaluate(() => window.__soleilNoteTest.setRo({
      html: '<img src="https://example.com/x.png" alt="ok" onerror="window.__xss=1">',
    }));
    await page.waitForTimeout(250);
    await expect(page.locator('[data-ro-note] .note-body img')).toHaveAttribute('alt', 'ok');
    expect(await page.evaluate(() => window.__xss ?? null)).toBeNull();
    expect(await page.locator('[data-ro-note] .note-body img').getAttribute('onerror')).toBeNull();
  });

  test('comment anchors survive (CommentMark is load-bearing)', async ({ page }) => {
    // Word-level comments ride a <span data-comment-id class="tt-comment"> in
    // the note html. Stripping the attribute would silently orphan every note
    // comment — the same class of breakage the noteExtensions schema gotcha
    // caused.
    await page.evaluate(() => window.__soleilNoteTest.setRo({
      html: '<p>a <span class="tt-comment" data-comment-id="c1">commented</span> word</p>',
    }));
    const mark = page.locator('[data-ro-note] .note-body span.tt-comment');
    await expect(mark).toHaveCount(1);
    await expect(mark).toHaveAttribute('data-comment-id', 'c1');
  });
});
