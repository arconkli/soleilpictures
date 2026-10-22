// The doc's one row of tools in the look the owner picked on 2026-10-21
// (direction A, with C's side panel), held to a dev opt-in (lib/appHost.js
// docLookAllowed): Doc ▾ | undo redo | style font size | the marks, colour and
// clear | lists and align | link comment | + | find ⋯. It is always one row:
// as its room narrows, groups fold into ⋯ (lib/docBarFold.js). Every control
// runs the editor command today's bar runs. Driven in the ?docqa=1 harness.

import { expect, test } from '@playwright/test';

test.skip(({ isMobile }) => isMobile, 'the bar under a finger is D7');

async function openDoc(page, { query = '', width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.dev.docLook', '1'); } catch (_) {}
  });
  await page.goto(`/?docqa=1${query}`);
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
  await expect(bar(page)).toBeVisible();
}

const modal = (page) => page.locator('.doc-card-modal');
const bar = (page) => modal(page).getByRole('toolbar', { name: 'Formatting', exact: true });
const btn = (page, name) => bar(page).getByRole('button', { name, exact: true });
const menu = (page) => page.getByRole('menu');
const editorDo = (page, fn, arg) => page.evaluate(([src, a]) => {
  // eslint-disable-next-line no-new-func
  return new Function('ed', 'a', src)(window.__soleilDocTest.editor, a);
}, [fn, arg]);

// The editor takes the focus a frame later: let it, so a test that moves the
// focus to the bar next doesn't have it taken back.
async function selectAll(page, html = '<p>Night drive across the desert</p>') {
  await editorDo(page, 'ed.commands.setContent(a); ed.commands.focus(); ed.commands.selectAll();', html);
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
}

// Select `text` where it first appears, or put the caret `at` characters into it.
const selectText = (page, text, at = null) => editorDo(page, `
  let from = null;
  ed.state.doc.descendants((n, pos) => {
    if (from == null && n.isText && n.text.includes(a.text)) from = pos + n.text.indexOf(a.text);
  });
  ed.commands.setTextSelection(a.at == null ? { from, to: from + a.text.length } : from + a.at);`, { text, at });

const IN_ORDER = ['Doc type', 'Undo', 'Redo', /^Text style/, /^Font(:|$)/, 'Font size', 'Bold', 'Italic', 'Underline',
  'Strikethrough', 'Inline code', 'Colour and highlight', 'Clear formatting', 'Bulleted list', 'Numbered list',
  'Task list', /^Align/, 'Link', 'Comment', 'Insert', 'Find', 'More'];

test('the bar is one row, in the mockup\'s order, each control named; today\'s bar is gone', async ({ page }) => {
  await openDoc(page);
  await expect(modal(page).locator('.doc-tb')).toHaveCount(0);
  const names = await bar(page).locator('button, input').evaluateAll((els) => els
    .filter((el) => el.offsetParent !== null)
    .map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  const want = IN_ORDER.map(String);
  const got = names.filter((n) => n !== 'Preset sizes');
  expect(got.length).toBe(want.length);
  IN_ORDER.forEach((w, i) => {
    if (w instanceof RegExp) expect(got[i]).toMatch(w);
    else expect(got[i]).toBe(w);
  });
  // One row: no taller than a button and its padding.
  const box = await bar(page).boundingBox();
  expect(box.height).toBeLessThanOrEqual(42);
  // Phosphor icons, never a letter standing in for one.
  for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Inline code', 'Clear formatting']) {
    await expect(btn(page, name).locator('svg')).toHaveCount(1);
    expect((await btn(page, name).textContent()).trim()).toBe('');
  }
});

test('each mark button toggles its mark and says whether it is on', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  const marks = { Bold: 'bold', Italic: 'italic', Underline: 'underline', Strikethrough: 'strike', 'Inline code': 'code' };
  for (const [name, mark] of Object.entries(marks)) {
    const b = btn(page, name);
    await expect(b).toHaveAttribute('aria-pressed', 'false');
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'true');
    expect(await editorDo(page, 'return ed.isActive(a);', mark)).toBe(true);
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'false');
    expect(await editorDo(page, 'return ed.isActive(a);', mark)).toBe(false);
  }
  // A press keeps the caret in the text: the editor still has the focus.
  await btn(page, 'Bold').click();
  expect(await editorDo(page, 'return ed.isFocused;')).toBe(true);
});

test('the bar lights what is under the caret, and what the next key will type', async ({ page }) => {
  await openDoc(page);
  await editorDo(page, 'ed.commands.setContent(a); ed.commands.focus();',
    '<h2>A heading</h2><p>Plain <strong>bold</strong> plain.</p><ul><li><p>An item</p></li></ul>');
  const mod = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control'));
  const style = bar(page).getByRole('button', { name: /^Text style/ });
  const bold = btn(page, 'Bold');
  await selectText(page, 'A heading', 3);
  await expect(style).toHaveText(/Heading 2/);
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, 'bold', 2);
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect(style).toHaveText(/Body/);
  await selectText(page, ' plain.', 3);
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  // Bold armed at a caret: the selection doesn't change, only the next key's marks.
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
  await page.keyboard.press(`${mod}+b`);
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.type('x');
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press(`${mod}+b`);
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await selectText(page, 'An item', 2);
  await expect(btn(page, 'Bulleted list')).toHaveAttribute('aria-pressed', 'true');
  // Link and Comment need words selected, and say so.
  await expect(btn(page, 'Link')).toBeDisabled();
  await expect(btn(page, 'Link')).toHaveAttribute('data-tl-tip', 'Select text to link');
  await expect(btn(page, 'Comment')).toHaveAttribute('data-tl-tip', 'Select text to comment on');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(btn(page, 'Link')).toBeEnabled();
  await expect(btn(page, 'Link')).toHaveAttribute('data-tl-tip', 'Link');
});

test('the lists toggle their list, and Clear formatting takes the marks off', async ({ page }) => {
  await openDoc(page);
  await editorDo(page, 'ed.commands.setContent("<p><strong><em>Night drive</em></strong></p>"); ed.commands.focus(); ed.commands.setTextSelection(4);');
  for (const [name, node] of [['Bulleted list', 'bulletList'], ['Numbered list', 'orderedList'], ['Task list', 'taskList']]) {
    await btn(page, name).click();
    await expect(btn(page, name)).toHaveAttribute('aria-pressed', 'true');
    expect(await editorDo(page, 'return ed.isActive(a);', node)).toBe(true);
    await btn(page, name).click();
    expect(await editorDo(page, 'return ed.isActive(a);', node)).toBe(false);
  }
  await editorDo(page, 'ed.commands.selectAll();');
  await btn(page, 'Clear formatting').click();
  expect(await editorDo(page, 'return ed.isActive("bold") || ed.isActive("italic");')).toBe(false);
});

test('the style menu sets a heading, a quote, and body again, and the select says which', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  const style = bar(page).getByRole('button', { name: /^Text style/ });
  await expect(style).toHaveText(/Body/);
  await style.click();
  await menu(page).getByRole('menuitemradio', { name: /Heading 2/ }).click();
  await expect(menu(page)).toHaveCount(0);
  expect(await editorDo(page, 'return ed.isActive("heading", { level: 2 });')).toBe(true);
  await expect(style).toHaveText(/Heading 2/);
  await style.click();
  await menu(page).getByRole('menuitemcheckbox', { name: /Quote/ }).click();
  expect(await editorDo(page, 'return ed.isActive("blockquote");')).toBe(true);
  await style.click();
  await menu(page).getByRole('menuitemradio', { name: /^Body/ }).click();
  expect(await editorDo(page, 'return ed.isActive("heading");')).toBe(false);
});

test('the font list sets the font, and the size field and its presets set the size', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  await bar(page).getByRole('button', { name: /^Font(:|$)/ }).click();
  await page.locator('.dl-font-pop').getByRole('menuitemradio', { name: 'Lora', exact: true }).click();
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontFamily || "";')).toContain('Lora');
  await expect(bar(page).getByRole('button', { name: 'Font: Lora' })).toBeVisible();

  await bar(page).getByRole('button', { name: 'Preset sizes' }).click();
  await page.getByRole('option', { name: '22' }).click();
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontSize;')).toBe('22px');
  const size = bar(page).getByRole('textbox', { name: 'Font size' });
  await expect(size).toHaveValue('22');
  await size.fill('19');
  await size.press('Enter');
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontSize;')).toBe('19px');
});

test('text with no font or size of its own shows the doc\'s, and Default puts a font back', async ({ page }) => {
  await openDoc(page);
  const font = bar(page).getByRole('button', { name: /^Font(:|$)/ });
  const size = bar(page).getByRole('textbox', { name: 'Font size' });
  const style = bar(page).getByRole('button', { name: /^Text style/ });
  await editorDo(page, 'ed.commands.setContent(a); ed.commands.focus();',
    '<h1>Night drive</h1><p>Across the desert</p><ul><li><p>Fuel</p></li></ul><pre><code>INT. CAR</code></pre>');
  await selectText(page, 'Across', 2);
  await expect(font).toHaveAccessibleName('Font: Serif');
  await expect(size).toHaveValue('16');
  await selectText(page, 'Night', 2);
  await expect(font).toHaveAccessibleName('Font: Sans');
  await expect(size).toHaveValue('32');
  // A list's text is body text; code is in mono, at a size the field can't
  // show as a whole number, so it shows none.
  await selectText(page, 'Fuel', 2);
  await expect(style).toHaveText(/Body/);
  await expect(size).toHaveValue('16');
  await selectText(page, 'INT', 2);
  await expect(style).toHaveText(/Code/);
  await expect(font).toHaveAccessibleName('Font: Mono');
  await expect(size).toHaveValue('');
  // Walking through the field sets no size on the text.
  await selectText(page, 'Across', 2);
  await expect(size).toHaveValue('16');
  await size.focus();
  await size.press('Tab');
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontSize || null;')).toBe(null);

  await selectText(page, 'Across');
  await font.click();
  await page.locator('.dl-font-pop').getByRole('menuitemradio', { name: 'Lora', exact: true }).click();
  await expect(font).toHaveAccessibleName('Font: Lora');
  await font.click();
  const def = page.locator('.dl-font-pop').getByRole('menuitemradio', { name: /^Default/ });
  await expect(def).toHaveAttribute('aria-checked', 'false');
  await def.click();
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontFamily || "";')).toBe('');
  await expect(font).toHaveAccessibleName('Font: Serif');
  await font.click();
  await expect(page.locator('.dl-font-pop').getByRole('menuitemradio', { name: /^Default/ })).toHaveAttribute('aria-checked', 'true');
});

test('Colour and highlight sets the text colour, takes it off, and highlights', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  const colour = btn(page, 'Colour and highlight');
  await colour.click();
  await page.getByRole('menuitemradio', { name: 'Red', exact: true }).click();
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").color;')).toBe('#ef4444');
  await colour.click();
  await expect(page.getByRole('menuitemradio', { name: 'Red', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'Default colour' }).click();
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").color || null;')).toBe(null);
  await colour.click();
  await page.getByRole('menuitemcheckbox', { name: /Highlight/ }).click();
  expect(await editorDo(page, 'return ed.isActive("highlight");')).toBe(true);
});

test('Align opens the four alignments and sets one', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  await bar(page).getByRole('button', { name: /^Align/ }).click();
  await menu(page).getByRole('menuitemradio', { name: /Centre/ }).click();
  expect(await editorDo(page, 'return ed.isActive({ textAlign: "center" });')).toBe(true);
  await expect(bar(page).getByRole('button', { name: 'Align: Centre' })).toBeVisible();
});

test('Insert puts in a table and bookmarks the spot', async ({ page }) => {
  await openDoc(page);
  await editorDo(page, 'ed.commands.setContent("<p>Before.</p>"); ed.commands.focus("end");');
  await btn(page, 'Insert').click();
  const rows = menu(page).getByRole('menuitem');
  await expect(rows).toHaveText([/Image/, /Table/, /Divider/, /Code block/, /Embed cluster/, /Bookmark this spot/]);
  await menu(page).getByRole('menuitem', { name: /Table/ }).click();
  await expect.poll(() => editorDo(page, 'let n = 0; ed.state.doc.descendants((x) => { if (x.type.name === "table") n++; }); return n;')).toBe(1);

  await editorDo(page, 'ed.commands.focus("start");');
  await btn(page, 'Insert').click();
  await menu(page).getByRole('menuitem', { name: /Bookmark this spot/ }).click();
  // It asks for the bookmark's name, as today.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.readBookmarks(T.ydoc, T.getScope()).length;
  })).toBe(1);
});

test('Insert\'s Image opens the file picker', async ({ page }) => {
  // A workspace (the harness's, with uploads=1) is what lets a doc take an
  // image; its other calls stay off the network.
  await page.route(/example\.supabase\.co/, (route) => route.abort());
  await openDoc(page, { query: '&uploads=1' });
  await editorDo(page, 'ed.commands.setContent("<p>Before.</p>"); ed.commands.focus("end");');
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await btn(page, 'Insert').click();
  await menu(page).getByRole('menuitem', { name: /Image/ }).click();
  await chooser;
});

test('Link opens the link picker, and Comment the comment box, whose comment marks the words', async ({ page }) => {
  await openDoc(page);
  await selectAll(page, '<p>comment target</p>');
  await btn(page, 'Link').click();
  await expect(page.locator('.entity-picker')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.entity-picker')).toHaveCount(0);
  await expect(modal(page)).toBeVisible();
  await editorDo(page, 'ed.commands.focus(); ed.commands.selectAll();');
  await btn(page, 'Comment').click();
  const composer = page.locator('.inline-composer-input');
  await expect(composer).toBeVisible();
  await composer.fill('Looks good');
  await composer.press('Enter');
  await expect(modal(page).locator('.tt-comment')).toHaveCount(1);
  expect(await page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.readComments(T.ydoc, T.getScope()).length;
  })).toBe(1);
});

test('Find opens the side panel on Find, with Replace, ready to type', async ({ page }) => {
  await openDoc(page);
  await btn(page, 'Find').click();
  const side = modal(page).getByRole('complementary', { name: 'Comments and find' });
  await expect(side.getByRole('tab', { name: 'Find' })).toHaveAttribute('aria-selected', 'true');
  await expect(side.getByRole('textbox', { name: 'Find', exact: true })).toBeFocused();
  await expect(side.getByRole('textbox', { name: 'Replace with' })).toBeVisible();
  await expect(modal(page).locator('.doc-find')).toHaveCount(0);
});

// A print whose afterprint never comes (an app's WebView has no print) must
// not hold the menu open, or the other exports busy.
test('Print or save as PDF closes the menu at once, and the other exports still work', async ({ page }) => {
  await page.addInitScript(() => { window.print = () => {}; });
  await openDoc(page);
  await editorDo(page, 'ed.commands.setContent("<p>Printable words.</p>");');
  await btn(page, 'More').click();
  await menu(page).getByRole('menuitem', { name: 'Print or save as PDF' }).click();
  await expect(page.locator('.tl-menu')).toHaveCount(0, { timeout: 3000 });
  await btn(page, 'More').click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    menu(page).getByRole('menuitem', { name: 'Markdown' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

// One Escape, one layer: a menu off the bar takes its Escape, and the doc
// stays open with the caret still in its text.
test('Escape closes each of the bar\'s menus, and nothing more', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  const opens = [
    ['Doc type', () => btn(page, 'Doc type')],
    ['Text style', () => bar(page).getByRole('button', { name: /^Text style/ })],
    ['Font', () => bar(page).getByRole('button', { name: /^Font(:|$)/ })],
    ['Preset sizes', () => btn(page, 'Preset sizes')],
    ['Colour and highlight', () => btn(page, 'Colour and highlight')],
    ['Align', () => bar(page).getByRole('button', { name: /^Align/ })],
    ['Insert', () => btn(page, 'Insert')],
    ['More', () => btn(page, 'More')],
  ];
  const menus = page.locator('.tl-menu');
  for (const [name, open] of opens) {
    await open().click();
    await expect(menus, name).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(menus, name).toHaveCount(0);
    await page.waitForTimeout(150);
    await expect(modal(page), name).toBeVisible();
    expect(await editorDo(page, 'return ed.isFocused;'), `${name}: the caret is still in the text`).toBe(true);
  }
});

test('Escape from a submenu closes it and its menu, and a font only looked at is put back', async ({ page }) => {
  await openDoc(page, { width: 1000 });
  await editorDo(page, 'ed.commands.setContent("<p>Night drive</p>"); ed.commands.focus("end");');
  // A change of its own, for undo to take back later (undo joins changes
  // less than half a second apart).
  await page.waitForTimeout(700);
  await page.keyboard.type('Z');
  await page.waitForTimeout(700);
  await editorDo(page, 'ed.commands.selectAll();');
  await btn(page, 'More').click();
  await menu(page).first().getByRole('menuitem', { name: /^Font/ }).hover();
  const fonts = page.locator('.dl-font-pop');
  await expect(fonts).toBeVisible();
  await fonts.getByRole('menuitemradio', { name: 'Lora', exact: true }).hover();
  await expect.poll(() => editorDo(page, 'return ed.getAttributes("textStyle").fontFamily || "";')).toContain('Lora');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tl-menu')).toHaveCount(0);
  await page.waitForTimeout(150);
  await expect(modal(page)).toBeVisible();
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontFamily || "";')).toBe('');
  // Looking was never a change: undo takes back the typing before it.
  await editorDo(page, 'ed.commands.undo();');
  await expect.poll(() => editorDo(page, 'return ed.getText();')).toBe('Night drive');
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontFamily || "";')).toBe('');
});

// The text colours show where they end in either theme: the white one on the
// light menu, the black one on the dark menu, by their fill or their edge.
test('every colour in the colour menu stands out from the menu, in either theme', async ({ page }) => {
  await openDoc(page);
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await btn(page, 'Colour and highlight').click();
    const pop = page.locator('.dl-colour-menu');
    await expect(pop).toBeVisible();
    const faint = await pop.evaluate((m) => {
      // Any CSS colour, as sRGB with alpha, through a canvas.
      const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgba = (css) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        return { r, g, b, a: a / 255 };
      };
      const over = (t, u) => ({ r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1 });
      const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
      const L = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const ratio = (x, y) => { const [hi, lo] = [L(x), L(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
      const bg = { ...rgba(getComputedStyle(m).backgroundColor), a: 1 };
      return [...m.querySelectorAll('.tl-sw:not(.is-none)')].filter((sw) => {
        const cs = getComputedStyle(sw);
        const fill = over(rgba(cs.backgroundColor), bg);
        const ring = (cs.boxShadow.match(/^(.*?)\s+-?[\d.]+px/) || [])[1];
        const edge = ring ? over(rgba(ring), fill) : fill;
        return ratio(fill, bg) < 1.3 && ratio(edge, bg) < 1.3;
      }).map((sw) => sw.getAttribute('aria-label'));
    });
    expect(faint, `${theme}: colours that vanish into the menu`).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
  }
});

test('with room for all of it, ⋯ holds the layout, the zoom and Export', async ({ page }) => {
  await openDoc(page);
  await btn(page, 'More').click();
  const m = menu(page);
  await expect(m.getByText('Layout', { exact: true })).toBeVisible();
  await expect(m.getByRole('menuitemradio', { name: /Pageless/ })).toHaveAttribute('aria-checked', 'true');
  await expect(m.getByRole('menuitem', { name: /HTML/ })).toBeVisible();
  await expect(m.getByRole('menuitem', { name: /Markdown/ })).toBeVisible();
  await expect(m.getByText(/words · .* characters/)).toBeVisible();
  await expect(m.getByText('Text', { exact: true })).toHaveCount(0);
  // Pages, from here.
  await m.getByRole('menuitemradio', { name: /^Pages/ }).click();
  await expect(modal(page).locator('.doc-pages-bg')).toBeVisible();
  await btn(page, 'More').click();
  await menu(page).getByRole('button', { name: 'Zoom in' }).click();
  await expect(modal(page).locator('.dl-foot')).toContainText('110%');
});

test('narrowed, the bar stays one row and ⋯ holds what folded, in the order it folded', async ({ page }) => {
  await openDoc(page, { width: 1000 });
  const box = await bar(page).boundingBox();
  expect(box.height).toBeLessThanOrEqual(42);
  const main = await modal(page).locator('.doc-center').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(main.x);
  expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 1);
  // Find folds first, then the font and its size.
  await expect(btn(page, 'Find')).toHaveCount(0);
  await expect(bar(page).getByRole('button', { name: /^Font(:|$)/ })).toHaveCount(0);
  await btn(page, 'More').click();
  const m = menu(page);
  await expect(m.getByText('Text', { exact: true })).toBeVisible();
  await expect(m.getByRole('menuitem', { name: /^Font/ })).toHaveAttribute('aria-haspopup', 'menu');
  await expect(m.getByRole('menuitem', { name: /^Find/ })).toBeVisible();
  // Layout and Export become submenus once there's a Text section.
  await expect(m.getByRole('menuitem', { name: /^Layout/ })).toHaveAttribute('aria-haspopup', 'menu');
  // A folded control does what it did in the bar: Find opens find.
  await m.getByRole('menuitem', { name: /^Find/ }).click();
  await expect(modal(page).locator('.dl-panel').getByRole('textbox', { name: 'Find', exact: true })).toBeFocused();
});

test('a submenu opens from the keyboard, picks, and closes the whole menu', async ({ page }) => {
  await openDoc(page, { width: 1000 });
  await selectAll(page);
  await btn(page, 'More').focus();
  await page.keyboard.press('ArrowDown');
  const font = menu(page).first().getByRole('menuitem', { name: /^Font/ });
  await expect(font).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const sub = page.locator('.dl-font-pop');
  await expect(sub).toBeVisible();
  await sub.getByRole('menuitemradio', { name: 'Lora', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await editorDo(page, 'return ed.getAttributes("textStyle").fontFamily || "";')).toContain('Lora');
});

// Tab stops in the bar: what Tab can land on.
const stops = (b) => b.evaluate((el) => [...el.querySelectorAll('button, input, [tabindex]')]
  .filter((n) => n.tabIndex >= 0 && !n.disabled && n.getClientRects().length > 0).length);
const focusedName = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.getAttribute('aria-label') || a.textContent.trim()) : null;
});

test('the bar is one Tab stop: the arrows, Home and End walk it, round, and Tab leaves it', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  expect(await stops(bar(page))).toBe(1);
  // Into the bar the way Tab goes: its stop.
  await bar(page).evaluate((el) => [...el.querySelectorAll('button, input, [tabindex]')]
    .find((n) => n.tabIndex >= 0 && !n.disabled && n.getClientRects().length > 0)?.focus());
  await page.keyboard.press('Home');
  await expect(btn(page, 'Doc type')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(btn(page, 'More')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(btn(page, 'Doc type')).toBeFocused();
  await page.keyboard.press('End');
  await expect(btn(page, 'More')).toBeFocused();
  // All the way round, stepping out of the size field from its end (End
  // doesn't take a field's caret there on a Mac).
  await page.keyboard.press('Home');
  const names = [];
  for (let i = 0; i < 40; i++) {
    names.push(await focusedName(page));
    await page.evaluate(() => {
      const a = document.activeElement;
      if (a?.matches('input')) a.setSelectionRange(a.value.length, a.value.length);
    });
    await page.keyboard.press('ArrowRight');
    if (await focusedName(page) === 'Doc type') break;
  }
  const want = IN_ORDER.map((w) => (w instanceof RegExp ? names.find((n) => w.test(n)) : w));
  expect(names.filter((n) => n !== 'Preset sizes')).toEqual(want);
  // The stop is where the arrows left it; Tab leaves the bar.
  await page.keyboard.press('ArrowRight');
  expect(await stops(bar(page))).toBe(1);
  await page.keyboard.press('Tab');
  expect(await bar(page).evaluate((el) => el.contains(document.activeElement))).toBe(false);
});

test('the size field keeps its own keys, and passing through it changes nothing', async ({ page }) => {
  await openDoc(page);
  await editorDo(page, 'ed.chain().focus().setContent("<p>plain words</p>").selectAll().setFontSize("18px").run();');
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
  const html = await editorDo(page, 'return ed.getHTML();');
  const size = bar(page).getByRole('textbox', { name: 'Font size' });
  await expect(size).toHaveValue('18');
  await size.focus();
  // Focus selects its text; → collapses that to its end, and is the field's.
  await page.keyboard.press('ArrowRight');
  await expect(size).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(btn(page, 'Preset sizes')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(size).toBeFocused();
  await size.evaluate((el) => el.setSelectionRange(0, 0));
  await page.keyboard.press('ArrowLeft');
  await expect(size).not.toBeFocused();
  await expect(bar(page).locator(':focus')).toHaveCount(1);
  expect(await editorDo(page, 'return ed.getHTML();')).toBe(html);
});

test('its buttons are named in words, with the shortcut in aria-keyshortcuts, and a toggle always says pressed or not', async ({ page }) => {
  await openDoc(page);
  await selectAll(page);
  const m = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control'));
  const keys = [['Bold', 'B'], ['Italic', 'I'], ['Underline', 'U'], ['Strikethrough', 'Shift+X'], ['Inline code', 'E'],
    ['Clear formatting', '\\'], ['Bulleted list', 'Shift+8'], ['Numbered list', 'Shift+7'], ['Task list', 'Shift+9'],
    ['Link', 'K'], ['Comment', 'Alt+M'], ['Find', 'F'], ['Undo', 'Z'], ['Redo', 'Shift+Z']];
  for (const [name, k] of keys) await expect(btn(page, name), name).toHaveAttribute('aria-keyshortcuts', `${m}+${k}`);
  for (const name of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'Inline code', 'Bulleted list', 'Numbered list', 'Task list']) {
    await expect(btn(page, name), name).toHaveAttribute('aria-pressed', /^(true|false)$/);
  }
  // Nothing named by the glyph on it, or by nothing at all.
  const glyphs = ['B', 'I', 'U', 'S', 'A', '•', '1.', '−', '+', '×', '⋯', '…'];
  const bad = (await bar(page).ariaSnapshot()).split('\n').filter((l) => {
    const x = l.match(/^\s*- (button|combobox|textbox)(?: "([^"]*)")?/);
    return x && (x[2] == null || glyphs.includes(x[2]));
  });
  expect(bad).toEqual([]);
});

test('⌥F10 goes from the text to the bar, the arrows walk it, and Escape goes back to the caret', async ({ page }) => {
  await openDoc(page);
  await editorDo(page, 'ed.commands.setContent("<p>one two</p>"); ed.commands.focus(); ed.commands.setTextSelection(4);');
  // The editor takes the focus a frame later.
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
  await page.keyboard.press('Alt+F10');
  await expect(btn(page, 'Doc type')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(btn(page, 'Undo')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect.poll(() => editorDo(page, 'return ed.isFocused;')).toBe(true);
  await expect(modal(page)).toBeVisible();
  await page.keyboard.type('X');
  await expect(modal(page).locator('.tt-editor').first()).toContainText('oneX two');
  // And back: where the arrows left it.
  await page.keyboard.press('Alt+F10');
  await expect(btn(page, 'Undo')).toBeFocused();
});

test('the Doc menu turns the doc into a screenplay', async ({ page }) => {
  await openDoc(page);
  await btn(page, 'Doc type').click();
  await expect(menu(page).getByRole('menuitemradio', { name: /^Document/ })).toHaveAttribute('aria-checked', 'true');
  await menu(page).getByRole('menuitemradio', { name: /^Screenplay/ }).click();
  await page.waitForFunction(() => window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    null, { timeout: 15000 });
});

// A screenplay's row (the mockup's AC-script): its element, title page,
// scene numbers and dual dialogue moved to the side panel's Elements.
async function openScript(page, opts) {
  await openDoc(page, opts);
  await btn(page, 'Doc type').click();
  await menu(page).getByRole('menuitemradio', { name: /^Screenplay/ }).click();
  await page.waitForFunction(() => window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
    null, { timeout: 15000 });
  await expect(bar(page)).toBeVisible();
  await editorDo(page, 'ed.commands.setContent(window.__soleilDocTest.screenplay.blocksToDocJSON(a)); ed.commands.focus("end");', [
    { element: 'scene', text: 'INT. DINER - NIGHT' },
    { element: 'action', text: 'The jukebox plays to nobody.' },
  ]);
  await expect(modal(page).locator('.tt-editor').first()).toBeFocused();
}

test('a screenplay\'s bar is its type, undo and redo, link, comment and bookmark, and ⋯', async ({ page }) => {
  await openScript(page);
  await expect(modal(page).locator('.doc-tb')).toHaveCount(0);
  const names = await bar(page).getByRole('button').evaluateAll((els) => els
    .filter((el) => el.offsetParent !== null)
    .map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  expect(names).toEqual(['Doc type', 'Undo', 'Redo', 'Link', 'Comment', 'Bookmark this spot', 'More']);
  await expect(btn(page, 'Doc type')).toContainText('Screenplay');
  const box = await bar(page).boundingBox();
  expect(box.height).toBeLessThanOrEqual(42);
  // Tab still steps the element at the caret.
  await page.keyboard.press('Enter');
  const after = await editorDo(page, 'return ed.getAttributes("screenplayBlock").element;');
  await page.keyboard.press('Tab');
  await expect.poll(() => editorDo(page, 'return ed.getAttributes("screenplayBlock").element;')).not.toBe(after);
});

test('a screenplay\'s Bookmark marks the spot, and ⋯ holds Elements, Find, the zoom, its exports and the counts', async ({ page }) => {
  await openScript(page);
  await btn(page, 'Bookmark this spot').click();
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const T = window.__soleilDocTest;
    return T.readBookmarks(T.ydoc, T.getScope()).length;
  })).toBe(1);
  await btn(page, 'More').click();
  const m = menu(page);
  await expect(m.getByRole('menuitem', { name: /^Elements/ })).toBeVisible();
  await expect(m.getByRole('menuitem', { name: /^Find/ })).toBeVisible();
  await expect(m.getByRole('button', { name: 'Zoom in' })).toBeVisible();
  await expect(m.getByRole('menuitem', { name: /^Final Draft/ })).toBeVisible();
  await expect(m.getByRole('menuitem', { name: /^Fountain/ })).toBeVisible();
  await expect(m.getByText(/words · .* characters/)).toBeVisible();
  // A screenplay is always pages: no Layout.
  await expect(m.getByText('Layout', { exact: true })).toHaveCount(0);
  await m.getByRole('menuitem', { name: /^Elements/ }).click();
  const side = modal(page).getByRole('complementary', { name: 'Comments and find' });
  await expect(side.getByRole('tab', { name: 'Elements' })).toHaveAttribute('aria-selected', 'true');
  await btn(page, 'More').click();
  await menu(page).getByRole('menuitem', { name: /^Find/ }).click();
  await expect(side.getByRole('textbox', { name: 'Find', exact: true })).toBeFocused();
});

test('a screenplay\'s Doc menu turns it back into a document, with the document\'s bar', async ({ page }) => {
  await openScript(page);
  await btn(page, 'Doc type').click();
  await expect(menu(page).getByRole('menuitemradio', { name: /^Screenplay/ })).toHaveAttribute('aria-checked', 'true');
  await menu(page).getByRole('menuitemradio', { name: /^Document/ }).click();
  await page.waitForFunction(() => window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name !== 'screenplayBlock',
    null, { timeout: 15000 });
  await expect(btn(page, 'Bold')).toBeVisible();
  await expect(btn(page, 'Bookmark this spot')).toHaveCount(0);
});

test('a view-only member\'s bar is Find, the zoom and Export', async ({ page }) => {
  await openDoc(page, { query: '&viewer=1' });
  const names = await bar(page).getByRole('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') || el.textContent.trim()));
  expect(names).toEqual(['Find', 'Zoom out', 'Actual size, 100%', 'Zoom in', 'Export']);
  await btn(page, 'Export').click();
  await expect(menu(page).getByRole('menuitem', { name: /HTML/ })).toBeVisible();
  await page.keyboard.press('Escape');
  // Find, with no Replace.
  await btn(page, 'Find').click();
  const side = modal(page).getByRole('complementary', { name: 'Comments and find' });
  await expect(side.getByRole('textbox', { name: 'Find', exact: true })).toBeFocused();
  await expect(side.getByRole('textbox', { name: 'Replace with' })).toHaveCount(0);
});

test('with the look off, the doc keeps today\'s bar', async ({ page }) => {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('soleil.dev.docLook', '0'); } catch (_) {}
  });
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(modal(page).locator('.doc-tb')).toBeVisible();
  await expect(modal(page).getByRole('toolbar', { name: 'Formatting', exact: true })).toHaveCount(0);
});
