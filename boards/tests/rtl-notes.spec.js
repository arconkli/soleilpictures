import { expect, test } from '@playwright/test';

// Right-to-left writing in a note and in a doc. dir="auto" is drawn on the view
// only (lib/textDirection.js + lib/textDirectionExtension.js): Arabic and Hebrew
// blocks read right to left, English stays left to right, a list item's marker
// sits on its own start side, and nothing about direction reaches getHTML() or
// the shared Yjs fragment.

const AR_P = 'هذه فقرة عربية قصيرة';
const HE_P = 'זוהי פסקה בעברית';
const AR_1 = 'عنصر أول';
const AR_2 = 'عنصر ثان';
const AR_Q = 'اقتباس عربي';
const EN_P = 'English first line';
const EN_LI = 'English item';
const EN_AFTER = 'English after list';

const NOTE = '[data-client="A"] .note-body[contenteditable="true"]';
const DOC = '.doc-card-modal .tt-editor';

// Editor reached through each harness's test bridge.
const NOTE_ED = () => window.__soleilNoteTest.getActiveEditor();
const DOC_ED = () => window.__soleilDocTest.editor;

async function openNote(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.locator('[data-client="A"] .note').dblclick();
  await page.locator(NOTE).waitFor();
  await page.locator(NOTE).click();
  // Room for the text, so nothing is clipped while measuring.
  await page.evaluate(() => { document.querySelector('[data-client="A"]').style.height = '560px'; });
}

async function openDoc(page) {
  page.on('pageerror', (e) => { throw e; });
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 15000 });
  await page.locator(DOC).click();
}

// Types the same mix into whichever editor is focused.
async function write(page, ed) {
  const cmd = (name) => page.evaluate(([getter, n]) => {
    // eslint-disable-next-line no-new-func
    const e = new Function(`return (${getter})()`)();
    e.chain().focus('end')[n]().run();
  }, [ed.toString(), name]);
  const line = async (text) => { await page.keyboard.type(text); await page.keyboard.press('Enter'); };

  await line(EN_P);
  await line(AR_P);
  await line(HE_P);
  await cmd('toggleBulletList');
  await line(AR_1);
  await line(AR_2);
  await line(EN_LI);
  await page.keyboard.press('Enter'); // an empty item ends the list
  await line(EN_AFTER);
  await cmd('toggleBlockquote');
  await page.keyboard.type(AR_Q);
}

// How a block reads: the element that owns its direction (the list item or the
// quote it sits in, else the block itself), its resolved direction, its dir
// attribute, and where its first text sits in the container.
async function probe(page, rootSel, text) {
  return page.evaluate(([sel, t]) => {
    const root = document.querySelector(sel);
    const block = [...root.querySelectorAll('p')].find((p) => p.textContent === t);
    if (!block) return null;
    const owner = block.closest('li, blockquote') || block;
    const cs = getComputedStyle(owner);
    const r = document.createRange();
    r.selectNodeContents(block);
    const text0 = r.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    return {
      tag: owner.tagName,
      attr: owner.getAttribute('dir'),
      direction: cs.direction,
      marginLeft: cs.marginLeft,
      marginRight: cs.marginRight,
      gapLeft: Math.round(text0.left - box.left),
      gapRight: Math.round(box.right - text0.right),
      blockHasDir: block.hasAttribute('dir'),
    };
  }, [rootSel, text]);
}

async function check(page, rootSel, getHtml) {
  const ar = await probe(page, rootSel, AR_P);
  const he = await probe(page, rootSel, HE_P);
  const en = await probe(page, rootSel, EN_P);
  const enAfter = await probe(page, rootSel, EN_AFTER);
  expect(ar.direction).toBe('rtl');
  expect(he.direction).toBe('rtl');
  expect(en.direction).toBe('ltr');
  expect(enAfter.direction).toBe('ltr');
  expect(ar.attr).toBe('auto');
  // Arabic text starts at the right edge, English at the left.
  expect(ar.gapRight).toBeLessThan(ar.gapLeft);
  expect(en.gapLeft).toBeLessThan(en.gapRight);

  // List items: each owns its direction, its indent (and so its marker) on its own start side.
  const li1 = await probe(page, rootSel, AR_1);
  const li2 = await probe(page, rootSel, AR_2);
  const liEn = await probe(page, rootSel, EN_LI);
  for (const li of [li1, li2]) {
    expect(li.tag).toBe('LI');
    expect(li.direction).toBe('rtl');
    expect(li.attr).toBe('auto');
    expect(li.blockHasDir).toBe(false); // the paragraph inside inherits; it carries no dir of its own
    expect(parseFloat(li.marginRight)).toBeGreaterThan(10); // indent on the right: the marker sits there
    expect(parseFloat(li.marginLeft)).toBe(0);
    expect(li.gapRight).toBeGreaterThan(10);
    expect(li.gapRight).toBeLessThan(li.gapLeft);
  }
  expect(liEn.direction).toBe('ltr');
  expect(parseFloat(liEn.marginLeft)).toBeGreaterThan(10);
  expect(parseFloat(liEn.marginRight)).toBe(0);

  // The marker of an Arabic item is drawn to the right of its text, English to the left.
  const markers = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    const item = (t) => [...root.querySelectorAll('li')].find((li) => li.textContent.trim() === t);
    const side = (li) => {
      const r = document.createRange();
      r.selectNodeContents(li.querySelector('p'));
      const li0 = li.getBoundingClientRect();
      const text = r.getBoundingClientRect();
      // The marker hangs outside the item's box, on the side the item starts.
      return getComputedStyle(li).direction === 'rtl' ? (li0.right >= text.right ? 'right' : 'left')
        : (li0.left <= text.left ? 'left' : 'right');
    };
    return { ar: side(item('عنصر أول')), en: side(item('English item')) };
  }, rootSel);
  expect(markers).toEqual({ ar: 'right', en: 'left' });

  const q = await probe(page, rootSel, AR_Q);
  expect(q.tag).toBe('BLOCKQUOTE');
  expect(q.direction).toBe('rtl');
  expect(q.attr).toBe('auto');
  expect(q.blockHasDir).toBe(false);

  // Stored html carries no direction.
  const html = await getHtml();
  expect(html).not.toMatch(/\sdir=/);
  expect(html).toContain(AR_P);
}

test('a note reads Arabic and Hebrew right to left and English left to right', async ({ page }) => {
  await openNote(page);
  await write(page, NOTE_ED);
  await check(page, NOTE, async () => {
    // The editor's own html and what the shared fragment holds (what is stored).
    const [live, shared] = await page.evaluate(() => [
      window.__soleilNoteTest.getActiveEditor().getHTML(),
      window.__soleilNoteTest.getFragHtmlA(),
    ]);
    return `${live}\n${shared}`;
  });
});

// The read-only note (canvas, share, list): plain innerHTML, and the trie path
// that rebuilds the html as React elements and must keep dir.
for (const [name, query] of [['plain', ''], ['auto-link', '&trie=1']]) {
  test(`a read-only note (${name}) reads Arabic right to left, English left to right`, async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await page.goto(`/?noteqa=1${query}`);
    await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
    await page.evaluate(([ar, li, q, en]) => window.__soleilNoteTest.setRo({
      html: `<p>${en}</p><p>${ar}</p><ul><li><p>${li}</p></li></ul><blockquote><p>${q}</p></blockquote>`,
    }), [AR_P, AR_1, AR_Q, EN_P]);
    const dir = (t) => page.evaluate((text) => {
      const p = [...document.querySelectorAll('[data-ro-note] .note-body p')].find((x) => x.textContent === text);
      const owner = p.closest('li, blockquote') || p;
      return [getComputedStyle(owner).direction, owner.getAttribute('dir'), p.hasAttribute('dir')];
    }, t);
    expect(await dir(EN_P)).toEqual(['ltr', 'auto', true]);
    expect(await dir(AR_P)).toEqual(['rtl', 'auto', true]);
    expect(await dir(AR_1)).toEqual(['rtl', 'auto', false]);
    expect(await dir(AR_Q)).toEqual(['rtl', 'auto', false]);
    // The Arabic quote's rule and indent sit on its right, where its text starts.
    const side = await page.evaluate((text) => {
      const p = [...document.querySelectorAll('[data-ro-note] .note-body p')].find((x) => x.textContent === text);
      const s = getComputedStyle(p.closest('blockquote'));
      return [s.borderRightWidth, s.borderLeftWidth, s.paddingRight, s.paddingLeft];
    }, AR_Q);
    expect(side).toEqual(['2px', '0px', '10px', '0px']);
  });
}

test('a doc reads Arabic and Hebrew right to left and English left to right', async ({ page }) => {
  await openDoc(page);
  await write(page, DOC_ED);
  await check(page, DOC, () => page.evaluate(() => window.__soleilDocTest.editor.getHTML()));
});

// Nesting: every item owns its own direction, so an English sub-item under an
// Arabic item reads left to right (its marker on the left), and an Arabic
// sub-item under an English item reads right to left.
for (const [name, open, getEd, root] of [
  ['note', openNote, NOTE_ED, NOTE],
  ['doc', openDoc, DOC_ED, DOC],
]) {
  test(`a nested mixed list reads each item in its own direction in a ${name}`, async ({ page }) => {
    await open(page);
    const edSrc = getEd.toString();
    await page.evaluate(([src, ar, en]) => {
      // eslint-disable-next-line no-new-func
      new Function(`return (${src})()`)().commands.setContent(
        `<ul><li><p>${ar}</p><ul><li><p>${en} sub</p></li></ul></li></ul>`
        + `<ul><li><p>${en} top</p><ul><li><p>${ar} فرعي</p></li></ul></li></ul>`
        + `<blockquote><p>${ar}</p><ul><li><p>${en} in quote</p></li></ul></blockquote>`,
      );
    }, [edSrc, AR_1, EN_LI]);
    const enSub = await probe(page, root, `${EN_LI} sub`);
    expect(enSub.tag).toBe('LI');
    expect(enSub.direction).toBe('ltr');
    expect(parseFloat(enSub.marginLeft)).toBeGreaterThan(10);
    expect(parseFloat(enSub.marginRight)).toBe(0);
    expect(enSub.gapLeft).toBeLessThan(enSub.gapRight);
    const arSub = await probe(page, root, `${AR_1} فرعي`);
    expect(arSub.direction).toBe('rtl');
    expect(parseFloat(arSub.marginRight)).toBeGreaterThan(10);
    const enQuote = await probe(page, root, `${EN_LI} in quote`);
    expect(enQuote.tag).toBe('LI');
    expect(enQuote.direction).toBe('ltr');
    expect(parseFloat(enQuote.marginLeft)).toBeGreaterThan(10);
    // The top item of the first list is still Arabic.
    const arTop = await probe(page, root, AR_1);
    expect(arTop.direction).toBe('rtl');
  });

  test(`the first empty item of a new list after Arabic starts at the right in a ${name}`, async ({ page }) => {
    await open(page);
    const edSrc = getEd.toString();
    await page.keyboard.type(AR_P);
    await page.keyboard.press('Enter');
    await page.keyboard.type('- ');
    const c = await page.evaluate(([sel, src]) => {
      // eslint-disable-next-line no-new-func
      const view = new Function(`return (${src})()`)().view;
      const pos = view.coordsAtPos(view.state.selection.from);
      const box = document.querySelector(sel).getBoundingClientRect();
      const { $from } = view.state.selection;
      const block = view.nodeDOM($from.before($from.depth));
      const owner = block.closest('li, blockquote') || block;
      return { toRight: box.right - pos.right, toLeft: pos.left - box.left, tag: owner.tagName, direction: getComputedStyle(owner).direction };
    }, [root, edSrc]);
    // "- " is a bullet list in a doc; a note keeps it as a text prefix on the line.
    expect(c.tag).toBe(name === 'doc' ? 'LI' : 'P');
    expect(c.direction).toBe('rtl');
    expect(c.toRight).toBeLessThan(c.toLeft);
  });
}

// An empty line has no letter for dir="auto" to read, so it takes the direction
// of the line before it: Enter after Arabic leaves the caret at the right, and
// the first letter typed decides from there.
for (const [name, open, getEd, root] of [
  ['note', openNote, NOTE_ED, NOTE],
  ['doc', openDoc, DOC_ED, DOC],
]) {
  test(`a new line after Arabic starts at the right in a ${name}; an English letter turns it left to right`, async ({ page }) => {
    await open(page);
    const edSrc = getEd.toString();
    const caret = () => page.evaluate(([sel, src]) => {
      // eslint-disable-next-line no-new-func
      const view = new Function(`return (${src})()`)().view;
      const c = view.coordsAtPos(view.state.selection.from);
      const box = document.querySelector(sel).getBoundingClientRect();
      const { $from } = view.state.selection;
      const block = view.nodeDOM($from.before($from.depth));
      const owner = block.closest('li, blockquote') || block;
      return { toRight: box.right - c.right, toLeft: c.left - box.left, direction: getComputedStyle(owner).direction, attr: owner.getAttribute('dir'), tag: owner.tagName };
    }, [root, edSrc]);

    // A paragraph.
    await page.keyboard.type(AR_P);
    await page.keyboard.press('Enter');
    let c = await caret();
    expect(c.direction).toBe('rtl');
    expect(c.toRight).toBeLessThan(c.toLeft);
    await page.keyboard.type('e');
    c = await caret();
    expect(c.direction).toBe('ltr');
    expect(c.toLeft).toBeLessThan(c.toRight);

    // A list item: its marker follows.
    await page.keyboard.press('Enter');
    await page.evaluate((src) => {
      // eslint-disable-next-line no-new-func
      new Function(`return (${src})()`)().chain().focus('end').toggleBulletList().run();
    }, edSrc);
    await page.keyboard.type(AR_1);
    await page.keyboard.press('Enter');
    c = await caret();
    expect(c.tag).toBe('LI');
    expect(c.direction).toBe('rtl');
    expect(c.toRight).toBeLessThan(c.toLeft);
    await page.keyboard.press('Enter'); // the empty item ends the list
    await page.keyboard.type('x');
    c = await caret();
    expect(c.direction).toBe('ltr');
  });
}
