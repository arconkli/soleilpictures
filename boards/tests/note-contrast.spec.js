// Always-readable colors for notes: the luminance core (readableColor.js +
// surfaceTone), and the read-only NoteCard render path (canvas/share) staying
// legible across bgColor / textColor / theme. Driven via the ?noteqa=1 harness.
import { expect, test } from '@playwright/test';

async function openNoteQa(page) {
  await page.goto('/?noteqa=1');
  await page.waitForFunction(() => !!window.__soleilNoteTest, null, { timeout: 15000 });
}

async function setTheme(page, theme) {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

// rgb(...) or #hex → perceptual luminance 0..1
function lum(color) {
  const s = String(color).trim();
  let r; let g; let b;
  const rgb = s.match(/(\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) { [r, g, b] = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]; }
  else {
    let h = s.replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6) return 0.5;
    const n = parseInt(h, 16);
    [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ── The luminance / readability core (pure) ────────────────────────────────
test('readableColor core: surfaceTone, readableOn (both directions), remap', async ({ page }) => {
  await openNoteQa(page);
  const r = await page.evaluate(async () => {
    const RC = await import('/src/lib/readableColor.js');
    const PL = await import('/src/lib/paletteLayout.js');
    const cr = (a, b) => RC.contrastRatio(RC.parseColor(a), RC.parseColor(b));
    return {
      // surfaceTone — luminance-based, fixes the old /^#?(f|e|d|c)/ regex misses.
      toneYellow: PL.surfaceTone('#fde68a'),     // light
      toneDark: PL.surfaceTone('#1c1c1f'),       // dark
      toneBlue: PL.surfaceTone('#bfdbfe'),       // light (old regex MISSED 'b…')
      toneNone: PL.surfaceTone('transparent'),   // null
      // readableOn — nudges only when needed, keeps readable colors.
      darkOnDark: RC.readableOn('#0a0a0c', '#0a0a0c'),   // → light
      lightOnLight: RC.readableOn('#f5f5f6', '#ffffff'), // → dark
      redOnWhite: RC.readableOn('#ef4444', '#ffffff'),   // kept (already readable-ish)
      // contrast AFTER the fix is comfortable in both bad cases.
      crDarkFixed: cr(RC.readableOn('#0a0a0c', '#0a0a0c'), '#0a0a0c'),
      crLightFixed: cr(RC.readableOn('#f5f5f6', '#ffffff'), '#ffffff'),
      // remapHtmlColors — grayscale flips, accent survives.
      remap: RC.remapHtmlColors(
        '<span style="color: #f5f5f6">w</span><span style="color: #ef4444">r</span>',
        '#ffffff'),
    };
  });
  expect(r.toneYellow).toBe('light');
  expect(r.toneDark).toBe('dark');
  expect(r.toneBlue).toBe('light');
  expect(r.toneNone).toBe(null);
  expect(lum(r.darkOnDark)).toBeGreaterThan(0.6);    // became light
  expect(lum(r.lightOnLight)).toBeLessThan(0.4);     // became dark
  expect(r.redOnWhite.toLowerCase()).toBe('#ef4444'); // accent kept
  expect(r.crDarkFixed).toBeGreaterThanOrEqual(4.5);
  expect(r.crLightFixed).toBeGreaterThanOrEqual(4.5);
  // grayscale span recolored to dark; the red span untouched.
  expect(r.remap).not.toContain('#f5f5f6');
  expect(r.remap.toLowerCase()).toContain('#ef4444');
});

// ── Read-only NoteCard: surface tone + default ink, both themes ─────────────
test('a light-bg note shows dark text in BOTH themes (read-only path)', async ({ page }) => {
  await openNoteQa(page);
  await page.evaluate(() => window.__soleilNoteTest.setRo({ bgColor: '#fde68a', textColor: null, html: '<p>hello world</p>' }));
  const note = page.locator('[data-ro-note] .note');
  await expect(note).toHaveClass(/is-light-bg/);
  const body = page.locator('[data-ro-note] .note-body');
  for (const theme of ['dark', 'light']) {
    await setTheme(page, theme);
    await page.waitForTimeout(50);
    const color = await body.evaluate((el) => getComputedStyle(el).color);
    expect(lum(color)).toBeLessThan(0.4); // dark ink on the light sticky, always
  }
});

test('a dark-bg note shows light text even in light theme (read-only path)', async ({ page }) => {
  await openNoteQa(page);
  await page.evaluate(() => window.__soleilNoteTest.setRo({ bgColor: '#1c1c1f', textColor: null, html: '<p>hi</p>' }));
  const note = page.locator('[data-ro-note] .note');
  await expect(note).toHaveClass(/is-dark-bg/);
  await setTheme(page, 'light');
  await page.waitForTimeout(50);
  const color = await page.locator('[data-ro-note] .note-body').evaluate((el) => getComputedStyle(el).color);
  expect(lum(color)).toBeGreaterThan(0.6);
});

test('an unpainted note with explicit dark textColor flips to readable in dark theme', async ({ page }) => {
  await openNoteQa(page);
  await page.evaluate(() => window.__soleilNoteTest.setRo({ bgColor: null, textColor: '#0a0a0c', html: '<p>flip me</p>' }));
  const body = page.locator('[data-ro-note] .note-body');
  await setTheme(page, 'light');
  await page.waitForTimeout(50);
  expect(lum(await body.evaluate((el) => getComputedStyle(el).color))).toBeLessThan(0.4); // dark on light paper
  await setTheme(page, 'dark');
  await page.waitForTimeout(80);
  expect(lum(await body.evaluate((el) => getComputedStyle(el).color))).toBeGreaterThan(0.6); // readable on dark
});

test('per-span: grayscale ink flips on a light note, but a red accent survives', async ({ page }) => {
  await openNoteQa(page);
  await page.evaluate(() => window.__soleilNoteTest.setRo({
    bgColor: '#fde68a',
    textColor: null,
    html: '<p><span style="color: #f5f5f6">white</span> <span style="color: #ef4444">red</span></p>',
  }));
  await setTheme(page, 'dark');
  await page.waitForTimeout(50);
  const spans = page.locator('[data-ro-note] .note-body span');
  // The "white" span is recolored dark (would be invisible on the yellow note).
  const whiteColor = await spans.nth(0).evaluate((el) => getComputedStyle(el).color);
  expect(lum(whiteColor)).toBeLessThan(0.4);
  // The red accent stays a recognizable red.
  const redColor = await spans.nth(1).evaluate((el) => getComputedStyle(el).color);
  const m = String(redColor).match(/(\d+),\s*(\d+),\s*(\d+)/);
  expect(Number(m[1])).toBeGreaterThan(150);                 // red channel dominant
  expect(Number(m[1])).toBeGreaterThan(Number(m[2]) + 60);
});
