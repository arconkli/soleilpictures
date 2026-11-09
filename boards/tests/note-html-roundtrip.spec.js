import { expect, test } from '@playwright/test';

// TEMP Phase-A verification: legacy note html → ProseMirror JSON → html must
// preserve the note html CONTRACT the read-only consumers depend on, and be
// idempotent (a second round-trip is stable).

test('note html round-trips through the note schema, preserving the contract', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  const result = await page.evaluate(async () => {
    const mod = await import('/src/lib/noteDocState.js');
    const rt = (html) => mod.noteJSONToHtml(mod.noteHtmlToJSON(html));
    const cases = {
      plain: '<div>hello</div><div>world</div>',
      marks: '<div>normal <strong>bold</strong> <em>it</em> <u>un</u> <s>st</s></div>',
      styles: '<div><span style="color: rgb(255, 0, 0)">red</span> '
            + '<span style="font-family: Inter">fam</span> '
            + '<span style="font-size: 24px">big</span></div>',
      checklist: '<ul class="note-checklist">'
            + '<li class="ck"><span class="ck-box" role="checkbox" aria-checked="true"></span><span class="ck-text">done</span></li>'
            + '<li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><span class="ck-text">todo</span></li>'
            + '</ul>',
      mention: '<div>hey <span class="tt-link tt-link-manual" data-entity-ref=\'{"kind":"note","id":"abc"}\'>Alice</span> there</div>',
      bullets: '<ul><li>a</li><li>b</li></ul>',
    };
    const out = {};
    for (const [k, html] of Object.entries(cases)) {
      const first = rt(html);
      const second = rt(first);
      out[k] = { first, idempotent: first === second };
    }
    // Decode the mention ref the way the browser/read-only renderer would.
    const probe = document.createElement('div');
    probe.innerHTML = out.mention.first;
    const chip = probe.querySelector('[data-entity-ref]');
    out.mention.ref = chip ? JSON.parse(chip.getAttribute('data-entity-ref')) : null;
    return out;
  });

  expect(errs, 'no page errors importing the module').toEqual([]);

  // plain text survives
  expect(result.plain.first).toContain('hello');
  expect(result.plain.first).toContain('world');

  // inline marks
  expect(result.marks.first).toContain('<strong>bold</strong>');
  expect(result.marks.first).toContain('<em>it</em>');
  expect(result.marks.first).toContain('<u>un</u>');
  expect(result.marks.first).toContain('<s>st</s>');

  // inline color / font / size on textStyle spans
  expect(result.styles.first).toMatch(/color:\s*rgb\(255, 0, 0\)/);
  expect(result.styles.first).toContain('font-family: Inter');
  expect(result.styles.first).toContain('font-size: 24px');

  // checklist contract
  expect(result.checklist.first).toContain('<ul class="note-checklist">');
  expect(result.checklist.first).toContain('class="ck"');
  expect(result.checklist.first).toContain('ck-box');
  expect(result.checklist.first).toContain('aria-checked="true"');
  expect(result.checklist.first).toContain('class="ck-text"');
  expect(result.checklist.first).toContain('done');
  expect(result.checklist.first).toContain('todo');

  // mention chip contract
  expect(result.mention.first).toContain('data-entity-ref');
  expect(result.mention.first).toContain('Alice');
  expect(result.mention.ref).toEqual({ kind: 'note', id: 'abc' });

  // plain bullets stay plain (NOT note-checklist)
  expect(result.bullets.first).toContain('<ul>');
  expect(result.bullets.first).not.toContain('note-checklist');
  expect(result.bullets.first).toContain('<li>');

  // idempotence
  for (const k of Object.keys(result)) {
    expect(result[k].idempotent, `${k} round-trip is idempotent`).toBe(true);
  }
});

test("a block's last <br> reads back as the line it showed, and a closing break saves as two", async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();

  const result = await page.evaluate(async () => {
    const mod = await import('/src/lib/noteDocState.js');
    const cases = [
      '<p>a<br><br></p>',
      '<p>a<br></p>',
      '<p><br></p>',
      'a<div><br></div><div>b</div>',
      '<p>a<br>b</p>',
      '<p><strong>a<br></strong></p>',
      '<h2>T<br><br></h2>',
      '<ul><li>x<br></li></ul>',
    ];
    return cases.map((html) => {
      const json = mod.noteHtmlToJSON(html);
      const out = mod.noteJSONToHtml(json);
      const again = mod.noteJSONToHtml(mod.noteHtmlToJSON(out));
      return {
        html,
        types: json.content.map((b) => (b.content || []).map((c) => c.type)),
        itemTypes: json.content[0]?.content?.[0]?.content?.[0]?.content?.map((c) => c.type) || null,
        out,
        stable: again === out,
      };
    });
  });

  const expected = [
    [[['text', 'hardBreak']], '<p>a<br><br></p>'],
    [[['text']], '<p>a</p>'],
    [[[]], '<p></p>'],
    [[['text'], [], ['text']], '<p>a</p><p></p><p>b</p>'],
    [[['text', 'hardBreak', 'text']], '<p>a<br>b</p>'],
    [[['text']], '<p><strong>a</strong></p>'],
    [[['text', 'hardBreak']], '<h2>T<br><br></h2>'],
  ];
  expected.forEach(([types, out], i) => {
    expect(result[i].types, result[i].html).toEqual(types);
    expect(result[i].out, result[i].html).toBe(out);
    expect(result[i].stable, `${result[i].html} is stable`).toBe(true);
  });
  // The list item's paragraph: bulletList > listItem > paragraph.
  expect(result[7].itemTypes).toEqual(['text']);
  expect(result[7].stable).toBe(true);
});

test('a paragraph ending in a hard break is saved with a filler break', async ({ page }) => {
  await page.goto('/?noteqa=1');
  await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
  await page.evaluate(() => {
    const t = window.__soleilNoteTest;
    const frag = t.getNoteFragment(t.cardB);
    t.docB.transact(() => {
      frag.delete(0, frag.length);
      const p = new t.Y.XmlElement('paragraph');
      frag.insert(0, [p]);
      const text = new t.Y.XmlText();
      p.insert(0, [text]);
      text.insert(0, 'a');
      p.insert(1, [new t.Y.XmlElement('hardBreak')]);
    }, 'local');
  });
  await expect.poll(() => page.evaluate(() => window.__soleilNoteTest.getFragHtmlA()))
    .toBe('<p>a<br><br></p>');
});
