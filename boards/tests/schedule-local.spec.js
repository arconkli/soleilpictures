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
