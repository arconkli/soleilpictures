// What people see while things load or upload: the activity tray
// (components/ActivityTray.jsx, its words from lib/activityTray.js) on the
// upload QA page (?uploadqa=1&tray=<state>), the loading screens on the
// loading QA page (?loadqa=<state>), and the real signed-in app mounting the
// tray. Strings are pinned literally: one or two per state plus the buttons by
// name. The model's rules are pinned in src/lib/activityTray.test.mjs; this
// checks what is drawn and how focus moves.
//
//   PW_PORT=5198 npx playwright test tests/activity-tray.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';
import { bootSignedIn } from './helpers/signedInStub.js';

async function openTray(page, state, extra = '') {
  await page.goto(`/?uploadqa=1&tray=${state}${extra}`);
  await page.waitForSelector('html[data-trayqa-ready="1"]', { timeout: 30000 });
}
const col = (page) => page.locator('.atr-col');
const panel = (page, title) => col(page).locator('section.atr').filter({ has: page.locator(`xpath=self::*[@aria-label=${JSON.stringify(title)}]`) });
const section = (page, title) => col(page).locator(`section[aria-label=${JSON.stringify(title)}]`);
const chip = (page) => col(page).locator('button.atr-chip, .atr-chip-main');
const btn = (page, name) => col(page).getByRole('button', { name, exact: true });

// state -> the panel it opens, a line it says, and the buttons it must carry.
const OPEN = [
  ['running', 'Uploading 12 files to Halcyon', '5 of 12 uploaded', ['Pause', 'Fold', 'Retry Location_scout_07.jpg']],
  ['paused', 'Uploading 12 files to Halcyon', 'paused', ['Resume', 'Fold']],
  ['problems', 'Uploaded to Halcyon', '1 didn’t upload', ['Dismiss', 'Retry Location_scout_07.jpg']],
  ['allfailed', 'Didn’t upload to Halcyon', '3 files didn’t upload', ['Dismiss', 'Retry IMG_2041.jpg', 'Retry IMG_2042.jpg', 'Retry IMG_2043.jpg']],
  ['offline', 'Offline', '3 uploads paused, they’ll continue when you’re back', ['Fold']],
  ['error', 'Couldn’t save', 'Your latest changes aren’t saved yet', ['Fold', 'Retry']],
  ['held', 'Waiting for room', null, ['Fold', 'Upload now', 'Discard']],
  ['op-zip', 'Preparing download · 34 of 120 files', null, ['Cancel download of Halcyon.zip', 'Fold']],
  ['op-zip-done', 'Downloaded Halcyon.zip', null, ['Dismiss: Downloaded Halcyon.zip']],
  ['op-copy', 'Copying 24 cards…', null, ['Fold']],
  ['op-copy-done', 'Copied', null, ['Open the copy', 'Dismiss: Copied']],
];

for (const [state, title, line, buttons] of OPEN) {
  test(`${state}: the open tray says "${title}"${line ? ` and "${line}"` : ''}`, async ({ page }) => {
    await openTray(page, state);
    const s = section(page, title);
    await expect(s).toBeVisible();
    if (line) await expect(s).toContainText(line);
    for (const b of buttons) await expect(s.getByRole('button', { name: b, exact: true })).toBeVisible();
    await expect(col(page).locator('button.atr-chip')).toHaveCount(0);
  });
}

test('running: a count and Pause, and Pause turns into Resume when clicked', async ({ page }) => {
  await openTray(page, 'running');
  await expect(section(page, 'Uploading 12 files to Halcyon')).toContainText('5 of 12 uploaded');
  await btn(page, 'Pause').click();
  await expect(btn(page, 'Resume')).toBeVisible();
  await expect(btn(page, 'Pause')).toHaveCount(0);
});

test('reconnecting: only the chip "Reconnecting…", no panel', async ({ page }) => {
  await openTray(page, 'reconnecting');
  await expect(chip(page)).toHaveAttribute('aria-label', 'Reconnecting…');
  await expect(col(page).locator('section')).toHaveCount(0);
});

test('saved: only the chip "Saved", no panel', async ({ page }) => {
  await openTray(page, 'saved');
  await expect(chip(page)).toHaveAttribute('aria-label', 'Saved');
  await expect(col(page).locator('section')).toHaveCount(0);
});

test('reconnecting-open: the open tray holds "Reconnecting…" above the upload', async ({ page }) => {
  await openTray(page, 'reconnecting-open');
  await expect(section(page, 'Reconnecting…')).toBeVisible();
  await expect(section(page, 'Uploading 12 files to Halcyon')).toBeVisible();
});

test('single: one file shows only the corner chip, no open panel', async ({ page }) => {
  await openTray(page, 'single');
  await expect(chip(page)).toHaveAttribute('aria-label', /^Uploading · \d+% · .*\. Open$/);
  await expect(col(page).locator('section')).toHaveCount(0);
});

test('folded: the chip alone; activating it opens the panel', async ({ page }) => {
  await openTray(page, 'folded');
  await expect(chip(page)).toHaveAttribute('aria-label', 'Uploading · 5 of 12 · about 4 min · 1 didn’t upload. Open');
  await expect(col(page).locator('section')).toHaveCount(0);
  await chip(page).click();
  await expect(section(page, 'Uploading 12 files to Halcyon')).toBeVisible();
});

test('stack: upload, held files and the import are three panels in one tray', async ({ page }) => {
  await openTray(page, 'stack');
  await expect(section(page, 'Uploading 12 files to Halcyon')).toBeVisible();
  await expect(section(page, 'Waiting for room')).toBeVisible();
  await expect(section(page, 'Imports')).toBeVisible();
});

test('held: Upload now and Discard are real buttons', async ({ page }) => {
  await openTray(page, 'held');
  await expect(btn(page, 'Upload now')).toBeEnabled();
  await expect(btn(page, 'Discard')).toBeEnabled();
});

test('op-export: the export is a chip, "Exporting Treatment_v3 as PDF…", no panel', async ({ page }) => {
  await openTray(page, 'op-export');
  await expect(chip(page)).toHaveAttribute('aria-label', 'Exporting Treatment_v3 as PDF…');
  await expect(col(page).locator('section')).toHaveCount(0);
});

test('op-with-upload: the open tray holds the upload and the zip', async ({ page }) => {
  await openTray(page, 'op-with-upload');
  await expect(section(page, 'Uploading 2 files to Halcyon')).toBeVisible();
  await expect(section(page, 'Preparing download · 34 of 120 files')).toBeVisible();
  await expect(btn(page, 'Cancel download of Halcyon.zip')).toBeVisible();
});

test('op-export-with-upload: the export leads the chip once folded; the upload stays in the open tray', async ({ page }) => {
  await openTray(page, 'op-export-with-upload');
  await expect(section(page, 'Uploading 2 files to Halcyon')).toBeVisible();
  await expect(section(page, 'Exporting Treatment_v3 as PDF…')).toBeVisible();
  await col(page).getByRole('button', { name: 'Fold', exact: true }).first().click();
  await expect(chip(page)).toHaveAttribute('aria-label', /^Exporting Treatment_v3 as PDF… · \d+%\. Open$|^Exporting Treatment_v3 as PDF…\. Open$/);
});

// The card draws "Uploading version 3" and "42%" as two lines (one group named
// by the first), not the one "Uploading version 3 · 42%" string.
test('version: the card says "Uploading version 3" and "42%"', async ({ page }) => {
  await openTray(page, 'version');
  await expect(page.getByRole('group', { name: 'Uploading version 3' })).toContainText('42%');
});

test('version-row: Info\'s Versions has the upload as its top row, "Version 3 · uploading 42%"', async ({ page }) => {
  await openTray(page, 'version-row');
  const top = page.getByRole('listitem').first();
  await expect(top).toContainText('Version 3 · uploading 42%');
  await expect(top).toContainText('8 of 19 MB');
});

test.describe('keyboard focus', () => {
  test('Enter on the chip opens the tray and focus lands on a button in the panel', async ({ page }) => {
    await openTray(page, 'folded');
    await chip(page).focus();
    await page.keyboard.press('Enter');
    await expect(section(page, 'Uploading 12 files to Halcyon')).toBeVisible();
    const inPanel = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && a.tagName === 'BUTTON' && !!a.closest('.atr-col section');
    });
    expect(inPanel).toBe(true);
  });

  test('the Fold button returns focus to the chip', async ({ page }) => {
    await openTray(page, 'running');
    const fold = btn(page, 'Fold');
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toBeFocused();
  });

  test('a row removed by the store (not the person) leaves focus on its panel, not on another row’s button', async ({ page }) => {
    await openTray(page, 'allfailed');
    const first = col(page).getByRole('button', { name: 'Retry IMG_2041.jpg', exact: true });
    await first.focus();
    await expect(first).toBeFocused();
    const r = await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((u) => u.includes('/src/lib/activity.js'));
      const m = await import(url || '/src/lib/activity.js');
      const it = (m.activitySnapshot().items || []).find((i) => i.label === 'IMG_2041.jpg');
      if (!it) return 'no item';
      m.removeTransfer(it.id);
      return 'removed';
    });
    expect(r).toBe('removed');
    await expect(col(page).getByRole('button', { name: 'Retry IMG_2041.jpg', exact: true })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const a = document.activeElement;
      return a && a !== document.body ? (a.getAttribute('aria-label') || '') : 'BODY';
    })).toBe("Didn’t upload to Halcyon");
  });

  test('the person removing a row with its own button moves focus to the next row’s button', async ({ page }) => {
    await openTray(page, 'allfailed');
    const rm = col(page).getByRole('button', { name: 'Remove this file: IMG_2041.jpg', exact: true });
    await rm.focus();
    await page.keyboard.press('Enter');
    await expect(rm).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const a = document.activeElement;
      return a && a !== document.body ? (a.getAttribute('aria-label') || '') : 'BODY';
    })).toBe('Retry IMG_2042.jpg');
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a multi-file upload does not open the sheet by itself; tapping the bar does', async ({ page }) => {
    await openTray(page, 'running', '&phone=1');
    await expect(page.locator('.atr-slim-main')).toBeVisible();
    await expect(page.locator('.atr-sheet')).toHaveCount(0);
    await page.locator('.atr-slim-main').tap();
    await expect(page.locator('.atr-sheet')).toBeVisible();
    await expect(page.locator('.atr-sheet')).toContainText('Uploading 12 files to Halcyon');
  });
});

test.describe('loading screens', () => {
  async function load(page, state) {
    await page.goto(`/?loadqa=${state}`);
    await page.waitForSelector('html[data-loadqa-ready="1"]', { timeout: 30000 });
  }

  test('boot-8: "Still loading…", no reload yet', async ({ page }) => {
    await load(page, 'boot-8');
    await expect(page.getByText('Still loading…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload page' })).toHaveCount(0);
  });

  test('boot-15: "This is taking longer than usual" and a Reload page button', async ({ page }) => {
    await load(page, 'boot-15');
    await expect(page.getByText('This is taking longer than usual')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  });

  test('switch: "Opening Sundown Films…"; switch-15 adds the longer words and Reload page', async ({ page }) => {
    await load(page, 'switch');
    await expect(page.getByText('Opening Sundown Films…')).toBeVisible();
    await page.goto('/?loadqa=switch-15');
    await expect(page.getByText('Opening Sundown Films…')).toBeVisible();
    await expect(page.getByText('This is taking longer than usual')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  });

  test('cluster: "Still connecting to Halcyon…", online words, Reload page and Go back', async ({ page }) => {
    await load(page, 'cluster');
    await expect(page.getByText('Still connecting to Halcyon…')).toBeVisible();
    await expect(page.getByText('If your connection dropped, reload the page.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
  });

  test('cluster-offline: says you are offline and that it opens when back online', async ({ page }) => {
    await load(page, 'cluster-offline');
    await expect(page.getByText('Still connecting to Halcyon…')).toBeVisible();
    await expect(page.getByText('You’re offline. The cluster opens as soon as you’re back online.')).toBeVisible();
  });

  test('cards: a picture that did not load says "Couldn’t load" and has Retry', async ({ page }) => {
    await load(page, 'cards');
    await expect(page.getByText('Couldn’t load').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry loading this picture' }).first()).toBeVisible();
  });

  test('panel: "Opening Settings…"', async ({ page }) => {
    await load(page, 'panel');
    await expect(page.getByText('Opening Settings…')).toHaveCount(1);
  });

  test('sidebar and palette: "Couldn’t load your files" / the search results, each with Retry', async ({ page }) => {
    await load(page, 'sidebar');
    await expect(page.getByText('Couldn’t load your files')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.goto('/?loadqa=palette');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('quicklook-slow and pdf-slow: the opening words, then "This is taking longer than usual"', async ({ page }) => {
    await load(page, 'quicklook-slow');
    await expect(page.getByText('Opening Halcyon_treatment.mov…')).toBeVisible();
    await expect(page.getByText('This is taking longer than usual')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await page.goto('/?loadqa=pdf-slow');
    await expect(page.getByText('Opening Halcyon_treatment.pdf…')).toBeVisible();
    await expect(page.getByText('This is taking longer than usual')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  test('composer-uploading: the attachment says "Uploading · 42%"', async ({ page }) => {
    await load(page, 'composer-uploading');
    await expect(page.getByText('Lookbook.pdf').first()).toBeVisible();
    await expect(page.getByText('Uploading · 42%')).toBeVisible();
  });
});

test.describe('the real app', () => {
  test('the tray mounts after boot, with no page error', async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bootSignedIn(page);
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    await expect(page.locator('.atr-col')).toBeAttached({ timeout: 10000 });

    // On the root cluster's canvas the tray also speaks for the connection.
    const onCanvas = await page.locator('.canvas-wrap').isVisible().catch(() => false);
    if (onCanvas) {
      await context.setOffline(true);
      // Offline opens as a panel titled "Offline" (not a chip).
      const offline = page.locator('.atr-col section[aria-label="Offline"]');
      await expect(offline).toBeVisible({ timeout: 6000 });
      await context.setOffline(false);
      await expect(offline).toHaveCount(0, { timeout: 15000 });
    }
    expect(errors).toEqual([]);
  });
});
