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
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width }; };
    return { toggle: r(toggle), plus: r(plus), select: r(select) };
  });

  const before = await rects();
  // The pill is wider than a 28px icon button — proof the label has room.
  expect(before.toggle.width).toBeGreaterThan(40);
  // No horizontal overlap with the `+` button (left) or the <select> (right).
  expect(before.toggle.left).toBeGreaterThanOrEqual(before.plus.right - 0.5);
  expect(before.select.left).toBeGreaterThanOrEqual(before.toggle.right - 0.5);

  // Still clean in screenplay mode (where the element <select> sits to its right).
  await enableScreenplay(page);
  const after = await rects();
  expect(after.toggle.width).toBeGreaterThan(40);
  expect(after.toggle.left).toBeGreaterThanOrEqual(after.plus.right - 0.5);
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

test('Enter progression from dialogue: new character → action → scene', async ({ page }) => {
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
  // Click the dialogue line to focus the editor, caret to end of the line.
  await page.locator('.doc-card-modal [data-screenplay-element="dialogue"]').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');   // dialogue → new character cue
  expect(await caretElement(page)).toBe('character');
  // The cast popup opens on the empty cue (JOHN). The NEXT Enter must ESCALATE
  // to Action (browse mode), NOT accept "JOHN" — this is the key interaction.
  await expect(page.locator('.sp-autocomplete.is-open')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Enter');   // empty character → action
  expect(await caretElement(page)).toBe('action');
  await page.keyboard.press('Enter');   // empty action → new scene heading
  expect(await caretElement(page)).toBe('scene');
});

test('the "+" insert menu offers screenplay elements in screenplay mode', async ({ page }) => {
  await openDoc(page);
  await enableScreenplay(page);
  const editor = page.locator('.doc-card-modal .tt-editor').first();
  await editor.click();
  await page.keyboard.press('Enter');  // seeded scene → action line
  // Open the toolbar "+" menu (NOT a "/" trigger anymore).
  await page.locator('.doc-card-modal button[aria-label="Insert a block"]').click();
  const menu = page.locator('.doc-insert-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.doc-insert-item-title', { hasText: 'Scene Heading' })).toBeVisible();
  await expect(menu.locator('.doc-insert-item-title', { hasText: 'Dialogue' })).toBeVisible();
  // No prose blocks leak into screenplay mode.
  await expect(menu.locator('.doc-insert-item-title', { hasText: 'Heading 1' })).toHaveCount(0);
  // Pick Character → the current line becomes a character cue.
  await menu.locator('.doc-insert-item', { hasText: 'Character' }).click();
  const cur = await page.evaluate(() => {
    const ed = window.__soleilDocTest.editor;
    const $from = ed.state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'screenplayBlock') return $from.node(d).attrs.element;
    }
    return null;
  });
  expect(cur).toBe('character');
});

test('the "+" insert menu offers prose blocks outside screenplay mode', async ({ page }) => {
  await openDoc(page);
  await page.locator('.doc-card-modal button[aria-label="Insert a block"]').click();
  const menu = page.locator('.doc-insert-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.doc-insert-item-title', { hasText: 'Heading 1' })).toBeVisible();
  await expect(menu.locator('.doc-insert-item-title', { hasText: 'Table' })).toBeVisible();
  await expect(menu.locator('.doc-insert-item-title', { hasText: 'Scene Heading' })).toHaveCount(0);
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
