// "Your place is held" (lib/placeHeld.js), driven through the REAL signed-in app
// with every Supabase call stubbed (helpers/signedInStub.js).
//
// Coming back to a cluster after a real break (30 min since this device last saw
// it and since the person's own last card touch), the canvas shows the whole
// cluster, holds ~650 ms, glides to the card they touched last and selects it; a
// slate beside the cluster's name says, for a few seconds, "last worked yesterday
// evening", then folds away to nothing. A press, wheel, touch or key during the hold stops it.
//
// The seed is six notes far apart (so the fit view and the card view differ
// clearly), all stamped with the stub's user. Stamps are computed from Date.now()
// in the test, in LOCAL time, so "yesterday evening" holds whenever this runs. The
// real clock runs (no page.clock): a fake one would freeze the glide's frames.
//
// Screenshots for review are written to PLACE_HELD_SHOTS (default
// /tmp/place-held-shots) only when PLACE_HELD_SHOT is set; they are never asserted on.
import { expect, test } from '@playwright/test';
import * as Y from 'yjs';
import fs from 'node:fs';
import path from 'node:path';
import { bootSignedIn, USER_ID, ROOT_ID } from './helpers/signedInStub.js';
import { cardToYMap, bytesToB64 } from '../src/lib/yhelpers.js';

const SHOTS = process.env.PLACE_HELD_SHOTS || '/tmp/place-held-shots';
const LANG = (process.env.I18N_LANG || '').trim() || null;
const PFX = LANG && LANG !== 'en' ? LANG : 'en';
const LAST_ID = 'card-last';
// The words are asserted in English only; a language run (I18N_LANG=ru, for the
// screenshots) checks the layout by eye.
const EN = PFX === 'en';

// Local-time stamp on a day `daysAgo` back at hh:mm. Hours before 05:00 count as
// the previous day for the slate, so every seed hour is well after it.
const at = (daysAgo, h, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

function note(id, x, y, stamp) {
  return {
    id, kind: 'note', x, y, w: 240, h: 160, title: id, body: `${id} body`,
    createdBy: USER_ID, updatedBy: USER_ID, createdAt: stamp, updatedAt: stamp,
  };
}

// Three working days (3, 2 and yesterday), the last touch yesterday 19:30 on a
// card far from the middle of the group.
const CARDS = [
  note('card-a', 100, 100, at(3, 10)),
  note('card-b', 2400, 150, at(3, 15)),
  note('card-c', 200, 1700, at(2, 11)),
  note('card-d', 1300, 900, at(2, 16)),
  note('card-e', 2300, 1600, at(1, 10)),
  note(LAST_ID, 3200, 2500, at(1, 19, 30)),
];

function savedBoard(cards) {
  const doc = new Y.Doc();
  const map = doc.getMap('cards');
  for (const c of cards) map.set(c.id, cardToYMap(c));
  return bytesToB64(Y.encodeStateAsUpdate(doc));
}

// Nothing may hold the screen: a tour or coachmark suppresses the held open by
// design, and the one-shot tips are ambient. setup_tips is marked done as
// layout-outlines-ask.spec.js does, onboarding done through get_my_tier.
const quiet = (page) => page.addInitScript(() => {
  try {
    for (const k of ['grids', 'list_drive', 'docs', 'palette']) localStorage.setItem(`soleil.reveal.${k}`, '1');
  } catch (_) {}
});

async function boot(page, { phone = false } = {}) {
  await quiet(page);
  await bootSignedIn(page, {
    path: LANG && LANG !== 'en' ? `/?lang=${LANG}` : '/',
    rpc: { get_my_tier: () => [{ tier: 'admin', demo_card_count: 0, onboarding: { done: true } }] },
    rest: {
      profiles: (url, method) => (method === 'GET' ? { user_id: USER_ID, settings: { setup_tips: { v: 1, done: true } } } : []),
      board_state: (url, method) => {
        if (method !== 'GET') return [];
        const id = (url.searchParams.get('board_id') || '').replace(/^eq\./, '');
        return { doc: savedBoard(id === ROOT_ID ? CARDS : []) };
      },
    },
  });
  await page.waitForSelector(phone ? '.canvas-wrap' : '.sb-ws-trigger', { timeout: 30000 });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
}

const last = (page) => page.locator(`.card[data-card-id="${LAST_ID}"]`);
const selectedCount = (page) => page.locator('.card.is-selected').count();

// Where the last card's centre sits against the canvas area's centre, in px.
async function offCentre(page) {
  return page.evaluate((id) => {
    const wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
    const el = document.querySelector(`.card[data-card-id="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { dx: r.x + r.width / 2 - (wrap.x + wrap.width / 2), dy: r.y + r.height / 2 - (wrap.y + wrap.height / 2) };
  }, LAST_ID);
}
const isCentred = async (page, tol = 40) => {
  const o = await offCentre(page);
  return !!o && Math.abs(o.dx) <= tol && Math.abs(o.dy) <= tol;
};

async function shot(page, name, clip) {
  if (!process.env.PLACE_HELD_SHOT) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${PFX}-${name}.png`), clip });
}

test.describe('your place is held', () => {
  test('after a break the canvas shows the whole cluster, then glides to the last card and selects it', async ({ page }) => {
    await boot(page);
    // The fit view first: the far-off last card is not on the middle of the canvas yet.
    await expect(page.locator('.card[data-card-id]').first()).toBeAttached({ timeout: 15000 });
    await page.waitForTimeout(300);
    expect(await isCentred(page)).toBe(false);
    expect(await selectedCount(page)).toBe(0);

    await expect(last(page)).toHaveClass(/is-selected/, { timeout: 5000 });
    await expect.poll(() => isCentred(page), { timeout: 5000 }).toBe(true);
    expect(await selectedCount(page)).toBe(1);
    await shot(page, '1280-landed', { x: 0, y: 0, width: 1000, height: 800 });
  });

  test('a wheel during the hold stops it: nothing is selected, the card is not centred', async ({ page }) => {
    await boot(page);
    await expect(page.locator('.card[data-card-id]').first()).toBeAttached({ timeout: 15000 });
    // Inside the 650 ms hold, over the canvas.
    const box = await page.locator('.canvas-wrap').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 40);
    await page.waitForTimeout(2000);
    expect(await selectedCount(page)).toBe(0);
    expect(await isCentred(page)).toBe(false);
  });

  test('with reduced motion it cuts straight to the card and selects it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await boot(page);
    await expect(last(page)).toHaveClass(/is-selected/, { timeout: 3000 });
    await expect.poll(() => isCentred(page), { timeout: 2000 }).toBe(true);
  });

  test('a quick return does not glide: nothing selected, the view is where it was left', async ({ page }) => {
    await boot(page);
    await expect(last(page)).toHaveClass(/is-selected/, { timeout: 5000 });
    await expect.poll(() => isCentred(page), { timeout: 5000 }).toBe(true);

    // Pan somewhere distinct (an empty-canvas wheel pans), and let the view save.
    const box = await page.locator('.canvas-wrap').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(300, 220);
    await page.waitForTimeout(1500);
    const before = await offCentre(page);
    expect(Math.abs(before.dx) + Math.abs(before.dy)).toBeGreaterThan(150);

    await page.reload();
    await page.waitForSelector('.sb-ws-trigger', { timeout: 30000 });
    await expect(page.locator('.card[data-card-id]').first()).toBeAttached({ timeout: 15000 });
    await page.waitForTimeout(2500);
    expect(await selectedCount(page)).toBe(0);
    const after = await offCentre(page);
    expect(Math.abs(after.dx - before.dx)).toBeLessThan(40);
    expect(Math.abs(after.dy - before.dy)).toBeLessThan(40);
  });

  test('the slate says when you last worked, then folds away; New cluster hides meanwhile', async ({ page }) => {
    await boot(page);
    const slate = page.locator('.cluster-slate');
    await expect(slate).toBeVisible({ timeout: 15000 });
    if (EN) await expect(slate).toContainText('last worked yesterday evening');
    // A longer language may not fit beside the name on this bar: then it shows the
    // short form at once (.is-clipped) rather than cut the cluster's name down.
    await expect(slate).toHaveClass(EN ? /is-long/ : /is-long|is-clipped/);
    const nameCut = await page.locator('.crumb').evaluateAll((els) => els.some((el) => el.scrollWidth > el.clientWidth + 1));
    expect(nameCut, "the cluster's name never gives way to the slate").toBe(false);
    if (/is-long/.test(await slate.getAttribute('class'))) await expect(page.locator('.ncl-wrap')).toBeHidden();
    await shot(page, '1280-long', { x: 0, y: 0, width: 1000, height: 120 });

    // ~4.5 s of long form, then the words fold away; New cluster comes back.
    const wasLong = /is-long/.test(await slate.getAttribute('class'));
    const leftWhileLong = await slate.evaluate((el) => el.getBoundingClientRect().left);
    await expect(slate).not.toHaveClass(/is-long/, { timeout: 8000 });
    if (wasLong) {
      // While they fade the words stay where they were: the slate leaves the row
      // only once they have folded (.is-gone).
      const fading = await slate.evaluate((el) => ({ gone: el.classList.contains('is-gone'), left: el.getBoundingClientRect().left }));
      expect(fading.gone, 'the slate stays in the row while its words fade').toBe(false);
      expect(Math.abs(fading.left - leftWhileLong), 'the fading words do not jump').toBeLessThan(1);
    }
    await page.waitForTimeout(1500);
    await expect(slate).toHaveClass(/is-gone/);
    await expect(page.locator('.ncl-wrap')).toBeVisible();
    // Folded, the slate shows no text and takes no room: New cluster sits exactly
    // where it would with no slate in the bar.
    const folded = await slate.evaluate((el) => ({
      w: el.getBoundingClientRect().width,
      last: [...el.querySelectorAll('.cs-last')].map((n) => n.getBoundingClientRect().width),
    }));
    expect(folded.w, 'the folded slate is empty').toBeLessThan(2);
    for (const w of folded.last) expect(w).toBeLessThan(2);
    const nclLeft = () => page.locator('.ncl-wrap').evaluate((el) => el.getBoundingClientRect().left);
    const withSlate = await nclLeft();
    await page.evaluate(() => document.querySelector('.cluster-slate')?.remove());
    expect(Math.abs((await nclLeft()) - withSlate), 'the folded slate moves nothing').toBeLessThan(1);
    await shot(page, '1280-short', { x: 0, y: 0, width: 1000, height: 120 });
  });
});

// The phone has no room beside the name: the words hang under the bar instead.
test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('the slate words show as a line under the top bar, then go', async ({ page }) => {
    await boot(page, { phone: true });
    const line = page.locator('.cluster-slate-line.is-on');
    await expect(line).toBeVisible({ timeout: 15000 });
    if (EN) await expect(line).toContainText('last worked yesterday evening');
    // A toast drops into the same spot and the line gives way to it (styles.css):
    // the stub's first-card toast is there now, so dismiss it to see the line.
    const toasts = page.locator('.toast-stack .toast-dismiss');
    if (await toasts.count()) {
      await toasts.first().dispatchEvent('click');
      await expect(page.locator('.toast-stack .toast')).toHaveCount(0);
      await page.waitForTimeout(600);
    }
    await shot(page, '390-line', { x: 0, y: 0, width: 390, height: 200 });
    await expect(line).toHaveCount(0, { timeout: 8000 });
  });
});
