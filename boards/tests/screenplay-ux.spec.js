// Real-editor screenplay tests in the ?docqa=1 harness: toggling screenplay
// mode, the Courier layout class, Tab/Enter element cycling, and auto-uppercase.

import { expect, test } from '@playwright/test';

async function openDoc(page) {
  await page.goto('/?docqa=1');
  await page.waitForFunction(() => !!window.__soleilDocTest, null, { timeout: 15000 });
  await page.evaluate(() => window.__soleilDocTest.openCard());
  await expect(page.locator('.doc-card-modal')).toBeVisible();
  await expect(page.locator('.tt-editor').first()).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilDocTest.editor, null, { timeout: 10000 });
}

async function enableScreenplay(page) {
  await page.locator('.doc-tb-screenplay-toggle').click();
  await expect(page.locator('.doc-paper.is-screenplay')).toBeVisible();
  // Editor rebuilds on mode change — wait for the re-handed live editor + the
  // seeded scene block.
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toBeVisible({ timeout: 10000 });
  // CRITICAL under parallel load: the bridge's `editor` handle is re-handed a
  // tick AFTER the rebuilt editor mounts. A setContent fired before that goes
  // into the DYING prose editor and silently vanishes — wait until the bridge
  // editor is the screenplay one.
  await page.waitForFunction(() =>
    window.__soleilDocTest.editor?.state?.doc?.firstChild?.type?.name === 'screenplayBlock',
  null, { timeout: 10000 });
}

test('toggling screenplay mode seeds a Scene Heading + Courier layout', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const font = await page.evaluate(() => {
    const pm = document.querySelector('.doc-paper.is-screenplay .ProseMirror');
    return getComputedStyle(pm).fontFamily.toLowerCase();
  });
  expect(font).toContain('courier');
  // Persisted mode in the data layer.
  const mode = await page.evaluate(() =>
    window.__soleilDocTest.getDocMode(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()));
  expect(mode).toBe('screenplay');
});

test('the Screenplay toggle is a labeled pill that does not overlap its toolbar neighbors', async ({ page }) => {
  await openDoc(page);
  // The toggle exists in both modes; check it in prose mode (where the `+`
  // button and the heading <select> flank it) and again in screenplay mode.
  const toggle = page.locator('.doc-tb-screenplay-toggle');
  await expect(toggle).toBeVisible();
  // It's rendered as a real-width pill (icon + word), not the 28px square.
  await expect(toggle).toHaveClass(/doc-tb-pill/);

  const rects = async () => page.evaluate(() => {
    const tb = document.querySelector('.doc-tb');
    const toggle = tb.querySelector('.doc-tb-screenplay-toggle');
    const plus = tb.querySelector('button[aria-label="Insert a block"]');
    const select = tb.querySelector('.doc-tb-select');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
    return { toggle: r(toggle), plus: r(plus), select: r(select) };
  });

  const before = await rects();
  // The pill is wider than a 28px icon button — proof the label has room.
  expect(before.toggle.width).toBeGreaterThan(40);
  // No horizontal overlap with the `+` button (left) or the <select> (right).
  expect(before.toggle.left).toBeGreaterThanOrEqual(before.plus.right - 0.5);
  expect(before.select.left).toBeGreaterThanOrEqual(before.toggle.right - 0.5);

  // In screenplay mode the "+" is gone (the element <select> is the inserter),
  // so just confirm the toggle still doesn't overlap that <select> to its right.
  await enableScreenplay(page);
  const after = await rects();
  expect(after.plus).toBeNull();
  expect(after.toggle.width).toBeGreaterThan(40);
  expect(after.select.left).toBeGreaterThanOrEqual(after.toggle.right - 0.5);
});

test('Title Page toggle adds an editable on-page title page that persists', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);

  // The toolbar exposes a screenplay-only Title Page pill.
  const tpToggle = page.locator('.doc-tb-titlepage-toggle');
  await expect(tpToggle).toBeVisible();
  await tpToggle.click();

  // A real on-page title page appears as the first sheet.
  const titlePage = page.locator('.doc-card-modal .sp-title-page');
  await expect(titlePage).toBeVisible();

  // Type directly on the title field.
  const titleField = titlePage.locator('.sp-tp-title');
  await titleField.click();
  await titleField.fill('MY GREAT SCRIPT');
  // Blur to flush the commit.
  await titlePage.locator('.sp-tp-authors').click();
  await titlePage.locator('.sp-tp-authors').fill('Andrew Conklin');
  await page.locator('.doc-paper').click({ position: { x: 5, y: 5 } });

  // Persisted into docMeta.
  const tp = await page.evaluate(() =>
    window.__soleilDocTest.getTitlePage(window.__soleilDocTest.ydoc, window.__soleilDocTest.getScope()));
  expect(tp.enabled).toBe(true);
  expect(tp.title).toBe('MY GREAT SCRIPT');
  expect(tp.authors).toBe('Andrew Conklin');

  // Toggling it off removes the page.
  await tpToggle.click();
  await expect(titlePage).toHaveCount(0);
});

test('Tab/Enter cycle elements and scene/character lines auto-uppercase', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);

  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();

  // Scene heading auto-uppercases.
  await page.keyboard.type('int. kitchen - day');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toHaveText('INT. KITCHEN - DAY');

  // Enter → action (not uppercased).
  await page.keyboard.press('Enter');
  await page.keyboard.type('John enters.');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="action"]').first()).toHaveText('John enters.');

  // Tab cycles action → character; character auto-uppercases.
  await page.keyboard.press('Enter');           // new action line
  await page.keyboard.press('Tab');             // action → character
  await page.keyboard.type('mary');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="character"]').first()).toHaveText('MARY');

  // Enter → dialogue (not uppercased).
  await page.keyboard.press('Enter');
  await page.keyboard.type('Hello there.');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first()).toHaveText('Hello there.');
});

test('deleting everything leaves an editable Scene Heading (not a dead paragraph)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'action', text: 'Some action.' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hi.' },
    ]));
    // Select-all + delete — the user's "deleted everything".
    window.__soleilDocTest.editor.chain().focus().selectAll().deleteSelection().run();
  });
  // The doc must NOT collapse to a plain paragraph: it's restored to one empty
  // Scene Heading so the toolbar + Enter keep working.
  const state = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const json = ed.getJSON();
    const first = json.content && json.content[0];
    return {
      count: (json.content || []).length,
      firstType: first?.type,
      firstEl: first?.attrs?.element,
      activeSp: ed.isActive('screenplayBlock'),
    };
  });
  expect(state.count).toBe(1);
  expect(state.firstType).toBe('screenplayBlock');
  expect(state.firstEl).toBe('scene');
  expect(state.activeSp).toBe(true);
  // The element selector is live again (not grayed out).
  await expect(page.locator('.doc-card-modal .doc-tb-select')).toBeEnabled();
  // And typing/auto-format works — a slugline forms inside a screenplayBlock.
  await page.locator('.doc-card-modal .tt-editor').first().click();
  await page.keyboard.type('ext. street - night');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first())
    .toHaveText('EXT. STREET - NIGHT');
});

test('scene navigator lists scene headings and jumps to them', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. COFFEE SHOP - DAY' },
      { element: 'action', text: 'x' },
      { element: 'scene', text: 'EXT. PARK - NIGHT' },
      { element: 'action', text: 'y' },
    ]));
  });
  const nav = page.locator('.sp-scenenav');
  await expect(nav).toBeVisible();
  await expect(nav.locator('.sp-scenenav-item')).toHaveCount(2);
  await expect(nav.locator('.sp-scenenav-item').first()).toContainText('COFFEE SHOP');
  // Clicking a scene moves the caret into that scene.
  await nav.locator('.sp-scenenav-item').nth(1).click();
  const inScene2 = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const $from = ed.state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      const n = $from.node(d);
      if (n.type.name === 'screenplayBlock') return n.textContent;
    }
    return null;
  });
  expect(inScene2).toContain('PARK');
});

test('scene navigator numbering matches the gutters when numbers are locked', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    // First scene carries a LOCKED number (as after an FDX import) — the
    // engine then numbers the inserted second scene 1A, not 2.
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. A - DAY', sceneNumber: '1' },
      { element: 'action', text: 'x' },
      { element: 'scene', text: 'EXT. B - NIGHT' },
    ]));
  });
  // Decorations render a tick after setContent, and the rail re-renders a
  // React tick after THAT — poll both instead of single-shot reads.
  await expect.poll(async () => page.$$eval('.doc-paper.is-screenplay [data-scene-number]',
    els => els.map(e => e.getAttribute('data-scene-number')))).toEqual(['1', '1A']);
  // The rail used a naive ordinal → showed 1, 2.
  await expect.poll(async () => page.$$eval('.sp-scenenav .sp-scenenav-num',
    els => els.map(e => e.textContent))).toEqual(['1', '1A']);
});

test('the Dual button is a no-op when the caret is not inside a speech', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hello.' },
      { element: 'character', text: 'MARY' },
      { element: 'dialogue', text: 'Hi.' },
      { element: 'action', text: 'They stare at each other.' },
    ]));
    // Caret on the ACTION line after the exchange.
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => { if (node.attrs?.element === 'action') pos = p + 1; });
    ed.chain().focus().setTextSelection(pos).run();
  });
  await page.locator('button[title^="Dual dialogue"]').click();
  // The two speeches above must NOT have been silently paired.
  await expect(page.locator('.doc-paper.is-screenplay [data-dual]')).toHaveCount(0);
});

test('the Scene # pill toggles scene numbers off and on', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. A - DAY' },
      { element: 'action', text: 'x' },
      { element: 'scene', text: 'EXT. B - NIGHT' },
    ]));
  });
  const pill = page.locator('.doc-tb-scenenum-toggle');
  // On by default → pill active, gutters numbered 1, 2.
  await expect(pill).toHaveClass(/is-active/);
  await expect(page.locator('.doc-paper.show-scene-numbers')).toBeVisible();
  const nums = await page.$$eval('.doc-paper.is-screenplay [data-scene-number]', els => els.map(e => e.getAttribute('data-scene-number')));
  expect(nums).toEqual(['1', '2']);
  // One click hides them.
  await pill.click();
  await expect(pill).not.toHaveClass(/is-active/);
  await expect(page.locator('.doc-paper.show-scene-numbers')).toHaveCount(0);
  // Click again shows them.
  await pill.click();
  await expect(page.locator('.doc-paper.show-scene-numbers')).toBeVisible();
});

test('scene numbers show by default at each scene heading, placed in the margin', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. A - DAY' },
      { element: 'action', text: 'x' },
      { element: 'scene', text: 'EXT. B - NIGHT' },
    ]));
  });
  // No toolbar interaction — numbers are ON by default.
  await expect(page.locator('.doc-paper.show-scene-numbers')).toBeVisible();
  const nums = await page.$$eval('.doc-paper.is-screenplay [data-scene-number]',
    els => els.map(e => e.getAttribute('data-scene-number')));
  expect(nums).toEqual(['1', '2']);
  // The left gutter number sits IN the margin, not jammed at the page edge: its
  // ::before `left` is negative but within ~1in of the slugline (-0.5in ≈ -48px;
  // the old -1.4in ≈ -134px would fail this).
  const beforeLeftPx = await page.evaluate(() => {
    const el = document.querySelector('.doc-paper.is-screenplay [data-scene-number]');
    return parseFloat(getComputedStyle(el, '::before').left);
  });
  expect(beforeLeftPx).toBeLessThan(0);
  expect(beforeLeftPx).toBeGreaterThan(-96);
});

test('Dual button pairs two speeches and renders them side by side', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'action', text: 'They face off.' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hello there.' },
      { element: 'character', text: 'MARY' },
      { element: 'dialogue', text: 'Hi yourself.' },
    ]));
    // Put the caret in the second speech (MARY).
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => { if (node.attrs?.element === 'character' && node.textContent === 'MARY') pos = p + 1; });
    if (pos != null) ed.commands.setTextSelection(pos);
  });
  await page.locator('button[title^="Dual dialogue"]').click();

  // Both cues now carry left/right and top-align into two columns.
  const cues = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.doc-paper.is-screenplay [data-dual][data-screenplay-element="character"]')];
    return els.map(e => ({ dual: e.getAttribute('data-dual'), top: Math.round(e.getBoundingClientRect().top), left: Math.round(e.getBoundingClientRect().left) }));
  });
  expect(cues.length).toBe(2);
  expect(cues.map(c => c.dual)).toEqual(['left', 'right']);
  expect(Math.abs(cues[0].top - cues[1].top)).toBeLessThanOrEqual(2); // top-aligned
  expect(cues[1].left).toBeGreaterThan(cues[0].left);                  // right column
});

test('on-screen auto (CONT’D) appears on a resuming character cue', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hello.' },
      { element: 'action', text: 'A beat.' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Still here.' },
    ]));
  });
  const contd = page.locator('.doc-paper.is-screenplay .sp-auto-contd');
  await expect(contd).toHaveCount(1);
  await expect(contd).toContainText("(CONT'D)");
});

test('a long screenplay shows on-screen page-break markers', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  // Load enough script to exceed one 54-line page.
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const ed = window.__soleilDocTest.editor;
    const blocks = [{ element: 'scene', text: 'INT. OFFICE - DAY' }];
    for (let i = 0; i < 90; i++) blocks.push({ element: 'action', text: 'The clock ticks forward another beat.' });
    ed.chain().focus().setContent(S.blocksToDocJSON(blocks)).run();
  });
  await expect(page.locator('.doc-card-modal .sp-page-break').first()).toBeVisible({ timeout: 5000 });
  // Page label reads "Page 2" on the first break.
  await expect(page.locator('.doc-card-modal .sp-page-break-rule[data-page="2"]').first()).toBeAttached();
});

test('(MORE) appears at page breaks only for split dialogue, never split action', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  // A giant ACTION block spanning the page boundary: break marker, no (MORE).
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const text = Array(120).fill('The clock ticks forward once more here.').join(' ');
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. OFFICE - DAY' },
      { element: 'action', text },
    ]));
  });
  await expect(page.locator('.doc-card-modal .sp-page-break').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.doc-card-modal .sp-page-break-more')).toHaveCount(0);
  // A giant DIALOGUE block: (MORE) below, "JOHN (CONT'D)" above the fold.
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const text = Array(120).fill('I am still talking and talking.').join(' ');
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text },
    ]));
  });
  await expect(page.locator('.doc-card-modal .sp-page-break-more').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.doc-card-modal .sp-page-break-contd').first()).toContainText("JOHN (CONT'D)");
});

test('character-name autocomplete suggests + completes a known name', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();

  // Establish a character (MARGARET) earlier in the script.
  await page.keyboard.type('int. room - day');
  await page.keyboard.press('Enter');           // action
  await page.keyboard.press('Tab');             // → character
  await page.keyboard.type('margaret');
  await page.keyboard.press('Enter');           // → dialogue
  await page.keyboard.type('Hello.');
  await page.keyboard.press('Enter');           // dialogue → new character cue
  await page.keyboard.type('mar');

  // Popup offers MARGARET; Enter accepts it.
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'MARGARET' })).toBeVisible();
  await page.keyboard.press('Enter');
  // The completed cue STORES "MARGARET" (the resuming cue also renders an auto
  // "(CONT'D)" widget, so assert the stored text, not the rendered textContent).
  const lastCue = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const cues = S.docJSONToBlocks(window.__soleilDocTest.editor.getJSON()).filter(b => b.element === 'character');
    return cues[cues.length - 1].text;
  });
  expect(lastCue).toBe('MARGARET');
});

test('character autocomplete offers (V.O.)/(O.S.) extensions after a name', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setScreenplayElement('character').run());
  await page.keyboard.type('john '); // name + trailing space → extension stage
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'V.O.' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="character"]').first()).toContainText('(V.O.)');
  // Dedup: with an extension already on the cue, a trailing space must NOT
  // re-offer one (no "(V.O.) (V.O.)") — the popup stays closed.
  await page.keyboard.type(' ');
  await expect(page.locator('.sp-autocomplete.is-open')).toHaveCount(0);
});

test('a new character cue suggests most-used characters first', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN' }, { element: 'dialogue', text: 'a' },
      { element: 'character', text: 'MARY' }, { element: 'dialogue', text: 'b' },
      { element: 'character', text: 'JOHN' }, { element: 'dialogue', text: 'c' },
      { element: 'character', text: 'JOHN' }, { element: 'dialogue', text: 'last' },
    ]));
  });
  // Dialogue + Enter → a new character cue; the cast popup lists most-used first.
  await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  const items = await page.$$eval('.sp-autocomplete-item', els => els.map(e => e.textContent));
  expect(items[0]).toBe('JOHN');     // JOHN×3 ranks above MARY×1
  expect(items).toContain('MARY');
});

test('scene-heading autocomplete offers an INT./EXT. prefix', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.keyboard.type('ex'); // seeded first block is a Scene Heading
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'EXT.' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toContainText('EXT.');
});

test('transition autocomplete offers common transitions', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setScreenplayElement('transition').run());
  await page.keyboard.type('diss');
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'DISSOLVE TO:' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="transition"]').first()).toContainText('DISSOLVE TO:');
});

test('Tab on an empty line cycles the element even while the hint popup is open', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  // The seeded empty Scene Heading proactively opens the INT./EXT. hint popup.
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  // Tab must CYCLE the element (scene → action), not type "INT. " into the line.
  await page.keyboard.press('Tab');
  expect(await caretElement(page)).toBe('action');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="action"]').first()).toHaveText('');
  // Shift-Tab cycles backward (action → scene) instead of accepting anything.
  await page.keyboard.press('Shift+Tab');
  expect(await caretElement(page)).toBe('scene');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]').first()).toHaveText('');
});

test('Tab accepts a suggestion once the user has arrowed to it', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hi.' },
      { element: 'character', text: '' },
    ]));
  });
  await page.locator('.doc-card-modal [data-screenplay-element="character"]').last().click();
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('ArrowDown');   // navigate → the popup is no longer a hint
  await page.keyboard.press('Tab');
  const cues = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return S.docJSONToBlocks(window.__soleilDocTest.editor.getJSON())
      .filter(b => b.element === 'character').map(b => b.text);
  });
  expect(cues[cues.length - 1]).toBe('JOHN');
});

test('Escape dismisses the popup and it stays dismissed for that line', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hi.' },
      { element: 'character', text: '' },
    ]));
  });
  const emptyCue = page.locator('.doc-card-modal [data-screenplay-element="character"]').last();
  await emptyCue.click();
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.sp-autocomplete.is-open')).toHaveCount(0);
  // Clicking away and back to the same unchanged line must NOT reopen it.
  await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first().click();
  await emptyCue.click();
  await expect(page.locator('.sp-autocomplete.is-open')).toHaveCount(0);
});

test('no completion popup when the caret is not at the end of the line', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN ' },   // trailing space = extension stage
    ]));
  });
  const cue = page.locator('.doc-card-modal [data-screenplay-element="character"]').first();
  await cue.click();
  // Caret at the START of the cue: accepting would clobber the line, so the
  // popup must not open at all.
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection(1).run());
  await expect(page.locator('.sp-autocomplete.is-open')).toHaveCount(0);
  // At the END of the line the extension suggestions appear as before.
  // (Programmatic move — the End key doesn't move a programmatic caret on mac.)
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().setTextSelection(ed.state.doc.firstChild.nodeSize - 1).run();
  });
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'V.O.' })).toBeVisible();
});

test('smart quotes apply in screenplay dialogue', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  // Get to a dialogue line: scene → enter (action) → tab (character) → type → enter (dialogue).
  await page.keyboard.type('int. room - day');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.type('sam');
  await page.keyboard.press('Enter');           // → dialogue
  await page.keyboard.type('"Hello," she said.');
  const text = await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first().textContent();
  // Typography converted the straight quotes to curly.
  expect(text).toMatch(/[“”]/);
});

test('typing a slugline on an action line auto-formats it into a Scene Heading', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  // The seeded first block is a Scene Heading; give it a location, then Enter
  // drops to an Action line.
  await page.keyboard.type('int. office - day');
  await page.keyboard.press('Enter');           // → action
  // On this ACTION line, typing another slugline auto-promotes it to a Scene
  // Heading (and uppercases), and scene autocomplete surfaces the known location.
  await page.keyboard.type('ext. ');
  await expect(page.locator('.doc-card-modal [data-screenplay-element="scene"]')).toHaveCount(2);
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.sp-autocomplete-item', { hasText: 'OFFICE' })).toBeVisible();
  await page.keyboard.type('street');
  const scenes = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return S.docJSONToBlocks(window.__soleilDocTest.editor.getJSON())
      .filter(b => b.element === 'scene').map(b => b.text);
  });
  expect(scenes).toEqual(['INT. OFFICE - DAY', 'EXT. STREET']);
});

// Read the screenplay element of the block at the caret.
async function caretElement(page) {
  return page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const $from = ed.state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'screenplayBlock') return $from.node(d).attrs.element;
    }
    return null;
  });
}

// Doc shape helpers for the Enter-flow tests.
async function blockCount(page) {
  return page.evaluate(() => window.__soleilDocTest.editor.state.doc.childCount);
}
async function blockShapes(page) {
  return page.evaluate(() => {
    const out = [];
    window.__soleilDocTest.editor.state.doc.forEach((node) => {
      out.push({ element: node.attrs?.element ?? node.type.name, text: node.textContent });
    });
    return out;
  });
}

test('Enter progression from dialogue: new character → action → scene (typing forward)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Goodbye.' },
    ]));
  });
  // Click to focus, then park the caret at the END of the dialogue line
  // programmatically (click coordinates + the End key are both unreliable
  // under parallel-worker load / on mac).
  await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first().click();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => { if (node.attrs?.element === 'dialogue') pos = p + 1 + node.content.size; });
    ed.chain().focus().setTextSelection(pos).run();
  });
  await page.keyboard.press('Enter');   // dialogue → a NEW empty character cue
  expect(await caretElement(page)).toBe('character');
  expect(await blockCount(page)).toBe(4);
  // The cast popup opens on the empty cue (JOHN). The NEXT Enter must ESCALATE
  // to Action (browse mode), NOT accept "JOHN" — this is the key interaction.
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Enter');   // empty character → action, IN PLACE
  expect(await caretElement(page)).toBe('action');
  expect(await blockCount(page)).toBe(4);
  await page.keyboard.press('Enter');   // empty action → scene heading, IN PLACE
  expect(await caretElement(page)).toBe('scene');
  expect(await blockCount(page)).toBe(4);
});

test('Enter on a clicked-into empty line inserts a new line (the mid-script glitch)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'action', text: '' },              // an existing blank spacer line
      { element: 'action', text: 'She waits.' },
    ]));
  });
  // Click into the blank line the way a user editing earlier script would
  // (then pin the caret programmatically — click coordinates drift under
  // parallel-worker load).
  await page.locator('.doc-card-modal [data-screenplay-element="action"]').first().click();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => {
      if (pos == null && node.attrs?.element === 'action' && !node.textContent) pos = p + 1;
    });
    ed.chain().focus().setTextSelection(pos).run();
  });
  await page.keyboard.press('Enter');
  // A new line exists — the old behavior only toggled the element in place
  // (Action ↔ Scene Heading forever) and never inserted one.
  expect(await blockShapes(page)).toEqual([
    { element: 'scene', text: 'INT. ROOM - DAY' },
    { element: 'action', text: '' },
    { element: 'action', text: '' },
    { element: 'action', text: 'She waits.' },
  ]);
  expect(await caretElement(page)).toBe('action');
});

test('Enter at the start of a slugline pushes it down intact (no element retype)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'action', text: 'She waits.' },
    ]));
  });
  // Real click for real DOM focus (evaluate-side .focus() races the harness),
  // then park the caret at the very start of the slugline text.
  await page.locator('.doc-card-modal [data-screenplay-element="scene"]').first().click();
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection(1).run());
  await page.keyboard.press('Enter');
  // The slugline is untouched below a new blank line — the old behavior
  // demoted the slugline itself to Action.
  expect(await blockShapes(page)).toEqual([
    { element: 'scene', text: '' },
    { element: 'scene', text: 'INT. ROOM - DAY' },
    { element: 'action', text: 'She waits.' },
  ]);
});

test('Enter mid-dialogue splits into two dialogue lines (no character cue minted)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hello there.' },
    ]));
  });
  // Real click for real DOM focus, then caret after "Hello" inside the line.
  await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first().click();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => {
      if (node.attrs?.element === 'dialogue') pos = p + 1 + 'Hello'.length;
    });
    ed.chain().focus().setTextSelection(pos).run();
  });
  await page.keyboard.press('Enter');
  expect(await blockShapes(page)).toEqual([
    { element: 'character', text: 'JOHN' },
    { element: 'dialogue', text: 'Hello' },
    { element: 'dialogue', text: ' there.' },
  ]);
});

test('the Enter escalation flow works mid-script, not just at the end', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Goodbye.' },
      { element: 'scene', text: 'EXT. STREET - NIGHT' },   // script continues below
      { element: 'action', text: 'Rain falls.' },
    ]));
  });
  await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first().click();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => { if (node.attrs?.element === 'dialogue') pos = p + 1 + node.content.size; });
    ed.chain().focus().setTextSelection(pos).run();
  });
  await page.keyboard.press('Enter');   // split → new empty character cue
  expect(await caretElement(page)).toBe('character');
  await page.keyboard.press('Enter');   // escalate → action
  expect(await caretElement(page)).toBe('action');
  await page.keyboard.press('Enter');   // escalate → scene
  expect(await caretElement(page)).toBe('scene');
  // The rest of the script is untouched below the new blank scene heading.
  const shapes = await blockShapes(page);
  expect(shapes.slice(-2)).toEqual([
    { element: 'scene', text: 'EXT. STREET - NIGHT' },
    { element: 'action', text: 'Rain falls.' },
  ]);
  expect(shapes.length).toBe(6);
});

test('pasting multi-line text creates real screenplay blocks (nothing lost on export)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.locator('.doc-card-modal .tt-editor').first().click();
  await page.evaluate(() => {
    const view = window.__soleilDocTest.editor.view;
    const dt = new DataTransfer();
    dt.setData('text/plain', 'int. house - day\nJohn walks in.\nCUT TO:');
    view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  const state = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    const json = window.__soleilDocTest.editor.getJSON();
    return {
      types: (json.content || []).map(n => n.type),
      blocks: S.docJSONToBlocks(json).map(b => b.element),
    };
  });
  // Every pasted line became a screenplayBlock (NOT a paragraph that renders
  // but silently vanishes from every export), with elements detected.
  expect(state.types).toEqual(['screenplayBlock', 'screenplayBlock', 'screenplayBlock']);
  expect(state.blocks).toEqual(['scene', 'action', 'transition']);
});

test('stray prose paragraphs still export as action lines (never dropped)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const blocks = await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return S.docJSONToBlocks({
      type: 'doc',
      content: [
        { type: 'screenplayBlock', attrs: { element: 'scene' }, content: [{ type: 'text', text: 'INT. ROOM - DAY' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'A pasted line.' }] },
        { type: 'screenplayBlock', attrs: { element: 'action' }, content: [{ type: 'text', text: 'She waits.' }] },
      ],
    });
  });
  expect(blocks).toEqual([
    { element: 'scene', text: 'INT. ROOM - DAY' },
    { element: 'action', text: 'A pasted line.' },
    { element: 'action', text: 'She waits.' },
  ]);
});

test('toggling Screenplay converts existing prose to script blocks (and back)', async ({ page }) => {
  await openDoc(page);
  // Write ordinary prose first.
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.keyboard.type('int. warehouse - night');
  await page.keyboard.press('Enter');
  await page.keyboard.type('A guard sleeps.');
  // Toggle Screenplay → the prose is MIGRATED, not left as inert paragraphs.
  await enableScreenplay(page);
  await expect.poll(async () => page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    return S.docJSONToBlocks(window.__soleilDocTest.editor.getJSON());
  })).toEqual([
    { element: 'scene', text: 'INT. WAREHOUSE - NIGHT' },   // detected + uppercased
    { element: 'action', text: 'A guard sleeps.' },
  ]);
  // The element selector is live (it was disabled on paragraph content).
  await expect(page.locator('.doc-card-modal .doc-tb-select')).toBeEnabled();
  // Toggle back → paragraphs again, text intact.
  await page.locator('.doc-tb-screenplay-toggle').click();
  await expect(page.locator('.doc-paper.is-screenplay')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() =>
    (window.__soleilDocTest.editor.getJSON().content || []).map(n => n.type),
  )).toEqual(['paragraph', 'paragraph']);
});

test('Backspace at line start consumes a blank line above instead of retyping the line', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },
      { element: 'action', text: 'She waits.' },
      { element: 'action', text: '' },
      { element: 'character', text: 'JOHN' },
      { element: 'dialogue', text: 'Hi.' },
    ]));
  });
  await page.locator('.doc-card-modal [data-screenplay-element="character"]').first().click();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    let pos = null;
    ed.state.doc.descendants((node, p) => { if (node.attrs?.element === 'character') pos = p + 1; });
    ed.chain().focus().setTextSelection(pos).run();
  });
  await page.keyboard.press('Backspace');
  // The blank line is gone and JOHN is STILL a character cue — the stock join
  // absorbed the cue into the empty block's element instead.
  expect(await blockShapes(page)).toEqual([
    { element: 'scene', text: 'INT. ROOM - DAY' },
    { element: 'action', text: 'She waits.' },
    { element: 'character', text: 'JOHN' },
    { element: 'dialogue', text: 'Hi.' },
  ]);
});

test('Delete at line end consumes a blank line below (keeps both elements)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'character', text: 'JOHN' },
      { element: 'action', text: '' },
      { element: 'dialogue', text: 'Hi.' },
    ]));
  });
  await page.locator('.doc-card-modal [data-screenplay-element="character"]').first().click();
  await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    ed.chain().focus().setTextSelection(1 + 'JOHN'.length).run();
  });
  await page.keyboard.press('Delete');
  expect(await blockShapes(page)).toEqual([
    { element: 'character', text: 'JOHN' },
    { element: 'dialogue', text: 'Hi.' },
  ]);
});

test('Tab away from an untouched parenthetical removes the auto "()"', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.locator('.doc-card-modal .tt-editor').first().click();
  // Seeded scene → Tab: action → character → parenthetical (auto-inserts "()").
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await caretElement(page)).toBe('parenthetical');
  expect((await blockShapes(page))[0]).toEqual({ element: 'parenthetical', text: '()' });
  // One more Tab: the untouched "()" must not ride along into Dialogue.
  await page.keyboard.press('Tab');
  expect(await caretElement(page)).toBe('dialogue');
  expect((await blockShapes(page))[0]).toEqual({ element: 'dialogue', text: '' });
});

test('slugline auto-detect keeps inline marks (promotes element without flattening)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    window.__soleilDocTest.editor.commands.setContent({
      type: 'doc',
      content: [{
        type: 'screenplayBlock',
        attrs: { element: 'action' },
        content: [
          { type: 'text', text: 'house - ' },
          { type: 'text', text: 'night', marks: [{ type: 'bold' }] },
        ],
      }],
    });
  });
  await page.locator('.doc-card-modal [data-screenplay-element="action"]').first().click();
  await page.evaluate(() => window.__soleilDocTest.editor.chain().focus().setTextSelection(1).run());
  await page.keyboard.type('INT. ');
  const state = await page.evaluate(() => {
    const json = window.__soleilDocTest.editor.getJSON();
    const first = (json.content || [])[0];
    return {
      element: first?.attrs?.element,
      boldRuns: (first?.content || []).filter(c => (c.marks || []).some(m => m.type === 'bold')).map(c => c.text),
    };
  });
  expect(state.element).toBe('scene');
  expect(state.boldRuns).toEqual(['night']);   // the old full-line rewrite destroyed it
});

test('screenplay mode has no "+" insert menu (the element dropdown handles elements)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  // The "+" is hidden in screenplay mode — the element <select> + Tab cover
  // every element (incl. Centered), so there's nothing for it to add.
  await expect(page.locator('.doc-card-modal button[aria-label="Insert a block"]')).toHaveCount(0);
  await expect(page.locator('.doc-card-modal .doc-tb-select')).toBeVisible();
});

test('the "+" insert menu holds only insert-content items, not toolbar duplicates', async ({ page }) => {
  await openDoc(page);
  await page.locator('.doc-card-modal button[aria-label="Insert a block"]').click();
  const menu = page.locator('.doc-insert-menu');
  await expect(menu).toBeVisible();
  // The five things with no other toolbar home.
  // "Embed cluster" — the board→cluster copy rename (f1f957a).
  for (const label of ['Image', 'Table', 'Divider', 'Code block', 'Embed cluster']) {
    await expect(menu.locator('.doc-insert-item-title', { hasText: label })).toBeVisible();
  }
  // None of the things the toolbar already provides (style select / list / quote
  // / bookmark buttons) — no "same thing twice".
  for (const dupe of ['Heading 1', 'Paragraph', 'Bulleted list', 'Quote', 'Bookmark']) {
    await expect(menu.locator('.doc-insert-item-title', { hasText: dupe })).toHaveCount(0);
  }
});

test('typing "/" in a doc is literal text — the slash command menu is gone', async ({ page }) => {
  await openDoc(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.keyboard.type('/hello');
  // No popup of any kind appears…
  await expect(page.locator('.doc-slash')).toHaveCount(0);
  await expect(page.locator('.doc-insert-menu')).toHaveCount(0);
  // …and the "/" is just typed into the document.
  await expect(editor).toContainText('/hello');
});

test('the "+" insert menu actually inserts a table (and is not clipped)', async ({ page }) => {
  await openDoc(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.locator('.doc-card-modal button[aria-label="Insert a block"]').click();
  const menu = page.locator('.doc-insert-menu');
  await expect(menu).toBeVisible();
  // The item must be a real hit target — the toolbar must not clip the menu.
  await menu.locator('.doc-insert-item', { hasText: 'Table' }).click({ timeout: 4000 });
  await expect(page.locator('.doc-card-modal .tt-editor table').first()).toBeVisible();
});

test('Tab moves between table cells instead of typing two spaces', async ({ page }) => {
  await openDoc(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.locator('.doc-card-modal button[aria-label="Insert a block"]').click();
  await page.locator('.doc-insert-menu .doc-insert-item', { hasText: 'Table' }).click();
  await expect(page.locator('.doc-card-modal .tt-editor table').first()).toBeVisible();
  await page.keyboard.type('one');
  await page.keyboard.press('Tab');          // → next cell (used to insert "  ")
  await page.keyboard.type('two');
  const cells = () => page.$$eval('.doc-card-modal .tt-editor table th, .doc-card-modal .tt-editor table td',
    els => els.map(e => e.textContent));
  let c = await cells();
  expect(c[0]).toBe('one');
  expect(c[1]).toBe('two');
  await page.keyboard.press('Shift+Tab');    // ← back (used to be swallowed entirely)
  // Cell navigation selects the cell's content, so typing replaces it —
  // the point is that the caret is back in cell 1, not still in cell 2.
  await page.keyboard.type('!');
  c = await cells();
  expect(c[0]).toBe('!');
  expect(c[1]).toBe('two');
});

test('screenplay export menu offers Fountain + Final Draft import/export', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.locator('.doc-card-modal .doc-export-wrap button').first().click();
  await expect(page.getByRole('menuitem', { name: /Export Fountain/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Export Final Draft/ })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Import Fountain/ })).toBeVisible();
});

test('line spacing matches industry standard (true 6 lines/inch, shot=2 blank lines, first line at top margin)', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  await page.evaluate(() => {
    const S = window.__soleilDocTest.screenplay;
    window.__soleilDocTest.editor.commands.setContent(S.blocksToDocJSON([
      { element: 'scene', text: 'INT. ROOM - DAY' },     // first block → top margin
      { element: 'action', text: 'She walks in.' },       // 1 blank line before
      { element: 'shot', text: 'CLOSE ON HER FACE' },      // 2 blank lines before
      { element: 'character', text: 'JANE' },
      { element: 'dialogue', text: 'Hello there.' },
    ]));
  });
  const m = await page.evaluate(() => {
    const px = (el, prop) => parseFloat(getComputedStyle(el).getPropertyValue(prop));
    const q = (sel) => document.querySelector(`.doc-paper.is-screenplay ${sel}`);
    const pm = q('.ProseMirror');
    const dlg = q('[data-screenplay-element="dialogue"]');
    return {
      lineHeight: px(dlg, 'line-height'),
      fontSize: px(pm, 'font-size'),
      firstTop: px(q('[data-screenplay-element="scene"]'), 'margin-top'),
      actionTop: px(q('[data-screenplay-element="action"]'), 'margin-top'),
      shotTop: px(q('[data-screenplay-element="shot"]'), 'margin-top'),
    };
  });
  // 12pt Courier @96dpi = 16px; line spacing is exactly 1/6in = 16px (true 6 lpi),
  // and crucially NOT smaller than the glyph (the old 9in/55 ≈ 15.7px was cramped).
  expect(m.fontSize).toBeCloseTo(16, 0);
  expect(m.lineHeight).toBeCloseTo(16, 0);
  expect(m.lineHeight).toBeGreaterThanOrEqual(m.fontSize - 0.01);
  // The very first line sits exactly at the 1in top margin (no leading blank lines).
  expect(m.firstTop).toBe(0);
  // Action = 1 blank line (one --sp-line); Shot = 2 blank lines, like a scene heading.
  expect(m.actionTop).toBeCloseTo(16, 0);
  expect(m.shotTop).toBeCloseTo(32, 0);
  expect(m.shotTop).toBeCloseTo(m.actionTop * 2, 0);
});
