// Capture Mode — the synthetic cast.
//
// Collaboration is the hardest thing in this product to film: it needs other
// people, on other machines, doing something plausible, at the moment you press
// record. So it never gets filmed. These are those people.
//
// Runs on ?local=1, which has NO awareness object at all — no PartyKit, no
// Supabase, no socket. That is deliberate: it proves the cast renders from the
// proxy alone, which is also what makes it work on a real board before the room
// has finished connecting.
//
// The unit tests own the guarantee that a synthetic peer can never be written
// to the network (castAwareness.test.mjs asserts it against the write path
// directly). What is checked here is that they actually appear, actually move,
// and actually go away.

import { test, expect } from '@playwright/test';

const cursors = (page) => page.locator('.cursors-layer .cursor');

async function boot(page) {
  await page.goto('/?local=1&reset=1&capture=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('html[data-capture-ready="1"]')).toHaveCount(1);
}

// The Cast control cycles 0 → 2 → 3 → 5.
const castChip = (page) => page.locator('[aria-label^="Stand-in collaborators"]');

test('a cast appears, and it is nobody until you ask for one', async ({ page }) => {
  await boot(page);
  await expect(cursors(page)).toHaveCount(0);

  await castChip(page).click();
  await expect(cursors(page)).toHaveCount(2);

  await castChip(page).click();
  await expect(cursors(page)).toHaveCount(3);
});

test('the cast has names and colours, not anonymous dots', async ({ page }) => {
  await boot(page);
  await castChip(page).click();
  await expect(cursors(page)).toHaveCount(2);

  const flags = page.locator('.cursors-layer .cursor-flag');
  await expect(flags).toHaveCount(2);
  const names = await flags.allTextContents();
  for (const n of names) expect(n.trim().length).toBeGreaterThan(1);
  expect(new Set(names).size, 'two cast members share a name').toBe(names.length);
});

test('cursors move, and move smoothly rather than teleporting', async ({ page }) => {
  await boot(page);
  await castChip(page).click();
  await expect(cursors(page)).toHaveCount(2);

  const positions = async () => page.evaluate(() =>
    [...document.querySelectorAll('.cursors-layer .cursor')]
      .map(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));

  // Sample across a realistic span. Peers dwell for up to six seconds now — a
  // person reading something does — so a two-second window can legitimately
  // catch the whole cast at rest.
  const samples = [];
  for (let i = 0; i < 14; i++) {
    samples.push(await positions());
    await page.waitForTimeout(400);
  }

  // Somebody travelled. A frozen cast is worse than no cast.
  const travelled = samples.some((s, i) =>
    i > 0 && s.some((p, j) => Math.hypot(p.x - samples[i - 1][j].x, p.y - samples[i - 1][j].y) > 6));
  expect(travelled, 'the cast never moved').toBe(true);

  // And nobody is a frozen sprite even between legs: a resting hand drifts.
  const totalPerPeer = samples[0].map((_, j) =>
    samples.slice(1).reduce((sum, s, i) =>
      sum + Math.hypot(s[j].x - samples[i][j].x, s[j].y - samples[i][j].y), 0));
  for (const [j, d] of totalPerPeer.entries()) {
    expect(d, `cursor ${j} never moved at all across ${samples.length} samples`).toBeGreaterThan(2);
  }

  // And nothing jumped across the screen between samples. LiveCursor
  // interpolates, so a teleport here would read as a glitch on camera.
  for (let i = 1; i < samples.length; i++) {
    for (let j = 0; j < samples[i].length; j++) {
      const d = Math.hypot(samples[i][j].x - samples[i - 1][j].x, samples[i][j].y - samples[i - 1][j].y);
      expect(d, `cursor ${j} jumped ${Math.round(d)}px between samples`).toBeLessThan(400);
    }
  }
});

test('the cast selects cards, so the board looks worked-on', async ({ page }) => {
  await boot(page);
  await castChip(page).click();
  await expect(cursors(page)).toHaveCount(2);
  // Peer selection pills name who grabbed what — the thing that makes a
  // multiplayer screenshot read as multiplayer rather than as one cursor.
  await expect(page.locator('.peer-sel-pill').first()).toBeVisible({ timeout: 4000 });
});

test('chrome-hiding and the cast do not cancel each other out', async ({ page }) => {
  await boot(page);
  // ?capture=1 turns chrome-hiding ON, and chrome-hiding hides remote cursors
  // so that real collaborators stay out of a marketing shot. Adding a cast has
  // to re-admit exactly those layers, or turning both on shows nothing.
  await expect(page.locator('body[data-capture-clean="1"]')).toHaveCount(1);
  await castChip(page).click();
  await expect(page.locator('body[data-capture-cast="1"]')).toHaveCount(1);
  await expect(cursors(page).first()).toBeVisible();
});

test('the cast leaves with capture and takes its attribute with it', async ({ page }) => {
  await boot(page);
  await castChip(page).click();
  await expect(cursors(page)).toHaveCount(2);

  await page.keyboard.press('Control+Shift+Period');
  await expect(cursors(page)).toHaveCount(0);
  await expect(page.locator('body[data-capture-cast="1"]')).toHaveCount(0);
});

test('the cursor spotlight draws a pointer and a click ripple', async ({ page }) => {
  await boot(page);
  await page.locator('.capture-hud-chip', { hasText: 'Cursor' }).click();
  const dot = page.locator('.capture-spot-dot');
  await expect(dot).toBeVisible();

  await page.mouse.move(400, 300);
  await expect.poll(async () => {
    const t = await dot.evaluate(el => el.style.transform);
    return t.includes('400px') && t.includes('300px');
  }).toBe(true);

  // A ripple lives 520ms and removes itself, so count them as they are added
  // rather than racing the animation. (The assertion here used to be
  // `count() >= 0`, which is true of every count there has ever been.)
  await page.evaluate(() => {
    window.__ripples = 0;
    new MutationObserver(ms => ms.forEach(m => { window.__ripples += m.addedNodes.length; }))
      .observe(document.querySelector('.capture-spot-ripples'), { childList: true });
  });

  await page.mouse.click(400, 300);
  await expect.poll(() => page.evaluate(() => window.__ripples)).toBe(1);
});

test('the spotlight does not draw the hand that is operating the camera', async ({ page }) => {
  await boot(page);
  await page.locator('.capture-hud-chip', { hasText: 'Cursor' }).click();
  await expect(page.locator('.capture-spot-dot')).toBeVisible();

  await page.evaluate(() => {
    window.__ripples = 0;
    new MutationObserver(ms => ms.forEach(m => { window.__ripples += m.addedNodes.length; }))
      .observe(document.querySelector('.capture-spot-ripples'), { childList: true });
  });

  // The panel portals to <body>, outside #root, precisely so it is not in the
  // picture. Pressing one of its controls used to paint a gold ripple anyway —
  // the tool signing the recording it was being used to make.
  await page.locator('[data-cap="fit"]').click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__ripples)).toBe(0);

  // The canvas still draws, so this is a filter and not an off switch.
  await page.mouse.click(400, 300);
  await expect.poll(() => page.evaluate(() => window.__ripples)).toBe(1);
});
