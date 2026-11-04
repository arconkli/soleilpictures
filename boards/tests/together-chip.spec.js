// The Together chip (components/TogetherChip.jsx), driven through the
// ?togetherqa=1 harness: its labels, the open popover's words (from
// lib/liveTogether.js, never typed here), the arrival note, and that reduced
// motion switches off every transition and animation in it.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import {
  chipAria, togetherTitle, rateLine, monthLine, capLine, groupHint, arrivalNote,
} from '../src/lib/liveTogether.js';

const SHOTS = 'test-results/together';
const box = (page, id) => page.locator(`[data-qa="${id}"]`);
// The popover is portaled to <body>, so find it by its month line (unique per state).
const POP_MONTH = { 'one-open': 7, 'two-open': 9, 'three-open': 12, 'capped-open': 25, 'unknown-open': 5 };
const popOf = (page, id) => page.locator('.tg-pop').filter({ hasText: monthLine(POP_MONTH[id], 25) });

async function open(page, theme = 'dark') {
  await page.goto(`/?togetherqa=1&theme=${theme}`);
  await page.waitForSelector('#root[data-togetherqa-ready="1"]');
}

test('the chip says Together, then what it has earned', async ({ page }) => {
  await open(page);
  const zero = box(page, 'one-zero').locator('.tg-chip');
  await expect(zero).toHaveText('Together');
  await expect(zero).toHaveAttribute('aria-label', chipAria(0));
  await expect(zero).toHaveAttribute('aria-expanded', 'false');
  const earned = box(page, 'one-open').locator('.tg-chip');
  await expect(earned.locator('.tg-lbl')).toContainText('Together');
  await expect(earned.locator('.tg-lbl b')).toHaveText('+3 cards');
  await expect(earned).toHaveAttribute('aria-label', chipAria(3));
  const phone = box(page, 'phone').locator('.tg-chip');
  await expect(phone).toHaveText('+3');
});

test('the popover tells the room as it is', async ({ page }) => {
  await open(page);
  const pop = (id) => popOf(page, id);

  await expect(pop('one-open')).toContainText(togetherTitle(['Lena'], 1));
  await expect(pop('one-open')).toContainText(rateLine(1));
  await expect(pop('one-open')).toContainText(monthLine(7, 25));
  await expect(pop('one-open')).toContainText(groupHint(1));
  await expect(box(page, 'one-open').locator('.tg-chip')).toHaveAttribute('aria-expanded', 'true');

  await expect(pop('two-open')).toContainText(togetherTitle(['Lena', 'Sam'], 2));
  await expect(pop('two-open')).toContainText(rateLine(2));
  await expect(pop('two-open')).toContainText(groupHint(2));
  await expect(pop('two-open').locator('.presence-dot')).toHaveCount(2);

  await expect(pop('three-open')).toContainText(togetherTitle(['Lena', 'Sam', 'Ola'], 3));
  await expect(pop('three-open')).toContainText(rateLine(3));
  await expect(pop('three-open').locator('.tg-more')).toHaveCount(0);

  await expect(pop('capped-open')).toContainText(capLine(25));
  await expect(pop('capped-open')).toContainText(monthLine(25, 25));
  await expect(pop('capped-open')).not.toContainText(rateLine(1));
  await expect(pop('capped-open').locator('.tg-more')).toHaveCount(0);

  // A person the app doesn't know has no name: counts, and a "?" face.
  await expect(pop('unknown-open')).toContainText(togetherTitle([], 1));
  await expect(pop('unknown-open').locator('.presence-dot')).toHaveText('?');
});

test('Escape and an outside press close it', async ({ page }) => {
  await open(page);
  const chip = box(page, 'one-open').locator('.tg-chip');
  await page.keyboard.press('Escape');
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await chip.click();
  await expect(popOf(page, 'one-open')).toBeVisible();
  await page.mouse.click(700, 10);
  await expect(popOf(page, 'one-open')).toHaveCount(0);
});

test('the popover takes focus, and Tab gives it back to the chip', async ({ page }) => {
  await open(page);
  const chip = box(page, 'one-open').locator('.tg-chip');
  // The harness starts several open; Escape closes them all.
  await page.keyboard.press('Escape');
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
  await chip.focus();
  await page.keyboard.press('Enter');
  const dialog = popOf(page, 'one-open');
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog).toBeHidden();
  await expect(chip).toBeFocused();
});

test('the open popover floats above the page and stays inside a 360px screen', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  const pop = popOf(page, 'one-open');
  await expect(pop).toBeVisible();
  const r = await pop.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, inside: !!hit?.closest('.tg-pop'), vw: innerWidth, vh: innerHeight };
  });
  expect(r.inside).toBe(true);
  expect(r.l).toBeGreaterThanOrEqual(0);
  expect(r.t).toBeGreaterThanOrEqual(0);
  expect(r.r).toBeLessThanOrEqual(r.vw);
  expect(r.b).toBeLessThanOrEqual(r.vh);
});

test('arrival shows one note', async ({ page }) => {
  await open(page);
  await page.locator('[data-qa-arrive]').click();
  await expect(page.locator('[data-qa-toast]')).toHaveText(arrivalNote(['Lena'], 1));
});

test('reduced motion turns off every transition and animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  const arc = await box(page, 'one-open').locator('.tg-ring-arc').evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(arc.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  const pop = await popOf(page, 'one-open').evaluate((el) => {
    const s = getComputedStyle(el);
    return { name: s.animationName, dur: s.animationDuration };
  });
  expect(pop.name === 'none' || parseFloat(pop.dur) === 0).toBe(true);
});

for (const theme of ['dark', 'light']) {
  test(`screenshots, ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 1400 });
    await open(page, theme);
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const id of ['one-open', 'capped-open', 'phone']) {
      await box(page, id).screenshot({ path: `${SHOTS}/${id}-${theme}.png` });
    }
  });
}
