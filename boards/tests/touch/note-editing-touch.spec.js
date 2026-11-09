// Phones and tablets: starting and finishing a note, in the real signed-in
// app with the production editor (helpers/signedInStub.js, Supabase stubbed).
// A tap selects a note and a second tap types at the tap; a double-tap types;
// a note placed with the tool has the focus, and what's typed at once lands in
// it (the keyboard keeper, lib/touchKeyboard.js); a tap on empty canvas
// finishes. The viewport meta stops iOS's focus zoom on iOS only.
//
//   cd boards && PW_PORT=5291 npx playwright test tests/touch/note-editing-touch.spec.js --workers=2 \
//     --project=mobile-chrome --project=mobile-safari --project=tablet \
//     --project=tablet-landscape --project=tablet-landscape-chrome
// A real iPhone must still confirm the keyboard comes up: no emulator raises one.
import { test, expect } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';
import { emptyCanvasPoint, tap } from './helpers.js';

const rpc = { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] };
const EDIT = '.card .note-body[contenteditable="true"]';
const READ = '.card .note > .note-body';
const NOTE = '.cards-layer .card.card-kind-note';

async function openBoard(page) {
  // A power reveal can hold the screen; mark this tab's as spent.
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch {} });
  await bootSignedIn(page, { rpc });
  await page.waitForSelector('.canvas-wrap', { timeout: 30_000 });
  await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
}

async function canvasPoint(page, fx, fy) {
  const b = await page.locator('.canvas-wrap').boundingBox();
  return { x: b.x + b.width * fx, y: b.y + b.height * fy };
}

// The note tool, then a tap; `text` typed straight away (before the editor may
// have mounted: the keeper holds it).
async function placeNote(page, text = '') {
  await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
  await tap(page, await canvasPoint(page, 0.45, 0.3));
  if (text) await page.keyboard.type(text);
  await expect(page.locator(EDIT)).toBeFocused();
}

async function finish(page) {
  await tap(page, await emptyCanvasPoint(page));
  await expect(page.locator(EDIT)).toHaveCount(0);
}

// Client centre of `word` inside the element matched by `sel`.
function wordCentre(page, sel, word) {
  return page.evaluate(({ sel, word }) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const i = n.nodeValue.indexOf(word);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + word.length);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    }
    return null;
  }, { sel, word });
}

// The word a collapsed caret sits in, or null.
const caretWord = (page) => page.evaluate(() => {
  const s = window.getSelection();
  if (!s || !s.isCollapsed || !s.anchorNode || s.anchorNode.nodeType !== 3) return null;
  const t = s.anchorNode.nodeValue;
  let a = s.anchorOffset;
  let b = s.anchorOffset;
  while (a > 0 && /\w/.test(t[a - 1])) a--;
  while (b < t.length && /\w/.test(t[b])) b++;
  return t.slice(a, b) || null;
});

test.describe('starting and finishing a note', () => {
  test('a tap selects a note; a second tap types where it landed', async ({ page }) => {
    await openBoard(page);
    await placeNote(page, 'alpha bravo charlie delta');
    await finish(page);
    await expect(page.locator(`${NOTE}.is-selected`)).toHaveCount(0);

    const at = await wordCentre(page, READ, 'charlie');
    expect(at).not.toBeNull();
    await tap(page, at);
    await expect(page.locator(`${NOTE}.is-selected`)).toHaveCount(1);
    await page.waitForTimeout(700); // past any double-tap: still only selected
    await expect(page.locator(EDIT)).toHaveCount(0);

    await tap(page, at);
    await expect(page.locator(EDIT)).toBeFocused();
    await expect.poll(() => caretWord(page)).toBe('charlie');
    await expect(page.locator('.note-touch-keeper')).toHaveCount(0);
  });

  test('a double-tap on a note types', async ({ page }) => {
    await openBoard(page);
    await placeNote(page, 'one two three');
    await finish(page);
    const at = await wordCentre(page, READ, 'two');
    await tap(page, at);
    await tap(page, at);
    await expect(page.locator(EDIT)).toBeFocused();
    await expect.poll(() => caretWord(page)).toBe('two');
  });

  test('a note placed with the tool has the focus, and early typing lands in it', async ({ page }) => {
    await openBoard(page);
    await placeNote(page, 'hello there');
    await expect(page.locator(EDIT)).toHaveText('hello there');
    await expect(page.locator('.note-touch-keeper')).toHaveCount(0);
  });

  test('a tap on empty canvas finishes the note', async ({ page }) => {
    await openBoard(page);
    await placeNote(page, 'end me');
    await finish(page);
    await expect(page.locator(READ)).toHaveText('end me');
    expect(await page.evaluate(() => !!document.activeElement?.isContentEditable)).toBe(false);
  });
});

test.describe('iOS focus zoom', () => {
  const UA = {
    iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    android: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  };
  for (const [name, userAgent] of Object.entries(UA)) {
    test(`viewport under ${name}`, async ({ browser }, testInfo) => {
      const ctx = await browser.newContext({
        userAgent, hasTouch: true, viewport: { width: 390, height: 844 },
        baseURL: testInfo.project.use.baseURL,
      });
      const p = await ctx.newPage();
      await p.goto('/?local=1');
      await expect(p.locator('.canvas-wrap')).toBeVisible({ timeout: 30_000 });
      const content = await p.locator('meta[name="viewport"]').getAttribute('content');
      if (name === 'iphone') expect(content).toContain('maximum-scale=1');
      else expect(content).not.toContain('maximum-scale');
      expect(content).toContain('width=device-width');
      await ctx.close();
    });
  }
});

test.describe('while typing on touch', () => {
  const rpc = { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] };
  const EDITING = '.card .note-body[contenteditable="true"]';

  async function boardOpen(page) {
    await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch {} });
    await bootSignedIn(page, { rpc });
    await page.waitForSelector('.canvas-wrap', { timeout: 30_000 });
    await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
  }

  // A note placed with a tap at (fx, fy) of the board, then opened with a
  // double tap (a phone places a note without opening it; a tablet may open it).
  async function noteOpen(page, fx = 0.3, fy = 0.62) {
    await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
    const b = await page.locator('.canvas-wrap').boundingBox();
    await page.touchscreen.tap(Math.round(b.x + b.width * fx), Math.round(b.y + b.height * fy));
    await expect(page.locator('.card')).toHaveCount(1);
    await page.waitForTimeout(400);
    if (!(await page.locator(EDITING).count())) {
      const n = await page.locator('.card .note').first().boundingBox();
      const x = Math.round(n.x + n.width / 2), y = Math.round(n.y + Math.min(20, n.height / 2));
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(90);
      await page.touchscreen.tap(x, y);
    }
    await page.locator(EDITING).waitFor();
    await page.locator('.tob').waitFor();
  }

  // The last line of the note (the caret's, after typing) against the note
  // bar and the board's top.
  const lastLine = (page) => page.evaluate((sel) => {
    const ps = document.querySelectorAll(`${sel} p`);
    const p = ps[ps.length - 1].getBoundingClientRect();
    const bar = document.querySelector('.tob')?.getBoundingClientRect();
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const canvas = document.querySelector('.canvas-wrap > .canvas');
    return {
      top: p.top, bottom: p.bottom,
      barTop: bar && bar.height > 0 ? bar.top : innerHeight,
      wrapTop: wrap.top, innerHeight,
      transform: canvas ? getComputedStyle(canvas).transform : '',
    };
  }, EDITING);

  test('the keyboard never covers the line being typed', async ({ page }) => {
    await boardOpen(page);
    await noteOpen(page);
    for (const [i, line] of ['Scout the pier', 'Rain cover', 'Second unit at six', 'Wrap by ten'].entries()) {
      if (i) await page.keyboard.press('Enter');
      await page.keyboard.type(line);
    }
    await page.waitForTimeout(300);
    const vp = page.viewportSize();
    const kbHeight = Math.round(vp.height * 0.55);
    const before = await lastLine(page);
    // The keyboard (a shorter visual viewport) would cover the line.
    expect(before.bottom, 'the line starts where a keyboard would cover it').toBeGreaterThan(kbHeight - 60);
    await page.setViewportSize({ width: vp.width, height: kbHeight });
    await page.waitForTimeout(600); // a 180ms glide, after the resize lands
    const after = await lastLine(page);
    expect(after.transform, 'the board moved').not.toBe(before.transform);
    expect(after.bottom, 'above the note bar').toBeLessThanOrEqual(after.barTop + 1);
    expect(after.bottom).toBeLessThanOrEqual(after.innerHeight);
    expect(after.top, 'still below the top of the board').toBeGreaterThanOrEqual(after.wrapTop - 1);
    // And it follows the next line too.
    await page.keyboard.press('Enter');
    await page.keyboard.type('Call sheet out');
    await page.waitForTimeout(500);
    const next = await lastLine(page);
    expect(next.bottom).toBeLessThanOrEqual(next.barTop + 1);
    await page.setViewportSize(vp);
  });

  test('the editor types with autocorrect, capitals and spellcheck, and no Grammarly', async ({ page }) => {
    await boardOpen(page);
    await noteOpen(page, 0.3, 0.35);
    const ed = page.locator(EDITING);
    await expect(ed).toHaveAttribute('spellcheck', 'true');
    await expect(ed).toHaveAttribute('autocorrect', 'on');
    await expect(ed).toHaveAttribute('autocapitalize', 'sentences');
    await expect(ed).toHaveAttribute('data-gramm', 'false');
  });
});

// The keyboard keeper (lib/touchKeyboard.js) holds what is typed until the
// note's editor opens (NoteTiptapSurface's open effect, one animation frame
// after mount). To hold the editor back deterministically, as a slow editor
// chunk would, these tests queue requestAnimationFrame callbacks while the
// keeper is typed into, then run them.
test.describe('typing before the editor opens', () => {
  test.describe.configure({ timeout: 90_000 });

  const KEEPER = '.note-touch-keeper';

  async function paste(page, html, text) {
    await page.evaluate(([h, t, sel]) => {
      const dt = new DataTransfer();
      dt.setData('text/html', h);
      dt.setData('text/plain', t);
      document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, [html, text, EDIT]);
  }

  // Hold every requestAnimationFrame callback back (as a slow editor would)...
  const holdFrames = (page) => page.evaluate(() => {
    window.__zzQ = [];
    window.__zzRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => { window.__zzQ.push(cb); return 0; };
  });
  // ...then let them run.
  const releaseFrames = (page) => page.evaluate(() => {
    window.requestAnimationFrame = window.__zzRaf;
    const q = window.__zzQ || [];
    window.__zzQ = [];
    for (const cb of q) window.requestAnimationFrame(cb);
  });

  // A note holding `html`, closed, then selected with one tap on `word`.
  async function selectedNoteWith(page, html, text, word) {
    await placeNote(page);
    await paste(page, html, text);
    await finish(page);
    const at = await wordCentre(page, READ, word);
    expect(at).not.toBeNull();
    await tap(page, at);
    await expect(page.locator(`${NOTE}.is-selected`)).toHaveCount(1);
    await page.waitForTimeout(700); // past any double-tap: only selected
    await expect(page.locator(EDIT)).toHaveCount(0);
    return at;
  }

  test('Enter typed before the editor opens in a bulleted list starts a new bullet', async ({ page }) => {
    await openBoard(page);
    const at = await selectedNoteWith(page, '<ul><li><p>milk</p></li></ul>', 'milk', 'milk');
    await expect(page.locator(`${READ} ul > li`)).toHaveCount(1);

    await holdFrames(page);
    await tap(page, at);                       // tap it again: the keeper holds the keyboard
    await expect(page.locator(KEEPER)).toBeFocused();
    await page.keyboard.press('Enter');
    await page.keyboard.type('eggs');
    await releaseFrames(page);

    await expect(page.locator(EDIT)).toBeFocused();
    await expect(page.locator(KEEPER)).toHaveCount(0);
    await expect(page.locator(EDIT)).toContainText('eggs');
    // Enter in the editor itself splits the list item; the keeper's Enter must too.
    await expect(page.locator(`${EDIT} ul > li`)).toHaveCount(2);
  });

  test('text typed while the editor is slow is never thrown away', async ({ page }) => {
    await openBoard(page);
    const at = await selectedNoteWith(page, '<p>harbour</p>', 'harbour', 'harbour');

    await holdFrames(page);
    await tap(page, at);
    await expect(page.locator(KEEPER)).toBeFocused();
    await page.keyboard.type('zebra');
    await page.waitForTimeout(10_800);         // longer than the keeper's old 10s timer
    await releaseFrames(page);

    await expect(page.locator(EDIT)).toHaveCount(1);
    await expect(page.locator(EDIT)).toContainText('zebra');
  });

  test('a tap inside a sentence raises the keyboard without a capital', async ({ page }) => {
    await openBoard(page);
    const at = await selectedNoteWith(page, '<p>Boats rest here</p>', 'Boats rest here', 'rest');

    await holdFrames(page);
    await tap(page, at);
    await expect(page.locator(KEEPER)).toBeFocused();
    await expect(page.locator(KEEPER)).toHaveAttribute('autocapitalize', 'none');
    await releaseFrames(page);

    await expect(page.locator(EDIT)).toHaveCount(1);
    await finish(page);
  });

  test('a tap at the start of a line raises the keyboard on a capital', async ({ page }) => {
    await openBoard(page);
    await selectedNoteWith(page, '<p>Boats rest here</p><p>gulls cry</p>', 'Boats rest here\ngulls cry', 'gulls');

    // 2px inside the left edge of the first character of "gulls".
    const at = await page.evaluate(({ sel, word }) => {
      const walker = document.createTreeWalker(document.querySelector(sel), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const i = n.nodeValue.indexOf(word);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        return { x: b.left + 2, y: b.top + b.height / 2 };
      }
      return null;
    }, { sel: READ, word: 'gulls' });
    expect(at).not.toBeNull();

    await holdFrames(page);
    await tap(page, at);
    await expect(page.locator(KEEPER)).toBeFocused();
    await expect(page.locator(KEEPER)).toHaveAttribute('autocapitalize', 'sentences');
    await releaseFrames(page);

    await expect(page.locator(EDIT)).toHaveCount(1);
    await finish(page);
  });
});
