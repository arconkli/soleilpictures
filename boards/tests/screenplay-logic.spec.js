// Pure-logic tests for screenplay mode (flow table, collectors, line-accurate
// paginator, Fountain + FDX round-trips), driven through the ?docqa=1 bridge
// (window.__soleilDocTest.screenplay). No UI — deterministic.

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!(window.__soleilDocTest && window.__soleilDocTest.screenplay), null, { timeout: 15000 });
});

test('Enter flow advances elements the way screenwriters expect', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return {
      scene: S.nextOnEnter('scene'),
      character: S.nextOnEnter('character'),
      dialogue: S.nextOnEnter('dialogue'),
      parenthetical: S.nextOnEnter('parenthetical'),
      transition: S.nextOnEnter('transition'),
      emptyCharacter: S.nextOnEnter('character', true),
    };
  });
  expect(r.scene).toBe('action');
  expect(r.character).toBe('dialogue');
  expect(r.dialogue).toBe('action');
  expect(r.parenthetical).toBe('dialogue');
  expect(r.transition).toBe('scene');
  expect(r.emptyCharacter).toBe('action'); // empty cue bails to action
});

test('Tab cycles the element ring forward and back', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return {
      fwd: S.nextOnTab('scene'),
      back: S.prevOnTab('scene'),
      caps: [S.shouldUppercase('scene'), S.shouldUppercase('character'), S.shouldUppercase('transition'), S.shouldUppercase('dialogue')],
    };
  });
  expect(r.fwd).toBe('action');
  expect(r.back).toBe('shot'); // wraps to end of ring
  expect(r.caps).toEqual([true, true, true, false]);
});

test('collectCharacterNames + collectLocations read the doc', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const doc = S.blocksToDocJSON([
      { element: 'scene', text: 'INT. KITCHEN - DAY' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Morning.' },
      { element: 'character', text: 'JOHN (CONT’D)' },
      { element: 'character', text: 'MARY' },
      { element: 'scene', text: 'EXT. PARK - NIGHT' },
    ]);
    return { names: S.collectCharacterNames(doc), locs: S.collectLocations(doc) };
  });
  expect(r.names).toEqual(['JOHN', 'MARY']); // CONT'D folds into JOHN
  expect(r.locs).toEqual(['KITCHEN', 'PARK']);
});

test('paginator splits a long dialogue with (MORE) / (CONT’D) and never strands lines', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // Fill most of a page with action, then a long dialogue that must split.
    const blocks = [
      { element: 'scene', text: 'INT. OFFICE - DAY' },
      { element: 'action', text: 'A'.repeat(60 * 45) },        // ~45 lines
      { element: 'character', text: 'NARRATOR' },
      { element: 'dialogue', text: 'B'.repeat(35 * 20) },      // ~20 dialogue lines
    ];
    const res = S.paginate(blocks);
    const flat = res.pages.flat();
    const more = flat.find(f => f.more);
    const contd = flat.find(f => f.contd);
    return { pageCount: res.pageCount, hasMore: !!more, contd: contd?.contd || null };
  });
  expect(r.pageCount).toBeGreaterThanOrEqual(2);
  expect(r.hasMore).toBe(true);
  expect(r.contd).toBe('NARRATOR'); // continued dialogue is attributed
});

test('paginator never orphans a scene heading at the bottom of a page', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'action', text: 'A'.repeat(60 * 53) },   // fills to line ~53 of 54
      { element: 'scene', text: 'INT. LATER - NIGHT' },   // would orphan at the very bottom
      { element: 'action', text: 'She enters.' },
    ];
    const res = S.paginate(blocks);
    // The scene heading must NOT be the trailing fragment of page 1.
    const page1 = res.pages[0];
    const last = page1[page1.length - 1];
    const page2 = res.pages[1] || [];
    return {
      pageCount: res.pageCount,
      lastEl: last.element,
      sceneOnPage2: page2.some(f => f.element === 'scene'),
    };
  });
  expect(r.pageCount).toBeGreaterThanOrEqual(2);
  expect(r.lastEl).not.toBe('scene');
  expect(r.sceneOnPage2).toBe(true);
});

test('Fountain round-trips the core element types', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. KITCHEN - DAY' },
      { element: 'action', text: 'John pours coffee.' },
      { element: 'character', text: 'JOHN' },
      { element: 'parenthetical', text: '(muttering)' },
      { element: 'dialogue', text: 'One good line.' },
      { element: 'transition', text: 'CUT TO:' },
      { element: 'centered', text: 'THE END' },
    ];
    const text = S.jsonToFountain(blocks);
    const back = S.fountainToBlocks(text);
    return { text, back };
  });
  expect(r.back).toEqual([
    { element: 'scene', text: 'INT. KITCHEN - DAY' },
    { element: 'action', text: 'John pours coffee.' },
    { element: 'character', text: 'JOHN' },
    { element: 'parenthetical', text: '(muttering)' },
    { element: 'dialogue', text: 'One good line.' },
    { element: 'transition', text: 'CUT TO:' },
    { element: 'centered', text: 'THE END' },
  ]);
});

test('Courier print HTML renders paginated pages with numbers + MORE/CONT’D', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. OFFICE - DAY' },
      { element: 'action', text: 'A'.repeat(60 * 45) },
      { element: 'character', text: 'NARRATOR' },
      { element: 'dialogue', text: 'B'.repeat(35 * 20) },
    ];
    const html = S.screenplayPrintHTML(blocks, { title: 'Test' });
    const pageCount = (html.match(/class="sp-page"/g) || []).length;
    return {
      pageCount,
      courier: /Courier/i.test(html),
      hasPageNo: /class="sp-pageno">2\./.test(html),
      hasMore: /\(MORE\)/.test(html),
      hasContd: /\(CONT'D\)/.test(html),
    };
  });
  expect(r.pageCount).toBeGreaterThanOrEqual(2);
  expect(r.courier).toBe(true);
  expect(r.hasPageNo).toBe(true);
  expect(r.hasMore).toBe(true);
  expect(r.hasContd).toBe(true);
});

test('FDX round-trips with exact Final Draft Type strings', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. KITCHEN - DAY' },
      { element: 'action', text: 'John pours coffee.' },
      { element: 'character', text: 'JOHN' },
      { element: 'parenthetical', text: '(muttering)' },
      { element: 'dialogue', text: 'One good line.' },
      { element: 'transition', text: 'CUT TO:' },
      { element: 'shot', text: 'ANGLE ON THE DOOR' },
    ];
    const xml = S.jsonToFdx(blocks);
    const back = S.fdxToBlocks(xml);
    return { xml, back };
  });
  expect(r.xml).toContain('Type="Scene Heading"');
  expect(r.xml).toContain('Type="Parenthetical"');
  expect(r.back).toEqual([
    { element: 'scene', text: 'INT. KITCHEN - DAY' },
    { element: 'action', text: 'John pours coffee.' },
    { element: 'character', text: 'JOHN' },
    { element: 'parenthetical', text: '(muttering)' },
    { element: 'dialogue', text: 'One good line.' },
    { element: 'transition', text: 'CUT TO:' },
    { element: 'shot', text: 'ANGLE ON THE DOOR' },
  ]);
});
