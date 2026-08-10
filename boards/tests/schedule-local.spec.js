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

  // NOTE (click-into-day): month/week cells are read-only tiles — all slot
  // editing (add menu, paste, ×-removal, breakdown) lives in the Day Peek and
  // is covered by the 'day peek panel' describe below.

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

  // Click-into-day: a plain click anywhere on a month day cell opens its peek.
  // Center click (default) — cell content is pass-through ink, and at deep
  // zoom-out an edge offset can round into the neighboring cell.
  async function openTodayPeek(page) {
    const today = page.locator('.schedc .schedc-slot-day.is-today');
    await today.click();
    const panel = page.locator('.schedc-peekpanel');
    await expect(panel).toBeVisible();
    return panel;
  }

  // Commit an in-panel text edit by blurring into another row's empty area
  // (clicking OUTSIDE the panel would dismiss it).
  async function blurEditor(page, panel) {
    await panel.locator('.schedc-slot-hour:not(.is-band)').last().click({ position: { x: 200, y: 30 } });
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

  test('peek add-menu appends text: 1 full-bleed, then chips — the month cell mirrors passively', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const row = panel.locator('.schedc-slot-hour:not(.is-band)').nth(3); // 11 AM
    const menu = page.locator('.gridc-cell-menu');

    await row.hover();
    await row.locator('.schedc-mini').click();
    await menu.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(row.locator('.gc-text-edit')).toBeVisible();
    await page.keyboard.type('Call sheet');
    await blurEditor(page, panel);
    await expect(row.locator('.schedc-item-full .gc-text')).toContainText('Call sheet');

    await row.hover();
    await row.locator('.schedc-mini').click();
    await menu.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(row.locator('.gc-text-edit')).toBeVisible();
    await page.keyboard.type('Scout notes');
    await blurEditor(page, panel);
    await expect(row.locator('.schedc-chip.is-text')).toHaveCount(2);
    // The (read-only) month cell mirrors the aggregation.
    await expect(page.locator('.schedc .schedc-slot-day.is-today .schedc-chip.is-text')).toHaveCount(2);
  });

  test('paste appends in a peek row; a focused chip paste replaces in place', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const row = panel.locator('.schedc-slot-hour:not(.is-band)').nth(1); // 9 AM
    await row.click({ position: { x: 200, y: 30 } });
    await expect(panel.locator('.schedc-slot.is-focused')).toHaveCount(1);
    await pasteInto(page, 'first note');
    await pasteInto(page, 'second note'); // slot focus survives → append
    await expect(row.locator('.schedc-chip.is-text')).toHaveCount(2);

    // Clicking a chip focuses the ITEM key — a paste REPLACES it in place.
    await row.locator('.schedc-chip.is-text').first().click();
    await pasteInto(page, 'rewritten');
    await expect(row.locator('.schedc-chip.is-text')).toHaveCount(2);
    await expect(row.locator('.schedc-chip.is-text', { hasText: 'rewritten' })).toHaveCount(1);
  });

  test('chip × and the full-bleed corner × remove items from the peek', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const row = panel.locator('.schedc-slot-hour:not(.is-band)').nth(2); // 10 AM
    await row.click({ position: { x: 200, y: 30 } });
    await pasteInto(page, 'keep me');
    await pasteInto(page, 'remove me');
    await expect(row.locator('.schedc-chip.is-text')).toHaveCount(2);

    const victim = row.locator('.schedc-chip.is-text', { hasText: 'remove me' });
    await victim.hover();
    await victim.locator('.schedc-chip-x').click();
    await expect(row.locator('.schedc-item-full .gc-text')).toContainText('keep me');

    await row.hover();
    await row.locator('.schedc-item-x').click();
    await expect(row.locator('.schedc-item-full')).toHaveCount(0);
    await expect(row.locator('.schedc-chip')).toHaveCount(0);
  });

  test('the "Hours on grid" toggle drives the inline breakdown from the peek', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const panel = await openTodayPeek(page);
    const toggle = panel.getByRole('button', { name: 'Hours on grid' });

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Card-scoped asserts — the panel has hour rows of its own.
    await expect(sched.locator('.schedc-slot-day.is-expanded')).toHaveCount(1);
    await expect(sched.locator('.schedc-slot-hour')).toHaveCount(10);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(sched.locator('.schedc-slot-day.is-expanded')).toHaveCount(0);
    await expect(sched.locator('.schedc-slot-hour')).toHaveCount(0);
  });

  test('clicking a month day cell opens its peek; the grid carries no edit chrome', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const today = sched.locator('.schedc-slot-day.is-today');
    await today.hover();
    // No hover chrome on grid cells anymore — the whole cell is the button.
    await expect(sched.locator('.schedc-mini')).toHaveCount(0);
    await expect(sched.locator('.schedc-peek-btn')).toHaveCount(0);
    await today.click({ position: { x: 8, y: 5 } });
    const panel = page.locator('.schedc-peekpanel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.schedc-peektitle')).toHaveText(dayTitleOf(new Date()));
  });

  test('a drag that starts on a day cell never opens the peek', async ({ page }) => {
    await addSchedule(page);
    const today = page.locator('.schedc .schedc-slot-day.is-today');
    const box = await today.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 25);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 25, { steps: 5 }); // >4px — a card drag
    await page.mouse.up();
    await expect(page.locator('.schedc-peekpanel')).toHaveCount(0);
  });

  test('clicking another day retargets the open panel in place', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const panel = await openTodayPeek(page);
    const before = await panel.locator('.schedc-peektitle').textContent();

    const other = sched.locator('.schedc-slot-day:not(.is-outside):not(.is-today)').first();
    await other.click({ position: { x: 8, y: 5 } });
    await expect(page.locator('.schedc-peekpanel')).toHaveCount(1);
    await expect(panel.locator('.schedc-peektitle')).not.toHaveText(before);
  });

  test('day/hour rows carry legible 22px chips with a clean overflow badge', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const row = panel.locator('.schedc-slot-hour:not(.is-band)').nth(1);
    await row.click({ position: { x: 200, y: 30 } });
    await expect(panel.locator('.schedc-slot.is-focused')).toHaveCount(1);
    await pasteInto(page, 'alpha');
    await pasteInto(page, 'beta');
    await pasteInto(page, 'gamma');

    // 48px row at 22px row-chips → capacity 2 → one chip + a "+2" badge.
    const chips = row.locator('.schedc-chip.is-text');
    await expect(chips).toHaveCount(1);
    const more = row.locator('.schedc-chip.is-more');
    await expect(more).toContainText('+2');

    const cs = await chips.first().evaluate((el) => ({
      fs: getComputedStyle(el).fontSize, h: el.getBoundingClientRect().height,
    }));
    expect(cs.fs).toBe('11.5px');
    expect(Math.round(cs.h)).toBe(22);
    // Nothing clips mid-glyph — every chip box sits inside its row box.
    const rb = await row.boundingBox();
    const mb = await more.boundingBox();
    expect(mb.y + mb.height).toBeLessThanOrEqual(rb.y + rb.height + 0.5);
  });

  test('clicking over a full-bleed month item still opens the peek (pass-through ink)', async ({ page }) => {
    await addSchedule(page);
    const panel = await openTodayPeek(page);
    const band = panel.locator('.schedc-slot-day.is-band');
    await band.click({ position: { x: 200, y: 11 } });
    await pasteInto(page, 'https://example.com/one');
    await page.keyboard.press('Escape');
    await expect(page.locator('.schedc-peekpanel')).toHaveCount(0);

    const today = page.locator('.schedc .schedc-slot-day.is-today');
    await expect(today.locator('.schedc-item-full .gc-link')).toBeVisible();
    await today.click({ position: { x: 30, y: 35 } }); // squarely over the item
    await expect(page.locator('.schedc-peekpanel')).toBeVisible();
  });

  test('an overflowing day shows a passive "+N more"; clicking the CELL opens the peek', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    // Seed 4 items into today via the peek's all-day band (grid cells are
    // read-only now — the band is the day-level slot inside the panel). One
    // focus click while the band is still empty, then paste-append ×4 (slot
    // focus survives pastes; re-clicking would land on freshly minted chips).
    const panel = await openTodayPeek(page);
    const band = panel.locator('.schedc-slot-day.is-band');
    await band.click({ position: { x: 200, y: 11 } });
    await expect(panel.locator('.schedc-slot.is-focused')).toHaveCount(1);
    for (const url of ['https://a.example/1', 'https://b.example/2', 'https://c.example/3', 'https://d.example/4']) {
      await pasteInto(page, url);
    }
    await expect(band.locator('.schedc-chip.is-more')).toContainText('+');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);

    // The month cell overflows into a passive "+N more" marker (not a button).
    const today = sched.locator('.schedc-slot-day.is-today');
    await expect(today.locator('.schedc-chip.is-more')).toBeVisible();
    // Clicking the CELL (chips are pass-through ink) re-opens the peek; the
    // card never flips its shared view.
    await today.click({ position: { x: 8, y: 5 } });
    await expect(page.locator('.schedc-peekpanel')).toBeVisible();
    await expect(sched.locator('.schedc-pill-btn.is-active')).toHaveText('M');
  });

  test('the panel never inherits the canvas transform — full-size rows at any zoom', async ({ page }) => {
    await addSchedule(page);
    // Zoom well out — MID tier: day cells still exist (the density map).
    // FAR-tier click-through is covered by the LOD poster test.
    for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Minus');
    await page.waitForTimeout(320);
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

test.describe('schedule — visual pass', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
  });

  test('month view carries the view class and tints weekend columns', async ({ page }) => {
    await addSchedule(page);
    await expect(page.locator('.schedc.is-view-month')).toBeVisible();
    // A full month grid always shows at least 4 Sat+Sun pairs.
    const weekendCells = await page.locator('.schedc .schedc-slot-day.is-weekend').count();
    expect(weekendCells).toBeGreaterThanOrEqual(8);
    expect(weekendCells % 2).toBe(0);
  });

  test('day view shows the live now-line exactly when the current hour is visible', async ({ page }) => {
    await addSchedule(page);
    await page.locator('.schedc').getByRole('button', { name: 'Day view' }).click();
    await expect(page.locator('.schedc.is-view-day')).toBeVisible();
    // Default window is 8–18; the line renders only when "now" falls inside it.
    const h = new Date().getHours();
    await expect(page.locator('.schedc .schedc-nowline')).toHaveCount(h >= 8 && h < 18 ? 1 : 0);
  });

  test('inline hour rows stripe alternating hours and mute sliver rows', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    // Inline breakdown is driven from the peek now ("Hours on grid").
    await sched.locator('.schedc-slot-day.is-today').click({ position: { x: 8, y: 5 } });
    const panel = page.locator('.schedc-peekpanel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Hours on grid' }).click();
    await page.keyboard.press('Escape');
    // 8–18 window → odd hours 9/11/13/15/17 stripe as .is-alt…
    await expect(sched.locator('.schedc-slot-hour.is-alt')).toHaveCount(5);
    // …and rows this small (~5px in a month cell) mute their chrome.
    await expect(sched.locator('.schedc-slot-hour.is-sliver').first()).toBeAttached();
  });
});

test.describe('schedule — zoomed-out LOD', () => {
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

  const canvasScale = (page) => page.locator('.canvas')
    .evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

  // Keyboard zoom: Ctrl+Minus/Equal step the SETTLED zoom by exactly ×0.8/×1.25
  // per press (zoomAroundCenter) — deterministic, unlike synthetic ctrl-wheel
  // which the pinch pipeline slams straight to ZOOM_MIN. The 320ms wait lets
  // the smooth-transform transition finish so computed-matrix reads are exact.
  async function pressZoom(page, presses, dir) {
    for (let i = 0; i < presses; i++) {
      await page.keyboard.press(dir < 0 ? 'Control+Minus' : 'Control+Equal');
    }
    await page.waitForTimeout(320);
  }

  test('mid tier: chips give way to a counter-scaled density map, then zooming back restores full', async ({ page }) => {
    await addSchedule(page);
    // Seed 2 items into today via the peek band.
    const today = page.locator('.schedc .schedc-slot-day.is-today');
    await today.click();
    const panel = page.locator('.schedc-peekpanel');
    await expect(panel).toBeVisible();
    await panel.locator('.schedc-slot-day.is-band').click({ position: { x: 200, y: 11 } });
    await pasteInto(page, 'scout');
    await pasteInto(page, 'callsheet');
    await page.keyboard.press('Escape');
    const sched = page.locator('.schedc');
    await expect(sched.locator('.schedc-slot-day.is-today .schedc-chip')).toHaveCount(2);

    await pressZoom(page, 3, -1); // ×0.8³ = 0.512 → MID for a 420×380 month card
    await expect(sched).toHaveClass(/is-lod-mid/);
    // Chips are gone; the density map takes over.
    await expect(sched.locator('.schedc-chip')).toHaveCount(0);
    await expect(sched.locator('.schedc-lod-num').first()).toBeVisible();
    await expect(sched.locator('.schedc-slot-day.is-today .schedc-lod-dot')).toHaveCount(2);
    // The date numbers counter-scale to a readable ON-SCREEN size (~13px).
    const scale = await canvasScale(page);
    const fs = await sched.locator('.schedc-lod-num').first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(Math.abs(fs * scale - 13)).toBeLessThan(2.5);

    await pressZoom(page, 3, 1); // back to ×1.0 exactly
    await expect(sched).not.toHaveClass(/is-lod-mid/);
    await expect(sched.locator('.schedc-slot-day.is-today .schedc-chip')).toHaveCount(2);
  });

  test('far tier: a poster with a dot lattice — lattice days still open the full-size peek', async ({ page }) => {
    await addSchedule(page);
    await pressZoom(page, 6, -1); // ×0.8⁶ ≈ 0.262 → FAR for a 420×380 month card
    const sched = page.locator('.schedc');
    await expect(sched).toHaveClass(/is-lod-far/);
    await expect(sched.locator('.schedc-poster-title')).toBeVisible();
    await expect(sched.locator('.schedc-slot-day')).toHaveCount(0); // grid replaced

    // The poster is still the calendar: clicking a lattice day opens the peek
    // at full, unscaled size.
    await sched.locator('.schedc-poster-day:not(.is-outside)').nth(10).click();
    const panel = page.locator('.schedc-peekpanel');
    await expect(panel).toBeVisible();
    const box = await panel.locator('.schedc-slot-hour:not(.is-band)').first().boundingBox();
    expect(box.height).toBeGreaterThan(36);
  });
});

test.describe('schedule — date-jump popover', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?local=1&reset=1&blank=1');
    await page.waitForSelector('.canvas-wrap');
  });

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthTitleOf = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  async function openPopover(page) {
    await page.locator('.schedc .schedc-title').click();
    const pop = page.locator('.schedc-datepop');
    await expect(pop).toBeVisible();
    return pop;
  }

  test('title click opens the mini calendar; picking a date jumps the anchor', async ({ page }) => {
    await addSchedule(page);
    const pop = await openPopover(page);

    // Step the POPOVER back one month and pick the 15th — the card jumps
    // straight there (no seven ‹ clicks).
    await pop.getByRole('button', { name: 'Previous month' }).click();
    await pop.locator('.schedc-dp-day:not(.is-outside)', { hasText: /^15$/ }).click();
    await expect(pop).toHaveCount(0);
    const prev = new Date();
    prev.setDate(1); prev.setMonth(prev.getMonth() - 1);
    await expect(page.locator('.schedc .schedc-title')).toContainText(monthTitleOf(prev));
  });

  test('popover ‹ › browses months without touching the card until a pick', async ({ page }) => {
    await addSchedule(page);
    const cardTitle = await page.locator('.schedc .schedc-title').textContent();
    const pop = await openPopover(page);

    await pop.getByRole('button', { name: 'Next month' }).click();
    const next = new Date();
    next.setDate(1); next.setMonth(next.getMonth() + 1);
    await expect(pop.locator('.schedc-dp-title')).toHaveText(monthTitleOf(next));
    await expect(page.locator('.schedc .schedc-title')).toHaveText(cardTitle);
    // Esc closes without picking.
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(page.locator('.schedc .schedc-title')).toHaveText(cardTitle);
  });

  test('the popover Today button returns a wandered card to today', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    const nowTitle = await sched.locator('.schedc-title').textContent();
    await sched.getByRole('button', { name: 'Next' }).click();
    await sched.getByRole('button', { name: 'Next' }).click();
    await expect(sched.locator('.schedc-title')).not.toHaveText(nowTitle);

    const pop = await openPopover(page);
    await pop.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(pop).toHaveCount(0);
    await expect(sched.locator('.schedc-title')).toHaveText(nowTitle);
    await expect(sched.locator('.schedc-slot-day.is-today')).toHaveCount(1);
  });

  test('hour view keeps its anchor hour across a date jump; week view stays week', async ({ page }) => {
    await addSchedule(page);
    const sched = page.locator('.schedc');
    await sched.getByRole('button', { name: 'Hour view' }).click();
    await expect(sched.locator('.schedc-title')).toContainText('9 AM');

    let pop = await openPopover(page);
    await pop.getByRole('button', { name: 'Next month' }).click();
    await pop.locator('.schedc-dp-day:not(.is-outside)', { hasText: /^20$/ }).click();
    // Jumped a month ahead, still parked on 9 AM.
    await expect(sched.locator('.schedc-title')).toContainText('9 AM');
    await expect(sched.locator('.schedc-title')).toContainText('20');

    await sched.getByRole('button', { name: 'Week view' }).click();
    const weekTitle = await sched.locator('.schedc-title').textContent();
    pop = await openPopover(page);
    await pop.getByRole('button', { name: 'Previous month' }).click();
    await pop.getByRole('button', { name: 'Previous month' }).click();
    await pop.locator('.schedc-dp-day:not(.is-outside)', { hasText: /^8$/ }).click();
    await expect(sched.locator('.schedc-pill-btn.is-active')).toHaveText('W');
    await expect(sched.locator('.schedc-title')).not.toHaveText(weekTitle);
  });
});
