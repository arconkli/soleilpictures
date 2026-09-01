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

  test('the survival curve draws its uncertainty, and drops the steps it cannot support', async ({ page }) => {
    // The panel exists because every other retention chart here is indexed by
    // calendar day, which pools away the fact that the loss is concentrated in
    // one step. Three things have to hold for it to be worth trusting:
    //
    //  1. it renders at all (a fetch with no fixture and no panel look alike);
    //  2. the deep steps, which rest on a handful of people, are DROPPED rather
    //     than drawn as a confident 100% — the fixture deliberately includes
    //     steps below the floor;
    //  3. every point carries an interval, because a step measured on tens and
    //     one measured on hundreds otherwise render identically.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    const surv = page.locator('.adm-surv');
    await expect(surv).toBeVisible({ timeout: 15000 });

    const drawn = await page.evaluate(() => {
      const svg = document.querySelector('.adm-surv');
      return {
        steps: [...svg.querySelectorAll('.adm-surv-step')].map((t) => t.textContent.trim()),
        points: svg.querySelectorAll('circle').length,
        // Two caps and a stem per interval; the gridlines span the full width
        // and are excluded by requiring a short horizontal or vertical run.
        rules: svg.querySelectorAll('line').length,
      };
    });

    expect(drawn.steps[0]).toBe('1→2');
    expect(drawn.steps.length).toBeGreaterThan(2);
    expect(
      drawn.steps,
      'a step resting on fewer than five people must not be plotted at all',
    ).not.toContain('8→9');
    expect(drawn.points).toBeGreaterThanOrEqual(drawn.steps.length);
    expect(
      drawn.rules,
      'each step needs a stem and two caps beside the gridlines — no intervals means the panel is lying about its precision',
    ).toBeGreaterThanOrEqual(drawn.steps.length * 3);
  });

  test('the survival panel states what it cannot yet measure', async ({ page }) => {
    // The power note is the half of this panel that changes decisions: at this
    // intake most differences worth arguing about are not yet distinguishable
    // from noise, and a dashboard that prints percentages without saying so
    // invites reading noise as a result. If the arithmetic silently returns
    // null the note vanishes and the panel looks finished, so assert the text.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    const note = page.locator('.adm-surv-power');
    await expect(note).toBeVisible({ timeout: 15000 });
    await expect(note).toContainText(/points/);
    await expect(note).toContainText(/weeks/);
  });

  test('the return gap is cumulative and front-loaded', async ({ page }) => {
    // The number every timed intervention is judged against. The cumulative
    // column is the point — a per-bucket share alone does not answer "would a
    // nudge tomorrow reach most of them".
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    await expect(page.locator('.adm-gap-row').first()).toBeVisible({ timeout: 15000 });

    const cum = await page.$$eval('.adm-gap-cum', (els) =>
      els.map((e) => Number(e.textContent.replace(/[^\d]/g, ''))));
    expect(cum.length).toBeGreaterThan(3);
    for (let i = 1; i < cum.length; i += 1) {
      expect(cum[i], 'a cumulative share must never decrease').toBeGreaterThanOrEqual(cum[i - 1]);
    }
    expect(cum[cum.length - 1]).toBe(100);
  });

  test('the predictor table refuses to state an effect the bands contradict', async ({ page }) => {
    // The regression guard for the whole confound problem.
    //
    // Read pooled, this dataset says hitting an error on day one IMPROVES
    // retention by a wide margin — an artefact of depth driving both. The
    // panel's contract is that a signal whose sign flips band to band is
    // labelled confounded and its pooled figure is struck through, so the
    // number cannot be lifted out and acted on. If this test goes green while
    // showing a clean effect size on that row, the guard is gone.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    const trigger = page.getByRole('button', { name: /day-one behaviour/i });
    await trigger.click();
    await expect(page.locator('.adm-pred').first()).toBeVisible({ timeout: 15000 });

    const err = page.locator('.adm-pred-row.is-inconsistent').filter({ hasText: 'Hit an error' });
    await expect(err, 'the error signal must be classed inconsistent').toHaveCount(1);
    await expect(err.locator('.adm-pred-chip')).toHaveText(/confounded/i);
    await expect(
      err.locator('.adm-pred-pooled .is-struck'),
      'the pooled figure must be retracted, not merely de-emphasised',
    ).toBeVisible();

    // And the converse: a signal whose sign survives every band keeps its
    // pooled number.
    const shared = page.locator('.adm-pred-row').filter({ hasText: 'Shared' });
    await expect(shared).not.toHaveClass(/is-inconsistent/);
    await expect(shared.locator('.adm-pred-chip')).toHaveText(/holds up/i);
    await expect(
      shared.locator('.adm-pred-pooled .is-struck'),
      'a consistent signal must keep its pooled figure',
    ).toHaveCount(0);

    // Mobile is the best-evidenced real gap in this data and is negative in
    // every band that says anything, with one flat band. It must NOT be thrown
    // out as confounded — an over-eager guard that condemns real findings is
    // just as useless as no guard at all.
    const mobile = page.locator('.adm-pred-row').filter({ hasText: 'Was on a phone' });
    await expect(mobile).not.toHaveClass(/is-inconsistent/);
    await expect(mobile.locator('.adm-pred-chip')).toHaveText(/directional/i);
  });

  test('a signal nobody ever triggers reads as absent, not as no-effect', async ({ page }) => {
    // "Nobody did this" and "doing this made no difference" are different
    // findings. Collapsing them into one blank cell would quietly retire a
    // gesture the onboarding calls its retention moment.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    await page.getByRole('button', { name: /day-one behaviour/i }).click();
    await expect(page.locator('.adm-pred').first()).toBeVisible({ timeout: 15000 });

    const nested = page.locator('.adm-pred-row').filter({ hasText: 'Nested a card' });
    await expect(nested.locator('.adm-pred-cell.is-none').first()).toBeVisible();
    await expect(nested.locator('.adm-pred-chip')).toHaveText(/too thin/i);
  });

  test('the autopsy never reports a signal younger than the cohort as zero', async ({ page }) => {
    // Two surfaces here began recording after almost everyone old enough to be
    // measured had signed up. Rendered as 0% they read "this never happens",
    // when the truth is "nothing was recording it yet" — the mistake 0277 had
    // to write into the table comments after it cost an analysis.
    await openAdmin(page, { view: 'retention', theme: 'dark' });
    await page.getByRole('button', { name: /day-one behaviour/i }).click();
    await expect(page.locator('.adm-fsc').first()).toBeVisible({ timeout: 15000 });

    const dock = page.locator('.adm-fsc-row').filter({ hasText: 'add-more dock' });
    await expect(dock).toHaveClass(/is-unmeasurable/);
    await expect(dock).toContainText(/not measurable yet/i);
    await expect(dock, 'an unrecorded signal must never render a percentage').not.toContainText('0%');

    // And the headline the panel exists to carry: the groups separate on TIME,
    // not on how much they made.
    const mins = page.locator('.adm-fsc-row').filter({ hasText: 'Minutes in the first session' });
    await expect(mins).toHaveClass(/is-strong/);
    const cards = page.locator('.adm-fsc-row').filter({ hasText: 'Cards on the board' });
    await expect(cards, 'card count does not separate the two groups').not.toHaveClass(/is-strong/);
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

  test('nothing is ruled twice', async ({ page }) => {
    // Graph paper is the look and it stays. What it may not do is disagree
    // with a grid the panel already has — a chart's ticks (spaced by the
    // data's range), a heatmap's cells (spaced by the container's width).
    // Neither lands on a pixel pitch, so paint a pitch behind them and you get
    // two grids crossing at unrelated intervals.
    //
    // So the rule is not "no paper", it is "no SECOND grid": a well that
    // contains something which rules itself must not also rule itself.
    for (const view of ['today', 'retention', 'funnel', 'system']) {
      await openAdmin(page, { view, theme: 'dark' });
      await expect(page.locator('.adm-well').first()).toBeVisible({ timeout: 15000 });

      const doubled = await page.evaluate(() => {
        const papered = (el, pseudo) =>
          /repeating-linear-gradient/.test(getComputedStyle(el, pseudo).backgroundImage || '');
        const bad = [];
        for (const w of document.querySelectorAll('.adm-well, .adm-plate')) {
          const selfRuling = w.querySelector('.is-ruled, .adm-heat, .adm-cohort');
          if (selfRuling && (papered(w, null) || papered(w, '::before'))) {
            bad.push(w.className);
          }
        }
        return bad;
      });
      expect(
        doubled,
        `these panels rule themselves on top of contents that already have a grid on ${view}: ${doubled.join(' | ')}`,
      ).toEqual([]);
    }
  });

  test('the paper subdivides the graticule exactly', async ({ page }) => {
    // The fix for the interference is not that the paper is gone — it is that
    // it is expressed in the SAME divisions as the ticks, as percentages of
    // the same box. Every --adm-gx/gy minor cell per major cell means every
    // Nth line lands on a tick, at any width, for any data range.
    //
    // Asserting the ratio is a whole number is the whole invariant: fractional
    // and the two drift apart again, which is exactly how this looked wrong.
    await openAdmin(page, { view: 'today', theme: 'dark' });
    await expect(page.locator('.adm-area-frame').first()).toBeVisible({ timeout: 15000 });

    const ratios = await page.evaluate(() => {
      const out = [];
      for (const area of document.querySelectorAll('.adm-area')) {
        const plot = area.querySelector('.adm-area-plot');
        const cs = getComputedStyle(plot);
        const gx = Number(cs.getPropertyValue('--adm-gx'));
        const gy = Number(cs.getPropertyValue('--adm-gy'));
        // Majors are drawn as positioned rules: N lines bound N-1 intervals.
        const hMaj = area.querySelectorAll('.adm-area-grid').length - 1;
        const vMaj = area.querySelectorAll('.adm-area-vgrid').length - 1;
        out.push({ gx, gy, hMaj, vMaj, ruled: plot.classList.contains('is-ruled') });
      }
      return out;
    });

    expect(ratios.length).toBeGreaterThan(0);
    for (const r of ratios) {
      expect(r.ruled, 'the plot is not ruled at all').toBe(true);
      expect(r.hMaj, 'no horizontal majors').toBeGreaterThan(0);
      expect(r.vMaj, 'no vertical majors').toBeGreaterThan(0);
      expect(r.gy % r.hMaj, `${r.gy} minor rows do not divide into ${r.hMaj} major rows`).toBe(0);
      expect(r.gx % r.vMaj, `${r.gx} minor cols do not divide into ${r.vMaj} major cols`).toBe(0);
    }

    // And the majors still sit on their own labels — the paper subdividing
    // them is worth nothing if the majors themselves have drifted.
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

  test('ornament never enters an accessible name', async ({ page }) => {
    // The active view tab is bracketed. The first version did that with
    // `content: '[ '`, and generated text is part of the accessible name — so
    // the tab announced itself as "left bracket system right bracket". The
    // brackets are drawn with borders now.
    //
    // This is a whole class of mistake rather than one bug: the cockpit is
    // full of ornament (corner ticks, edge marks, section numbers, LEDs), and
    // any of it done with `content` becomes something a screen reader reads
    // out. Cheaper to assert the names are clean than to remember.
    for (const view of ['today', 'retention']) {
      await openAdmin(page, { view, theme: 'dark' });
      await expect(page.locator('[role="tab"]').first()).toBeVisible({ timeout: 15000 });

      // getByRole matches on the browser's ACCESSIBLE NAME, which is the thing
      // generated content pollutes. An earlier version of this test read
      // textContent instead and could not see pseudo-element content at all —
      // it passed happily with the brackets put back.
      for (const id of ['today', 'funnel', 'retention', 'system']) {
        await expect(
          page.getByRole('tab', { name: new RegExp(`^${id}$`, 'i') }),
          `the ${id} tab is not reachable by its own name`,
        ).toHaveCount(1);
      }

      // And directly: no tab may carry generated text at all, active or not.
      const generated = await page.locator('[role="tab"]').evaluateAll((els) => {
        const bad = [];
        for (const el of els) {
          for (const p of ['::before', '::after']) {
            const c = getComputedStyle(el, p).content;
            if (c && c !== 'none' && c !== 'normal' && c !== '""' && c !== "''") {
              bad.push(`${el.textContent.trim()}${p} = ${c}`);
            }
          }
        }
        return bad;
      });
      expect(generated, `tabs carrying generated text: ${generated.join(' | ')}`).toEqual([]);
    }
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
