// The bulk import's tray (components/ImportTray.jsx, the owner's pick A) on
// the import QA page (?importqa=1): every state draws, every button calls the
// entry's act(id) with its id, it folds to the 30px corner chip and back, and
// gold is on the paid step alone. The words are importCopy's and are pinned
// in src/lib/importCopy.test.mjs; this checks the drawing and the wiring.
import { expect, test } from '@playwright/test';
import { CTA, STORAGE_ADDON_BLOCK_LABEL } from '../src/lib/billingCopy.js';

const TRY = CTA.tryCreatorShort;
const ADD = `Add ${STORAGE_ADDON_BLOCK_LABEL}`;

async function open(page, query) {
  const acts = [];
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[importqa] act ')) acts.push(t.slice('[importqa] act '.length));
  });
  await page.goto(`/?importqa=1&${query}`);
  await page.waitForSelector('[data-importqa-ready]');
  return acts;
}
const tray = (page) => page.locator('section.imptray');
const chip = (page) => page.locator('.imptray-chip');
const button = (page, name) => tray(page).getByRole('button', { name, exact: true });

// state → its title, its buttons in order, and the one gold step (if any).
const STATES = [
  ['reading', 'Reading Night Shift…', ['Minimize', 'Cancel']],
  ['creating', 'Importing Night Shift', ['Minimize', 'Cancel']],
  ['run', 'Importing Night Shift', ['Minimize', 'Pause', 'Cancel']],
  ['paused', 'Night Shift is paused', ['Minimize', 'Resume', 'Cancel']],
  ['wait-free', 'Night Shift', ['Minimize', TRY, 'Stop'], TRY],
  ['wait-storage-paid', 'Night Shift', ['Minimize', ADD, 'Stop'], ADD],
  ['wait-trial', 'Night Shift', ['Minimize', 'Stop']],
  ['wait-guest', 'Night Shift', ['Minimize', 'Stop']],
  ['done', 'Night Shift is in', ['Close', 'Open Night Shift', 'Remove this import']],
  ['done-fails', 'Night Shift is in', ['Close', 'Open Night Shift', 'Remove this import', 'Try these again']],
  ['cancelled', 'Night Shift stopped', ['Close', 'Open Night Shift', 'Remove this import']],
  ['failed', 'Night Shift stopped', ['Close', 'Resume', 'Remove this import']],
  ['reload', 'Night Shift stopped', ['Minimize', 'Resume', 'Remove this import']],
  ['redrop', 'Night Shift stopped', ['Minimize', 'Remove this import']],
];

for (const [state, title, buttons, gold] of STATES) {
  test(`${state}: "${title}", its buttons, gold only on the paid step`, async ({ page }) => {
    await open(page, `state=${state}`);
    await expect(tray(page).locator('.imptray-title')).toHaveText(title);
    const names = await tray(page).getByRole('button').evaluateAll((els) => els.map((b) => b.getAttribute('aria-label') || b.innerText.trim()));
    expect(names).toEqual(buttons);
    await expect(tray(page).locator('.is-primary')).toHaveCount(gold ? 1 : 0);
    if (gold) await expect(tray(page).locator('.is-primary')).toHaveText(gold);
  });
}

// state → [button, the act id it sends].
const ACTS = [
  ['reading', [['Cancel', 'cancel']]],
  ['run', [['Pause', 'pause'], ['Cancel', 'cancel']]],
  ['paused', [['Resume', 'resume'], ['Cancel', 'cancel']]],
  ['wait-free', [[TRY, 'upgrade'], ['Stop', 'cancel']]],
  ['wait-storage-paid', [[ADD, 'addon']]],
  ['done-fails', [['Open Night Shift', 'open'], ['Remove this import', 'remove'], ['Try these again', 'retry']]],
  ['failed', [['Resume', 'resume']]],
  ['reload', [['Resume', 'resume'], ['Remove this import', 'remove']]],
];

for (const [state, clicks] of ACTS) {
  test(`${state}: each button sends its own act`, async ({ page }) => {
    const acts = await open(page, `state=${state}`);
    for (const [name] of clicks) await button(page, name).click();
    await expect.poll(() => acts).toEqual(clicks.map(([, id]) => id));
  });
}

test('Close on a finished import lets the controller go and takes the tray away, chip and all', async ({ page }) => {
  const acts = await open(page, 'state=done');
  await button(page, 'Close').click();
  await expect.poll(() => acts).toEqual(['close']);
  await expect(tray(page)).toHaveCount(0);
  await expect(chip(page)).toHaveCount(0);
});

test('Minimize folds it to a 30px chip in the corner that names the numbers, and the chip opens it again', async ({ page }) => {
  await open(page, 'state=run');
  await button(page, 'Minimize').click();
  await expect(tray(page)).toHaveCount(0);
  await expect(chip(page)).toHaveText('50%');
  await expect(chip(page)).toHaveAttribute('aria-label', 'Importing Night Shift: 1,846 of 6,193 files, about 1 hr 10 min left. Open the import');
  const box = await chip(page).boundingBox();
  const vp = page.viewportSize();
  expect(box.height).toBe(30);
  expect(vp.width - (box.x + box.width)).toBeLessThanOrEqual(20);
  await chip(page).click();
  await expect(tray(page).locator('.imptray-title')).toHaveText('Importing Night Shift');
});

test('the chip says one word: a spinning ring while reading, then Waiting, Done or how many failed', async ({ page }) => {
  await open(page, 'state=reading&min=1');
  await expect(chip(page)).toHaveText('Reading');
  await expect(chip(page).locator('svg.is-spin')).toHaveCount(1);
  for (const [state, word] of [['wait-free', 'Waiting'], ['done', 'Done'], ['done-fails', '3 failed'], ['reload', 'Stopped']]) {
    await open(page, `state=${state}&min=1`);
    await expect(chip(page)).toHaveText(word);
    await expect(chip(page).locator('.is-primary')).toHaveCount(0);
  }
});

test('on a desktop it sits just above the zoom control, never over it', async ({ page }) => {
  await open(page, 'state=run');
  const zoom = await page.locator('.cnv-zoom').boundingBox();
  const box = await tray(page).boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(zoom.y);
  await button(page, 'Minimize').click();
  const c = await chip(page).boundingBox();
  expect(c.y + c.height).toBeLessThanOrEqual(zoom.y);
});

test('on a phone it spans the width above the nav and steps aside while the zoom pill shows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'state=wait-free&phone=1');
  await expect(tray(page)).toHaveClass(/is-above-nav/);
  const box = await tray(page).boundingBox();
  expect(Math.round(box.x)).toBe(8);
  expect(Math.round(390 - (box.x + box.width))).toBe(8);
  await page.evaluate(() => document.body.setAttribute('data-zooming', '1'));
  await expect(tray(page)).toHaveCSS('opacity', '0');
  await expect(tray(page)).toHaveCSS('pointer-events', 'none');
});

test('reduced motion stops the reading bar and the spinning ring', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'state=reading');
  await expect(tray(page).locator('.imptray-bar.is-reading span')).toHaveCSS('animation-name', 'none');
  await button(page, 'Minimize').click();
  await expect(chip(page).locator('svg.is-spin')).toHaveCSS('animation-name', 'none');
});

test('a new import opens the tray even when the last one was folded, and one waiting its turn is counted', async ({ page }) => {
  await open(page, 'state=done&min=1');
  await expect(chip(page)).toHaveText('Done');
  await page.evaluate(() => window.__importQa.put('qa-2', { phase: 'queued', title: 'Lookbook', reading: { files: 86, folders: 1 } }));
  await expect(tray(page).locator('.imptray-title')).toHaveText('Lookbook');
  await page.evaluate(() => window.__importQa.put('qa-3', { phase: 'queued', title: 'Wardrobe', reading: { files: 236, folders: 1 } }));
  await expect(tray(page).locator('.imptray-foot')).toContainText('1 more import after this');
});
