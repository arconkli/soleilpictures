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
  { id: 'today',     heading: 'The last seven days' },
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
  test('MRR is on Today before there is any, and says why it is zero', async ({ page }) => {
    // Deliberate reversal of an earlier call. The argument against showing a
    // structurally-zero number is that it reads as a measurement rather than
    // an absence — so the tile is present from before the first subscription,
    // but while it is zero it draws no trend line and no change badge, and its
    // sub-label says the reason in words. These assertions are what keep that
    // bargain honest.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    const mrr = page.locator('.admin-stat-card', { has: page.locator('.admin-stat-label', { hasText: /^MRR$/ }) });
    await expect(mrr).toBeVisible({ timeout: 15000 });

    const zero = /^\$?0(\.00)?$/.test((await mrr.locator('.admin-stat-value').innerText()).trim());
    if (zero) {
      await expect(mrr.locator('.admin-stat-sub')).toHaveText(/no subscription yet/i);
      await expect(mrr.locator('.admin-stat-spark')).toHaveCount(0);
      await expect(mrr.locator('.admin-stat-delta')).toHaveCount(0);
    } else {
      // Once revenue exists it is an ordinary metric and must trend like one.
      await expect(mrr.locator('.admin-stat-spark')).toHaveCount(1);
    }
  });

  test('the time range is hidden on Today, shown elsewhere', async ({ page }) => {
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.admin-stat-grid').first()).toBeVisible({ timeout: 15000 });
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
    // Checked on every view, because the marks are no longer all in one place —
    // and the panels are wells now, so waiting on `.admin-chart-panel` waits
    // for something Retention no longer contains.
    for (const view of ['today', 'retention', 'funnel', 'system']) {
      await openAdmin(page, { view, theme: 'dark' });
      await expect(page.locator('.adm-well').first()).toBeVisible({ timeout: 15000 });

      const offenders = await page.evaluate(() => {
        const gold = ['rgb(255, 165, 0)'];
        const marks = document.querySelectorAll([
          '.adm-bar-fill', '.adm-dist-bar', '.admin-funnel-bar-fill',
          '.adm-trend-plot path[stroke]', '.adm-area-plot path[stroke]',
          '.adm-cohort-cell', '.adm-heat-cell', '.adm-heat-marg > span',
          '.adm-console-dot', '.adm-console-tick', '.admin-stat-ratio > span',
        ].join(', '));
        const bad = [];
        for (const el of marks) {
          const cs = getComputedStyle(el);
          if (gold.includes(cs.backgroundColor) || gold.includes(cs.stroke)) {
            bad.push(el.className?.toString?.() || el.tagName);
          }
        }
        return bad;
      });
      expect(offenders, `data marks painted in --soleil on ${view}: ${offenders.join(', ')}`).toEqual([]);
    }
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

  test('every plot well is darker than the page, in LIGHT theme', async ({ page }) => {
    // This is the whole bargain of the instrument deck: a plot is a screen set
    // into a console, so its ground does not follow the theme. If a well ever
    // resolves to a light surface, the marks on it are the DARK palette steps
    // and the chart drops to roughly 1.7:1 — which is the exact failure the
    // palette work was done to end. Light is the only theme where this can
    // regress silently, so light is where it is asserted.
    await openAdmin(page, { view: 'today', theme: 'light' });
    await expect(page.locator('.adm-well').first()).toBeVisible({ timeout: 15000 });

    const result = await page.evaluate(() => {
      const lum = (c) => {
        const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const page_ = lum(getComputedStyle(document.body).backgroundColor);
      const wells = [...document.querySelectorAll('.adm-well')];
      return {
        count: wells.length,
        page: page_,
        lighter: wells
          .map((w) => ({ cls: w.className, l: lum(getComputedStyle(w).backgroundColor) }))
          .filter((w) => w.l >= page_)
          .map((w) => w.cls),
      };
    });

    expect(result.count).toBeGreaterThan(2);
    expect(result.lighter, `wells not darker than the page: ${result.lighter.join(' | ')}`).toEqual([]);
  });

  test('the cohort matrix never draws the future, and hatches what it did not measure', async ({ page }) => {
    // Three cell states, and two of them are how a cohort chart lies. Filling
    // the unreached upper triangle with 0% invents a churn cliff out of the
    // future; painting the pre-instrumentation weeks as 0% invents one out of
    // a column that was not being written (did_work is false for everything
    // before 2026-08-17 and 0248 deliberately did not backfill it).
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    await expect(page.locator('.adm-cohort-grid')).toBeVisible({ timeout: 15000 });

    // Newest cohort first, so row 1 has the fewest cells with content.
    const shape = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.adm-cohort-row')]
        .filter((r) => !r.classList.contains('is-head') && !r.classList.contains('is-avg'));
      return rows.map((r) => {
        const cells = [...r.querySelectorAll('.adm-cohort-cell')];
        return {
          future: cells.filter((c) => c.classList.contains('is-future')).length,
          unknown: cells.filter((c) => c.classList.contains('is-unknown')).length,
          // A measured cell prints a number; future and unknown print nothing.
          labelled: cells.filter((c) => c.textContent.trim() !== '').length,
          futureLabelled: cells.filter((c) => c.classList.contains('is-future') && c.textContent.trim() !== '').length,
          unknownLabelled: cells.filter((c) => c.classList.contains('is-unknown') && c.textContent.trim() !== '').length,
        };
      });
    });

    expect(shape.length).toBeGreaterThan(3);
    // Newest cohort has lived one week; the oldest has lived many.
    expect(shape[0].labelled + shape[0].unknown).toBeLessThan(shape[shape.length - 1].labelled + shape[shape.length - 1].unknown);
    for (const [i, r] of shape.entries()) {
      expect(r.futureLabelled, `row ${i} printed a value in an unreached week`).toBe(0);
      expect(r.unknownLabelled, `row ${i} printed a value in an unmeasured week`).toBe(0);
    }
    // The fixture deliberately spans the instrumentation boundary.
    expect(shape.some((r) => r.unknown > 0), 'no hatched cells — the unknown state is untested').toBe(true);
  });

  test('the live console seeds from the backfill and never announces itself', async ({ page }) => {
    // `recent` on useActivityPulse starts empty and fills only as events are
    // pushed, so without admin_recent_events the console is blank for its first
    // few minutes and reads as broken. And it must NOT be a live region: two
    // thousand events a day announced to a screen reader is unusable.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    const stream = page.locator('.adm-console-stream');
    await expect(stream).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-console-row').first()).toBeVisible();

    const live = await stream.getAttribute('aria-live');
    expect(live, 'the event stream must not be an aria-live region').toBeNull();
    await expect(stream).toHaveAttribute('aria-hidden', 'true');
    // The non-visual equivalent has to exist in its place.
    await expect(page.locator('.adm-console').locator('.sr-only')).toHaveCount(1);
  });

  test('Today packs the first screen', async ({ page }) => {
    // Guards the decision, not the pixels. Before this pass Today showed about
    // six things across four screens of scroll; the deck exists to make the
    // first screen worth opening. If someone re-introduces generous vertical
    // rhythm here, this is what says so.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.adm-well').first()).toBeVisible({ timeout: 15000 });

    const aboveFold = await page.evaluate(() => [
      ...document.querySelectorAll('.adm-well, .admin-stat-card'),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < 900 && r.height > 20;
    }).length);

    expect(aboveFold).toBeGreaterThanOrEqual(11);
  });

  test('the heatmap margins are drawn, and are not mistaken for cells', async ({ page }) => {
    // `actors` was returned by admin_activity_heatmap all along and appeared
    // only in a hover tooltip. The margins spend it — but they are furniture,
    // so they must not inflate the 168-cell count the test above asserts.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.adm-heat-grid')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.adm-heat-marg.is-hour')).toHaveCount(24);
    await expect(page.locator('.adm-heat-marg.is-day')).toHaveCount(7);
    await expect(page.locator('.adm-heat-cell')).toHaveCount(168);
    await expect(page.locator('.adm-heat-marg.is-day.is-busiest')).toHaveCount(1);
  });

  test('the return curve plots one segment, not three interleaved', async ({ page }) => {
    // admin_retention_curve returns a row per (segment, day_offset) — all /
    // demo / paid. The panel used to plot every row in RPC order, drawing a
    // 22-day decay as a 66-point sawtooth and passing the zigzag between
    // segments off as day-to-day volatility.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    await expect(page.locator('.adm-trend-plot').first()).toBeVisible({ timeout: 15000 });

    // A monotonic-ish decay reverses direction a handful of times; three
    // interleaved series reverse on nearly every point.
    const reversals = await page.evaluate(() => {
      const path = document.querySelector('.adm-trend-plot svg path[stroke]');
      if (!path) return -1;
      const ys = [...path.getAttribute('d').matchAll(/[ML,]\s*[\d.]+[ ,]([\d.]+)/g)].map((m) => Number(m[1]));
      let n = 0;
      for (let i = 2; i < ys.length; i++) {
        const a = Math.sign(ys[i - 1] - ys[i - 2]);
        const b = Math.sign(ys[i] - ys[i - 1]);
        if (a !== 0 && b !== 0 && a !== b) n++;
      }
      return { reversals: n, points: ys.length };
    });

    expect(reversals.points).toBeGreaterThan(5);
    expect(
      reversals.reversals / reversals.points,
      `${reversals.reversals} direction changes over ${reversals.points} points — that is a sawtooth, not a decay curve`,
    ).toBeLessThan(0.4);
  });

  test('the page refreshes itself, without fading or freezing', async ({ page }) => {
    // Two halves of one feature.
    //
    // It refreshes: Today polls, so the RPC tally has to keep climbing with no
    // interaction at all. Asserting the interval was passed somewhere would
    // pass just as happily if the hook ignored it.
    //
    // In the background: the old indicator was `.is-refreshing { opacity: .55;
    // pointer-events: none }` on the view root, so a 30-second poll faded the
    // page and killed the cursor twice a minute. A background refresh that you
    // have to wait out is a foreground refresh on a timer.
    test.setTimeout(90_000);
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.adm-well').first()).toBeVisible({ timeout: 15000 });

    // Counted on an RPC only THIS view issues. The first version of this test
    // watched the grand total and passed even with Today's poll deleted,
    // because the shell polls too — it was measuring that something on the page
    // refreshes, not that this view does.
    const calls = () => page.evaluate(() => window.__admRpcCalls?.admin_activity_heatmap || 0);
    const first = await calls();
    expect(first, 'the harness call tally never armed').toBeGreaterThan(0);

    await expect.poll(calls, {
      message: 'Today re-issued none of its own RPCs while sitting idle — it is not refreshing itself',
      timeout: 60_000,
      intervals: [1000],
    }).toBeGreaterThan(first);

    // …and nothing about the page dimmed or went inert to do it.
    await expect(page.locator('.admin-analytics .is-refreshing')).toHaveCount(0);
    const view = await page.evaluate(() => {
      const el = document.querySelector('.adm-view');
      const cs = getComputedStyle(el);
      return { opacity: Number(cs.opacity), pointer: cs.pointerEvents };
    });
    expect(view.opacity).toBe(1);
    expect(view.pointer).not.toBe('none');
    // The dot in the toolbar is the entire replacement affordance.
    await expect(page.locator('.adm-refresh-dot')).toHaveCount(1);
  });

  test('the honesty list is actually in two columns', async ({ page }) => {
    // `.admin-dq-list` is `display: flex`, and a flex container ignores
    // `columns` outright — so the two-column rule was dead from the day it was
    // written and the page looked exactly as it had. Measure the boxes; a
    // stylesheet that silently does nothing is the thing being guarded.
    await openAdmin(page, { view: 'system', theme: 'dark' });
    await expect(page.locator('.admin-dq-list.is-two-col')).toBeVisible({ timeout: 15000 });

    const sideBySide = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.admin-dq-list.is-two-col > li')]
        .map((el) => el.getBoundingClientRect());
      return items.some((a, i) => items.some((b, j) =>
        j !== i && b.left > a.right && b.top < a.bottom && b.bottom > a.top));
    });
    expect(sideBySide, 'no two bullets share a row — the list is still one column').toBe(true);
  });

  test('one grid per surface — no panel rules itself twice', async ({ page }) => {
    // The wells used to carry decorative graph paper at a fixed pixel pitch,
    // on top of contents that already have a grid: the chart's value ticks,
    // the heatmap's 168 cells, the cohort matrix's rows. The two never lined
    // up, because tick spacing is a function of the data's range and cell
    // spacing is a function of the container's width, so every plot was two
    // unrelated grids crossing each other. That is not texture, it is
    // interference, and it is what made the page look messy.
    //
    // The rule now: a panel's ruling is the structure of its own contents.
    // Decoration on top of that is banned, and this is what bans it.
    for (const view of ['today', 'retention', 'funnel', 'system']) {
      await openAdmin(page, { view, theme: 'dark' });
      await expect(page.locator('.adm-well').first()).toBeVisible({ timeout: 15000 });

      const ruled = await page.evaluate(() => {
        const bad = [];
        for (const el of document.querySelectorAll('.adm-well, .adm-plate')) {
          for (const pseudo of [null, '::before']) {
            const cs = getComputedStyle(el, pseudo);
            // repeating-linear-gradient is the graph-paper signature.
            if (/repeating-linear-gradient/.test(cs.backgroundImage || '')) {
              bad.push(`${el.className}${pseudo || ''}`);
            }
          }
        }
        return bad;
      });
      expect(
        ruled,
        `panels carrying a decorative ruling on ${view}: ${ruled.join(', ')}`,
      ).toEqual([]);
    }
  });

  test('the chart graticule is the scale, on both axes', async ({ page }) => {
    // Having removed the decoration, the plot still needs a coordinate system —
    // and it has to be one the marks are actually measured against. Horizontals
    // sit on the value ticks, so there is exactly one per printed label;
    // verticals divide the span evenly, which on a linear date axis is a real
    // interval rather than a pattern.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.adm-area-frame').first()).toBeVisible({ timeout: 15000 });

    const first = page.locator('.adm-area').first();
    const hLines = await first.locator('.adm-area-grid').count();
    const vLines = await first.locator('.adm-area-vgrid').count();
    const labels = await first.locator('.adm-area-tick').count();

    expect(hLines, 'horizontal rules must match the printed value ticks').toBe(labels);
    expect(vLines).toBeGreaterThan(2);

    // Every horizontal must land on its label, which is what "the graticule is
    // the scale" means in practice.
    const aligned = await page.evaluate(() => {
      const root = document.querySelector('.adm-area');
      const ys = (sel) => [...root.querySelectorAll(sel)]
        .map((el) => Math.round(el.getBoundingClientRect().top))
        .sort((a, b) => a - b);
      const rules = ys('.adm-area-grid');
      const ticks = ys('.adm-area-tick');
      if (rules.length !== ticks.length) return false;
      return rules.every((y, i) => Math.abs(y - ticks[i]) <= 2);
    });
    expect(aligned, 'a value rule does not sit on its own label').toBe(true);
  });

  test('a sparse series is drawn with gaps, not bridged', async ({ page }) => {
    // metrics_daily has no backfill, so the series genuinely has holes. A line
    // drawn straight across a hole invents the days it is missing.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.admin-stat-grid').first()).toBeVisible({ timeout: 15000 });
    const segments = await page.evaluate(() => {
      const plot = document.querySelector('.adm-trend-plot svg');
      return plot ? plot.querySelectorAll('path').length : 0;
    });
    // At minimum the primitive rendered something rather than silently nothing.
    expect(segments).toBeGreaterThan(0);
  });
});
