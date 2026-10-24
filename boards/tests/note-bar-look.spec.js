// The note bar in the toolbar look (the owner's pick "A · Islands",
// 2026-10-21; the toolbar canvas's A-note, A-ipad and A-phone frames), held
// to a dev opt-in (lib/appHost.js toolbarLookAllowed; components/toolbar/
// NoteBarA.jsx). On a desktop it carries every control by name, with its keys
// and the look's tooltip, in the room the rail and the zoom leave it, centred
// by its margins (its rise-in moved it sideways when a transform centred it);
// a window too narrow for the row folds it a step at a time and unfolds it
// again, never cutting its end off; each fold's controls are in ⋯ or a menu,
// and work there. A phone draws the A-phone row: its lists a menu, and its
// background's colours in ⋯. Today's bar keeps nothing of the look.
//
// The specs that work a control in either look go through
// tests/helpers/noteBar.js; this one is the look's own. On the real canvas,
// through ?local=1.
import { expect, test } from '@playwright/test';
import { noteBar } from './helpers/noteBar.js';

const look = (page, on) => page.addInitScript((v) => {
  try { window.localStorage.setItem('soleil.dev.toolbarLook', v); } catch (_) {}
}, on ? '1' : '0');
const note = (page) => page.locator('.canvas-wrap .card[data-card-id="home-note"]');
const button = (page, name) => noteBar(page).getByRole('button', { name, exact: true });
const names = (page) => noteBar(page).locator('button, input')
  .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.textContent.trim()));

// The local board's note, open for writing, with its words selected: its bar
// is up.
async function editNote(page, { on = true, touch = false } = {}) {
  await look(page, on);
  await page.goto('/?local=1&reset=1');
  await note(page).waitFor({ timeout: 30000 });
  // What only the dev harness draws: the tweaks gear in the corner, over a
  // phone's ⋯.
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  await page.waitForTimeout(500);
  if (touch) {
    const body = note(page).locator('.note');
    await body.tap();
    await page.waitForTimeout(90);
    await body.tap();
  } else {
    await note(page).dblclick();
  }
  await expect(page.locator('.note-body[contenteditable="true"]')).toBeVisible();
  await expect(noteBar(page)).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
}

// How far the row has folded, by what's on it: Strikethrough leaves it first
// (1), then the size's − and + (2), then the font's name (3).
const foldOf = (page) => noteBar(page).evaluate((bar) => {
  const has = (name) => [...bar.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === name);
  if (has('Strikethrough')) return 0;
  if (has('Decrease font size')) return 1;
  return bar.querySelector('.nb-font.is-select') ? 2 : 3;
});
// What the note's text carries: the local board's note writes a style
// (font-weight: bold), the collaborative one a tag (<strong>).
const BOLD = /font-weight:\s*(bold|[6-9]00)|<b[\s>]|<strong/i;
const STRUCK = /line-through|<s[\s>]|<strike/i;
const noteHtml = (page) => page.locator('.note-body[contenteditable="true"]').innerHTML();
const meets = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('on a desktop the whole row: every control by name, its keys, the look\'s tooltip', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await editNote(page);
  await expect(page.locator('html')).toHaveAttribute('data-tb', 'a');
  await expect(noteBar(page)).toHaveClass(/\bnb-a\b/);
  await expect(noteBar(page)).toHaveAttribute('role', 'toolbar');
  expect(await names(page)).toEqual([
    expect.stringMatching(/^Font: \S/), 'Decrease font size', 'Font size', 'Preset sizes', 'Increase font size',
    'Bold', 'Italic', 'Underline', 'Strikethrough', 'Clear formatting',
    'Bulleted list', 'Numbered list', 'Checklist',
    'Align left', 'Align center', 'Align right', 'Center in the box',
    'Text color', 'Card background',
  ]);
  const bold = button(page, 'Bold');
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await expect(bold).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+B$/);
  await expect(button(page, 'Strikethrough')).toHaveAttribute('aria-keyshortcuts', /^(Meta|Control)\+Shift\+S$/);
  await expect(bold).toHaveAttribute('data-tl-tip', 'Bold');
  await bold.hover();
  const tip = page.locator('.tl-tip');
  await expect(tip).toHaveClass(/is-shown/);
  await expect(tip).toContainText('Bold');
  await expect(tip.locator('.tl-keys kbd')).toHaveCount(2);
  // What's on is pressed, not a class of its own.
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => noteHtml(page)).toMatch(BOLD);
});

test('on a desktop it sits between the rail and the zoom, centred by its margins, and comes in without a sideways jump', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await look(page, true);
  await page.goto('/?local=1&reset=1');
  await note(page).waitFor({ timeout: 30000 });
  await page.waitForTimeout(500);
  // Where its left edge is, each frame of its first half second.
  await page.evaluate(() => {
    window.__barLefts = [];
    const seen = new MutationObserver(() => {
      const bar = document.querySelector('.tob');
      if (!bar) return;
      seen.disconnect();
      const t0 = performance.now();
      const tick = () => {
        window.__barLefts.push(bar.getBoundingClientRect().left);
        if (performance.now() - t0 < 500) requestAnimationFrame(tick);
      };
      tick();
    });
    seen.observe(document.body, { childList: true, subtree: true });
  });
  await note(page).dblclick();
  await expect(noteBar(page)).toBeVisible();
  await page.waitForTimeout(700);
  const lefts = await page.evaluate(() => window.__barLefts);
  expect(lefts.length).toBeGreaterThan(5);
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
  await expect(noteBar(page)).toHaveCSS('transform', 'none');

  const [b, rail, zoom] = await Promise.all([
    noteBar(page).boundingBox(), page.locator('.cnv-tools').boundingBox(), page.locator('.cnv-zoom').boundingBox(),
  ]);
  const from = rail.x + rail.width + 12;
  const to = zoom.x - 12;
  expect(b.x).toBeGreaterThanOrEqual(from - 1);
  expect(b.x + b.width).toBeLessThanOrEqual(to + 1);
  expect(Math.abs((b.x - from) - (to - (b.x + b.width)))).toBeLessThanOrEqual(2);
  // On the bottom row, with the zoom.
  expect(Math.abs((b.y + b.height) - (zoom.y + zoom.height))).toBeLessThanOrEqual(2);
});

test('a desktop window too narrow for the row folds it a step at a time, and unfolds it, never cutting its end off', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await editNote(page);
  const at = async (width) => {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(400);
    const [b, rail, zoom] = await Promise.all([
      noteBar(page).boundingBox(), page.locator('.cnv-tools').boundingBox(), page.locator('.cnv-zoom').boundingBox(),
    ]);
    expect(await noteBar(page).evaluate((el) => el.scrollWidth - el.clientWidth), `${width}: the row's end is cut off`)
      .toBeLessThanOrEqual(1);
    expect(meets(b, rail), `${width}: over the rail`).toBe(false);
    expect(meets(b, zoom), `${width}: over the zoom`).toBe(false);
    return foldOf(page);
  };
  const down = [];
  for (const w of [1440, 1280, 1100, 1000, 900, 760, 660]) down.push(await at(w));
  expect(down[0]).toBe(0);
  for (let i = 1; i < down.length; i++) expect(down[i], `${down}`).toBeGreaterThanOrEqual(down[i - 1]);
  expect([...new Set(down)], `${down}`).toEqual([0, 1, 2, 3]);
  const up = [];
  for (const w of [760, 1000, 1100, 1440]) up.push(await at(w));
  for (let i = 1; i < up.length; i++) expect(up[i], `${up}`).toBeLessThanOrEqual(up[i - 1]);
  expect(up.at(-1)).toBe(0);
  // Still writing in the note all along.
  await expect(page.locator('.note-body[contenteditable="true"]')).toBeVisible();
});

test('folded a step, ⋯ holds what left the row, and it works on the text', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await editNote(page);
  expect(await foldOf(page)).toBe(1);
  await button(page, 'More formatting').click();
  const more = page.locator('.nb-more');
  await expect(more).toBeVisible();
  await expect(more.getByRole('menuitemcheckbox', { name: 'Strikethrough' })).toBeVisible();
  await expect(more.getByRole('menuitem', { name: 'Clear formatting' })).toBeVisible();
  await expect(more.getByRole('group', { name: 'Align' }).getByRole('menuitemradio')).toHaveCount(3);
  await expect(more.getByRole('menuitemcheckbox', { name: 'Center in the box' })).toBeVisible();
  await more.getByRole('menuitemcheckbox', { name: 'Strikethrough' }).click();
  await expect(more).toBeHidden();
  await expect.poll(() => noteHtml(page)).toMatch(STRUCK);
  await expect(page.locator('.note-body[contenteditable="true"]')).toBeVisible();
});

test('folded two steps, the size is in the font\'s menu and the background in ⋯', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await editNote(page);
  expect(await foldOf(page)).toBe(2);
  const font = noteBar(page).getByRole('button', { name: /^Font: .+, size \d+$/ });
  const sizeOf = async () => Number((await font.getAttribute('aria-label')).match(/size (\d+)$/)[1]);
  const before = await sizeOf();
  await font.click();
  const sizeRow = page.locator('.nb-font-pop').getByRole('group', { name: 'Font size' });
  await sizeRow.getByRole('menuitem', { name: 'Increase font size' }).click();
  // The menu stays open to see it change.
  await expect(sizeRow).toBeVisible();
  await expect.poll(sizeOf).toBe(before + 1);
  await expect(sizeRow.locator('.nb-size-val')).toHaveText(String(before + 1));
  await page.keyboard.press('Escape');
  await expect(page.locator('.nb-font-pop')).toBeHidden();

  await button(page, 'More formatting').click();
  await page.locator('.nb-more').getByRole('menuitem', { name: 'Card background' }).click();
  const colours = page.locator('.nb-colour-menu');
  await expect(colours).toBeVisible();
  await colours.getByLabel('Color #fef3c7', { exact: true }).click();
  await expect(colours).toBeHidden();
  await button(page, 'More formatting').click();
  await page.locator('.nb-more').getByRole('menuitem', { name: 'Card background' }).click();
  await expect(colours.getByLabel('Color #fef3c7', { exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('folded three steps, the font and the lists are a button each, as on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 660, height: 800 });
  await editNote(page);
  expect(await foldOf(page)).toBe(3);
  await expect(noteBar(page).getByRole('button', { name: /^Font: .+, size \d+$/ })).toHaveText('');
  const lists = noteBar(page).getByRole('button', { name: /^Lists/ });
  await expect(lists).toHaveAttribute('aria-label', 'Lists');
  await lists.click();
  const menu = page.getByRole('menu', { name: 'Lists' });
  await expect(menu.getByRole('menuitemcheckbox')).toHaveCount(3);
  await menu.getByRole('menuitemcheckbox', { name: 'Bulleted list' }).click();
  await expect(page.locator('.note-body ul:not(.note-checklist)').first()).toBeVisible();
  await expect(lists).toHaveAttribute('aria-label', 'Lists: Bulleted list');
});

test('the background\'s chip is the note\'s own surface while it has none, and the colour once it has one', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await editNote(page);
  const bg = button(page, 'Card background');
  const chip = () => bg.evaluate((b) => getComputedStyle(b, '::before').backgroundColor);
  const surface = await bg.evaluate((b) => {
    const probe = document.createElement('div');
    probe.style.background = 'var(--bg-0)';
    b.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  });
  expect(await chip()).toBe(surface);
  await bg.click();
  await page.locator('.nb-colour-menu').getByLabel('Color #fef3c7', { exact: true }).click();
  await expect.poll(chip).toBe('rgb(254, 243, 199)');
});

test('today\'s bar keeps nothing of the look', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await editNote(page, { on: false });
  await expect(page.locator('html')).not.toHaveAttribute('data-tb', 'a');
  await expect(noteBar(page)).not.toHaveClass(/\bnb-a\b/);
  await expect(noteBar(page).locator('[data-tl-tip]')).toHaveCount(0);
  await expect(noteBar(page).locator('.tob-btn').first()).toBeVisible();
  await expect(button(page, 'Strike')).toBeVisible();
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the A-phone row across the width: Aa, B I U, the lists, the colour, ⋯', async ({ page }) => {
    await editNote(page, { touch: true });
    await expect(noteBar(page)).toHaveClass(/\bis-phone\b/);
    expect(await names(page)).toEqual([
      expect.stringMatching(/^Font: .+, size \d+$/), 'Bold', 'Italic', 'Underline', 'Lists', 'Text color', 'More formatting',
    ]);
    const b = await noteBar(page).boundingBox();
    expect(b.width).toBeGreaterThanOrEqual(390 - 16 - 1);
    expect(await noteBar(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  });

  test('its lists are a menu, and a list picked there is the note\'s', async ({ page }) => {
    await editNote(page, { touch: true });
    const lists = noteBar(page).getByRole('button', { name: /^Lists/ });
    await lists.tap();
    await page.getByRole('menu', { name: 'Lists' }).getByRole('menuitemcheckbox', { name: 'Checklist' }).tap();
    await expect(page.locator('.note-body ul.note-checklist').first()).toBeVisible();
    await expect(lists).toHaveAttribute('aria-label', 'Lists: Checklist');
    await expect(page.locator('.note-body[contenteditable="true"]')).toBeVisible();
  });

  test('⋯ holds the background\'s colours itself, with no menu beside it', async ({ page }) => {
    await editNote(page, { touch: true });
    await button(page, 'More formatting').tap();
    const more = page.locator('.nb-more');
    await expect(more).toBeVisible();
    await expect(more.getByRole('menuitem', { name: 'Card background' })).toHaveCount(0);
    const colours = more.getByRole('group', { name: 'Card background' });
    await colours.getByLabel('Color #fef3c7', { exact: true }).tap();
    await expect(more).toBeHidden();
    await button(page, 'More formatting').tap();
    await expect(colours.getByLabel('Color #fef3c7', { exact: true })).toHaveAttribute('aria-checked', 'true');
    // Inside the window.
    const m = await more.boundingBox();
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(390);
  });
});
