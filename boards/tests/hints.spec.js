import { expect, test } from '@playwright/test';

// Failure-triggered hints (lib/hints.js). Two of the three are reachable in the
// local QA shell: the palette's "no results" explanation and the naming bar for
// a cluster left as "Untitled cluster" (shortened from a minute to 300 ms by the
// DEV-only ?hintms= seam). The picker-cancel hint needs the OS file dialog, so
// its wiring is proven at the source level below.

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('a search that finds nothing explains what search can see, and offers the list view', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.sb-search')).toBeVisible();
  await page.keyboard.press(`${MOD}+k`);
  await page.locator('.cmdk-input').fill('zzzznotaboard');
  await expect(page.locator('.cmdk-empty')).toContainText('No results');
  const help = page.locator('.cmdk-empty-help');
  await expect(help).toBeVisible();
  await expect(help).toContainText('captions');
  await help.locator('.cmdk-empty-btn').click();
  await expect(page.locator('.cmdk')).toBeHidden();
  await expect(page.locator('.view-pill-btn[title="List view"]')).toHaveClass(/\bon\b/);
});

test('one or two characters get "keep typing", not the explanation', async ({ page }) => {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.sb-search')).toBeVisible();
  await page.keyboard.press(`${MOD}+k`);
  await page.locator('.cmdk-input').fill('zq');
  await expect(page.locator('.cmdk-empty-help')).toContainText('Keep typing');
  await expect(page.locator('.cmdk-empty-btn')).toHaveCount(0);
});

test('a cluster left unnamed gets the naming bar, and Name it opens its name for editing', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1&hintms=300');
  await expect(page.locator('.sb-search')).toBeVisible();
  const canvas = page.locator('.canvas-wrap');
  await expect(canvas).toBeVisible();
  // A note first: a cluster placed as the board's FIRST card auto-opens into
  // itself, and the bar belongs to the canvas it was placed on.
  await page.keyboard.press('n');
  await canvas.click({ position: { x: 240, y: 220 } });
  await page.keyboard.press('Escape');
  await expect(page.locator('.card')).toHaveCount(1);
  await page.locator('[data-tour="cluster-tool"]').click();
  await canvas.click({ position: { x: 520, y: 320 } });
  await expect(page.locator('[data-tour="cluster-card"]')).toHaveCount(1);

  const bar = page.locator('[data-hint="name_cluster"]');
  await expect(bar).toBeVisible({ timeout: 5000 });
  await expect(bar).toContainText('Untitled cluster');
  await bar.locator('.cnv-hint-btn').click();
  const name = page.locator('[data-tour="cluster-card"] .bc-name[contenteditable="true"]');
  await expect(name).toBeVisible();
  await expect(name).toBeFocused();
  await page.keyboard.type('Scene 4');
  await page.keyboard.press('Enter');
  // A real name answers the hint.
  await expect(bar).toBeHidden();
  await expect(page.locator('[data-tour="cluster-card"] .bc-name')).toHaveText('Scene 4');
});

test('the naming bar is once per device: a second unnamed cluster does not bring it back', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1&hintms=300');
  await expect(page.locator('.sb-search')).toBeVisible();
  await page.evaluate(() => { try { localStorage.setItem('soleil.hint.name_cluster', '1'); } catch (_) {} });
  const canvas = page.locator('.canvas-wrap');
  await page.keyboard.press('n');
  await canvas.click({ position: { x: 240, y: 220 } });
  await page.keyboard.press('Escape');
  await page.locator('[data-tour="cluster-tool"]').click();
  await canvas.click({ position: { x: 520, y: 320 } });
  await expect(page.locator('[data-tour="cluster-card"]')).toHaveCount(1);
  await page.waitForTimeout(900);
  await expect(page.locator('[data-hint="name_cluster"]')).toHaveCount(0);
});

test('the picker-cancel hint and the grid cell default are wired at the source', async () => {
  const { readFileSync } = await import('node:fs');
  const canvas = readFileSync(new URL('../src/components/CanvasSurface.jsx', import.meta.url), 'utf8');
  expect(canvas).toContain("trigger: 'picker_cancel'");
  expect(canvas).toContain("canShowHint('paste') && claimHint('paste')");
  expect(canvas).toMatch(/pasteHintUp\s*\?\s*\(isPhone/);
  const grid = readFileSync(new URL('../src/components/cards/GridCard.jsx', import.meta.url), 'utf8');
  expect(grid).toContain("'Drop an image here'");
});
