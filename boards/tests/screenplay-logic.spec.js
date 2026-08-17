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
      emptyCharacter: S.nextOnEnter('character', true),
      emptyAction: S.nextOnEnter('action', true),
      parenthetical: S.nextOnEnter('parenthetical'),
      transition: S.nextOnEnter('transition'),
    };
  });
  expect(r.scene).toBe('action');
  expect(r.character).toBe('dialogue');
  expect(r.dialogue).toBe('character');      // dialogue → a new character cue
  expect(r.emptyCharacter).toBe('action');   // empty cue → action
  expect(r.emptyAction).toBe('scene');       // empty action → new scene heading
  expect(r.parenthetical).toBe('dialogue');
  expect(r.transition).toBe('scene');
});

test('enterDecision: split by default; escalate only inside the Enter chain', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return {
      // A clicked-into blank line (not in the chain) SPLITS — the old behavior
      // escalated in place forever and could never insert a line.
      clickedEmptyAction: S.enterDecision({ element: 'action', isEmpty: true, atEnd: true, inChain: false }),
      clickedEmptyCharacter: S.enterDecision({ element: 'character', isEmpty: true, atEnd: true, inChain: false }),
      // In the chain (the empty line came from the previous Enter) → escalate.
      chainEmptyCharacter: S.enterDecision({ element: 'character', isEmpty: true, atEnd: true, inChain: true }),
      chainEmptyAction: S.enterDecision({ element: 'action', isEmpty: true, atEnd: true, inChain: true }),
      // The ladder tops out at scene: in-chain Enter on an empty scene splits.
      chainEmptyScene: S.enterDecision({ element: 'scene', isEmpty: true, atEnd: true, inChain: true }),
      // Filled line, caret at end → the Final Draft progression.
      endOfDialogue: S.enterDecision({ element: 'dialogue', isEmpty: false, atEnd: true }),
      endOfCharacter: S.enterDecision({ element: 'character', isEmpty: false, atEnd: true }),
      // Filled line, caret at start/middle → plain break, element preserved.
      midDialogue: S.enterDecision({ element: 'dialogue', isEmpty: false, atEnd: false }),
      startOfScene: S.enterDecision({ element: 'scene', isEmpty: false, atEnd: false }),
    };
  });
  expect(r.clickedEmptyAction).toEqual({ kind: 'split', element: 'action' });
  expect(r.clickedEmptyCharacter).toEqual({ kind: 'split', element: 'character' });
  expect(r.chainEmptyCharacter).toEqual({ kind: 'escalate', element: 'action' });
  expect(r.chainEmptyAction).toEqual({ kind: 'escalate', element: 'scene' });
  expect(r.chainEmptyScene).toEqual({ kind: 'split', element: 'scene' });
  expect(r.endOfDialogue).toEqual({ kind: 'split', element: 'character' });
  expect(r.endOfCharacter).toEqual({ kind: 'split', element: 'dialogue' });
  expect(r.midDialogue).toEqual({ kind: 'split', element: 'dialogue' });
  expect(r.startOfScene).toEqual({ kind: 'split', element: 'scene' });
});

test('paginator: dual dialogue is measured at the dual column widths (29ch)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const long = Array(10).fill('abcdefghij').join(' ');  // 10-char words: 3/line at 35ch, 2/line at 29ch
    const { pages } = S.paginate([
      { element: 'character', text: 'JOHN', dual: 'left' },
      { element: 'dialogue', text: long, dual: 'left' },
      { element: 'character', text: 'MARY', dual: 'right' },
      { element: 'dialogue', text: 'Hi.', dual: 'right' },
    ]);
    const dlg = pages[0].find(f => f.element === 'dialogue' && f.dual === 'left');
    return {
      counted: dlg.lines,
      at29: S.wrapLines(long, 29).length,
      at35: S.wrapLines(long, 35).length,
    };
  });
  // Rendered at 29ch (screen CSS, print, PDF) — must be COUNTED at 29ch too.
  expect(r.at29).toBeGreaterThan(r.at35);
  expect(r.counted).toBe(r.at29);
});

test('paginator: back-to-back dual pairs are separate groups (a page can break between them)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const twoLines = `${'a'.repeat(28)} bbbb`;   // 2 lines at 29ch
    const pair = (L, R) => ([
      { element: 'character', text: L, dual: 'left' },
      { element: 'dialogue', text: twoLines, dual: 'left' },
      { element: 'character', text: R, dual: 'right' },
      { element: 'dialogue', text: 'Hi.', dual: 'right' },
    ]);
    const blocks = [
      ...Array.from({ length: 25 }, () => ({ element: 'action', text: 'x' })),  // fills 49 lines
      ...pair('JOHN', 'MARY'),
      ...pair('ANA', 'BEN'),
    ];
    const { pages } = S.paginate(blocks);
    return { p0: pages[0].length, p1: pages[1]?.length, p1first: pages[1]?.[0]?.dual };
  });
  // Pair 1 (3 lines tall) still fits page 1; pair 2 starts page 2. The old
  // merged grouping measured all four speakers as two tall columns and pushed
  // BOTH pairs to page 2.
  expect(r.p0).toBe(29);
  expect(r.p1).toBe(4);
  expect(r.p1first).toBe('left');
});

test('paginator: the (CONT\'D) carry cue occupies a line on the continuation page', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const word = 'a'.repeat(35);                       // one word = one 35ch line
    const text = Array(106).fill(word).join(' ');      // 106 dialogue lines
    const { pages, pageCount } = S.paginate([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text },
    ]);
    return {
      pageCount,
      p1: pages[1].map(f => ({ lines: f.lines, contd: f.contd || null, more: !!f.more })),
      p2: pages[2]?.map(f => ({ lines: f.lines, contd: f.contd || null })),
    };
  });
  // Page 2 holds the "JOHN (CONT'D)" cue line + 52 dialogue lines + (MORE) = 54,
  // not 54 dialogue lines under an uncounted cue (55 drawn = bottom-margin
  // overflow in the PDF).
  expect(r.pageCount).toBe(3);
  expect(r.p1).toEqual([{ lines: 52, contd: 'JOHN', more: true }]);
  expect(r.p2).toEqual([{ lines: 2, contd: 'JOHN' }]);
});

test('paginator: a block taller than a page starting a fresh page is split, not bled', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const word = 'a'.repeat(35);
    const text = Array(60).fill(word).join(' ');       // 60 action lines
    const { pages, pageCount } = S.paginate([{ element: 'action', text }]);
    return {
      pageCount,
      first: { lines: pages[0][0].lines, srcStart: pages[0][0].srcStart },
      second: { lines: pages[1]?.[0]?.lines, srcStart: pages[1]?.[0]?.srcStart },
    };
  });
  expect(r.pageCount).toBe(2);
  expect(r.first).toEqual({ lines: 54, srcStart: 0 });
  expect(r.second.lines).toBe(6);
  expect(r.second.srcStart).toBeGreaterThan(0);
});

test('paginator: auto (CONT\'D) on a long cue is counted in the cue\'s wrap', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const cue = 'DETECTIVE MARGARET HOLLOWAY-REID';   // 32 chars; +9 for " (CONT'D)" wraps at 38
    const { pages } = S.paginate([
      { element: 'character', text: cue },
      { element: 'dialogue', text: 'First.' },
      { element: 'action', text: 'A beat.' },
      { element: 'character', text: cue },
      { element: 'dialogue', text: 'Again.' },
    ]);
    const cues = pages[0].filter(f => f.element === 'character').map(f => f.lines);
    return { cues };
  });
  // First cue: 1 line. Resuming cue renders "… (CONT'D)" → 2 lines at 38ch.
  expect(r.cues).toEqual([1, 2]);
});

test('Fountain round-trip: centered after a speech, blank dialogue lines, shots', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'shot', text: 'TIGHT ON HER HANDS' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'One.' },
      { element: 'dialogue', text: '' },          // deliberate blank beat
      { element: 'dialogue', text: 'Two.' },
      { element: 'centered', text: 'THE END' },   // right after the speech
    ];
    return S.fountainToBlocks(S.jsonToFountain(blocks));
  });
  expect(r).toEqual([
    { element: 'scene', text: 'INT. ROOM - DAY' },
    { element: 'shot', text: 'TIGHT ON HER HANDS' },
    { element: 'character', text: 'JOHN' },
    { element: 'dialogue', text: 'One.' },
    { element: 'dialogue', text: '' },
    { element: 'dialogue', text: 'Two.' },
    { element: 'centered', text: 'THE END' },     // was swallowed into the dialogue
  ]);
});

test('page breaks between doc pages survive export (Fountain === / paginator / doc JSON)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. A - DAY' },
      { element: 'action', text: 'First page.' },
      { element: 'pagebreak', text: '' },
      { element: 'scene', text: 'INT. B - DAY' },
    ];
    const fountain = S.jsonToFountain(blocks);
    const { pages, pageCount } = S.paginate(blocks);
    return {
      fountainHasBreak: /\n===\n/.test(fountain),
      roundTrip: S.fountainToBlocks(fountain),
      pageCount,
      page2First: pages[1]?.[0]?.text,
      docRoundTrip: S.docJSONToBlocks(S.blocksToDocJSON(blocks)),
    };
  });
  expect(r.fountainHasBreak).toBe(true);
  expect(r.roundTrip).toEqual([
    { element: 'scene', text: 'INT. A - DAY' },
    { element: 'action', text: 'First page.' },
    { element: 'pagebreak', text: '' },
    { element: 'scene', text: 'INT. B - DAY' },
  ]);
  expect(r.pageCount).toBe(2);
  expect(r.page2First).toBe('INT. B - DAY');
  expect(r.docRoundTrip).toEqual([
    { element: 'scene', text: 'INT. A - DAY' },
    { element: 'action', text: 'First page.' },
    { element: 'pagebreak', text: '' },
    { element: 'scene', text: 'INT. B - DAY' },
  ]);
});

test('FDX: back-to-back dual pairs export as two DualDialogue wrappers', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const pair = (L, R, lt, rt) => ([
      { element: 'character', text: L, dual: 'left' },
      { element: 'dialogue', text: lt, dual: 'left' },
      { element: 'character', text: R, dual: 'right' },
      { element: 'dialogue', text: rt, dual: 'right' },
    ]);
    const blocks = [...pair('JOHN', 'MARY', 'Hey.', 'Hi.'), ...pair('ANA', 'BEN', 'Yes.', 'No.')];
    const xml = S.jsonToFdx(blocks);
    return {
      wrappers: (xml.match(/<DualDialogue>/g) || []).length,
      back: S.fdxToBlocks(xml).map(b => `${b.element}:${b.dual}`),
    };
  });
  expect(r.wrappers).toBe(2);
  expect(r.back).toEqual([
    'character:left', 'dialogue:left', 'character:right', 'dialogue:right',
    'character:left', 'dialogue:left', 'character:right', 'dialogue:right',
  ]);
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

test('auto (CONT’D): same speaker resuming after action is marked, a new speaker resets it', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN' },          // 1
      { element: 'dialogue', text: 'Hello.' },
      { element: 'action', text: 'He pauses.' },
      { element: 'character', text: 'JOHN' },          // 4 → CONT'D (same speaker after action)
      { element: 'dialogue', text: 'Still here.' },
      { element: 'character', text: 'MARY' },          // 6 → not contd
      { element: 'dialogue', text: 'Hi.' },
      { element: 'character', text: 'JOHN' },          // 8 → not contd (MARY spoke between)
      { element: 'scene', text: 'EXT. PARK - NIGHT' },
      { element: 'character', text: 'JOHN' },          // 10 → not contd (scene reset)
    ];
    const set = [...S.computeAutoContd(blocks)];
    return {
      set,
      display4: S.characterCueDisplay('JOHN', true),
      displayNone: S.characterCueDisplay('JOHN', false),
      displayExisting: S.characterCueDisplay("JOHN (CONT'D)", true),
    };
  });
  expect(r.set).toEqual([4]);
  expect(r.display4).toBe("JOHN (CONT'D)");
  expect(r.displayNone).toBe('JOHN');
  expect(r.displayExisting).toBe("JOHN (CONT'D)"); // not doubled
});

test('print marks a resuming character cue with (CONT’D)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const html = S.screenplayPrintHTML([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hello.' },
      { element: 'action', text: 'A beat.' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Still talking.' },
    ], { title: 'T' });
    // The apostrophe is HTML-escaped in the print output.
    return { count: (html.match(/JOHN \(CONT(?:&#39;|')D\)/g) || []).length };
  });
  expect(r.count).toBe(1); // only the resuming cue
});

test('smart break: a character cue never strands at the bottom of a page', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // Fill the page so only ~1 line is left, then a cue + multi-line dialogue.
    const blocks = [
      { element: 'action', text: 'A'.repeat(60 * 54) }, // fills the page (54 lines)
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: ('word ').repeat(35 * 4).trim() }, // 4 lines
    ];
    const res = S.paginate(blocks);
    const page1 = res.pages[0];
    const last = page1[page1.length - 1];
    const page2 = res.pages[1] || [];
    return { pageCount: res.pageCount, lastEl: last.element, cueOnPage2: page2.some(f => f.element === 'character') };
  });
  expect(r.pageCount).toBeGreaterThanOrEqual(2);
  expect(r.lastEl).not.toBe('character'); // cue moved to page 2 with its dialogue
  expect(r.cueOnPage2).toBe(true);
});

test('scene numbers: auto by order, and locked numbers give inserts A/B suffixes', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // Auto: number by order.
    const auto = S.computeSceneNumbers([
      { element: 'scene' }, { element: 'action' }, { element: 'scene' }, { element: 'scene' },
    ]);
    // Locked: scenes 1 and 2 stamped; a scene inserted between them is 1A.
    const locked = S.computeSceneNumbers([
      { element: 'scene', sceneNumber: '1' },
      { element: 'scene' },                       // inserted after #1 → 1A
      { element: 'scene' },                       // → 1B
      { element: 'scene', sceneNumber: '2' },
    ]);
    return { auto: [...auto.values()], locked: [...locked.values()] };
  });
  expect(r.auto).toEqual(['1', '2', '3']); // action ignored
  expect(r.locked).toEqual(['1', '1A', '1B', '2']);
});

test('FDX round-trips locked scene numbers via the Number attribute', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. A - DAY', sceneNumber: '1' },
      { element: 'action', text: 'Stuff.' },
      { element: 'scene', text: 'EXT. B - NIGHT', sceneNumber: '2A' },
    ];
    const xml = S.jsonToFdx(blocks);
    const back = S.fdxToBlocks(xml);
    return { hasNum: /Number="2A"/.test(xml), back };
  });
  expect(r.hasNum).toBe(true);
  expect(r.back[0]).toMatchObject({ element: 'scene', sceneNumber: '1' });
  expect(r.back[2]).toMatchObject({ element: 'scene', sceneNumber: '2A' });
});

test('print renders scene numbers in the gutters when enabled', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [{ element: 'scene', text: 'INT. A - DAY' }, { element: 'action', text: 'x' }, { element: 'scene', text: 'EXT. B - DAY' }];
    const on = S.screenplayPrintHTML(blocks, { title: 'T', sceneNumbers: true });
    const off = S.screenplayPrintHTML(blocks, { title: 'T', sceneNumbers: false });
    return {
      onClass: /<body class="sp-show-nums">/.test(on),
      onNums: (on.match(/data-scene-number="/g) || []).length,
      offClass: /<body class="">/.test(off),
    };
  });
  expect(r.onClass).toBe(true);
  expect(r.onNums).toBe(2); // two scene headings
  expect(r.offClass).toBe(true);
});

test('dual dialogue round-trips through Fountain via the ^ caret', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN', dual: 'left' },
      { element: 'dialogue', text: 'Hello.', dual: 'left' },
      { element: 'character', text: 'MARY', dual: 'right' },
      { element: 'dialogue', text: 'Hi.', dual: 'right' },
    ];
    const f = S.jsonToFountain(blocks);
    const back = S.fountainToBlocks(f);
    return {
      hasCaret: /MARY \^/.test(f),
      noCaretOnFirst: !/JOHN \^/.test(f),
      back: back.map(b => ({ element: b.element, text: b.text, dual: b.dual || null })),
    };
  });
  expect(r.hasCaret).toBe(true);
  expect(r.noCaretOnFirst).toBe(true);
  expect(r.back).toEqual([
    { element: 'scene', text: 'INT. ROOM - DAY', dual: null },
    { element: 'character', text: 'JOHN', dual: 'left' },
    { element: 'dialogue', text: 'Hello.', dual: 'left' },
    { element: 'character', text: 'MARY', dual: 'right' },
    { element: 'dialogue', text: 'Hi.', dual: 'right' },
  ]);
});

test('dual dialogue round-trips through FDX with the <DualDialogue> wrapper', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN', dual: 'left' },
      { element: 'parenthetical', text: '(angry)', dual: 'left' },
      { element: 'dialogue', text: 'Hello.', dual: 'left' },
      { element: 'character', text: 'MARY', dual: 'right' },
      { element: 'dialogue', text: 'Hi.', dual: 'right' },
      { element: 'transition', text: 'CUT TO:' },
    ];
    const xml = S.jsonToFdx(blocks);
    const back = S.fdxToBlocks(xml);
    return {
      // Wrapped exactly like a real Final Draft file.
      hasWrapper: /<Paragraph>\s*<DualDialogue>/.test(xml),
      closes: /<\/DualDialogue>\s*<\/Paragraph>/.test(xml),
      back: back.map(b => ({ element: b.element, text: b.text, dual: b.dual || null })),
    };
  });
  expect(r.hasWrapper).toBe(true);
  expect(r.closes).toBe(true);
  expect(r.back).toEqual([
    { element: 'scene', text: 'INT. ROOM - DAY', dual: null },
    { element: 'character', text: 'JOHN', dual: 'left' },
    { element: 'parenthetical', text: '(angry)', dual: 'left' },
    { element: 'dialogue', text: 'Hello.', dual: 'left' },
    { element: 'character', text: 'MARY', dual: 'right' },
    { element: 'dialogue', text: 'Hi.', dual: 'right' },
    { element: 'transition', text: 'CUT TO:', dual: null },
  ]);
});

test('imports dual dialogue from a real Final Draft <DualDialogue> block', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // The Brick & Steel sample shape: a wrapping <Paragraph> around DualDialogue.
    const xml = `<?xml version="1.0"?>
<FinalDraft DocumentType="Script" Version="5">
 <Content>
  <Paragraph Type="Action"><Text>The men look at each other.</Text></Paragraph>
  <Paragraph>
   <DualDialogue>
    <Paragraph Type="Character"><Text>STEEL</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Screw retirement.</Text></Paragraph>
    <Paragraph Type="Character"><Text>BRICK</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text>Screw retirement.</Text></Paragraph>
   </DualDialogue>
  </Paragraph>
  <Paragraph Type="Transition"><Text>SMASH CUT TO:</Text></Paragraph>
 </Content>
</FinalDraft>`;
    return S.fdxToBlocks(xml).map(b => ({ element: b.element, text: b.text, dual: b.dual || null }));
  });
  expect(r).toEqual([
    { element: 'action', text: 'The men look at each other.', dual: null },
    { element: 'character', text: 'STEEL', dual: 'left' },
    { element: 'dialogue', text: 'Screw retirement.', dual: 'left' },
    { element: 'character', text: 'BRICK', dual: 'right' },
    { element: 'dialogue', text: 'Screw retirement.', dual: 'right' },
    { element: 'transition', text: 'SMASH CUT TO:', dual: null },
  ]);
});

test('paginator keeps a dual-dialogue pair together and counts the taller column', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // Fill near the page bottom, then a dual pair (left 2 lines / right 5 lines).
    const blocks = [
      { element: 'action', text: 'A'.repeat(60 * 50) },        // 50 lines
      { element: 'character', text: 'JOHN', dual: 'left' },
      { element: 'dialogue', text: ('word ').repeat(35 * 2).trim(), dual: 'left' },
      { element: 'character', text: 'MARY', dual: 'right' },
      { element: 'dialogue', text: ('talk ').repeat(35 * 5).trim(), dual: 'right' },
    ];
    const res = S.paginate(blocks);
    // The 4 dual fragments must all land on the SAME page (never split).
    const pageOf = {};
    res.pages.forEach((frags, p) => frags.forEach(f => { if (f.dual) pageOf[f.index] = p; }));
    const dualPages = [pageOf[1], pageOf[2], pageOf[3], pageOf[4]];
    return { pageCount: res.pageCount, allSamePage: new Set(dualPages).size === 1, dualPages };
  });
  expect(r.pageCount).toBeGreaterThanOrEqual(2); // the pair didn't fit after 50 lines → moved
  expect(r.allSamePage).toBe(true);
});

test('Fountain title page round-trips and never bleeds into the body', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const tp = {
      enabled: true,
      title: 'THE TITLE',
      credit: 'Written by',
      authors: 'Andrew Conklin',
      draftDate: 'First Draft 6/17/26',
      contact: 'arconkli@gmail.com\n123 Main St',
    };
    const blocks = [
      { element: 'scene', text: 'INT. KITCHEN - DAY' },
      { element: 'action', text: 'John pours coffee.' },
    ];
    const text = S.jsonToFountain(blocks, tp);
    const parsed = S.parseFountainTitlePage(text);
    const body = S.fountainToBlocks(parsed.body);
    return { text, tp: parsed.titlePage, body };
  });
  // The title block is emitted before the body and parses back into fields.
  expect(r.text.startsWith('Title: THE TITLE')).toBe(true);
  expect(r.tp).toMatchObject({
    enabled: true, title: 'THE TITLE', credit: 'Written by', authors: 'Andrew Conklin',
    draftDate: 'First Draft 6/17/26', contact: 'arconkli@gmail.com\n123 Main St',
  });
  // Body is exactly the script — no title-page lines leaked in as action.
  expect(r.body).toEqual([
    { element: 'scene', text: 'INT. KITCHEN - DAY' },
    { element: 'action', text: 'John pours coffee.' },
  ]);
});

test('a screenplay starting with a colon line is NOT mistaken for a title page', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const parsed = S.parseFountainTitlePage('FADE IN:\n\nINT. HOUSE - DAY\n');
    return parsed;
  });
  expect(r.titlePage).toBe(null);
  expect(r.body).toContain('FADE IN:');
});

test('FDX <TitlePage> exports + imports and does NOT fold into the body (regression)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const tp = { enabled: true, title: 'THE TITLE', credit: 'Written by', authors: 'Andrew Conklin', draftDate: '6/17/26', contact: 'me@example.com' };
    const blocks = [
      { element: 'scene', text: 'INT. KITCHEN - DAY' },
      { element: 'action', text: 'John pours coffee.' },
    ];
    const xml = S.jsonToFdx(blocks, tp);
    const back = S.fdxToBlocks(xml);
    const tpBack = S.fdxToTitlePage(xml);
    return { xml, back, tpBack };
  });
  expect(r.xml).toContain('<TitlePage>');
  // The body has exactly the 2 script paragraphs — title-page paragraphs are
  // scoped out (this was the folding bug).
  expect(r.back).toEqual([
    { element: 'scene', text: 'INT. KITCHEN - DAY' },
    { element: 'action', text: 'John pours coffee.' },
  ]);
  expect(r.tpBack).toMatchObject({ enabled: true, title: 'THE TITLE', credit: 'Written by', authors: 'Andrew Conklin' });
});

test('print HTML prepends a full title page section when enabled', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const blocks = [{ element: 'scene', text: 'INT. KITCHEN - DAY' }, { element: 'action', text: 'Hi.' }];
    const html = S.screenplayPrintHTML(blocks, { title: 'Test', titlePage: { enabled: true, title: 'THE TITLE', credit: 'Written by', authors: 'A. C.' } });
    const off = S.screenplayPrintHTML(blocks, { title: 'Test', titlePage: { enabled: false, title: 'x' } });
    const SECTION = '<section class="sp-page sp-title-page">';
    return {
      hasTitlePage: html.includes(SECTION),
      titleText: /THE TITLE/.test(html),
      // The title page section comes before the first script page.
      tpBeforeBody: html.indexOf(SECTION) < html.indexOf('INT. KITCHEN'),
      offHasNone: !off.includes(SECTION),
    };
  });
  expect(r.hasTitlePage).toBe(true);
  expect(r.titleText).toBe(true);
  expect(r.tpBeforeBody).toBe(true);
  expect(r.offHasNone).toBe(true);
});

test('IO fixes: centered round-trips through FDX, and shots import from Fountain', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // centered → FDX Alignment="Center" → back to centered
    const xml = S.jsonToFdx([{ element: 'centered', text: 'THE END' }]);
    const back = S.fdxToBlocks(xml);
    // shot heuristic on Fountain import
    const shots = S.fountainToBlocks('INT. ROOM - DAY\n\nANGLE ON THE DOOR\n\nIt creaks open.\n');
    return {
      xmlHasCenter: /Alignment="Center"/.test(xml),
      back0: back[0],
      shotEl: (shots.find(b => /ANGLE/.test(b.text)) || {}).element,
    };
  });
  expect(r.xmlHasCenter).toBe(true);
  expect(r.back0).toEqual({ element: 'centered', text: 'THE END' });
  expect(r.shotEl).toBe('shot');
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

test('detectElementFromText promotes an action line to a scene heading or transition', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return {
      intLower: S.detectElementFromText('action', 'int. '),
      ext: S.detectElementFromText('action', 'EXT. STREET'),
      intExt: S.detectElementFromText('action', 'int./ext. car - day'),
      ie: S.detectElementFromText('action', 'i/e car - day'),
      cutLower: S.detectElementFromText('action', 'cut to:'),
      dissolve: S.detectElementFromText('action', 'DISSOLVE TO:'),
      plainAction: S.detectElementFromText('action', 'He walks to the door.'),
      interior: S.detectElementFromText('action', 'Interior thoughts race.'),
      notFromScene: S.detectElementFromText('scene', 'int. '),
      notFromChar: S.detectElementFromText('character', 'CUT TO:'),
    };
  });
  expect(r.intLower).toBe('scene');
  expect(r.ext).toBe('scene');
  expect(r.intExt).toBe('scene');
  expect(r.ie).toBe('scene');
  expect(r.cutLower).toBe('transition');
  expect(r.dissolve).toBe('transition');
  expect(r.plainAction).toBe(null);
  expect(r.interior).toBe(null);     // "Interior…" must NOT be mistaken for INT.
  expect(r.notFromScene).toBe(null); // only promotes FROM action
  expect(r.notFromChar).toBe(null);
});

test('collectCharacterNamesByFrequency orders the cast by how often they speak', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const doc = S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'a' },
      { element: 'character', text: 'MARY' },
      { element: 'dialogue', text: 'b' },
      { element: 'character', text: "JOHN (V.O.)" },   // folds into JOHN
      { element: 'dialogue', text: 'c' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'd' },
    ]);
    return {
      byFreq: S.collectCharacterNamesByFrequency(doc),
      alpha: S.collectCharacterNames(doc),
    };
  });
  expect(r.byFreq).toEqual(['JOHN', 'MARY']);  // JOHN×3 before MARY×1
  expect(r.alpha).toEqual(['JOHN', 'MARY']);   // alphabetical collector still sorted
});

test('EXTENSIONS + TRANSITIONS are shared from screenplayFlow (one source)', async ({ page }) => {
  const r = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return { ext: S.EXTENSIONS, trans: S.TRANSITIONS };
  });
  expect(r.ext).toEqual(expect.arrayContaining(['(V.O.)', '(O.S.)', "(CONT'D)"]));
  expect(r.trans).toEqual(expect.arrayContaining(['CUT TO:', 'DISSOLVE TO:']));
});
