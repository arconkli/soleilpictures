// Capture Mode — camera moves and takes.
//
// The unit tests own the vocabulary and the arithmetic. What can only be
// checked in a browser is that a SEQUENCE actually sequences: that each move
// resolves against the camera as it is when that move starts, that a take runs
// to its end without a later move stomping an earlier one, and that starting
// something new abandons what was running instead of two rAF loops fighting
// over the same transform.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const pose = (page) => page.evaluate(() => document.querySelector('.canvas')?.style.transform || '');

// Zoom, pulled out of the transform, so a move can be checked for direction
// rather than just "something changed".
const zoomOf = (t) => {
  const m = /scale\(([\d.]+)\)/.exec(t || '');
  return m ? Number(m[1]) : null;
};

async function boot(page) {
  await page.goto('/?local=1&reset=1&capture=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(1);
  await page.waitForTimeout(600);
}

const play = (page, detail) => page.evaluate((d) => {
  document.dispatchEvent(new CustomEvent('soleil-capture-camera', { detail: d }));
}, detail);

// Settle to a stable transform, so a later assertion isn't reading mid-tween.
async function settled(page) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await pose(page);
    if (now && now === last) return now;
    last = now;
    await page.waitForTimeout(150);
  }
  return last;
}

test('a zero-duration move is a cut, not a tween', async ({ page }) => {
  await boot(page);
  const before = await pose(page);
  // Takes open with { ms: 0 } to set a starting pose. It must land immediately;
  // if it tweened, every take would begin with a slow drift from wherever the
  // camera happened to be sitting.
  await play(page, { moves: [{ type: 'zoom', by: 2, ms: 0 }] });
  await page.waitForTimeout(120);
  const after = await pose(page);
  expect(after).not.toBe(before);
  expect(zoomOf(after)).toBeGreaterThan(zoomOf(before) * 1.5);
});

test('zoom multiplies, and pan moves without changing zoom', async ({ page }) => {
  await boot(page);
  await play(page, { moves: [{ type: 'fit', ms: 0 }] });
  await page.waitForTimeout(200);
  const base = await pose(page);

  await play(page, { moves: [{ type: 'zoom', by: 1.8, ms: 300 }] });
  const zoomed = await settled(page);
  expect(zoomOf(zoomed)).toBeCloseTo(zoomOf(base) * 1.8, 1);

  await play(page, { moves: [{ type: 'pan', dx: 200, dy: 0, ms: 300 }] });
  const panned = await settled(page);
  expect(zoomOf(panned), 'a pan changed the zoom').toBeCloseTo(zoomOf(zoomed), 3);
  expect(panned).not.toBe(zoomed);
});

test('a take runs every move in order and finishes somewhere else', async ({ page }) => {
  await boot(page);
  await play(page, { moves: [{ type: 'zoom', by: 3, ms: 0 }] });
  await page.waitForTimeout(200);
  const start = await pose(page);

  // `reveal` opens tight, holds, then pulls back to fit over ~1.9s.
  await play(page, { take: 'reveal' });

  // It must still be moving partway through — a take that jumped straight to
  // its final pose would pass a naive before/after check.
  await page.waitForTimeout(1400);
  const mid = await pose(page);

  const end = await settled(page);
  expect(end).not.toBe(start);
  expect(end, 'the take never travelled — it cut to its end pose').not.toBe(mid);
  // Pulling back means ending wider than it opened.
  expect(zoomOf(end)).toBeLessThan(zoomOf(start));
});

test('a new move abandons a running take instead of fighting it', async ({ page }) => {
  await boot(page);
  await play(page, { take: 'sweep' });      // ~7s, plenty of runway
  await page.waitForTimeout(900);

  // Interrupt with a plain fit, the way pressing the HUD button would.
  await play(page, { target: 'fit', ms: 400 });
  const afterFit = await settled(page);

  // If the abandoned take were still running, the transform would keep moving
  // after the fit had settled.
  await page.waitForTimeout(1500);
  expect(await pose(page), 'the interrupted take was still driving the camera').toBe(afterFit);
});

test('the app reports a take’s own duration, so a script never hardcodes it', async ({ page }) => {
  await boot(page);
  const ms = await page.evaluate(() => window.__soleilCapture.takeMs('establish'));
  expect(ms).toBeGreaterThan(4000);
  expect(await page.evaluate(() => window.__soleilCapture.takeMs('nope'))).toBe(0);
});

test('the HUD offers takes and a record button', async ({ page }) => {
  await boot(page);
  const takeChip = page.locator('[aria-label^="Take:"]');
  await expect(takeChip).toHaveText(/None/);

  await takeChip.click();
  await expect(takeChip).not.toHaveText(/None/);

  // Chromium supports getDisplayMedia, so the button is live here. The label
  // changes once a take is armed, because the press then does more.
  const rec = page.locator('.capture-hud-rec');
  await expect(rec).toBeVisible();
  await expect(rec).toBeEnabled();
  await expect(rec).toHaveText(/Record/);
});

test('the Shot button saves a PNG, cropped to the framing guide', async ({ page, context }) => {
  await boot(page);

  // getDisplayMedia can't be granted headlessly, so stand in a stream from a
  // canvas at a known size. Everything downstream of the stream — the shutter,
  // the frame grab, the crop solve, the download — is the real path.
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1000;
    const g = c.getContext('2d');
    g.fillStyle = '#123456'; g.fillRect(0, 0, 1600, 1000);
    // Keep it painting, or the captured stream has no frames.
    setInterval(() => { g.fillStyle = '#123456'; g.fillRect(0, 0, 1600, 1000); }, 100);
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(30);
  });

  await page.locator('[aria-label^="Framing guide"]').click();     // Off → 9:16
  const download = page.waitForEvent('download');
  await page.locator('.capture-hud-btn', { hasText: 'Shot' }).click();
  const file = await download;

  expect(file.suggestedFilename()).toMatch(/^soleil-shot-9x16-\d{8}-\d{6}\.png$/);

  // 1600×1000 cropped to 9:16 is height-limited: 1000 tall, 563 wide.
  const buf = readFileSync(await file.path());
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  expect(h).toBe(1000);
  expect(w).toBe(Math.round(1000 * 9 / 16));
});

test('the HUD takes itself out of the picture, and comes back', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.capture-hud')).toBeVisible();

  // The shutter attribute is what hides the tool during the grab. Assert the
  // RULE, since the grab itself is over in two frames.
  await page.evaluate(() => document.body.setAttribute('data-capture-shutter', '1'));
  await expect(page.locator('.capture-hud:visible')).toHaveCount(0);
  await expect(page.locator('.capture-mask:visible')).toHaveCount(0);

  await page.evaluate(() => document.body.removeAttribute('data-capture-shutter'));
  await expect(page.locator('.capture-hud')).toBeVisible();
});

// ── Staying out of the recording while staying usable ──────────────────────
//
// A tab capture records the rendered page, so a control panel you drive DURING
// a take is in every frame. Element Capture is the way out: restrictTo(#root)
// films the app's subtree and ignores anything painted over it. That only works
// if the panel is OUTSIDE that subtree, which is the structural property below.

test('the controls live outside #root, which is what lets them be excluded', async ({ page }) => {
  await boot(page);
  const placement = await page.evaluate(() => {
    const hud = document.querySelector('.capture-hud');
    const root = document.getElementById('root');
    return {
      exists: !!hud,
      insideRoot: !!(hud && root && root.contains(hud)),
      parentIsBody: hud?.parentElement === document.body,
    };
  });
  expect(placement.exists).toBe(true);
  expect(placement.insideRoot, 'the HUD is inside #root — restrictTo would still film it').toBe(false);
  expect(placement.parentIsBody).toBe(true);
});

test('the framing guide is outside #root too — it is a viewfinder, not content', async ({ page }) => {
  await boot(page);
  await page.locator('[aria-label^="Framing guide"]').click();
  await expect(page.locator('.capture-mask')).toBeVisible();
  const insideRoot = await page.evaluate(() =>
    document.getElementById('root').contains(document.querySelector('.capture-mask')));
  expect(insideRoot).toBe(false);
});

test('with Element Capture, the panel stays up and says it is off-camera', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    setInterval(() => c.getContext('2d').fillRect(0, 0, 800, 600), 100);
    // Stand in for a browser that supports restrictTo.
    window.RestrictionTarget = { fromElement: async (el) => ({ el }) };
    MediaStreamTrack.prototype.restrictTo = async function () { return undefined; };
    navigator.mediaDevices.getDisplayMedia = async () => c.captureStream(30);
  });

  await page.locator('.capture-hud-rec').click();
  const hud = page.locator('.capture-hud');
  await expect(hud).toBeVisible();
  await expect(hud).toHaveAttribute('data-excluded', '1');
  await expect(hud.locator('.capture-hud-title')).toHaveText('Off-camera');
  // And it is still operable mid-recording — the entire point.
  await expect(page.locator('[aria-label^="Take:"]')).toBeEnabled();
});

test('without Element Capture, the panel ducks out of frame instead', async ({ page }) => {
  await boot(page);
  await stubRecorder(page, { elementCapture: false });

  await page.locator('.capture-hud-rec').click();
  // Nothing else can keep it out of the video, so it leaves. (An exact class
  // token, so this does NOT match .capture-hud-dot.)
  await expect(page.locator('.capture-hud')).toHaveCount(0);

  // …but it leaves a tally light, and that light is the stop button. It used to
  // leave NOTHING: `gone || mustDuck` returned null above the dot branch, so a
  // free-running take — which arms no auto-stop — had no way to end from inside
  // the app at all. ⌘⇧H could not help either; it toggles `gone`, which
  // mustDuck overrode.
  const dot = page.locator('.capture-hud-dot.is-live');
  await expect(dot).toBeVisible();
  await expect(dot).toHaveAttribute('aria-label', /Stop recording/);

  const download = page.waitForEvent('download');
  await dot.click();
  expect((await download).suggestedFilename()).toMatch(CLIP_NAME);
  await expect(page.locator('.capture-hud')).toBeVisible();
});

// ── Finishing a recording ──────────────────────────────────────────────────
//
// A recording can end four ways — our Stop button, a take's auto-stop, the
// browser's own "Stop sharing" bar, and the HUD unmounting — and until these
// tests existed exactly one of them was checked, by not checking any of them:
// no test here waited for a single recorded byte. Three of the four silently
// destroyed the footage.

const CLIP_NAME = /^soleil-[a-z-]+-\d{8}-\d{6}\.(mp4|webm)$/;

// Which container the headless browser actually chose is not knowable in
// advance, so assert the two agree rather than hard-coding one. That is the
// real bug this guards: clipFilename used to default to 'mp4', so a Firefox
// webm shipped named .mp4.
function assertContainerMatchesExtension(name, buf) {
  const ext = name.split('.').pop();
  if (ext === 'mp4') expect(buf.subarray(4, 8).toString()).toBe('ftyp');
  else expect([...buf.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
}

// A canvas stream stands in for the display capture. `window.__stubStream`
// is kept so a test can end the share the way the browser's own bar does.
async function stubRecorder(page, { elementCapture = true } = {}) {
  await page.evaluate((withEC) => {
    const c = document.createElement('canvas');
    c.width = 800; c.height = 600;
    const g = c.getContext('2d');
    let i = 0;
    // Keep painting something DIFFERENT each tick — a stream of identical
    // frames can encode to nothing at all, and then there is no blob to save.
    setInterval(() => { g.fillStyle = `hsl(${(i += 17) % 360} 70% 50%)`; g.fillRect(0, 0, 800, 600); }, 40);
    if (withEC) {
      window.RestrictionTarget = { fromElement: async (el) => ({ el }) };
      MediaStreamTrack.prototype.restrictTo = async function () { return undefined; };
    } else {
      delete window.RestrictionTarget;
      delete MediaStreamTrack.prototype.restrictTo;
    }
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.__stubStream = c.captureStream(30);
      return window.__stubStream;
    };
  }, elementCapture);
}

test('Record then Stop saves a clip named for what it actually contains', async ({ page }) => {
  await boot(page);
  await stubRecorder(page);

  await page.locator('.capture-hud-rec').click();
  await expect(page.locator('.capture-hud-rec')).toHaveText(/Stop/);
  await page.waitForTimeout(1400);            // past the first timeslice

  const download = page.waitForEvent('download');
  await page.locator('.capture-hud-rec').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(CLIP_NAME);
  assertContainerMatchesExtension(file.suggestedFilename(), readFileSync(await file.path()));
});

test('the browser\'s own Stop-sharing bar still saves the take', async ({ page }) => {
  await boot(page);
  await stubRecorder(page);

  await page.locator('.capture-hud-rec').click();
  await expect(page.locator('.capture-hud-rec')).toHaveText(/Stop/);
  await page.waitForTimeout(1400);

  // Ending the track is exactly what "Stop sharing" does. The recorder's own
  // `ended` handler used to call recorder.stop() with no listener attached, so
  // the chunks were assembled by nobody and then wiped by the catch in the
  // stopRecording() that came afterwards.
  //
  // Note the dispatch. Calling track.stop() from script deliberately does NOT
  // fire `ended` — per spec that event means the track ended for a reason
  // OUTSIDE the page's control, which is exactly what the sharing bar is. So
  // end the track and then raise the event the browser would have raised. The
  // listener and everything downstream of it are the real ones.
  const download = page.waitForEvent('download');
  await page.evaluate(() => {
    const t = window.__stubStream.getVideoTracks()[0];
    t.stop();
    t.dispatchEvent(new Event('ended'));
  });
  expect((await download).suggestedFilename()).toMatch(CLIP_NAME);

  // And the UI knows it is over, rather than sitting on a Stop button with a
  // dead recorder behind it.
  await expect(page.locator('.capture-hud-rec')).toHaveText(/Rec/);
});

// The Take control is a cycling button (a native select renders 18px tall on an
// iPad), so getting to a named take means stepping to it.
async function setTake(page, label) {
  const chip = page.locator('[aria-label^="Take:"]');
  for (let i = 0; i < 8; i++) {
    if ((await chip.innerText()).includes(label)) return;
    await chip.click();
  }
  throw new Error(`never reached take "${label}"`);
}

test('a stopped take does not take the next one down with it', async ({ page }) => {
  await boot(page);
  await stubRecorder(page);

  // Arming a take is what arms an auto-stop alongside the recording.
  await setTake(page, 'Establish');

  const first = page.waitForEvent('download');
  await page.locator('.capture-hud-rec').click();
  await page.waitForTimeout(900);
  await page.locator('.capture-hud-rec').click();          // stop early
  await first;

  // Back to a free-running recording, which arms no timer of its own — so if
  // anything stops it, it is the abandoned take's. That timer used to stay
  // armed and fire into the NEXT recording, cutting it short by exactly how
  // early you stopped this one.
  await setTake(page, 'None');
  await page.locator('.capture-hud-rec').click();
  await page.waitForTimeout(7000);                         // past Establish's own length
  await expect(page.locator('.capture-hud-rec')).toHaveText(/Stop/);

  const second = page.waitForEvent('download');
  await page.locator('.capture-hud-rec').click();
  await second;
});

test('a take stops the recording when the camera says it is finished', async ({ page }) => {
  await boot(page);
  await stubRecorder(page);
  // Punch in is the short one: fit(0) + hold(500) + selection(620) + hold(1400).
  await setTake(page, 'Punch in');

  const download = page.waitForEvent('download');
  const t0 = Date.now();
  await page.locator('.capture-hud-rec').click();
  const file = await download;
  const elapsed = Date.now() - t0;

  expect(file.suggestedFilename()).toMatch(/^soleil-punch-\d{8}-\d{6}\.(mp4|webm)$/);
  // Punch in is 2520ms of moves. The fallback timer would not fire until
  // 2520 + 1200, so landing under 3200 is what proves the take's own completion
  // event stopped the tape rather than the ceiling — which is the whole point,
  // because that arithmetic drifts and the event does not.
  expect(elapsed).toBeLessThan(3200);
  await expect(page.locator('.capture-hud-rec')).toHaveText(/Record/);
});

// ── The camera as a gesture ────────────────────────────────────────────────

test('a cut is the anchor for the move that follows it', async ({ page }) => {
  await boot(page);

  // What `fit` alone solves to, as the reference.
  await play(page, { moves: [{ type: 'fit', ms: 0 }] });
  await page.waitForTimeout(200);
  const fitZoom = zoomOf(await pose(page));
  expect(fitZoom).toBeGreaterThan(0);

  // Now the same cut from somewhere else entirely, chained straight into a
  // move with no hold between them — which is exactly the shape of `sweep` and
  // `drift`. applyCamera is setZoom/setPan, and the refs the next move reads
  // are written by the layout effect after React commits; runMoves resumes on a
  // microtask and that commit is a macrotask, so the cut was invisible to the
  // move that followed it. Both takes silently discarded their opening fit.
  await play(page, { moves: [{ type: 'zoom', by: 0.25, ms: 0 }] });
  await page.waitForTimeout(200);
  await play(page, { moves: [{ type: 'fit', ms: 0 }, { type: 'zoom', by: 1.9, ms: 300 }] });
  await settled(page);

  expect(zoomOf(await pose(page))).toBeCloseTo(fitZoom * 1.9, 2);
});

test('the cull runs while the camera travels, not only when it lands', async ({ page }) => {
  await boot(page);
  // perf's counters are the only honest way to see this from outside: the
  // ?local=1 fixture is far too small to leave the ADD band (which is three
  // viewports wide), so counting mounted cards would pass whatever the code
  // did. What is actually being asserted is that a camera move participates in
  // the machinery that mounts cards at all.
  await page.evaluate(() => window.perf.enable());

  const cullRuns = () => page.evaluate(() => window.perf.snapshot().counters['cull.runs'] || 0);

  const before = await cullRuns();
  await play(page, { moves: [{ type: 'fit', ms: 0 }, { type: 'zoom', by: 3, ms: 1200 }] });
  await page.waitForTimeout(700);
  const midMove = await cullRuns();
  await settled(page);
  const after = await cullRuns();

  // Many passes DURING the travel — the tween runs at frame rate and each frame
  // schedules one. This used to be zero for the whole move: the cull ran when
  // the move finished and not before, so a pull-back revealed board area whose
  // cards did not appear until the camera had already stopped.
  expect(midMove - before).toBeGreaterThan(5);
  expect(after).toBeGreaterThan(midMove);
});

test('nothing unmounts while a take is travelling', async ({ page }) => {
  await boot(page);
  const mounted = () => page.locator('.canvas [data-card-id]').count();

  await play(page, { moves: [{ type: 'fit', ms: 0 }] });
  await settled(page);
  const framed = await mounted();
  expect(framed).toBeGreaterThan(0);

  // The cull that now runs every frame must be ADD-only, or a take would churn
  // R2ImageProgressive back to its blur tier mid-shot. The gesture flag is what
  // guarantees that, and it is held across holds as well as tweens.
  await play(page, { take: 'establish' });
  for (let i = 0; i < 12; i++) {
    expect(await mounted()).toBeGreaterThanOrEqual(framed);
    await page.waitForTimeout(400);
  }
});

test('an unknown take or a junk move is ignored rather than throwing', async ({ page }) => {
  await boot(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const before = await pose(page);

  await play(page, { take: 'does-not-exist' });
  await play(page, { moves: [{ type: 'nonsense' }, null, { type: 'fit', ms: 0 }] });
  await page.waitForTimeout(400);

  expect(errors).toEqual([]);
  // The one real move in that list still ran.
  expect(await pose(page)).not.toBe(before);
});
