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

  test('break a day into inline hour rows from the slot menu; collapse via right-click', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const slot = sched.locator('.schedc-slot-day:not(.is-outside)').nth(8);

    await slot.hover();
    await slot.locator('.schedc-mini').click();
    await page.locator('.gridc-cell-menu').getByRole('button', { name: 'Break into hours' }).click();
    // The day subdivides INLINE in the month grid (default 8–18 window).
    await expect(sched.locator('.schedc-slot-day.is-expanded')).toHaveCount(1);
    await expect(sched.locator('.schedc-slot-hour')).toHaveCount(10);

    // Focus the expanded day (its date strip) → right-click → Collapse day.
    await slot.click({ position: { x: 8, y: 5 } });
    await page.locator('.card-kind-schedule').dispatchEvent('contextmenu');
    await page.locator('.ctx-menu').getByText('Collapse day', { exact: true }).click();
    await expect(sched.locator('.schedc-slot-day.is-expanded')).toHaveCount(0);
    await expect(sched.locator('.schedc-slot-hour')).toHaveCount(0);
  });

  test('an hour item aggregates into its (collapsed) day in month view', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    // Day view: put a text item into the 9 AM hour row.
    await sched.getByRole('button', { name: 'Day view' }).click();
    const nineAm = sched.locator('.schedc-slot-hour').nth(1);
    await addViaSlotMenu(page, nineAm, 'Text');
    await expect(nineAm.locator('.gc-text-edit')).toBeVisible();
    await page.keyboard.type('Dailies review');
    await page.locator('.canvas-wrap').click({ position: { x: 30, y: 700 } });
    // (chip or full-bleed depending on row height — either way it's in the slot)
    await expect(nineAm).toContainText('Dailies review');

    // Month view: the (collapsed) day aggregates the hour-deep item — the
    // breakdown content is never invisible.
    await sched.getByRole('button', { name: 'Month view' }).click();
    await expect(sched.locator('.schedc-slot-day.is-today .schedc-item-full .gc-text')).toContainText('Dailies review');
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

test.describe('schedule — day peek panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
  });

  async function pasteInto(page, text) {
    await page.evaluate((t) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', t);
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, text);
  }

  // The peek's deterministic English titles (mirrors lib/schedDates.js).
  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayTitleOf = (d) => `${WD[(d.getDay() + 6) % 7]}, ${MS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  async function openTodayPeek(page) {
    const today = page.locator('.schedc .schedc-slot-day.is-today');
    await today.hover();
    await today.locator('.schedc-peek-btn').click();
    const panel = page.locator('.schedc-peekpanel');
    await expect(panel).toBeVisible();
    return panel;
  }

  test('the day peek opens from a day slot with big hour rows, without touching card state', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);

    // Full-size hour rows (default 8–18 window → 10 rows), every one of them
    // comfortably tall — the whole point of the peek.
    const rows = panel.locator('.schedc-slot-hour:not(.is-band)');
    await expect(rows).toHaveCount(10);
    for (let i = 0; i < 10; i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box.height).toBeGreaterThan(36);
    }
    await expect(panel.locator('.schedc-peektitle')).toHaveText(dayTitleOf(new Date()));
    // The card itself is untouched: still Month view, still this month.
    await expect(page.locator('.schedc .schedc-pill-btn.is-active')).toHaveText('M');
  });

  test('panel ‹ › steps the peeked day locally — the card title never changes', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const cardTitle = await page.locator('.schedc .schedc-title').textContent();

    await panel.getByRole('button', { name: 'Next day' }).click();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await expect(panel.locator('.schedc-peektitle')).toHaveText(dayTitleOf(tomorrow));
    await expect(page.locator('.schedc .schedc-title')).toHaveText(cardTitle);
  });

  test('Esc, outside click, and ✕ all close the peek; Esc yields to an open slot menu', async ({ page }) => {
    await addSchedule(page);
    let panel = await openTodayPeek(page);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    // Esc was captured by the panel — the card must still be selected/rendered.
    await expect(page.locator('.schedc')).toBeVisible();

    panel = await openTodayPeek(page);
    await page.locator('.canvas-wrap').click({ position: { x: 20, y: 400 } });
    await expect(panel).toHaveCount(0);

    panel = await openTodayPeek(page);
    // Open a slot menu INSIDE the panel: first Esc closes only the menu.
    const row = panel.locator('.schedc-slot-hour:not(.is-band)').nth(2);
    await row.hover();
    await row.locator('.schedc-mini').click();
    await expect(page.locator('.gridc-cell-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.gridc-cell-menu')).toHaveCount(0);
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
  });

  test('pasting into a panel hour row lands the item on BOTH surfaces', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);

    // Focus the 9 AM row (empty → slot focus) and paste a URL.
    const nineAm = panel.locator('.schedc-slot-hour:not(.is-band)').nth(1);
    await nineAm.click({ position: { x: 200, y: 22 } });
    await expect(panel.locator('.schedc-slot.is-focused')).toHaveCount(1);
    await pasteInto(page, 'https://example.com/callsheet');

    // One item in a 44px row renders full-bleed in the panel…
    await expect(nineAm.locator('.schedc-item-full .gc-link')).toContainText('example.com');
    // …and the SAME item aggregates into today's (collapsed) month cell on the card.
    await expect(page.locator('.schedc .schedc-slot-day.is-today .schedc-item-full .gc-link')).toBeVisible();
  });

  test('the slot menu works inside the panel: break an hour into minutes inline', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const tenAm = panel.locator('.schedc-slot-hour:not(.is-band)').nth(2);
    await tenAm.hover();
    await tenAm.locator('.schedc-mini').click();
    await page.locator('.gridc-cell-menu').getByRole('button', { name: 'Break into minutes' }).click();
    await expect(panel.locator('.schedc-slot-minute')).toHaveCount(4);
  });

  test('"+N more" opens the peek instead of flipping the shared card view', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const slot = sched.locator('.schedc-slot-day:not(.is-outside)').nth(9);
    for (const url of ['https://a.example/1', 'https://b.example/2', 'https://c.example/3', 'https://d.example/4']) {
      await slot.click({ position: { x: 8, y: 5 } });
      await pasteInto(page, url);
    }
    const more = slot.locator('.schedc-chip.is-more');
    await expect(more).toBeVisible();
    await more.click();
    await expect(page.locator('.schedc-peekpanel')).toBeVisible();
    // The card did NOT drill into Day view (that was the old shared-state behavior).
    await expect(sched.locator('.schedc-pill-btn.is-active')).toHaveText('M');
  });

  test('the panel never inherits the canvas transform — full-size rows at any zoom', async ({ page }) => {
    await addSchedule(page);
    // Zoom the canvas well out (the wheel listener lives on .canvas-wrap).
    await page.locator('.canvas-wrap').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      for (let i = 0; i < 6; i++) {
        node.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true, deltaY: 120, ctrlKey: true,
          clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
        }));
      }
    });
    const scale = await page.locator('.canvas').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    expect(scale).toBeLessThan(0.9);

    // The peek still opens at full, unscaled size beside the (tiny) day cell.
    const panel = await openTodayPeek(page);
    const rows = panel.locator('.schedc-slot-hour:not(.is-band)');
    await expect(rows).toHaveCount(10);
    const box = await rows.first().boundingBox();
    expect(box.height).toBeGreaterThan(36);
  });

  test('hour peek: a panel hour row zooms to full-size minute rows and back', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const nineAm = panel.locator('.schedc-slot-hour:not(.is-band)').nth(1);
    await nineAm.hover();
    await nineAm.locator('.schedc-peek-btn').click();

    // Same panel, re-targeted: 4 quarter-hour rows at full size.
    const minutes = panel.locator('.schedc-slot-minute');
    await expect(minutes).toHaveCount(4);
    const box = await minutes.first().boundingBox();
    expect(box.height).toBeGreaterThan(40);
    await expect(panel.locator('.schedc-peektitle')).toContainText('9 AM');

    await panel.getByRole('button', { name: 'Back to day' }).click();
    await expect(panel.locator('.schedc-slot-hour:not(.is-band)')).toHaveCount(10);
  });
});
