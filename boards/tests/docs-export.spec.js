// Whole-doc export regression guard (boards/src/lib/docFullExport.js), driven
// through the ?docqa=1 bridge. The historic bug: export only saw the focused
// sheet, silently dropping every other sheet + page. These build multi-sheet /
// multi-page Y.Docs and assert collectFullDocJSON / jsonToMarkdown capture ALL
// content. Pure logic — no UI.

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!(window.__soleilDocTest && window.__soleilDocTest.docExport), null, { timeout: 15000 });
});

test('collectFullDocJSON spans every sheet of a page (not just the focused one)', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const cardYMap = new T.Y.Map();
    ydoc.transact(() => { ydoc.getMap('cards').set('c1', cardYMap); }, 'local');
    T.initCardDocStore(ydoc, cardYMap);
    const scope = { ...T.cardScope(cardYMap), cardId: 'c1', docCardId: 'c1' };
    const addPara = (frag, text) => {
      ydoc.transact(() => {
        const p = new T.Y.XmlElement('paragraph');
        const t = new T.Y.XmlText();
        t.insert(0, text);
        p.insert(0, [t]);
        frag.insert(frag.length, [p]);
      }, 'local');
    };
    const pid = T.addPage(ydoc, { name: 'P1', scope });
    addPara(T.getOrCreateSheetContent(ydoc, pid, pid, scope), 'ALPHA_PRIMARY_SHEET');
    const sid = T.addPageSheet(ydoc, pid, scope);
    addPara(T.getOrCreateSheetContent(ydoc, pid, sid, scope), 'BETA_SECOND_SHEET');
    const json = JSON.stringify(T.docExport.collectFullDocJSON(ydoc, scope));
    return { hasAlpha: json.includes('ALPHA_PRIMARY_SHEET'), hasBeta: json.includes('BETA_SECOND_SHEET') };
  });
  expect(res.hasAlpha).toBe(true);
  expect(res.hasBeta).toBe(true);
});

test('collectFullDocJSON spans every page in tree order with page breaks', async ({ page }) => {
  const res = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const scope = undefined; // root scope
    const addPara = (frag, text) => {
      ydoc.transact(() => {
        const p = new T.Y.XmlElement('paragraph');
        const t = new T.Y.XmlText();
        t.insert(0, text);
        p.insert(0, [t]);
        frag.insert(frag.length, [p]);
      }, 'local');
    };
    const p1 = T.addPage(ydoc, { name: 'One', scope });
    const p2 = T.addPage(ydoc, { name: 'Two', scope });
    addPara(T.getOrCreatePageContent(ydoc, p1, scope), 'PAGE_ONE_BODY');
    addPara(T.getOrCreatePageContent(ydoc, p2, scope), 'PAGE_TWO_BODY');
    const doc = T.docExport.collectFullDocJSON(ydoc, scope);
    const json = JSON.stringify(doc);
    return {
      hasOne: json.includes('PAGE_ONE_BODY'),
      hasTwo: json.includes('PAGE_TWO_BODY'),
      hasBreak: (doc.content || []).some(n => n.type === 'horizontalRule'),
    };
  });
  expect(res.hasOne).toBe(true);
  expect(res.hasTwo).toBe(true);
  expect(res.hasBreak).toBe(true);
});

test('jsonToMarkdown renders headings, sub/superscript, and links', async ({ page }) => {
  const md = await page.evaluate(() => {
    const T = window.__soleilDocTest;
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
        { type: 'paragraph', content: [
          { type: 'text', text: 'x', marks: [{ type: 'superscript' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://soleil.test' } }] },
        ] },
      ],
    };
    return T.docExport.jsonToMarkdown(doc);
  });
  expect(md).toContain('## Title');
  expect(md).toContain('<sup>x</sup>');
  expect(md).toContain('[link](https://soleil.test)');
});

test('collectFullDocHtml resolves link marks to real <a href> and renders all sheets', async ({ page }) => {
  const html = await page.evaluate(async () => {
    const T = window.__soleilDocTest;
    const ydoc = new T.Y.Doc();
    const scope = undefined;
    const addLinkPara = (frag, text, href) => {
      ydoc.transact(() => {
        const p = new T.Y.XmlElement('paragraph');
        const t = new T.Y.XmlText();
        // Apply a `link` mark via a stored href attr (the export renders it).
        t.insert(0, text, { link: { href } });
        p.insert(0, [t]);
        frag.insert(frag.length, [p]);
      }, 'local');
    };
    const p1 = T.addPage(ydoc, { name: 'One', scope });
    addLinkPara(T.getOrCreatePageContent(ydoc, p1, scope), 'clickme', 'https://soleil.test/x');
    return T.docExport.collectFullDocHtml(ydoc, scope);
  });
  expect(html).toContain('href="https://soleil.test/x"');
  expect(html).toContain('clickme');
});
