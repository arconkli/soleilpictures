// Right-to-left writing in the interface (the labels and fields that show or
// take people's own words; menus stay left-to-right). A cluster named in
// Arabic reads from its right end: the sidebar row's text direction is rtl,
// the text still sits beside its icon (body { text-align: left }), and a name
// too long for the row is cut at its left end, where its text runs out. An
// English cluster in the same list is unchanged.
//
// The clusters are planted in the saved local session, then the page reloads
// (the local shell's sidebar is its own; tests/rtl-notes.spec.js covers the
// notes and docs).
import { expect, test } from '@playwright/test';

const KEY = 'soleil.boards.local.session.v1';
const ARABIC = 'مشروع الفيلم القصير';
const ARABIC_LONG = 'مجموعة لقطات الفصل الثاني من الفيلم الوثائقي عن الموانئ القديمة والمدن الساحلية وأسواقها العتيقة';
const ENGLISH = 'Harbour treatment';

async function plant(page) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), KEY)).toBe(true);
  await page.evaluate(({ k, names }) => {
    const s = JSON.parse(localStorage.getItem(k));
    names.forEach((name, i) => {
      s.localState.boards[`rtl${i}`] = {
        id: `rtl${i}`, name, view: 'canvas', workspace_id: 'local-workspace',
        parent_board_id: 'root', created_at: `1970-01-01T00:00:0${i}.000Z`,
      };
    });
    localStorage.setItem(k, JSON.stringify(s));
  }, { k: KEY, names: [ARABIC, ENGLISH, ARABIC_LONG] });
  await page.goto('/?local=1&blank=1');
  await expect(page.locator('.sidebar .sb-row-label', { hasText: ENGLISH })).toBeVisible({ timeout: 15000 });
}

const row = (page, name) => page.locator('.sidebar .sb-row-board', { has: page.locator('.sb-row-label', { hasText: name }) });

// Where the label's own words are drawn (not the label's box, which is as
// wide as the row), against the label's box.
const textBox = (page, name) => row(page, name).locator('.sb-row-label').evaluate((el) => {
  const r = document.createRange();
  r.selectNodeContents(el);
  const t = r.getBoundingClientRect();
  const b = el.getBoundingClientRect();
  return { tl: t.left, tr: t.right, bl: b.left, br: b.right, over: el.scrollWidth > el.clientWidth };
});

test('a cluster named in Arabic reads right to left; an English one does not', async ({ page }) => {
  page.on('pageerror', (e) => { throw e; });
  await plant(page);
  const dirOf = (name) => row(page, name).locator('.sb-row-label').evaluate((el) => getComputedStyle(el).direction);
  expect(await dirOf(ARABIC)).toBe('rtl');
  expect(await dirOf(ARABIC_LONG)).toBe('rtl');
  expect(await dirOf(ENGLISH)).toBe('ltr');
  // The menu around them stays left-to-right.
  expect(await page.evaluate(() => getComputedStyle(document.body).direction)).toBe('ltr');
});

test('the Arabic row\'s text sits beside its icon, like the English one', async ({ page }) => {
  await plant(page);
  const gap = async (name) => {
    const dot = await row(page, name).locator('.sb-dot').boundingBox();
    const t = await textBox(page, name);
    return t.tl - (dot.x + dot.width);
  };
  const ar = await gap(ARABIC);
  const en = await gap(ENGLISH);
  expect(ar).toBeGreaterThanOrEqual(0);
  expect(ar).toBeLessThan(16);
  expect(Math.abs(ar - en)).toBeLessThan(2);
});

test('a long Arabic name is cut at its left end', async ({ page }) => {
  await plant(page);
  const t = await textBox(page, ARABIC_LONG);
  expect(t.over).toBe(true);
  // It begins at the label's right edge and runs out past the left one.
  expect(t.tr).toBeLessThanOrEqual(t.br + 1);
  expect(t.tr).toBeGreaterThan(t.br - 4);
  expect(t.tl).toBeLessThan(t.bl);
  // An English name that long is cut at the right instead.
  const e = await row(page, ENGLISH).locator('.sb-row-label').evaluate((el) => {
    el.textContent = 'A very long English cluster name about the second act and its many locations and markets';
    const r = document.createRange();
    r.selectNodeContents(el);
    const t2 = r.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return { tl: t2.left, tr: t2.right, bl: b.left, br: b.right };
  });
  expect(e.tl).toBeGreaterThanOrEqual(e.bl - 1);
  expect(e.tr).toBeGreaterThan(e.br);
});

test('a field that takes a name follows what is typed into it', async ({ page }) => {
  await plant(page);
  await page.keyboard.press('ControlOrMeta+k');
  const input = page.locator('.cmdk-input');
  await expect(input).toBeVisible();
  await input.fill(ARABIC);
  expect(await input.evaluate((el) => getComputedStyle(el).direction)).toBe('rtl');
  await input.fill('harbour');
  expect(await input.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
});

test('an editable title keeps its own class beside "editable" and carries dir="auto"', async ({ page }) => {
  // The local shell's sample cluster has cards with titles.
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.editable').first()).toBeAttached({ timeout: 15000 });
  // Every EditableText (a card title, a cluster title) is class "editable <its own>".
  const found = await page.evaluate(() => [...document.querySelectorAll('.editable')].map((el) => ({
    classes: [...el.classList],
    dir: el.getAttribute('dir'),
  })));
  expect(found.length).toBeGreaterThan(0);
  for (const f of found) {
    expect(f.dir).toBe('auto');
    // A class string that lost its space reads "editablefoo": a glued name, no "editable" token.
    expect(f.classes).toContain('editable');
    expect(f.classes.filter((c) => c.startsWith('editable') && c !== 'editable')).toEqual([]);
  }
  const own = found.find((f) => f.classes.some((c) => c !== 'editable' && c !== 'is-editing' && c !== 'is-placeholder'));
  expect(own, 'an EditableText with a class of its own').toBeTruthy();
});
