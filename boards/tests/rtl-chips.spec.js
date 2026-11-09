import { expect, test } from '@playwright/test';

// Chips, links, embeds and pills inside right-to-left text. A chip never decides
// its line's direction (lib/textDirection.js, lib/textDirectionExtension.js): the
// line reads by its own first letter, or by the nearest earlier line when it has
// none. Asserts the computed direction of each owner and where things sit on screen,
// in the note editor, the read-only note, a doc and a message. Direction is a view
// concern: the note's getHTML() and its shared Yjs fragment carry none of it.

const AR_LINE = 'مرحبا هذا هو الجدول';
const AR_LI = 'مرحبا في قائمة';
const AR_Q = 'اقتباس عربي';
const EN_LINE = 'hello there, an English line';

const NOTE = '[data-client="A"] .note-body[contenteditable="true"]';
const RO = '[data-ro-note] .note-body';
const DOC = '.doc-card-modal .tt-editor';

const chip = (id, label) => `<span class="tt-link tt-link-manual" data-entity-ref='{"kind":"user","id":"${id}"}'>${label}</span>`;

const NOTE_HTML = `<p>${chip('a', 'Marcus Webb')} ${AR_LINE}</p>`
  + `<p>${chip('b', 'דני כהן')} ${EN_LINE}</p>`
  + `<p>${chip('c', 'Marcus')}</p>`
  + `<ul><li><p>${chip('d', 'Marcus')} ${AR_LI}</p></li></ul>`
  + `<blockquote><p>${chip('e', 'Marcus')} ${AR_Q}</p></blockquote>`;

async function openNote(page, extra = '') {
  page.on('pageerror', (e) => { throw e; });
  await page.goto(`/?noteqa=1${extra}`);
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
}

async function openNoteEditor(page) {
  await openNote(page);
  await page.locator('[data-client="A"] .note').dblclick();
  await page.locator(NOTE).waitFor();
  await page.locator(NOTE).click();
  await page.evaluate(() => { document.querySelector('[data-client="A"]').style.height = '600px'; });
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

// Each line (p) of a note surface: its owner's direction and dir attribute, the
// chip's direction, and which side of the container the chip sits on.
function lines(page, rootSel) {
  return page.evaluate((sel) => [...document.querySelectorAll(`${sel} p`)].map((p) => {
    const owner = p.closest('li, blockquote') || p;
    const c = p.querySelector('[data-entity-ref]');
    const box = document.querySelector(sel).getBoundingClientRect();
    const r = c && c.getBoundingClientRect();
    return {
      text: p.textContent,
      tag: owner.tagName,
      direction: getComputedStyle(owner).direction,
      chipDirection: c ? getComputedStyle(c).direction : null,
      chipToRight: r ? Math.round(box.right - r.right) : null,
      chipToLeft: r ? Math.round(r.left - box.left) : null,
    };
  }), rootSel);
}

const find = (all, needle) => all.find((l) => l.text.includes(needle));

// What the four fixtures must read as, in the editor and in the read-only note.
function expectChipLines(all) {
  const ar = find(all, AR_LINE); // a Latin-named chip leading an Arabic line
  expect(ar.direction).toBe('rtl');
  expect(ar.chipToRight).toBeLessThan(ar.chipToLeft);

  const en = find(all, EN_LINE); // a Hebrew-named chip leading an English line
  expect(en.direction).toBe('ltr');
  expect(en.chipToLeft).toBeLessThan(en.chipToRight);

  const only = all.find((l) => l.text === 'Marcus' && l.tag === 'P'); // a chip-only line after English
  expect(only.direction).toBe('ltr');

  const li = find(all, AR_LI); // a chip as a list item's first content
  expect(li.tag).toBe('LI');
  expect(li.direction).toBe('rtl');
  expect(li.chipToRight).toBeLessThan(li.chipToLeft);

  const q = find(all, AR_Q);
  expect(q.tag).toBe('BLOCKQUOTE');
  expect(q.direction).toBe('rtl');
}

test('a note editor reads a line by its text, not by the chip that leads it', async ({ page }) => {
  await openNoteEditor(page);
  await page.evaluate((html) => window.__soleilNoteTest.getActiveEditor().commands.setContent(html), NOTE_HTML);
  await page.waitForTimeout(300);
  expectChipLines(await lines(page, NOTE));
});

test('a chip-only line after Arabic reads right to left in the note editor', async ({ page }) => {
  await openNoteEditor(page);
  await page.evaluate(([html]) => window.__soleilNoteTest.getActiveEditor().commands.setContent(html), [`<p>${AR_LINE}</p><p>${chip('c', 'Marcus')}</p>`]);
  await page.waitForTimeout(300);
  const all = await lines(page, NOTE);
  const only = all.find((l) => l.text === 'Marcus');
  expect(only.direction).toBe('rtl');
  expect(only.chipToRight).toBeLessThan(only.chipToLeft);
});

for (const [name, query] of [['plain', ''], ['auto-link', '&trie=1']]) {
  test(`a read-only note (${name}) reads a line by its text, not by the chip that leads it`, async ({ page }) => {
    await openNote(page, query);
    await page.evaluate((h) => window.__soleilNoteTest.setRo({ html: h }), NOTE_HTML);
    await page.waitForTimeout(300);
    expectChipLines(await lines(page, RO));
  });

  test(`a read-only note (${name}): a chip-only line after Arabic is right to left, like the editor`, async ({ page }) => {
    await openNote(page, query);
    await page.evaluate((h) => window.__soleilNoteTest.setRo({ html: h }), `<p>${AR_LINE}</p><p>${chip('c', 'Marcus')}</p><p>123</p>`);
    await page.waitForTimeout(300);
    const all = await lines(page, RO);
    const only = all.find((l) => l.text === 'Marcus');
    expect(only.direction).toBe('rtl');
    expect(only.chipToRight).toBeLessThan(only.chipToLeft);
    expect(all.find((l) => l.text === '123').direction).toBe('rtl');
  });
}

test('the note editor draws direction on the view only: no dir in getHTML or the shared fragment', async ({ page }) => {
  await openNoteEditor(page);
  await page.evaluate((html) => window.__soleilNoteTest.getActiveEditor().commands.setContent(html), NOTE_HTML);
  await page.waitForTimeout(300);
  const [live, shared] = await page.evaluate(() => [
    window.__soleilNoteTest.getActiveEditor().getHTML(),
    window.__soleilNoteTest.getFragHtmlA(),
  ]);
  for (const html of [live, shared]) {
    expect(html).toContain(AR_LINE);
    expect(html).not.toMatch(/\sdir=/);
    expect(html).not.toContain('data-dir-auto');
  }
});

// A doc: an entity link split by bold inside an Arabic line reads in order, and a
// board embed first in a quote does not decide the quote.
const link = (id) => ({ type: 'link', attrs: { linkId: id } });
const linkLine = (id) => ({
  type: 'paragraph',
  content: [
    { type: 'text', text: 'مرحبا يا ' },
    { type: 'text', text: 'Marcus ', marks: [link(id)] },
    { type: 'text', text: 'Webb', marks: [link(id), { type: 'bold' }] },
    { type: 'text', text: ' هذا هو الجدول' },
  ],
});
const DOC_JSON = {
  type: 'doc',
  content: [
    linkLine('L1'),
    linkLine(null),
    { type: 'blockquote', content: [{ type: 'boardEmbed', attrs: { label: 'Harbour moodboard' } }, { type: 'paragraph', content: [{ type: 'text', text: 'اقتباس عربي بعد لوحة مضمنة' }] }] },
    { type: 'blockquote', content: [{ type: 'boardEmbed', attrs: { label: 'لوحة الميناء', cardId: 'c1' } }, { type: 'paragraph', content: [{ type: 'text', text: 'An English quote after an embed' }] }] },
  ],
};

test('a doc reads an entity link split by bold in order inside an Arabic line, with and without a link id', async ({ page }) => {
  await openDoc(page);
  const html = await page.evaluate((j) => { const e = window.__soleilDocTest.editor; e.commands.setContent(j); return e.getHTML(); }, DOC_JSON);
  await page.waitForTimeout(300);
  expect(html).not.toMatch(/\sdir=|data-dir-auto/);
  const rows = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} > p`)].slice(0, 2).map((p) => {
    const left = (needle) => {
      const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.nodeValue.indexOf(needle);
        if (i >= 0) {
          const g = document.createRange();
          g.setStart(n, i);
          g.setEnd(n, i + needle.length);
          return g.getBoundingClientRect().left;
        }
      }
      return null;
    };
    return { direction: getComputedStyle(p).direction, marcus: left('Marcus'), webb: left('Webb') };
  }), DOC);
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.direction).toBe('rtl');
    expect(row.marcus).not.toBeNull();
    expect(row.webb).not.toBeNull();
    expect(row.marcus).toBeLessThan(row.webb); // the x of "Marcus" is left of "Webb"
  }
});

test('a doc: a board embed first in a quote does not decide it; its title follows its own text', async ({ page }) => {
  await openDoc(page);
  await page.evaluate((j) => window.__soleilDocTest.editor.commands.setContent(j), DOC_JSON);
  await page.waitForTimeout(300);
  const embeds = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} .tt-embed`)].map((e) => {
    const title = e.querySelector('.tt-embed-title');
    const q = e.closest('blockquote');
    const box = document.querySelector(sel).getBoundingClientRect();
    return {
      quote: getComputedStyle(q).direction,
      root: getComputedStyle(e).direction,
      title: getComputedStyle(title).direction,
      align: getComputedStyle(title).textAlign,
      left: Math.round(e.getBoundingClientRect().left - box.left),
      right: Math.round(box.right - e.getBoundingClientRect().right),
    };
  }), DOC);
  expect(embeds).toHaveLength(2);
  const [arQuote, enQuote] = embeds;
  expect(arQuote.quote).toBe('rtl'); // the Arabic text after the embed decides the quote
  expect(arQuote.root).toBe('ltr'); // the embed is interface, drawn left to right
  expect(arQuote.title).toBe('ltr'); // "Harbour moodboard" follows its own text
  expect(['left', 'start']).toContain(arQuote.align);
  expect(enQuote.quote).toBe('ltr');
  expect(enQuote.root).toBe('ltr');
  expect(enQuote.title).toBe('rtl'); // an Arabic title follows its own text
});

// A message: the pill is an inline chip with a dir of its own; the line reads by its text.
test('a message pill never decides its line: Arabic with a leading pill is rtl, English with a Hebrew pill is ltr', async ({ page }) => {
  await openNote(page);
  const res = await page.evaluate(async () => {
    const { renderMessageBody } = await import('/src/lib/renderMessageBody.jsx');
    const client = await import('/node_modules/.vite/deps/react-dom_client.js');
    const rd = await import('/node_modules/.vite/deps/react-dom.js');
    const flush = rd.flushSync || rd.default.flushSync;
    const createRoot = client.createRoot || client.default.createRoot;
    const ctx = { mentions: ['u1', 'u2'], userNamesById: { u1: 'Marcus Webb', u2: 'דני כהן' } };
    const out = {};
    for (const [key, body] of [
      ['ar', '@Marcus Webb مرحبا كيف حالك'],
      ['en', '@דני כהן hello there, how are you'],
    ]) {
      const host = document.createElement('div');
      host.className = 'msg-bubble-body';
      host.style.cssText = 'position:fixed;left:20px;top:20px;width:400px;z-index:2147483647';
      document.body.appendChild(host);
      flush(() => createRoot(host).render(renderMessageBody(body, ctx)));
      const pill = host.querySelector('.msg-pill');
      const line = pill.closest('p, li, blockquote');
      const box = host.getBoundingClientRect();
      const r = pill.getBoundingClientRect();
      out[key] = {
        line: getComputedStyle(line).direction,
        pill: getComputedStyle(pill).direction,
        toRight: Math.round(box.right - r.right),
        toLeft: Math.round(r.left - box.left),
      };
      host.remove();
    }
    return out;
  });
  expect(res.ar.line).toBe('rtl');
  expect(res.ar.toRight).toBeLessThan(res.ar.toLeft); // the pill starts at the right edge
  expect(res.en.line).toBe('ltr');
  expect(res.en.toLeft).toBeLessThan(res.en.toRight); // and at the left edge
});
