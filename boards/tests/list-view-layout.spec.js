// Layout guards for the cluster browser. Everything here is a defect that
// shipped and was invisible from the code: each one needs a real layout to
// show itself.
//
// The theme running through them is that the list is a SCROLL CONTAINER inside
// a PANE, and that neither fact is visible to the two things CSS reaches for
// first — an absolutely-positioned pseudo-element, and a viewport media query.
import { expect, test } from '@playwright/test';

// A pack with varied names, tempos and keys. Everything points at the one real
// fixture file; only the metadata differs, which is all the layout cares about.
const PACK = [
  ['Midnight Keys 120 Amin.wav', 120, 'Amin', 4.2],
  ['808 Sub Slide F#min 140.wav', 140, 'F#min', 2.0],
  ['Dusty Rhodes Loop Bbmaj 92.wav', 92, 'Bbmaj', 8.5],
  ['Trap Hat Roll 150.wav', 150, null, 1.9],
  ['Vinyl Guitar Chops Dmin 85.wav', 85, 'Dmin', 6.4],
  ['Analog Bass Cmin 128.wav', 128, 'Cmin', 3.1],
  ['Reversed Vox Texture Ebmaj.wav', null, 'Ebmaj', 12.7],
  ['Neuro Drum Break 174.wav', 174, null, 2.8],
  ['Warm Pad Layer Gmin 100.wav', 100, 'Gmin', 16.0],
  ['Plucked Harp Arp Emin 118.wav', 118, 'Emin', 4.0],
  ['Glass Bell Melody Dbmin 112.wav', 112, 'Dbmin', 7.1],
  ['Kalimba Motif 124 Cmaj.wav', 124, 'Cmaj', 3.6],
];

async function boot(page, { width = 1440, height = 900 } = {}) {
  await page.setViewportSize({ width, height });
  // blank=1, and NOT followed by a replaceState to '/?local=1' — that re-seeds
  // the demo board underneath you and every count here goes off by five.
  await page.goto('/?local=1&reset=1&blank=1');
  await page.waitForFunction(() => !!window.__soleilAudioLive);
  await page.evaluate((pack) => {
    // Peaks the rows can actually draw; the harness cards never go through a
    // real decode, and a row with no peaks renders no waveform to test.
    const mkPeaks = (seed) => {
      const u8 = new Uint8Array(96);
      let x = seed * 9301 + 49297;
      for (let i = 0; i < 96; i++) {
        x = (x * 9301 + 49297) % 233280;
        u8[i] = Math.max(8, Math.round((0.3 + 0.7 * (x / 233280)) * 240));
      }
      let s = '';
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return btoa(s);
    };
    pack.forEach(([fileName, bpm, musicalKey, duration], i) => {
      window.__soleilAudioLive.addAudio({ x: 200 + i * 6, y: 160 + i * 6 }, {
        fileName, bpm, musicalKey, duration, peaks: mkPeaks(i + 1), analyzed: 1,
        updatedAt: Date.now() - i * 5400000, createdAt: Date.now() - i * 5400000,
      });
    });
  }, PACK);
  await expect(page.locator('.ac').first()).toBeVisible();
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.list-wrap')).toBeVisible();
  await expect(page.locator('.ct-row').first()).toBeVisible();
}

const rowMetrics = (page) => page.evaluate(() => {
  const row = document.querySelector('.ct-row');
  const wave = row.querySelector('.ct-wave');
  return {
    pane: Math.round(document.querySelector('.cb-main').getBoundingClientRect().width),
    name: Math.round(row.querySelector('.ct-name').getBoundingClientRect().width),
    waveShown: wave ? getComputedStyle(wave).display !== 'none' : false,
    overflow: row.scrollWidth - row.clientWidth,
  };
});

test('the grain is painted on the scrollable surface, not on a one-screen pseudo-element', async ({ page }) => {
  await boot(page);
  const bg = await page.locator('.list-wrap').evaluate((el) => {
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    return {
      image: cs.backgroundImage,
      attachment: cs.backgroundAttachment,
      afterImage: after.backgroundImage,
    };
  });
  // `local` is the whole point: it tiles across scrollHeight instead of the
  // one-viewport padding box an inset:0 ::after is sized to.
  expect(bg.attachment).toContain('local');
  expect(bg.image).toContain('grain');
  // And it must NOT also be coming from the shared ::after tier, which is what
  // the drag-over rule turned into a 60%-opacity veil by raising the same
  // pseudo-element's opacity without clearing its background-image.
  expect(bg.afterImage).not.toContain('grain');
});

test('the drop outline survives scrolling', async ({ page }) => {
  await boot(page);
  // An outline is painted on the border box; the ::after it replaced was
  // positioned in the scrolled content and vanished past the first screenful.
  const style = await page.locator('.list-wrap').evaluate((el) => {
    el.classList.add('is-drop-target');
    // getComputedStyle returns a LIVE declaration — read the values out before
    // dropping the class again, or you measure the element without it.
    const cs = getComputedStyle(el);
    const out = { style: cs.outlineStyle, offset: cs.outlineOffset };
    el.classList.remove('is-drop-target');
    return out;
  });
  expect(style.style).toBe('dashed');
  // Inset, so it frames the list rather than reading as a focus ring.
  expect(parseFloat(style.offset)).toBeLessThan(0);
});

test('the column header stays pinned to the top of the list while it scrolls', async ({ page }) => {
  // Short enough that twelve rows genuinely overflow — a list that does not
  // scroll cannot show whether its header sticks.
  await boot(page, { width: 1280, height: 480 });
  await page.locator('.list-wrap').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  const offset = await page.locator('.ct-head').evaluate((el) => {
    const wrap = document.querySelector('.list-wrap').getBoundingClientRect();
    return Math.round(el.getBoundingClientRect().top - wrap.top);
  });
  // Flush, not 32px down with a strip of rows sliding past above it: a scroll
  // container's own padding insets the rectangle its sticky children are held
  // in, which is why the vertical padding lives on .list-inner.
  expect(offset).toBe(0);
});

test('the selection action bar floats above the list instead of scrolling off the top', async ({ page }) => {
  await boot(page);
  await page.locator('.ct-row').nth(0).click();
  await page.locator('.ct-row').nth(5).click({ modifiers: ['Shift'] });
  await expect(page.locator('.list-selbar')).toContainText('6 selected');
  await page.locator('.list-wrap').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(200);
  const box = await page.locator('.list-selbar').boundingBox();
  const vp = page.viewportSize();
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  expect(box.y).toBeGreaterThan(0);
  // Shift-click must not drag a native text selection across the rows it spans.
  const selected = await page.evaluate(() => String(window.getSelection()));
  expect(selected).toBe('');
});

test('columns yield to the PANE, not the viewport', async ({ page }) => {
  await boot(page, { width: 1280, height: 880 });

  const wide = await rowMetrics(page);
  expect(wide.waveShown).toBe(true);
  expect(wide.overflow).toBe(0);

  // Opening the detail popout takes 336px out of the pane with the viewport
  // untouched — the case a viewport media query cannot see at all. Before the
  // container query the name column was left about 26px here.
  await page.locator('.ct-row').nth(2).click();
  await expect(page.locator('.cb-detail')).toBeVisible();
  await page.waitForTimeout(200);
  const narrow = await rowMetrics(page);
  expect(narrow.pane).toBeLessThan(wide.pane);
  expect(narrow.waveShown).toBe(false);
  expect(narrow.overflow).toBe(0);
  expect(narrow.name).toBeGreaterThan(100);

  // And a merely narrow window, still far above the 640px phone breakpoint.
  await page.locator('.cbd-close').click();
  await page.setViewportSize({ width: 900, height: 880 });
  await page.waitForTimeout(200);
  const small = await rowMetrics(page);
  expect(small.overflow).toBe(0);
  expect(small.name).toBeGreaterThan(100);
});

test('a phone keeps the filename, the metadata and the download button', async ({ page }) => {
  // Boot wide (the view toggle lives in the desktop topbar), then narrow: what
  // is under test is the layout, not the mobile shell's chrome.
  await boot(page, { width: 1100, height: 880 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);

  const m = await rowMetrics(page);
  expect(m.overflow).toBe(0);
  expect(m.name).toBeGreaterThan(150);

  // The four mono columns fold onto one line under the name rather than
  // truncating "F♯ min" to "F♯ m…".
  const sub = page.locator('.ct-row').first().locator('.ct-sub');
  await expect(sub).toBeVisible();
  await expect(sub).toContainText('120');
  await expect(sub).toContainText('A min');

  // The per-row download lives in the presence cell, and the phone breakpoint
  // used to hide that whole column — leaving a visitor on a published pack,
  // on the device most of them arrive on, with no way to take one file.
  const dl = page.locator('.ct-row').first().locator('.ct-dl');
  await expect(dl).toHaveCount(1);
  const visible = await dl.evaluate(el => getComputedStyle(el).display !== 'none'
    && el.getBoundingClientRect().width > 0);
  expect(visible).toBe(true);
});

test('the playing row shows how far through it is', async ({ page }) => {
  await boot(page);
  await page.locator('.ct-row').first().locator('.ct-play').click();
  await expect(page.locator('.ct-row.is-playing')).toHaveCount(1);
  // Drive the shared element forward rather than waiting out a real file.
  await page.evaluate(() => {
    const el = document.querySelector('audio[data-list-audio]');
    el.currentTime = Math.max(0.5, (el.duration || 2) * 0.45);
  });
  await page.waitForFunction(() => {
    const r = document.querySelector('.ct-row.is-playing');
    return r && parseFloat(r.style.getPropertyValue('--ct-progress') || '0') > 0.2;
  }, null, { timeout: 5000 });
});

test('the pack reads itself out, and Download all follows the filter', async ({ page }) => {
  await boot(page);
  const meta = page.locator('.list-section-meta');
  await expect(meta).toContainText('12 audio files');
  await expect(meta).toContainText('85–174 BPM');

  const all = page.locator('.list-section-act');
  await expect(all).toContainText('Download all');

  // Narrowed, it names the count it would actually take.
  await page.locator('.cbt-input').fill('min');
  await expect(all).toHaveText(/^Download \d+$/);

  // One file left is not a zip — the row's own download button is the path,
  // so the bulk affordance gets out of the way.
  await page.locator('.cbt-input').fill('Kalimba');
  await expect(page.locator('.ct-row')).toHaveCount(1);
  await expect(all).toHaveCount(0);
});

test('a focused control keeps Enter and Space', async ({ page }) => {
  await boot(page);
  // Clicking a row's own Play button sets the keyboard cursor, which is what
  // armed the window handler's preventDefault over every button in the list.
  const play = page.locator('.ct-row').nth(1).locator('.ct-play');
  await play.click();
  await expect(page.locator('.ct-row.is-playing')).toHaveCount(1);
  await play.focus();
  await page.keyboard.press('Enter');
  // Enter on the focused Play button toggles it, rather than being swallowed
  // into "select the cursor row".
  await expect(page.locator('.ct-row.is-playing')).toHaveCount(0);
});

test('the waveform scrubs the row that is sounding, and only that one', async ({ page }) => {
  await boot(page);
  const row = page.locator('.ct-row').first();
  const at = (b, f) => page.mouse.click(b.x + b.width * f, b.y + b.height / 2);
  const state = () => row.evaluate(r => ({
    playing: r.classList.contains('is-playing'),
    p: parseFloat(r.style.getPropertyValue('--ct-progress') || '0'),
  }));

  // At rest the waveform is inert. It covers most of the row's width, so a
  // click there has to select the row exactly like any other click would.
  let box = await row.locator('.ct-wave').boundingBox();
  await at(box, 0.66);
  await expect(row).toHaveClass(/is-selected/);
  await expect(page.locator('.ct-row.is-playing')).toHaveCount(0);

  // Selecting opens the 320px popout, which takes the pane to ~784px. The
  // waveform has to survive that, or a pack loses every waveform on the first
  // click anyone makes.
  await expect(page.locator('.cb-detail')).toBeVisible();
  await expect(row.locator('.ct-wave')).toBeVisible();

  // Playing, it is the transport. Let it run a while, then seek BACKWARDS:
  // playback only ever moves forward, so a drop cannot come from elapsed time.
  // (Seeking forward would pass on elapsed time alone, and asserting a drop
  // without also asserting it is STILL playing would pass on the clip simply
  // having ended and cleared the property.)
  await row.locator('.ct-play').click();
  await expect(row).toHaveClass(/is-playing/);
  await expect.poll(async () => (await state()).p).toBeGreaterThan(0.3);
  box = await row.locator('.ct-wave').boundingBox();
  await at(box, 0.08);
  const after = await state();
  expect(after.playing).toBe(true);
  expect(after.p).toBeLessThan(0.3);

  // The fill layer is clipped to the position rather than painting the whole
  // waveform gold.
  const clip = await row.locator('.ct-wave-fill').evaluate(el => getComputedStyle(el).clipPath);
  expect(clip).toMatch(/inset\(/);

  // Stop, so auto-advance is not walking the pack underneath the next part.
  await row.locator('.ct-play').click();
  await expect(page.locator('.ct-row.is-playing')).toHaveCount(0);

  // A modified click still reaches the row, or a range selection breaks
  // wherever it happens to cross a waveform. NOTE: page.mouse.click has no
  // `modifiers` option — it silently ignores one — so the key is held by hand.
  const b2 = await page.locator('.ct-row').nth(4).locator('.ct-wave').boundingBox();
  await page.keyboard.down('Shift');
  await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.keyboard.up('Shift');
  await expect(page.locator('.ct-row.is-selected')).toHaveCount(5);
});

test('a gallery of a loop pack shows the sound, not a wall of one icon', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: 'Gallery view' }).click();
  await expect(page.locator('.ct-tile').first()).toBeVisible();
  await expect(page.locator('.cbp-audio-wave')).toHaveCount(12);
  await expect(page.locator('.ct-tile .cbp-glyph')).toHaveCount(0);

  // Every tile the same height, or the grid goes ragged on one long meta line.
  const heights = await page.locator('.ct-tile').evaluateAll(
    els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().height)))]);
  expect(heights).toHaveLength(1);
});
