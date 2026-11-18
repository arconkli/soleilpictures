// Haptic feedback (lib/haptics.js, components/HapticTap.jsx).
//
// Chromium projects: navigator.vibrate is recorded, so what buzzed and when is
// readable. Holds and drags use CDP touch (tests/touch/helpers.js), which is the
// only way to get a real touch pointerType; the desktop project uses the mouse
// and must record nothing. iPhone Safari has no vibrate: there the buzz is a
// native <input switch> toggled by the user's own tap on a transparent label
// over the row, so the spec taps a danger row and reads that switch.
import { expect, test } from '@playwright/test';
import { holdDrag, touchDown, touchMove, touchUp } from '../touch/helpers.js';

const card = (page, id) => page.locator(`.card[data-card-id="${id}"]`);
const vib = (page) => page.evaluate(() => window.__vib.slice());

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.project.name === 'mobile-safari') return;
  await page.addInitScript(() => {
    window.__vib = [];
    window.__vibT = [];
    Object.defineProperty(Navigator.prototype, 'vibrate', {
      configurable: true,
      value: function (p) { window.__vib.push(p); window.__vibT.push(performance.now()); return true; },
    });
  });
});

// The switch is not a tab stop and must never keep focus after a tap.
const switchInert = async (page) => {
  expect(await page.evaluate(() => document.activeElement?.id)).not.toBe('soleil-haptic-switch');
  expect(await page.evaluate(() => document.getElementById('soleil-haptic-switch')?.hasAttribute('tabindex'))).toBe(false);
};

async function open(page, { off = false, cards = 3 } = {}) {
  if (off) await page.addInitScript(() => { try { localStorage.setItem('soleil.haptics', 'off'); } catch (_) {} });
  await page.goto(`/?local=1&reset=1&blank=1&mixqa=${cards}`);
  await expect(card(page, 'mixqa-0')).toBeVisible();
  // The board fits itself to its cards once they land; let the camera settle.
  await page.waitForTimeout(900);
}

const center = (page, id) => card(page, id).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});

// A card whose centre is really on top of itself (nothing floats over it).
async function hittable(page) {
  for (const id of ['mixqa-0', 'mixqa-1', 'mixqa-2']) {
    const ok = await card(page, id).evaluate((el) => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return r.width > 24 && r.top > 60 && r.bottom < innerHeight - 8 && !!at && el.contains(at);
    });
    if (ok) return id;
  }
  throw new Error('no card is under its own centre');
}

test.describe('touch, Chromium', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'Chromium touch (CDP) only');
  });

  test('holding a card until it lifts buzzes once (lift) and nothing else before the finger moves', async ({ page }) => {
    await open(page);
    const id = await hittable(page);
    const p = await center(page, id);
    await touchDown(page, [p]);
    await expect(card(page, id)).toHaveClass(/is-lifted/);
    await page.waitForTimeout(400);
    expect(await vib(page)).toEqual([15]);
    await touchUp(page);
    await page.waitForTimeout(200);
    expect(await vib(page)).toEqual([15]);
  });

  test('lifting a card and dragging it onto a cluster ticks on arrival and drops on release', async ({ page }) => {
    await open(page);
    // A project started from Home lands on the Studio root as a cluster card.
    await page.getByRole('tab', { name: 'Home' }).tap();
    await page.locator('.ph-tile-new').tap();
    await page.locator('.ph-new-input').fill('Spec ad');
    await page.locator('.ph-new-input').press('Enter');
    await expect(page.locator('.crumbs .crumb.here')).toHaveText('Spec ad');
    // The breadcrumb is hidden on a phone; a DOM click is the same route back.
    await page.getByRole('button', { name: 'Open menu' }).tap();
    await page.locator('.sb-row', { hasText: 'Studio' }).first().tap();
    await expect(page.locator('.crumbs .crumb.here')).toHaveText('Studio');
    await page.touchscreen.tap(385, 400);
    await expect(page.locator('.sidebar-mobile-backdrop')).toHaveCount(0);
    await expect(card(page, 'mixqa-0')).toBeVisible();
    await page.waitForTimeout(900);
    // The cluster card lands beside the content, off a phone's screen: zoom out.
    const cluster = page.locator('.card.card-kind-board', { hasText: 'Spec ad' }).first();
    for (let i = 0; i < 10; i++) {
      const right = await page.evaluate(() => document.querySelector('.card.card-kind-board')?.getBoundingClientRect().right ?? Infinity);
      if (right < 380) break;
      await page.getByRole('button', { name: 'Zoom out' }).dispatchEvent('click');
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    await expect(cluster).toBeVisible();
    await page.evaluate(() => {
      window.__moves = [];
      window.addEventListener('soleil-card-into-board-drop', (e) => {
        window.__moves.push((e.detail.cards || []).map((c) => c.id));
      }, true);
    });

    const id = await hittable(page);
    const from = await center(page, id);
    const to = await cluster.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    // When the cluster first lights up as the drop target.
    await page.evaluate(() => {
      window.__lit = null;
      new MutationObserver(() => {
        if (window.__lit === null && document.querySelector('.is-card-drop-target')) window.__lit = performance.now();
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    await holdDrag(page, from, [to], { ms: 700, steps: 12, lift: false });
    await page.waitForTimeout(300);
    const lit = await page.evaluate(() => window.__lit);
    expect(lit, 'the cluster lit up as the drop target').not.toBeNull();
    // Snap guides can tick as the drag settles (the seeded cards share a top
    // edge); the cluster becoming the target is the tick beside the moment it lit.
    const during = await page.evaluate(() => ({ vib: window.__vib.slice(), t: window.__vibT.slice() }));
    expect(during.vib[0]).toBe(15);
    const near = during.t.filter((t, i) => during.vib[i] === 10 && Math.abs(t - lit) < 50);
    expect(near, `ticks: ${JSON.stringify(during)} lit: ${lit}`).toHaveLength(1);
    const before = during.vib.length;
    await touchUp(page);
    await expect.poll(async () => (await vib(page)).slice(before)).toEqual([[18, 40, 18]]);
    // The harness hands the move to the same listener the app uses.
    await expect.poll(() => page.evaluate(() => window.__moves)).toEqual([[id]]);
  });

  test('dragging a card into line with another ticks once while it stays aligned', async ({ page }) => {
    await open(page);
    const id = await hittable(page);
    const rect = (k) => card(page, k).evaluate((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
    const a = await rect(id);
    const from = { x: a.l + a.w / 2, y: a.t + a.h / 2 };
    // The seeded cards share a top edge. Lift one, take it down 80px, then
    // bring it back up so its top edge comes into line with the others.
    await touchDown(page, [from]);
    await expect(card(page, id)).toHaveClass(/is-lifted/);
    const stepTo = async (y) => { await touchMove(page, [{ x: from.x, y }]); await page.waitForTimeout(40); };
    for (let i = 1; i <= 8; i++) await stepTo(from.y + i * 10);
    await page.waitForTimeout(400);
    await page.evaluate(() => { window.__vib.length = 0; });
    for (let i = 1; i <= 8; i++) await stepTo(from.y + 80 - i * 10);
    await page.waitForTimeout(500);
    const during = await vib(page);
    // Wiggle by a pixel while aligned: same alignment, no new tick.
    await stepTo(from.y + 1);
    await stepTo(from.y);
    await page.waitForTimeout(300);
    await touchUp(page);
    const all = await vib(page);
    expect(during, `during: ${JSON.stringify(during)}`).toEqual([10]);
    expect(all.filter((v) => v === 10).length, `all: ${JSON.stringify(all)}`).toBe(1);
  });

  test('with vibration off the same hold records nothing', async ({ page }) => {
    await open(page, { off: true });
    const id = await hittable(page);
    const p = await center(page, id);
    await touchDown(page, [p]);
    await expect(card(page, id)).toHaveClass(/is-lifted/);
    await page.waitForTimeout(400);
    await touchUp(page);
    expect(await vib(page)).toEqual([]);
  });

  // A point on bare canvas: nothing of ours (card, rail, zoom, inbox) under it.
  const emptySpot = (page) => page.evaluate(() => {
    const bad = '.card, .cnv-tool, .cnv-tools, .cnv-zoom, .inbox, .cnv-add-menu, .cnv-hint, .cnv-empty-tiles, .tob, .sel-menu, .multi-resize, .ctx-menu, .tabbar, nav, header';
    const host = document.querySelector('.cards-layer')?.getBoundingClientRect();
    for (let y = innerHeight - 140; y > 120; y -= 24) {
      for (let x = 60; x < innerWidth - 20; x += 24) {
        const at = document.elementFromPoint(x, y);
        if (at && !at.closest(bad) && at.closest('.canvas, .cnv, [class*="canvas"], .cards-layer')) return { x, y };
      }
    }
    return host ? { x: host.left + 30, y: host.top + 30 } : null;
  });

  test("a hold that does nothing doesn't buzz", async ({ page }) => {
    await open(page);
    // The canvas toolbar is where the hold is ignored on a phone's layout.
    const tool = page.locator('.cnv-tools .cnv-tool').first();
    await expect(tool).toBeVisible();
    const tb = await tool.boundingBox();
    await touchDown(page, [{ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }]);
    await page.waitForTimeout(700);
    await touchUp(page);
    await page.waitForTimeout(200);
    expect(await vib(page)).toEqual([]);
    // Control: the same hold on empty canvas with the select tool buzzes once.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.evaluate(() => { window.__vib.length = 0; });
    const spot = await emptySpot(page);
    expect(spot, 'an empty canvas point').not.toBeNull();
    await touchDown(page, [spot]);
    await page.waitForTimeout(700);
    await touchUp(page);
    await page.waitForTimeout(200);
    expect(await vib(page)).toEqual([15]);
  });

  test.describe('sidebar cluster row hold', () => {
    async function drawerWithRow(page) {
      // The phone's own drawer in local mode is the older sidebar; the
      // SidebarBoardTree rows live in the real ClusterSidebar, which the
      // ?sidebarqa=1 harness mounts at this phone size.
      await page.goto('/?sidebarqa=1');
      await page.waitForSelector('[data-sidebarqa-ready]');
      const row = page.locator('.sb-tree-row', { hasText: 'Feature film' }).first();
      await expect(row).toBeVisible();
      await page.waitForTimeout(400);
      await page.evaluate(() => { window.__vib.length = 0; });
      return row;
    }
    const heldAt = async (page, row, ms) => {
      const b = await row.boundingBox();
      await touchDown(page, [{ x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2 }]);
      await page.waitForTimeout(ms);
      await touchUp(page);
      await page.waitForTimeout(250);
    };

    test('a 420ms hold is still a tap: no buzz, no row menu', async ({ page }) => {
      const row = await drawerWithRow(page);
      await heldAt(page, row, 420);
      expect(await vib(page)).toEqual([]);
      await expect(page.locator('.ctx-menu')).toHaveCount(0);
    });

    test('a 650ms hold buzzes once and opens the row menu', async ({ page }) => {
      const row = await drawerWithRow(page);
      await heldAt(page, row, 650);
      expect(await vib(page)).toEqual([15]);
      await expect(page.locator('.ctx-menu')).toBeVisible();
    });
  });
});

test.describe('mouse, desktop', () => {
  // The desktop-chrome project ignores mobile/**, so the mouse runs here: a
  // Chromium context with no touch, at desktop size.
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } });
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chrome', 'one Chromium run is enough');
  });

  test('dragging a card with the mouse, and holding it, record nothing', async ({ page }) => {
    await open(page);
    const id = await hittable(page);
    const p = await center(page, id);
    const left0 = await card(page, id).evaluate((el) => el.getBoundingClientRect().left);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    for (let i = 1; i <= 8; i++) { await page.mouse.move(p.x + i * 12, p.y + i * 6); await page.waitForTimeout(16); }
    await page.mouse.up();
    await page.waitForTimeout(300);
    // The drag really moved the card, so the silence is not an idle gesture.
    expect(await card(page, id).evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThan(left0 + 40);
    expect(await vib(page)).toEqual([]);
  });
});

test.describe('iPhone Safari, the switch', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-safari', 'the switch trick is iPhone Safari only');
  });

  const switchState = (page) => page.evaluate(() => {
    const el = document.getElementById('soleil-haptic-switch');
    return el ? el.checked : null;
  });

  test('tapping Delete in a card menu deletes once, toasts once, and toggles the switch once', async ({ page }) => {
    await open(page);
    const before = await page.locator('.cards-layer .card').count();
    const id = await hittable(page);
    // WebKit cannot hold a real finger (see mobile/long-press), so the menu
    // opens the way a long-press ends up opening it: by its contextmenu event.
    await card(page, id).click({ button: 'right' });
    // On a phone Delete is one of the sheet's tiles above the list
    // (.ctx-quick, ctxMenuParts.jsx), not a row in it.
    const del = page.locator('.ctx-quick .ctx-quick-btn.danger').first();
    await expect(del).toBeVisible();
    await del.scrollIntoViewIfNeeded();
    await expect(del).toContainText(/Delete/);
    await expect(del.locator('label.haptic-tap')).toHaveCount(1);
    expect(await switchState(page)).toBe(false);
    const b = await del.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(card(page, id)).toHaveCount(0);
    await expect(page.locator('.cards-layer .card')).toHaveCount(before - 1);
    await expect(page.locator('.toast-msg', { hasText: /deleted/i })).toHaveCount(1);
    await page.waitForTimeout(600);
    await expect(page.locator('.cards-layer .card')).toHaveCount(before - 1);
    await expect(page.locator('.toast-msg', { hasText: /deleted/i })).toHaveCount(1);
    expect(await switchState(page)).toBe(true);
    await switchInert(page);
  });

  test('tapping a display-mode checklist box toggles it once and the switch once', async ({ page }) => {
    page.on('pageerror', (e) => { throw e; });
    await page.goto('/?noteqa=1&trie=1');
    await expect(page.locator('#noteqa-ready')).toHaveText('noteqa ready', { timeout: 15000 });
    await page.evaluate(() => {
      const T = window.__soleilNoteTest;
      const src = '<p>List</p><ul class="note-checklist">'
        + '<li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>one</p></div></li>'
        + '<li class="ck"><span class="ck-box" role="checkbox" aria-checked="false"></span><div class="ck-text"><p>two</p></div></li>'
        + '</ul>';
      T.seedNoteFragmentFromHtml(T.docA, T.cardA, src);
      T.docA.transact(() => T.cardA.set('html', T.noteFragmentToHtml(T.getNoteFragment(T.cardA))), 'remote-test');
    });
    const box = page.locator('[data-client="A"] .note .ck-box').nth(1);
    await expect(box).toBeVisible();
    await expect(box.locator('label[data-haptic-label]')).toHaveCount(1);
    const b = await box.boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await expect(box).toHaveClass(/is-checked/);
    await page.waitForTimeout(500);
    await expect(box).toHaveClass(/is-checked/);
    await expect(page.locator('[data-client="A"] .note .ck-box.is-checked')).toHaveCount(1);
    expect(await page.evaluate(() => document.getElementById('soleil-haptic-switch').checked)).toBe(true);
    await switchInert(page);
  });
});
