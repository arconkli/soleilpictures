import { expect, test } from '@playwright/test';

// Photo-adjustment logic. Drives the pure helper bridge published under
// ?imgeditqa=1 (src/lib/imageAdjust.js) — the Lightroom-style tone/color engine
// (normalizeAdjust, buildToneTable, buildColorMatrix, isAdjusted, buildImgStyle/
// buildFilterRef) that drives both the live SVG filter and the download bake.

test.describe('image photo adjustments (logic bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?imgeditqa=1');
    await page.waitForFunction(() => !!window.__soleilImgEditTest);
  });

  test('isAdjusted is false for neutral and true for any change', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        nullA:    T.isAdjusted(null),
        empty:    T.isAdjusted({}),
        v2neutral:T.isAdjusted({ v: 2 }),
        exposure: T.isAdjusted({ v: 2, exposure: 30 }),
        flip:     T.isAdjusted({ flipH: true }),
        gray:     T.isAdjusted({ grayscale: true }),
        sharp:    T.isAdjusted({ v: 2, sharpness: 20 }),
      };
    });
    expect(r.nullA).toBe(false);
    expect(r.empty).toBe(false);
    expect(r.v2neutral).toBe(false);
    expect(r.exposure).toBe(true);
    expect(r.flip).toBe(true);
    expect(r.gray).toBe(true);
    expect(r.sharp).toBe(true);
  });

  test('normalizeAdjust migrates legacy v1 edits', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        brightUp:   T.normalizeAdjust({ brightness: 200 }).exposure,   // ≈ +67
        brightDown: T.normalizeAdjust({ brightness: 50 }).exposure,    // ≈ -67
        warmth:     T.normalizeAdjust({ warmth: 50 }).temperature,     // 50
        contrast:   T.normalizeAdjust({ contrast: 150 }).contrast,     // +50
        sat:        T.normalizeAdjust({ saturation: 50 }).saturation,  // -50
        sharpen:    T.normalizeAdjust({ sharpen: 3 }).sharpness,       // 100
        gray:       T.normalizeAdjust({ grayscale: true, flipH: true }),
        v2:         T.normalizeAdjust({ v: 2, exposure: 30 }).exposure,// 30 (passthrough)
      };
    });
    expect(r.brightUp).toBeGreaterThan(60);
    expect(r.brightDown).toBeLessThan(-60);
    expect(r.warmth).toBe(50);
    expect(r.contrast).toBe(50);
    expect(r.sat).toBe(-50);
    expect(r.sharpen).toBe(100);
    expect(r.gray.grayscale).toBe(true);
    expect(r.gray.flipH).toBe(true);
    expect(r.v2).toBe(30);
  });

  test('tone table is monotonic and neutral is identity', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      const parse = (a) => T.buildToneTable(T.normalizeAdjust(a)).split(' ').map(Number);
      const neutral = parse({ v: 2 });
      // an extreme, normally-non-monotone combination
      const extreme = parse({ v: 2, exposure: 60, contrast: 90, highlights: 100, shadows: -100, whites: 80, blacks: -80 });
      const isMono = (arr) => arr.every((v, i) => i === 0 || v >= arr[i - 1] - 1e-6);
      const nearIdentity = neutral.every((v, i) => Math.abs(v - i / (neutral.length - 1)) < 0.02);
      return {
        neutralMono: isMono(neutral), extremeMono: isMono(extreme), nearIdentity,
        n0: neutral[0], nLast: neutral[neutral.length - 1], len: neutral.length,
      };
    });
    expect(r.len).toBe(33);
    expect(r.neutralMono).toBe(true);
    expect(r.extremeMono).toBe(true);   // running-max guarantees this
    expect(r.nearIdentity).toBe(true);
    expect(r.n0).toBeCloseTo(0, 2);
    expect(r.nLast).toBeCloseTo(1, 2);
  });

  test('color matrix: neutral = identity, B&W = luma', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        neutral: T.buildColorMatrix(T.normalizeAdjust({ v: 2 })),
        bw: T.buildColorMatrix(T.normalizeAdjust({ grayscale: true })),
      };
    });
    // identity 4x5
    expect(r.neutral[0]).toBeCloseTo(1, 4);
    expect(r.neutral[1]).toBeCloseTo(0, 4);
    expect(r.neutral[6]).toBeCloseTo(1, 4);
    expect(r.neutral[12]).toBeCloseTo(1, 4);
    // B&W: every row = Rec.709 luma
    expect(r.bw[0]).toBeCloseTo(0.2126, 3);
    expect(r.bw[1]).toBeCloseTo(0.7152, 3);
    expect(r.bw[2]).toBeCloseTo(0.0722, 3);
    expect(r.bw[5]).toBeCloseTo(0.2126, 3);
  });

  test('buildImgStyle / buildFilterRef wire the per-card filter id', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        neutral:   T.buildImgStyle({ v: 2 }, 'c1'),
        exposure:  T.buildImgStyle({ v: 2, exposure: 30 }, 'c1'),
        flipOnly:  T.buildImgStyle({ flipH: true }, 'c1'),
        both:      T.buildImgStyle({ v: 2, exposure: 30, flipH: true }, 'c1'),
        refFlip:   T.buildFilterRef({ flipH: true }, 'c1'),
        refExp:    T.buildFilterRef({ v: 2, exposure: 30 }, 'c1'),
        idSanit:   T.adjustFilterId('a b/c'),
      };
    });
    expect(r.neutral).toBeUndefined();
    expect(r.exposure).toEqual({ filter: 'url(#soleil-adj-c1)' });
    expect(r.flipOnly).toEqual({ transform: 'scaleX(-1)' });   // flip-only → no filter ref
    expect(r.both).toEqual({ filter: 'url(#soleil-adj-c1)', transform: 'scaleX(-1)' });
    expect(r.refFlip).toBe('');
    expect(r.refExp).toBe('url(#soleil-adj-c1)');
    expect(r.idSanit).toBe('soleil-adj-a_b_c');
  });

  test('buildTransform emits only the flipped axes', async ({ page }) => {
    const r = await page.evaluate(() => {
      const T = window.__soleilImgEditTest;
      return {
        none: T.buildTransform({}),
        h: T.buildTransform({ flipH: true }),
        v: T.buildTransform({ flipV: true }),
        both: T.buildTransform({ flipH: true, flipV: true }),
      };
    });
    expect(r.none).toBe('');
    expect(r.h).toBe('scaleX(-1)');
    expect(r.v).toBe('scaleY(-1)');
    expect(r.both).toBe('scaleX(-1) scaleY(-1)');
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

  const pushSlider = (locator, value) => locator.evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);

  test('pencil opens the popover and a slider applies the per-card SVG filter', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    const pencil = card.locator('.ic-edit');
    await expect(pencil).toBeVisible();
    await pencil.click();

    const pop = page.locator('.iep-pop');
    await expect(pop).toBeVisible();

    await pushSlider(pop.locator('.iap-slider').first(), 60);   // Exposure

    const r2p = page.locator('.ic-img.r2p').first();
    await expect.poll(async () =>
      r2p.evaluate((el) => getComputedStyle(el).filter)
    ).toContain('soleil-adj');
  });

  test('flip applies a transform and download bakes with no taint error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    const pop = page.locator('.iep-pop');
    await expect(pop).toBeVisible();

    await pop.getByTitle('Flip horizontal').click();
    const r2p = page.locator('.ic-img.r2p').first();
    await expect.poll(async () =>
      r2p.evaluate((el) => getComputedStyle(el).transform)
    ).not.toBe('none');

    // Single download is the image card's own top-right button (pinned visible
    // while editing) — the editor panel has no separate download.
    await expect(pop.getByRole('button', { name: /^Download$/ })).toHaveCount(0);
    await card.locator('.ic-download').click();
    await page.waitForTimeout(400);
    const taint = errors.filter((e) => /taint|SecurityError|insecure/i.test(e));
    expect(taint).toEqual([]);
  });

  test('expand opens the full-screen editor with grouped sections', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    await page.locator('.iep-pop').getByRole('button', { name: 'Full screen' }).click();
    await expect(page.locator('.iem')).toBeVisible();
    await expect(page.locator('.iem-img')).toBeVisible();
    // Light / Color / Detail section eyebrows
    await expect(page.locator('.iem-rail .iap-group-label')).toHaveCount(3);
  });

  test('value readout marks dirty and taps to reset just that control', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    const row = page.locator('.iep-pop .iap-row').first();   // Exposure
    const valBtn = row.locator('.iap-val');

    await expect(valBtn).not.toHaveClass(/is-dirty/);
    await pushSlider(row.locator('.iap-slider'), 50);
    await expect(valBtn).toHaveClass(/is-dirty/);
    await expect(valBtn).toHaveText('+50');

    await valBtn.click();
    await expect(valBtn).not.toHaveClass(/is-dirty/);
    await expect(valBtn).toHaveText('0');
  });

  test('hold-to-compare strips the filter while held', async ({ page }) => {
    const card = page.locator('[data-card-id]').filter({ has: page.locator('.ic-img') }).first();
    await card.hover();
    await card.locator('.ic-edit').click();
    const pop = page.locator('.iep-pop');
    await pushSlider(pop.locator('.iap-slider').first(), 50);

    const r2p = page.locator('.ic-img.r2p').first();
    await expect.poll(() => r2p.evaluate((el) => getComputedStyle(el).filter)).toContain('soleil-adj');

    const compare = pop.getByTitle('Hold to compare original');
    await compare.dispatchEvent('pointerdown');
    await expect.poll(() => r2p.evaluate((el) => getComputedStyle(el).filter)).toBe('none');
    await compare.dispatchEvent('pointerup');
    await expect.poll(() => r2p.evaluate((el) => getComputedStyle(el).filter)).toContain('soleil-adj');
  });
});
