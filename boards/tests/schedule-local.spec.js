import { expect, test } from '@playwright/test';

// Schedule — live interaction in the local (?local=1) harness. Verifies the
// calendar container end to end with REAL input: create via the canvas
// right-click Add menu, switch the four views, navigate months + Today, and
// confirm LEGACY rows-table schedule cards still render. The pure date/layout
// math is covered separately by schedule.spec.js (?schedqa=1).

async function addSchedule(page) {
  const canvas = page.locator('.canvas-wrap');
  await canvas.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    node.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true,
      clientX: rect.left + 520, clientY: rect.top + 200,
    }));
  });
  const menu = page.locator('.ctx-menu').first();
  await expect(menu).toBeVisible();
  await menu.locator('.ctx-submenu-wrap', { hasText: 'Add' }).hover();
  await page.locator('.ctx-submenu').getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(page.locator('.schedc')).toBeVisible();
}

test.describe('schedule — local interaction', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
  });

  test('create a Schedule → a month calendar anchored on today', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    // Month view: a weekday strip + full weeks of day slots (28–42).
    await expect(sched.locator('.schedc-wd')).toHaveCount(7);
    const days = sched.locator('.schedc-slot-day');
    const n = await days.count();
    expect(n).toBeGreaterThanOrEqual(28);
    expect(n % 7).toBe(0);
    // Exactly one today, and the header title is the current month.
    await expect(sched.locator('.schedc-slot-day.is-today')).toHaveCount(1);
    const expectTitle = await page.evaluate(() => {
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const d = new Date();
      return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    });
    await expect(sched.locator('.schedc-title')).toHaveText(expectTitle);
    // The default active view is Month.
    await expect(sched.locator('.schedc-pill-btn.is-active')).toHaveText('M');
  });

  test('the view pill switches Month → Week → Day → Hour', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');

    await sched.getByRole('button', { name: 'Week view' }).click();
    await expect(sched.locator('.schedc-slot-day')).toHaveCount(7);
    await expect(sched.locator('.schedc-wd')).toHaveCount(7);

    await sched.getByRole('button', { name: 'Day view' }).click();
    // All-day band + the default 8–18 hour window.
    await expect(sched.locator('.schedc-slot-day.is-band')).toHaveCount(1);
    await expect(sched.locator('.schedc-slot-hour')).toHaveCount(10);
    await expect(sched.locator('.schedc-slot-hour .schedc-time-label').first()).toHaveText('8 AM');

    await sched.getByRole('button', { name: 'Hour view' }).click();
    // Whole-hour band + 4 quarter-hour rows.
    await expect(sched.locator('.schedc-slot-hour.is-band')).toHaveCount(1);
    await expect(sched.locator('.schedc-slot-minute')).toHaveCount(4);

    await sched.getByRole('button', { name: 'Month view' }).click();
    await expect(sched.locator('.schedc-slot-day.is-today')).toHaveCount(1);
  });

  test('month navigation moves the anchor and Today returns', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const startTitle = await sched.locator('.schedc-title').textContent();

    await sched.getByRole('button', { name: 'Next' }).click();
    const nextTitle = await sched.locator('.schedc-title').textContent();
    expect(nextTitle).not.toBe(startTitle);
    // A month away from today: no today highlight.
    await expect(sched.locator('.schedc-slot-day.is-today')).toHaveCount(0);

    await sched.getByRole('button', { name: 'Previous' }).click();
    await sched.getByRole('button', { name: 'Previous' }).click();
    await expect(sched.locator('.schedc-title')).not.toHaveText(startTitle);

    await sched.getByRole('button', { name: 'Go to today' }).click();
    await expect(sched.locator('.schedc-title')).toHaveText(startTitle);
    await expect(sched.locator('.schedc-slot-day.is-today')).toHaveCount(1);
  });

  test('hour view navigation rolls across midnight', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    await sched.getByRole('button', { name: 'Hour view' }).click();
    // Anchor hour defaults to 9 AM.
    await expect(sched.locator('.schedc-title')).toContainText('9 AM');
    // 9 → back 10 hours → 11 PM yesterday (title shows the rolled date + hour).
    for (let i = 0; i < 10; i++) await sched.getByRole('button', { name: 'Previous' }).click();
    await expect(sched.locator('.schedc-title')).toContainText('11 PM');
  });

  // Click a slot to focus it, then paste — the slot auto-formats by clipboard
  // type and APPENDS (multi-item slots mint a fresh item key per write).
  async function pasteInto(page, text) {
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
  }

  // The hover "+" on a slot opens the portaled add menu; pick an option.
  async function addViaSlotMenu(page, slot, option) {
    await slot.hover();
    await slot.locator('.schedc-mini').click();
    const menu = page.locator('.gridc-cell-menu');
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: option, exact: true }).click();
  }

  test('slot add-menu appends text items: 1 renders full-bleed, 2 stack as chips', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const slot = sched.locator('.schedc-slot-day:not(.is-outside)').nth(8);

    await addViaSlotMenu(page, slot, 'Text');
    // A fresh text item opens in edit mode (autoFocus editor) — type + commit on blur.
    await expect(slot.locator('.gc-text-edit')).toBeVisible();
    await page.keyboard.type('Call sheet');
    await page.locator('.canvas-wrap').click({ position: { x: 30, y: 500 } });
    // One item in a comfortable day cell renders full-bleed like a grid cell.
    await expect(slot.locator('.schedc-item-full .gc-text')).toContainText('Call sheet');

    await addViaSlotMenu(page, slot, 'Text');
    await expect(slot.locator('.gc-text-edit')).toBeVisible();
    await page.keyboard.type('Scout notes');
    await page.locator('.canvas-wrap').click({ position: { x: 30, y: 500 } });
    // Two items → compact chips (append, never replace).
    await expect(slot.locator('.schedc-chip.is-text')).toHaveCount(2);
  });

  test('paste a URL into a focused day slot → a link item; a second paste appends', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const slot = sched.locator('.schedc-slot-day:not(.is-outside)').nth(10);
    await slot.click({ position: { x: 8, y: 5 } });
    await expect(sched.locator('.schedc-slot.is-focused')).toHaveCount(1);

    await pasteInto(page, 'https://example.com/callsheet');
    await expect(slot.locator('.schedc-item-full .gc-link')).toContainText('example.com');

    // Focus again (background click cleared it) and paste a second URL — the
    // slot appends a second item instead of replacing the first.
    await slot.click({ position: { x: 8, y: 5 } });
    await pasteInto(page, 'https://soleilpictures.com/board');
    await expect(slot.locator('.schedc-chip.is-link')).toHaveCount(2);
  });

  test('paste with a CHIP focused replaces that item in place', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const slot = sched.locator('.schedc-slot-day:not(.is-outside)').nth(12);
    await slot.click({ position: { x: 8, y: 5 } });
    await pasteInto(page, 'first note');
    await slot.click({ position: { x: 8, y: 5 } });
    await pasteInto(page, 'second note');
    await expect(slot.locator('.schedc-chip.is-text')).toHaveCount(2);

    // Clicking a chip focuses the ITEM key (capture handler), so a paste
    // REPLACES that item — still 2 chips, one rewritten.
    await slot.locator('.schedc-chip.is-text').first().click();
    await pasteInto(page, 'rewritten');
    await expect(slot.locator('.schedc-chip.is-text')).toHaveCount(2);
    await expect(slot.locator('.schedc-chip.is-text', { hasText: 'rewritten' })).toHaveCount(1);
  });

  test('the chip × and the full-bleed corner × truly remove items', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const slot = sched.locator('.schedc-slot-day:not(.is-outside)').nth(15);
    await slot.click({ position: { x: 8, y: 5 } });
    await pasteInto(page, 'keep me');
    await slot.click({ position: { x: 8, y: 5 } });
    await pasteInto(page, 'remove me');
    await expect(slot.locator('.schedc-chip.is-text')).toHaveCount(2);

    // Hover × removes one chip; the survivor collapses back to full-bleed.
    const victim = slot.locator('.schedc-chip.is-text', { hasText: 'remove me' });
    await victim.hover();
    await victim.locator('.schedc-chip-x').click();
    await expect(slot.locator('.schedc-item-full .gc-text')).toContainText('keep me');

    // The full-bleed corner × removes the last item — the slot is empty again.
    await slot.hover();
    await slot.locator('.schedc-item-x').click();
    await expect(slot.locator('.schedc-item-full')).toHaveCount(0);
    await expect(slot.locator('.schedc-chip')).toHaveCount(0);
  });

  test('a LEGACY rows-table schedule card still renders the old table', async ({ page }) => {
    // The seeded (non-blank) local workspace carries the legacy fixture card
    // ("6-day shoot · v3" — rows of day/what/loc) on the Sundown Highway
    // board. It must keep the static table render, NOT the calendar container.
    await page.goto('/?local=1&reset=1');
    await page.waitForSelector('.canvas-wrap');
    // Navigate to the board holding the fixture via the command palette.
    await page.locator('.sb-search').click();
    await page.locator('.cmdk-input').fill('Sundown');
    await expect(page.locator('.cmdk-row.is-active').first()).toContainText('Sundown Highway');
    await page.keyboard.press('Enter');
    const legacy = page.locator('.card-kind-schedule .sched');
    await expect(legacy.first()).toBeVisible();
    await expect(legacy.first().locator('.sched-row').first()).toBeVisible();
    await expect(page.locator('.card-kind-schedule .schedc')).toHaveCount(0);
  });
});
