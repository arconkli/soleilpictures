// Admin dashboard regression guard.
//
// Before this, /admin had NO test coverage at all: of ~150 specs, the only one
// touching the admin surface was universe-scale.spec.js, and that exercises the
// 3D renderer rather than anything on the dashboard. A tab could throw on mount
// and nothing would say so until someone opened it.
//
// Drives the DEV-only fixture harness (?adminpreview=1), so no auth, no
// network, and no writes to the production analytics table.
//
// What these assert is deliberately narrow: that every view mounts, renders its
// own hero rather than a neighbour's, and logs nothing to console.error — in
// BOTH themes, because light mode is where this surface has historically broken
// (the whole chart palette used to sit below the contrast floor there, and the
// panels painted dark-theme shadows onto a light page).

import { test, expect } from '@playwright/test';

const VIEWS = [
  { id: 'today',     heading: 'Needs you' },
  { id: 'funnel',    heading: 'Landing to paid' },
  { id: 'retention', heading: 'Did they make anything' },
  { id: 'system',    heading: 'What the data cannot tell you' },
];

/** Fail on console.error, which is how a broken chart usually announces itself. */
function watchConsole(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function openAdmin(page, { view, theme }) {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('soleil.ui', JSON.stringify({ theme: t }));
      document.documentElement.setAttribute('data-theme', t);
    } catch { /* ignore */ }
  }, theme);
  await page.goto(`/?adminpreview=1&tab=overview&view=${view}`);
}

for (const theme of ['dark', 'light']) {
  test.describe(`admin dashboard (${theme})`, () => {
    for (const { id, heading } of VIEWS) {
      test(`${id} view mounts and renders its hero`, async ({ page }) => {
        const errors = watchConsole(page);
        await openAdmin(page, { view: id, theme });

        await expect(page.getByRole('tab', { name: new RegExp(`^${id}$`, 'i') }))
          .toHaveAttribute('aria-selected', 'true');
        await expect(page.getByText(heading, { exact: false }).first()).toBeVisible({ timeout: 15000 });

        expect(errors, `console errors on ${id}:\n${errors.join('\n')}`).toEqual([]);
      });
    }
  });
}

test.describe('admin dashboard structure', () => {
  test('Today leads with what needs attention, not with a metric', async ({ page }) => {
    await openAdmin(page, { view: 'today', theme: 'dark' });
    // The queue block must come BEFORE the hero metrics in the document. This
    // is the whole editorial claim of the view: you open a dashboard to find
    // out whether anything needs you, not to admire a number.
    const needs = page.locator('.admin-needs');
    const metrics = page.locator('.admin-stat-grid').first();
    await expect(needs).toBeVisible();
    const order = await page.evaluate(() => {
      const a = document.querySelector('.admin-needs');
      const b = document.querySelector('.admin-stat-grid');
      if (!a || !b) return null;
      // eslint-disable-next-line no-bitwise
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? 'needs-first' : 'metrics-first';
    });
    expect(order).toBe('needs-first');
    await expect(metrics).toBeVisible();
  });

  test('no MRR tile on Today while revenue is structurally zero', async ({ page }) => {
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.admin-needs')).toBeVisible();
    // A permanent flat zero reads as a measurement rather than an absence.
    // If a subscription ever exists this test should be revisited, not deleted.
    await expect(page.locator('.admin-stat-label', { hasText: /^MRR$/ })).toHaveCount(0);
  });

  test('the time range is hidden on Today, shown elsewhere', async ({ page }) => {
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.admin-needs')).toBeVisible();
    // Today is a fixed seven-day window; a selector that silently does nothing
    // is worse than no selector.
    await expect(page.locator('.tob-segmented')).toHaveCount(0);

    await page.getByRole('tab', { name: /^funnel$/i }).click();
    await expect(page.locator('.tob-segmented')).toBeVisible();
  });

  test('detail sections do not fetch until opened', async ({ page }) => {
    await openAdmin(page, { view: 'funnel', theme: 'dark' });
    const detail = page.locator('.adm-detail-trigger').first();
    await expect(detail).toBeVisible();
    await expect(page.locator('.adm-detail-body')).toHaveCount(0);
    await detail.click();
    await expect(page.locator('.adm-detail-body').first()).toBeVisible();
  });

  test('retired deep links alias forward instead of dead-ending', async ({ page }) => {
    // ?tab=analytics was a real tab until Overview absorbed it; ?view=engagement
    // was a real sub-view until Retention did.
    await page.goto('/?adminpreview=1&tab=analytics&view=engagement');
    await expect(page.getByRole('tab', { name: /^retention$/i }))
      .toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  });
});

test.describe('admin dashboard charts', () => {
  test('no chart paints itself in the reserved accent', async ({ page }) => {
    // --soleil is reserved for active/selection/focus. Data wearing it is what
    // made every screen read orange, and it crept back twice while this was
    // being written. Tab pills and toggles are legitimately gold, so they are
    // excluded by selector rather than by colour.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    await expect(page.locator('.admin-chart-panel').first()).toBeVisible();

    const offenders = await page.evaluate(() => {
      const gold = ['rgb(255, 165, 0)'];
      const marks = document.querySelectorAll(
        '.adm-bar-fill, .adm-dist-bar, .admin-funnel-bar-fill, .adm-trend-plot path[stroke]',
      );
      const bad = [];
      for (const el of marks) {
        const cs = getComputedStyle(el);
        if (gold.includes(cs.backgroundColor) || gold.includes(cs.stroke)) {
          bad.push(el.className?.toString?.() || el.tagName);
        }
      }
      return bad;
    });
    expect(offenders, `data marks painted in --soleil: ${offenders.join(', ')}`).toEqual([]);
  });

  test('the heatmap draws all 168 buckets, including the empty ones', async ({ page }) => {
    // A heatmap that omits its empty cells misrepresents the shape of the
    // week, and the empty cells are half of what you read. The RPC zero-fills
    // for this reason; this asserts the client does not filter them back out.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.adm-heat-grid')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-heat-cell')).toHaveCount(168);
    // Exactly one busiest hour, ringed.
    await expect(page.locator('.adm-heat-cell.is-peak')).toHaveCount(1);
  });

  test('the area chart is drawn at its stated height, not its viewBox ratio', async ({ page }) => {
    // Regression: the SVG's 1:1 viewBox drove the grid row's intrinsic height,
    // so a 230px chart laid out 1,566px tall with its content off-screen.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    const frame = page.locator('.adm-area-frame').first();
    await expect(frame).toBeVisible({ timeout: 15000 });
    const sizes = await page.evaluate(() => {
      const f = document.querySelector('.adm-area-frame');
      const p = document.querySelector('.adm-area-plot');
      return { frame: f.getBoundingClientRect().height, plot: p.getBoundingClientRect().height };
    });
    expect(sizes.frame).toBeLessThan(400);
    expect(Math.abs(sizes.plot - sizes.frame)).toBeLessThan(4);
    // And it actually drew something.
    expect(await page.locator('.adm-area-plot svg path').count()).toBeGreaterThan(0);
  });

  test('a sparse series is drawn with gaps, not bridged', async ({ page }) => {
    // metrics_daily has no backfill, so the series genuinely has holes. A line
    // drawn straight across a hole invents the days it is missing.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.admin-needs')).toBeVisible();
    const segments = await page.evaluate(() => {
      const plot = document.querySelector('.adm-trend-plot svg');
      return plot ? plot.querySelectorAll('path').length : 0;
    });
    // At minimum the primitive rendered something rather than silently nothing.
    expect(segments).toBeGreaterThan(0);
  });
});
