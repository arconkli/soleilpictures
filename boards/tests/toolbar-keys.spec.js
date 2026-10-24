// What a keyboard and a screen reader get from the bars. A role="toolbar" is
// one Tab stop whose arrow keys walk its controls (the WAI-ARIA toolbar
// pattern): the bars said "toolbar", gave Tab a stop for every control, up to
// thirty of them, and no arrow moved. Their buttons are named in words, not by
// the glyph on them (B, •, ⇤, A, −); a shortcut is the tooltip's and
// aria-keyshortcuts', not part of the name; a toggle says pressed or not
// pressed, never neither. And a field you only pass through changes nothing.
// A doc's and a note's text keep Tab for themselves, so ⌥F10 is the way from
// the words to their bar, and Esc the way back to the caret.
import { expect, test } from '@playwright/test';
import { todaysLook } from './helpers/docFrame.js';
import { colourList, inToolbarLook } from './helpers/noteBar.js';

// Tab stops inside a bar: what Tab can land on, outside a menu of its own.
const stops = (bar) => bar.evaluate((el) => [...el.querySelectorAll('button, [role="button"], input, select, textarea, a[href], [tabindex]')]
  .filter((n) => n.tabIndex >= 0 && !n.disabled && n.getClientRects().length > 0 && !n.closest('[role="menu"], [role="listbox"]'))
  .length);
// Into a bar the way Tab goes: its stop.
const enter = (bar) => bar.evaluate((el) => [...el.querySelectorAll('button, [role="button"], input, select, textarea, a[href], [tabindex]')]
  .find((n) => n.tabIndex >= 0 && !n.disabled && n.getClientRects().length > 0)?.focus());
const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.getAttribute('aria-label') || a.textContent.trim()) : null;
});
const mod = (page) => page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? 'Meta' : 'Control'));
// A control named by what's drawn on it, or by nothing at all.
const GLYPHS = ['B', 'I', 'U', 'S', '•', '1.', '☐', '⇤', '≡', '⇥', 'A', '−', '+', '×'];
const glyphNamed = (snap) => snap.split('\n').filter((l) => {
  const m = l.match(/^\s*- (button|combobox|slider)(?: "([^"]*)")?/);
  return m && (m[2] == null || GLYPHS.includes(m[2]));
});

// Walk a bar from its first control to its last with →, stepping out of a
// text field from its end; the names, in order, until it comes round again.
async function walk(page) {
  const names = [];
  await page.keyboard.press('Home');
  const first = await focused(page);
  for (let i = 0; i < 60; i++) {
    names.push(await focused(page));
    if (await page.evaluate(() => document.activeElement?.matches('input[type="text"], input:not([type])'))) await page.keyboard.press('End');
    await page.keyboard.press('ArrowRight');
    if (await focused(page) === first) return names;
  }
  throw new Error(`no way round: ${names.join(', ')}`);
}

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal .tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

test.describe('the doc toolbar', () => {
  // Today's bar. The look's keys are doc-bar-a.spec.js's.
  test.beforeEach(({ page }) => todaysLook(page));

  test('is one Tab stop, and ← → Home End walk it, round from either end', async ({ page }) => {
    await openDoc(page);
    const bar = page.locator('.doc-card-modal .doc-tb');
    expect(await stops(bar)).toBe(1);
    await enter(bar);
    const first = await focused(page);
    await page.keyboard.press('ArrowRight');
    const second = await focused(page);
    expect(second).not.toBe(first);
    await page.keyboard.press('ArrowLeft');
    expect(await focused(page)).toBe(first);
    await page.keyboard.press('ArrowLeft');
    const last = await focused(page);
    expect(last).not.toBe(first);
    await page.keyboard.press('Home');
    expect(await focused(page)).toBe(first);
    await page.keyboard.press('End');
    expect(await focused(page)).toBe(last);
    const names = await walk(page);
    for (const name of ['Paragraph style', 'Font size', 'Preset sizes', 'Bold', 'Text color', 'Bulleted list', 'Find', 'Undo', 'Redo']) {
      expect(names, `${name} is on the way round`).toContain(name);
    }
    // The stop is wherever the arrows left it, and Tab leaves the bar.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    expect(await stops(bar)).toBe(1);
    expect(await bar.evaluate((el) => el.contains(document.activeElement) && document.activeElement.tabIndex)).toBe(0);
    await page.keyboard.press('Tab');
    expect(await bar.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  });

  test('its list and its size field keep their own keys, and passing through them changes nothing', async ({ page }) => {
    await openDoc(page);
    // Words in a size of their own, so the size field shows one.
    await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('plain words').selectAll()
      .setFontSize('18px').run());
    // The editor takes the focus a frame later: let it, before the bar does.
    await expect(page.locator('.doc-card-modal .tt-editor').first()).toBeFocused();
    const html = await page.evaluate(() => window.__soleilDocTest.editor.getHTML());
    const bar = page.locator('.doc-card-modal .doc-tb');
    await expect(bar.getByRole('textbox', { name: 'Font size' })).toHaveValue('18');
    const style = bar.getByRole('combobox', { name: 'Paragraph style' });
    const value = await style.inputValue();
    await style.focus();
    await page.keyboard.press('ArrowRight');
    await expect(style).not.toBeFocused();
    expect(await style.inputValue()).toBe(value);
    const size = bar.getByRole('textbox', { name: 'Font size' });
    await size.focus();
    // Focus selects its text; → collapses that to the end, and is the field's.
    await page.keyboard.press('ArrowRight');
    await expect(size).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(bar.getByRole('button', { name: 'Preset sizes', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(size).toBeFocused();
    await page.keyboard.press('Home');
    await expect(size, 'Home is the field\'s').toBeFocused();
    // With the caret at its start (Home puts it there, but not on a Mac),
    // ← goes on to the control before it.
    await size.evaluate((el) => el.setSelectionRange(0, 0));
    await page.keyboard.press('ArrowLeft');
    await expect(size).not.toBeFocused();
    // Nothing was typed, so nothing was set, and the focus stayed in the bar.
    await expect(bar.locator(':focus')).toHaveCount(1);
    expect(await page.evaluate(() => window.__soleilDocTest.editor.getHTML())).toBe(html);
  });

  test('names its buttons without the shortcut, which aria-keyshortcuts carries', async ({ page }) => {
    await openDoc(page);
    // Words selected, so Add link and Add comment are on and say their keys.
    await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('plain words').selectAll().run());
    const bar = page.locator('.doc-card-modal .doc-tb');
    const m = await mod(page);
    const keys = [
      ['Bold', 'B'], ['Italic', 'I'], ['Underline', 'U'], ['Highlight', 'Shift+H'], ['Clear formatting', '\\'],
      ['Bulleted list', 'Shift+8'], ['Numbered list', 'Shift+7'], ['Task list', 'Shift+9'],
      ['Add link', 'K'], ['Add comment', 'Alt+M'], ['Find', 'F'], ['Undo', 'Z'], ['Redo', 'Shift+Z'],
      ['Zoom out', '-'], ['Zoom in', '='],
    ];
    for (const [name, k] of keys) {
      const b = bar.getByRole('button', { name, exact: true });
      await expect(b, name).toHaveCount(1);
      await expect(b, name).toHaveAttribute('aria-keyshortcuts', `${m}+${k}`);
      await expect(b, `${name}'s tooltip still shows it`).toHaveAttribute('title', /\(.+\)$/);
    }
    for (const name of ['Bold', 'Italic', 'Underline', 'Strike', 'Inline code', 'Highlight', 'Bulleted list', 'Numbered list',
      'Task list', 'Quote', 'Align left', 'Align center', 'Align right']) {
      await expect(bar.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-pressed', /^(true|false)$/);
    }
    await expect(bar.getByRole('button', { name: 'Align left', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // The font button says what it is, and the zoom readout what it shows.
    await expect(bar.getByRole('button', { name: /^Font(: .+)?$/ })).toHaveCount(1);
    const readout = bar.locator('.doc-tb-zoom-label');
    const shown = (await readout.innerText()).trim();
    await expect(readout).toHaveAccessibleName(shown === 'Fit' ? 'Fit to width' : `${shown} — reset zoom`);
    expect(glyphNamed(await bar.ariaSnapshot())).toEqual([]);
  });

  test('⌥F10 in the text goes to it, and Esc goes back to the caret', async ({ page }) => {
    await openDoc(page);
    await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().insertContent('one two').setTextSelection(4).run());
    const text = page.locator('.doc-card-modal .tt-editor').first();
    await expect(text).toBeFocused();
    const bar = page.locator('.doc-card-modal .doc-tb');
    // Tab is the text's (it indents), so this is the way from the words to the bar.
    await page.keyboard.press('Alt+F10');
    await expect.poll(() => bar.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    expect(await bar.evaluate(() => document.activeElement.tabIndex)).toBe(0);
    // All the way round, through its fields (one takes the page's selection).
    await walk(page);
    await page.keyboard.press('ArrowRight');
    const there = await focused(page);
    await page.keyboard.press('Escape');
    await expect(text).toBeFocused();
    await expect(page.locator('.doc-card-modal')).toBeVisible();
    await page.keyboard.type('X');
    await expect(text).toContainText('oneX two');
    // And back: where the arrows left it.
    await page.keyboard.press('Alt+F10');
    await expect.poll(() => focused(page)).toBe(there);
    // A screen reader is told the way in.
    await expect(bar).toHaveAttribute('aria-keyshortcuts', 'Alt+F10');
  });
});

// ── The note's bar, against the real collaborative note (?noteqa) ─────────
const A = '[data-client="A"] .note';
const A_EDIT = '[data-client="A"] .note-body[contenteditable="true"]';
async function editA(page) {
  await page.goto('/?noteqa=1&toolbar=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.locator(A).dblclick();
  await page.locator(A_EDIT).waitFor();
  await page.locator(A_EDIT).click();
  await page.keyboard.type('hello world');
  await expect(page.locator('.tob')).toBeVisible();
}

test.describe('the note bar', () => {
  test('names its buttons in words, and its toggles say pressed or not', async ({ page }) => {
    await editA(page);
    const bar = page.locator('.tob');
    await expect(bar).toHaveAttribute('role', 'toolbar');
    await expect(bar).toHaveAttribute('aria-label', 'Text formatting');
    const m = await mod(page);
    // The toolbar look says Strikethrough, and its key (helpers/noteBar.js).
    const look = await inToolbarLook(page);
    const strike = look ? 'Strikethrough' : 'Strike';
    const named = [
      ['Bold', `${m}+B`], ['Italic', `${m}+I`], ['Underline', `${m}+U`], [strike, look ? `${m}+Shift+S` : undefined], ['Clear formatting', `${m}+\\`],
      ['Bulleted list'], ['Numbered list'], ['Checklist'], ['Align left'], ['Align center'], ['Align right'],
      ['Center in the box'], ['Add comment', `${m}+Alt+M`], ['Text color'], ['Card background'],
      ['Decrease font size'], ['Increase font size'], ['Preset sizes'],
    ];
    for (const [name, keys] of named) {
      const b = bar.getByRole('button', { name, exact: true });
      await expect(b, name).toHaveCount(1);
      if (keys) await expect(b, name).toHaveAttribute('aria-keyshortcuts', keys);
    }
    for (const name of ['Bold', 'Italic', 'Underline', strike, 'Bulleted list', 'Numbered list', 'Checklist',
      'Align left', 'Align center', 'Align right', 'Center in the box']) {
      await expect(bar.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-pressed', /^(true|false)$/);
    }
    for (const name of ['Text color', 'Card background']) {
      await expect(bar.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-expanded', 'false');
    }
    await expect(bar.getByRole('button', { name: /^Font(: .+)?$/ })).toHaveCount(1);
    expect(glyphNamed(await bar.ariaSnapshot())).toEqual([]);
    // Its colours are named too.
    await bar.getByRole('button', { name: 'Text color', exact: true }).click();
    const pop = colourList(page);
    await expect(pop).toBeVisible();
    expect(glyphNamed(await pop.ariaSnapshot())).toEqual([]);
  });

  test('is one Tab stop, the arrows walk it, and the note stays in edit', async ({ page }) => {
    await editA(page);
    const bar = page.locator('.tob');
    expect(await stops(bar)).toBe(1);
    await enter(bar);
    const names = await walk(page);
    for (const name of ['Bold', 'Bulleted list', 'Align center', 'Text color', 'Card background']) expect(names).toContain(name);
    await expect(page.locator(A_EDIT)).toHaveCount(1);
    await expect(bar).toBeVisible();
    await expect(page.locator(A_EDIT)).toContainText('hello world');
  });

  test('⌥F10 in the note goes to its bar, and Esc goes back to the caret, still editing', async ({ page }) => {
    await editA(page);
    const bar = page.locator('.tob');
    // Tab is the note's (two spaces), so this is the way from the words to the bar.
    await page.keyboard.press('Alt+F10');
    await expect.poll(() => bar.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await expect(page.locator(A_EDIT)).toHaveCount(1);
    await walk(page);
    await page.keyboard.press('Escape');
    await expect(page.locator(A_EDIT)).toBeFocused();
    await page.keyboard.type('!');
    await expect(page.locator(A_EDIT)).toContainText('hello world!');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('aria-keyshortcuts', 'Alt+F10');
  });
});

// ── The canvas: the rail, zoom and the tool bars (?local=1) ───────────────
test.describe('on the canvas', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?local=1&reset=1');
    await page.waitForSelector('.canvas-wrap .card', { timeout: 30000 });
    await page.waitForTimeout(600);
  });

  test('the tool rail is one Tab stop: ↑ ↓ walk it, → opens + and ← closes it', async ({ page }) => {
    const rail = page.locator('.cnv-tools');
    await expect(rail).toHaveAttribute('role', 'toolbar');
    await expect(rail).toHaveAttribute('aria-label', 'Tools');
    await expect(rail).toHaveAttribute('aria-orientation', 'vertical');
    expect(await stops(rail)).toBe(1);
    await enter(rail);
    expect(await focused(page)).toBe('Add menu');
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('Select tool');
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('Pan tool');
    await page.keyboard.press('ArrowUp');
    expect(await focused(page)).toBe('Select tool');
    await page.keyboard.press('End');
    expect(await focused(page)).toBe('Keyboard shortcuts');
    await page.keyboard.press('ArrowDown');
    expect(await focused(page)).toBe('Add menu');
    await page.keyboard.press('ArrowUp');
    expect(await focused(page)).toBe('Keyboard shortcuts');
    await page.keyboard.press('Home');
    // ↓ on + is the rail's; → opens it, as it opens to the right.
    await page.keyboard.press('ArrowRight');
    const menu = page.locator('.cnv-add-menu');
    await expect(menu).toBeVisible();
    const firstItem = await menu.getByRole('menuitem').first().getAttribute('aria-label');
    await expect.poll(() => focused(page)).toBe(firstItem);
    await page.keyboard.press('ArrowLeft');
    await expect(menu).toHaveCount(0);
    expect(await focused(page)).toBe('Add menu');
    // Moving along the rail arms nothing.
    await expect(page.locator('.cnv-hint')).toHaveCount(0);
    for (const [name, key] of [['Select tool', 'V'], ['Pan tool', 'H'], ['Add note tool', 'N'], ['Add grid tool', 'G'], ['Arrow tool', 'A']]) {
      await expect(rail.getByRole('button', { name, exact: true }), name).toHaveAttribute('aria-keyshortcuts', key);
    }
  });

  test('⌥F10 in a note goes to its bar, and Esc goes back to the caret', async ({ page }) => {
    // With no live room the canvas draws the plain note editor, which the bar
    // formats by execCommand rather than through Tiptap.
    await page.locator('.canvas-wrap .card .note').first().dblclick();
    const edit = page.locator('.note-body[contenteditable="true"]');
    await expect(edit).toBeFocused();
    await page.keyboard.type('zz');
    const bar = page.locator('.tob');
    await page.keyboard.press('Alt+F10');
    await expect.poll(() => bar.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await expect(edit).toHaveCount(1);
    await walk(page);
    await page.keyboard.press('Escape');
    await expect(edit).toBeFocused();
    await page.keyboard.type('!');
    await expect(edit).toContainText('zz!');
    await expect(bar).toHaveAttribute('aria-keyshortcuts', 'Alt+F10');
  });

  test('zoom names its parts, and its readout is a button that goes to 100%', async ({ page }) => {
    const zoom = page.locator('.cnv-zoom');
    await expect(zoom).toHaveAttribute('role', 'group');
    await expect(zoom).toHaveAttribute('aria-label', 'Zoom');
    const m = await mod(page);
    const out = zoom.getByRole('button', { name: 'Zoom out', exact: true });
    const inn = zoom.getByRole('button', { name: 'Zoom in', exact: true });
    await expect(out).toHaveAttribute('aria-keyshortcuts', `${m}+-`);
    await expect(inn).toHaveAttribute('aria-keyshortcuts', `${m}+=`);
    const slider = zoom.getByRole('slider', { name: 'Zoom', exact: true });
    const readout = zoom.locator('.cnv-zoom-val');
    await expect(readout).toHaveJSProperty('tagName', 'BUTTON');
    const pct = async () => (await readout.innerText()).trim();
    await expect(slider).toHaveAttribute('aria-valuetext', await pct());
    await expect(readout).toHaveAccessibleName(`${await pct()} — reset to 100%`);
    await expect(readout).toHaveAttribute('aria-keyshortcuts', `${m}+0`);
    // (By its keys: ?local=1's settings gear sits over its corner.)
    await inn.focus();
    await page.keyboard.press('Enter');
    await expect.poll(pct).not.toBe('100%');
    await expect(slider).toHaveAttribute('aria-valuetext', await pct());
    await readout.focus();
    await page.keyboard.press('Enter');
    await expect.poll(pct).toBe('100%');
    await expect(slider).toHaveAttribute('aria-valuetext', '100%');
    expect(glyphNamed(await zoom.ariaSnapshot())).toEqual([]);
  });

  test('the shape bar names its swatches and its lists, and says which is on', async ({ page }) => {
    await page.locator('.cnv-tools').getByRole('button', { name: 'Add menu', exact: true }).click();
    await page.locator('.cnv-add-menu').getByRole('menuitem', { name: 'Shape', exact: true }).click();
    const bar = page.locator('.tob');
    await expect(bar).toHaveAttribute('role', 'toolbar');
    await expect(bar).toHaveAttribute('aria-label', 'Shape');
    if (await inToolbarLook(page)) {
      // The look's: the shape and the line style are menus that name what's
      // picked, and the stroke and the fill are chips whose menus say which
      // colour is on (components/toolbar/CanvasBarsA.jsx).
      await expect(bar.getByRole('button', { name: /^Shape: / })).toHaveCount(1);
      await expect(bar.getByRole('button', { name: /^Line style: / })).toHaveCount(1);
      for (const name of ['Stroke color', 'Fill']) {
        await bar.getByRole('button', { name, exact: true }).click();
        const menu = page.getByRole('menu', { name });
        const rows = menu.getByRole('menuitemradio');
        expect(await rows.count()).toBeGreaterThan(4);
        expect(await rows.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-checked') === 'true').length)).toBe(1);
        expect(glyphNamed(await menu.ariaSnapshot())).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
      }
    } else {
      await expect(bar.getByRole('combobox', { name: 'Shape', exact: true })).toHaveCount(1);
      await expect(bar.getByRole('combobox', { name: 'Line style', exact: true })).toHaveCount(1);
      const stroke = bar.getByRole('button', { name: /^Stroke #/ });
      const fill = bar.getByRole('button', { name: /^(Fill #|No fill$)/ });
      expect(await stroke.count()).toBeGreaterThan(4);
      expect(await fill.count()).toBeGreaterThan(4);
      for (const set of [stroke, fill]) {
        expect(await set.evaluateAll((els) => els.every((el) => /^(true|false)$/.test(el.getAttribute('aria-pressed') || '')))).toBe(true);
        expect(await set.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-pressed') === 'true').length)).toBe(1);
      }
    }
    expect(glyphNamed(await bar.ariaSnapshot())).toEqual([]);
    expect(await stops(bar)).toBe(1);
  });

  test('the arrow bar says which path and which style are on', async ({ page }) => {
    await page.keyboard.press('a');
    const bar = page.locator('.tob');
    await expect(bar).toHaveAttribute('aria-label', 'Arrow');
    for (const pair of [['Curved', 'Straight'], ['Solid', 'Dashed']]) {
      const states = [];
      for (const name of pair) states.push(await bar.getByRole('button', { name, exact: true }).getAttribute('aria-pressed'));
      expect(states.sort(), pair.join(' / ')).toEqual(['false', 'true']);
    }
    await bar.getByRole('button', { name: 'Straight', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Straight', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(bar.getByRole('button', { name: 'Curved', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await stops(bar)).toBe(1);
  });

  test('the draw bar says which mode, brush, colour and width are on', async ({ page }) => {
    // The look's row unfolded: a narrower window folds it a step at a time
    // (draw-bar-look.spec.js has the folds).
    const look = await inToolbarLook(page);
    if (look) await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('d');
    const bar = page.locator('.tob');
    await expect(bar).toHaveAttribute('aria-label', 'Drawing');
    const modes = bar.getByRole('button', { name: /^(Pen|Eraser|Lasso)$/ });
    expect(await modes.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-pressed') === 'true').length)).toBe(1);
    // Each says what it shows: lit, pressed. (Today's bar starts on a width,
    // 3, that isn't one of the four it offers, so none of them is; the
    // look's starts on 4.)
    const lit = look ? 'is-on' : 'is-active';
    for (const set of [modes, bar.getByRole('button', { name: / brush$/ }), bar.getByRole('button', { name: /^Colou?r #/ }),
      bar.getByRole('button', { name: /^Stroke width / })]) {
      expect(await set.count()).toBeGreaterThan(1);
      expect(await set.evaluateAll((els) => els.map((el) => `${el.getAttribute('aria-pressed')}`)))
        .toEqual(await set.evaluateAll((els, c) => els.map((el) => `${el.classList.contains(c)}`), lit));
    }
    expect(glyphNamed(await bar.ariaSnapshot())).toEqual([]);
    expect(await stops(bar)).toBe(1);
  });
});

// ── A line (an arrow with no heads) gets its own bar ─────────────────────
async function drag(page, x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

test('a line\'s bar names its parts, and walking through its fields writes nothing', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.keyboard.press('a');
  await drag(page, 380, 300, 941, 457);
  await page.keyboard.press('v');
  const hit = page.locator('.arrow-g > path').first();
  const box = await hit.boundingBox();
  await hit.dispatchEvent('pointerdown', {
    button: 0, pointerId: 1, isPrimary: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2,
  });
  await page.mouse.up();
  await page.locator('.arrow-popover [title="No arrowheads"]').click();
  const bar = page.locator('.tob');
  await expect(bar).toHaveAttribute('aria-label', 'Line');
  const look = await inToolbarLook(page);
  if (look) {
    // The look's: the colour is a chip whose menu says which is on.
    await expect(bar.getByRole('button', { name: /^Line style: / })).toHaveCount(1);
    await bar.getByRole('button', { name: 'Line color', exact: true }).click();
    const rows = page.getByRole('menu', { name: 'Line color' }).getByRole('menuitemradio');
    expect(await rows.count()).toBeGreaterThan(4);
    expect(await rows.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-checked') === 'true').length)).toBe(1);
    await page.keyboard.press('Escape');
  } else {
    await expect(bar.getByRole('combobox', { name: 'Line style', exact: true })).toHaveCount(1);
    const swatches = bar.getByRole('button', { name: /^Color #/ });
    expect(await swatches.count()).toBeGreaterThan(4);
    expect(await swatches.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-pressed') === 'true').length)).toBe(1);
  }
  expect(glyphNamed(await bar.ariaSnapshot())).toEqual([]);
  expect(await stops(bar)).toBe(1);
  // Out of the undo window of the arrowheads, then through the bar and back.
  await page.waitForTimeout(800);
  await enter(bar);
  const names = await walk(page);
  expect(names).toContain(look ? 'Line style: Solid' : 'Line style');
  await page.waitForTimeout(800);
  // So the last thing to undo is still taking the heads off: the bar goes.
  await page.keyboard.press(`${await mod(page)}+z`);
  await expect(page.locator('.tob-angle-input')).toHaveCount(0);
});

// ── The app's other toolbars (?sidebarqa) ─────────────────────────────────
test.describe('around the app', () => {
  async function open(page, query = '') {
    await page.goto(`/?sidebarqa=1${query}`);
    await page.waitForSelector('[data-sidebarqa-ready]');
  }
  async function steps(page, bar) {
    expect(await stops(bar)).toBe(1);
    await enter(bar);
    const first = await focused(page);
    await page.keyboard.press('End');
    const last = await focused(page);
    expect(last).not.toBe(first);
    await page.keyboard.press('ArrowRight');
    expect(await focused(page)).toBe(first);
    await page.keyboard.press('ArrowLeft');
    expect(await focused(page)).toBe(last);
  }

  test('the cluster\'s bar across the top is one Tab stop the arrows walk', async ({ page }) => {
    await open(page);
    await steps(page, page.locator('.chrome-right'));
  });

  test('the files bar is one Tab stop the arrows walk', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sbf-block').first()).toBeVisible();
    await page.locator('.sbf-files [data-sb-item="film:film-file-0"]').click({ modifiers: ['ControlOrMeta'] });
    const bar = page.locator('.sbf-bulk');
    await expect(bar).toBeVisible();
    await steps(page, bar);
  });

  test('Home\'s bar is one Tab stop, and its search keeps the arrows until the caret is at its end', async ({ page }) => {
    await open(page, '&surface=home&drawer=0');
    const bar = page.locator('.ch-bar');
    await expect(bar).toBeVisible();
    expect(await stops(bar)).toBe(1);
    await enter(bar);
    const find = bar.getByRole('searchbox', { name: 'Find a cluster' });
    await expect(find).toBeFocused();
    await page.keyboard.type('fi');
    await page.keyboard.press('ArrowLeft');
    await expect(find).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(find).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(find).not.toBeFocused();
    expect(await bar.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });
});
