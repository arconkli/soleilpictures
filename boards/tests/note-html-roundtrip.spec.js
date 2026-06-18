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
