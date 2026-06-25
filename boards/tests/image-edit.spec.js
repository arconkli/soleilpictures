import { expect, test } from '@playwright/test';

// Photo-adjustment logic. Drives the pure helper bridge published under
// ?imgeditqa=1 (src/lib/imageAdjust.js) — the same buildFilterCss /
// buildTransform / isAdjusted / buildImgStyle the image card + download bake
// use — so the load-bearing filter-string math is verified with zero backend.
// The DOM interaction (pencil → popover → slider → live filter) is covered by
// manual MCP/devtools verification; computed `filter` strings vary per browser
// which makes exact-string DOM assertions brittle.

test.describe('image photo adjustments (logic bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?imgeditqa=1');
    await page.waitForFunction(() => !!window.__soleilImgEditTest);
  });

  test('isAdjusted is false for neutral/empty and true for any change', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        nullA:       T.isAdjusted(null),
        empty:       T.isAdjusted({}),
        neutral:     T.isAdjusted({ brightness: 100, contrast: 100, saturation: 100, warmth: 0, sharpen: 0 }),
        bright:      T.isAdjusted({ brightness: 120 }),
        flip:        T.isAdjusted({ flipH: true }),
        gray:        T.isAdjusted({ grayscale: true }),
        warmthZero:  T.isAdjusted({ warmth: 0 }),
        sharpenZero: T.isAdjusted({ sharpen: 0 }),
        sharpen:     T.isAdjusted({ sharpen: 2 }),
      };
    });
    expect(r.nullA).toBe(false);
    expect(r.empty).toBe(false);
    expect(r.neutral).toBe(false);
    expect(r.bright).toBe(true);
    expect(r.flip).toBe(true);
    expect(r.gray).toBe(true);
    expect(r.warmthZero).toBe(false);
    expect(r.sharpenZero).toBe(false);
    expect(r.sharpen).toBe(true);
  });

  test('buildFilterCss maps the function filters and omits neutral terms', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        empty:   T.buildFilterCss(null),
        bright:  T.buildFilterCss({ brightness: 120 }),
        contrast:T.buildFilterCss({ contrast: 90 }),
        sat:     T.buildFilterCss({ saturation: 150 }),
        gray:    T.buildFilterCss({ grayscale: true }),
      };
    });
    expect(r.empty).toBe('');
    expect(r.bright).toBe('brightness(1.2)');
    expect(r.contrast).toBe('contrast(0.9)');
    expect(r.sat).toBe('saturate(1.5)');
    expect(r.gray).toBe('grayscale(1)');
  });

  test('buildFilterCss appends sharpen + warmth url() refs in order', async ({ page }) => {
    const css = await page.evaluate(() => window.__soleilImgEditTest.buildFilterCss({
      brightness: 120, contrast: 90, saturation: 150, grayscale: true, warmth: 50, sharpen: 2,
    }));
    expect(css).toBe('brightness(1.2) contrast(0.9) saturate(1.5) grayscale(1) url(#soleil-warm-5) url(#soleil-sharpen-2)');
  });

  test('warmthLevel snaps the raw -100..100 value to a signed level', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        zero: T.warmthLevel(0),
        warm: T.warmthLevel(50),
        cool: T.warmthLevel(-100),
        max:  T.warmthLevel(100),
        round1: T.warmthLevel(7),   // round(0.7) = 1
        round0: T.warmthLevel(4),   // round(0.4) = 0
      };
    });
    expect(r.zero).toBe(0);
    expect(r.warm).toBe(5);
    expect(r.cool).toBe(-10);
    expect(r.max).toBe(10);
    expect(r.round1).toBe(1);
    expect(r.round0).toBe(0);
  });

  test('buildTransform emits only the flipped axes', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        none: T.buildTransform({}),
        h:    T.buildTransform({ flipH: true }),
        v:    T.buildTransform({ flipV: true }),
        both: T.buildTransform({ flipH: true, flipV: true }),
      };
    });
    expect(r.none).toBe('');
    expect(r.h).toBe('scaleX(-1)');
    expect(r.v).toBe('scaleY(-1)');
    expect(r.both).toBe('scaleX(-1) scaleY(-1)');
  });

  test('buildImgStyle is undefined when neutral and a minimal object otherwise', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        neutralIsUndefined: T.buildImgStyle(null) === undefined,
        filterOnly: T.buildImgStyle({ brightness: 120 }),
        flipOnly:   T.buildImgStyle({ flipH: true }),
        both:       T.buildImgStyle({ brightness: 120, flipH: true }),
      };
    });
    expect(r.neutralIsUndefined).toBe(true);
    expect(r.filterOnly).toEqual({ filter: 'brightness(1.2)' });
    expect(r.flipOnly).toEqual({ transform: 'scaleX(-1)' });
    expect(r.both).toEqual({ filter: 'brightness(1.2)', transform: 'scaleX(-1)' });
  });

  test('buildCanvasFilterCss drops url() refs (canvas bake uses manual passes)', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        withUrls: T.buildCanvasFilterCss({ saturation: 150, sharpen: 3, warmth: 40 }),
        funcs:    T.buildCanvasFilterCss({ brightness: 110, grayscale: true }),
      };
    });
    expect(r.withUrls).toBe('saturate(1.5)');       // sharpen/warmth excluded
    expect(r.funcs).toBe('brightness(1.1) grayscale(1)');
  });
});

// Real DOM flow against the local app (?local=1). The local Home board seeds an
// image card with a same-origin sample photo, so the card renders a real <img>
// and shows the edit/download affordances with no backend.
test.describe('image photo editing (DOM)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?local=1');
    await page.locator('.canvas').waitFor({ state: 'visible' });
    await page.locator('.ic-img').first().waitFor({ state: 'visible' });
  });

  test('pencil opens the popover and a slider applies a live CSS filter', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    const pencil = card.locator('.ic-edit');
    await expect(pencil).toBeVisible();
    await pencil.click();

    const pop = page.locator('.iep-pop');
    await expect(pop).toBeVisible();

    // Drive the brightness slider (first slider) up. Use the native value
    // setter so React's controlled-input value tracker actually sees the change.
    const slider = pop.locator('.iap-slider').first();
    await slider.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '150');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // The displayed image (inside the progressive .r2p wrapper) now carries a
    // brightness filter. Computed filter strings vary, so assert substring.
    const r2p = page.locator('.ic-img.r2p').first();
    await expect.poll(async () =>
      r2p.evaluate((el) => getComputedStyle(el).filter)
    ).toContain('brightness');
  });

  test('flip applies a transform and download bakes with no taint error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    const pop = page.locator('.iep-pop');
    await expect(pop).toBeVisible();

    // Flip horizontal (button's visible text is "Flip H"; match by title).
    await pop.getByTitle('Flip horizontal').click();
    const r2p = page.locator('.ic-img.r2p').first();
    await expect.poll(async () =>
      r2p.evaluate((el) => getComputedStyle(el).transform)
    ).not.toBe('none');

    // Download (baked) — assert it runs without a SecurityError/taint.
    const download = pop.getByRole('button', { name: /Download/ });
    await download.click();
    await page.waitForTimeout(400);
    const taint = errors.filter((e) => /taint|SecurityError|insecure/i.test(e));
    expect(taint).toEqual([]);
  });

  test('expand opens the full-screen editor', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    await page.locator('.iep-pop').getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('.iem')).toBeVisible();
    await expect(page.locator('.iem-img')).toBeVisible();
  });

  const pushSlider = (locator, value) => locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

  test('value readout marks dirty and taps to reset just that control', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    const row = page.locator('.iep-pop .iap-row').first();   // Brightness
    const valBtn = row.locator('.iap-val');

    await expect(valBtn).not.toHaveClass(/is-dirty/);
    await pushSlider(row.locator('.iap-slider'), 150);
    await expect(valBtn).toHaveClass(/is-dirty/);
    await expect(valBtn).toHaveText('150%');

    await valBtn.click();                                     // tap value → reset control
    await expect(valBtn).not.toHaveClass(/is-dirty/);
    await expect(valBtn).toHaveText('100%');
  });

  test('hold-to-compare strips the filter while held', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    const pop = page.locator('.iep-pop');
    await pushSlider(pop.locator('.iap-slider').first(), 150);

    const r2p = page.locator('.ic-img.r2p').first();
    await expect.poll(() => r2p.evaluate((el) => getComputedStyle(el).filter)).toContain('brightness');

    const compare = pop.getByTitle('Hold to compare original');
    await compare.dispatchEvent('pointerdown');
    await expect.poll(() => r2p.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    await compare.dispatchEvent('pointerup');
    await expect.poll(() => r2p.evaluate((el) => getComputedStyle(el).filter)).toContain('brightness');
  });
});
