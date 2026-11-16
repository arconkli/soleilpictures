// Under a finger (the mobile functionality pass, step 6b): the controls the
// audit found under 40px take 40, every field is 16px so an iPhone doesn't
// zoom the page on focus, and nothing on screen names a mouse or a keyboard.
// All of it keys on (pointer: coarse), so an iPad held sideways (the desktop
// layout under a finger) gets it too; tests/coarse-only-desktop.spec.js holds
// the other half, that a computer with a mouse keeps its sizes.
//
// Sizes are hit areas, found the way a tap finds them (helpers.js hitBox): a
// clear ::before counts, a neighbour lying over the control doesn't.
import { expect, test } from '@playwright/test';
import { bootSignedIn } from '../helpers/signedInStub.js';
import { canvasZoom, emptyCanvasPoint, hitBox, tap } from './helpers.js';

const mobileShell = (page) => page.viewportSize().width <= 1024;
const shellOnly = (page) => test.skip(!mobileShell(page), 'the phone shell (the bottom nav) only');

async function bootSigned(page) {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
}
async function bootLocal(page, extra = '') {
  await page.goto(`/?local=1&reset=1${extra}`);
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
}

// Every visible match of each selector takes at least `min` each way.
async function expectFinger(page, selectors, { min = 40, scope = null } = {}) {
  const small = [];
  let seen = 0;
  for (const sel of selectors) {
    const all = (scope || page).locator(sel);
    const n = await all.count();
    let shown = 0;
    for (let i = 0; i < n; i++) {
      const el = all.nth(i);
      if (!(await el.isVisible())) continue;
      shown++;
      await el.scrollIntoViewIfNeeded();
      const b = await hitBox(el);
      if (b.w < min || b.h < min) small.push(`${sel}[${i}] ${b.w}x${b.h}${b.covered ? ' (covered)' : ''}`);
    }
    if (!shown) small.push(`${sel}: none on screen`);
    seen += shown;
  }
  expect(small, `under ${min}px to a finger`).toEqual([]);
  return seen;
}
const fontPx = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
const clips = (loc) => loc.evaluate((el) => el.scrollWidth > el.clientWidth + 1);

test.describe('fields', () => {
  test('every field is 16px; the board\'s own text keeps its size', async ({ page }) => {
    await bootLocal(page);
    // The sheets of the public pages hold the rule too, and two of them load
    // inside the app (the pricing wall, a shared file): with them in, the
    // board's own text and the larger fields still keep their sizes.
    const sizes = await page.evaluate(async () => {
      await import('/src/pages/seoLanding.css');
      await import('/src/components/fileShare/fileShare.css');
      const make = (tag, host, type, cls) => {
        const el = document.createElement(tag);
        if (type) el.type = type;
        if (cls) el.className = cls; else el.style.font = '400 11px/1 sans-serif';
        // As the app's own selects and search fields are drawn: a system-drawn
        // one snaps its text to the system's sizes on a Mac's WebKit.
        el.style.appearance = 'none';
        el.style.webkitAppearance = 'none';
        host.appendChild(el);
        const px = parseFloat(getComputedStyle(el).fontSize);
        el.remove();
        return px;
      };
      const layer = document.querySelector('.cards-layer');
      return {
        input: make('input', document.body), search: make('input', document.body, 'search'),
        textarea: make('textarea', document.body), select: make('select', document.body),
        onBoard: make('textarea', layer), hasLayer: !!layer,
        // Drawn larger than 16px: the sign-in code, an open doc's title.
        code: make('input', document.body, null, 'auth-code-input'),
        docTitle: make('input', document.body, null, 'doc-card-title-input'),
        // The two sheets are in: each one's own finger rule shows.
        sheets: ['exp-sort-btn', 'fsc-btn'].map((cls) => {
          const el = document.createElement('button');
          el.className = cls;
          document.body.appendChild(el);
          const h = getComputedStyle(el).minHeight;
          el.remove();
          return h;
        }),
      };
    });
    expect(sizes.hasLayer).toBe(true);
    expect(sizes.sheets).toEqual(['40px', '40px']);
    expect(sizes).toMatchObject({ input: 16, search: 16, textarea: 16, select: 16, onBoard: 11, code: 22, docTitle: 17 });
  });

  test('the question dialog (Add a link) has a 16px, 40px field that shows its placeholder, and 40px buttons', async ({ page }) => {
    shellOnly(page);
    await bootLocal(page);
    await page.getByLabel('Add a card').first().tap();
    await page.locator('.mobile-add-grid').getByText('Link', { exact: true }).tap();
    const field = page.locator('.feedback-field input');
    await expect(field).toBeVisible();
    expect(await fontPx(field)).toBeGreaterThanOrEqual(16);
    expect(await clips(field)).toBe(false);
    expect(await field.evaluate((el) => el.offsetHeight)).toBeGreaterThanOrEqual(40);   // not its box: the dialog scales in
    await expectFinger(page, ['.feedback-dialog .btn-primary', '.feedback-dialog .btn-secondary']);
  });

  test('the tag picker\'s field is 16px and fits its words', async ({ page }) => {
    shellOnly(page);
    await bootLocal(page);
    await page.locator('.canvas-wrap .card[data-card-id="home-note"]').tap();
    await page.locator('.sel-menu .card-menu-btn').tap();
    await page.locator('.ctx-menu').getByText('Tag…', { exact: true }).tap();
    const field = page.locator('.tag-picker-input');
    await expect(field).toBeVisible();
    expect(await fontPx(field)).toBeGreaterThanOrEqual(16);
    expect(await clips(field)).toBe(false);
  });
});

test.describe('the board', () => {
  test('Done, which leaves Draw, takes 40px', async ({ page }) => {
    await bootLocal(page);
    await page.locator('.cnv-tools [aria-label="Free-draw tool"]').tap();
    const done = page.locator('.cnv-hint-btn', { hasText: 'Done' });
    await expect(done).toBeVisible();
    await expectFinger(page, ['.cnv-hint-btn']);
    await done.tap();
    await expect(done).toHaveCount(0);
  });

  // In-card buttons are drawn at the board's zoom: measured at 100%.
  async function at100(page, id, point) {
    const card = page.locator(`.canvas-wrap .card[data-card-id="${id}"]`);
    const b = await card.boundingBox();
    await tap(page, point(b));
    await expect(page.locator(`.card.is-selected[data-card-id="${id}"]`)).toHaveCount(1);
    await page.keyboard.press('Shift+Digit2');   // Fit selection: the card to the middle
    await page.waitForTimeout(700);
    await page.keyboard.press('Control+0');      // Reset zoom (⌘0 on a Mac's WebKit)
    await page.keyboard.press('Meta+0');
    await expect.poll(() => canvasZoom(page)).toBeCloseTo(1, 2);
    await page.waitForTimeout(400);
  }

  test('a photo\'s buttons take 40px at 100%', async ({ page }) => {
    shellOnly(page);
    await bootLocal(page);
    await at100(page, 'home-image', (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    // Unselected, as a finger first meets them (the selection's ⋯ sits on the corner).
    await tap(page, await emptyCanvasPoint(page));
    await expect(page.locator('.card.is-selected')).toHaveCount(0);
    const seen = await expectFinger(page, ['.card[data-card-id="home-image"] .ic-actions .ic-act']);
    expect(seen).toBeGreaterThanOrEqual(2);
  });

  test('a selected palette\'s remove-colour x takes 32px in its own swatch, and its add sliver 40px, at 100%', async ({ page }) => {
    shellOnly(page);
    await bootLocal(page);
    await at100(page, 'home-pal', (b) => ({ x: b.x + b.width / 2, y: b.y + 3 }));
    await expectFinger(page, ['.card.is-selected .pc-cell-x'], { min: 32 });
    await expectFinger(page, ['.card.is-selected .pc-add']);
    // No x's area reaches past its own swatch into the one before it.
    const reach = await page.evaluate(() => [...document.querySelectorAll('.card.is-selected .pc-cell-x')].map((x) => {
      const cell = x.closest('.pc-cell').getBoundingClientRect();
      const r = x.getBoundingClientRect();
      const y = r.top + r.height / 2;
      let left = r.left;
      while (left > cell.left - 40 && document.elementFromPoint(left - 1, y) === x) left--;
      return left >= cell.left - 0.5;
    }));
    expect(reach.length).toBeGreaterThan(1);
    expect(reach).not.toContain(false);
  });

  for (const width of [390, 320]) {
    test(`the plan chip takes 40px and leaves Draw's Done clear at ${width} wide`, async ({ page }) => {
      test.skip(page.viewportSize().width > 640, 'a phone: the chip sits under the top bar there');
      await page.setViewportSize({ width, height: page.viewportSize().height });
      await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
      // A free account with enough cards for the chip to show.
      await bootSignedIn(page, {
        rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 20, onboarding: { seeded: true, done: true } }] },
      });
      await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
      await expect(page.locator('.upgrade-chip')).toBeVisible({ timeout: 15000 });
      // Something lies over the chip while the board settles in: measured once
      // the chip is on top.
      await expect.poll(async () => (await hitBox(page.locator('.upgrade-chip'))).covered, { timeout: 10000 }).toBe(false);
      await expectFinger(page, ['.upgrade-chip']);
      await page.locator('.cnv-tools [aria-label="Free-draw tool"]').tap();
      await expect(page.locator('.cnv-hint-btn')).toBeVisible();
      // A toast passing over the chip (the stack sits there on a phone) is not
      // Done: wait it out, as above. Done lying on the chip would never clear.
      await expect.poll(async () => (await hitBox(page.locator('.upgrade-chip'))).covered, { timeout: 10000 }).toBe(false);
      await expectFinger(page, ['.cnv-hint-btn', '.upgrade-chip']);
    });
  }

  test('an empty cluster says tap and hold, not drag', async ({ page }) => {
    await bootLocal(page, '&blank=1');
    const line = page.locator('.cnv-empty-tiles-sub-coarse');
    await expect(line).toBeVisible();
    await expect(line).toContainText('tap + to add');
    await expect(line).toContainText('press and hold');
    await expect(page.locator('.cnv-empty-tiles-sub-fine')).toBeHidden();
  });
});

test.describe('the menu', () => {
  test('New cluster, New tag and a workspace\'s ⋯ take 40px', async ({ page }) => {
    shellOnly(page);
    await bootSigned(page);
    await page.getByLabel('Open menu').first().tap();
    const drawer = page.locator('.sidebar.is-mobile-open');
    await expect(drawer).toBeVisible();
    await expectFinger(page, ['.sb-boards-add', '.sb-tags-add'], { scope: drawer });
    await drawer.locator('.sb-ws-trigger').first().tap();
    await expect(page.locator('.ws-menu-row-more').first()).toBeVisible();
    await expectFinger(page, ['.ws-menu-row-more']);
  });
});

test.describe('small things', () => {
  test('the tour\'s Skip takes 40px', async ({ page }) => {
    await page.goto('/?tourqa=1');
    await expect(page.locator('.onboarding-tour-skip')).toBeVisible({ timeout: 30000 });
    await expectFinger(page, ['.onboarding-tour-skip']);
  });

  test('the upload tray\'s buttons take 40px', async ({ page }) => {
    await page.goto('/?uploadqa=1&tray=problems');
    await expect(page.locator('.imptray-ib').first()).toBeVisible({ timeout: 30000 });
    await expectFinger(page, ['.imptray-ib', '.imptray-btn']);
  });

  test('the import guide\'s close and its link take 40px', async ({ page }) => {
    await page.goto('/?importqa=1&guide=1');
    await expect(page.locator('.imptray.is-guide')).toBeVisible({ timeout: 30000 });
    await expectFinger(page, ['.imptray.is-guide .imptray-ib', '.imptray-row-actions a']);
  });

  for (const [path, sel] of [['/pricing', '.pricing-toggle-pill'], ['/docs', '.docs-nav-toggle'], ['/explore', '.exp-sort-btn']]) {
    test(`${path}: ${sel} takes 40px`, async ({ page }) => {
      test.skip(sel === '.docs-nav-toggle' && page.viewportSize().width > 900, 'the docs menu button is a narrow screen\'s');
      await page.goto(path);
      await expect(page.locator(sel).first()).toBeVisible({ timeout: 30000 });
      await expectFinger(page, [sel]);
    });
  }
});

test.describe('Settings', () => {
  test('close, back, the mode pills and the accent dots take 40px; no wheel or W A S D rows', async ({ page }) => {
    shellOnly(page);
    await bootSigned(page);
    await page.locator('.mb-nav-tab', { hasText: 'Settings' }).tap();
    const modal = page.locator('.settings-modal');
    await expect(modal).toBeVisible();
    await modal.locator('.settings-tab', { hasText: 'Appearance' }).tap();
    await expect(modal.locator('.settings-accent-row')).toBeVisible();
    const controls = ['.settings-x', '.settings-pill', '.settings-accent-dot', 'select.settings-input'];
    // The back arrow is the phone's (a list, then a detail screen).
    if (await modal.locator('.settings-back').count()) controls.push('.settings-back');
    await expectFinger(page, controls, { scope: modal });
    for (const sel of ['select.settings-input']) {
      expect(await fontPx(modal.locator(sel).first())).toBeGreaterThanOrEqual(16);
    }
    const pane = modal.locator('.settings-pane');
    await expect(pane).toContainText('Clean mode');
    await expect(pane).not.toContainText('Scroll wheel');
    await expect(pane).not.toContainText('W A S D');
    await expect(pane).not.toContainText('⌘');
    // The close still closes.
    await modal.locator('.settings-x').tap();
    await expect(modal).toHaveCount(0);
  });
});

test.describe('Share', () => {
  test('the reach buttons, the role pickers and Details take 40px; the invite field is 16px', async ({ page }) => {
    shellOnly(page);
    await bootSigned(page);
    await page.getByLabel('Share this cluster').first().tap();
    const panel = page.locator('.share-modal');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.share-scope-btn').first()).toBeVisible();
    await expectFinger(page, ['.share-scope-btn', '.share-access-pick', '.share-role-select', '.share-reward-toggle'], { scope: panel });
    const invite = panel.locator('.share-input').first();
    expect(await fontPx(invite)).toBeGreaterThanOrEqual(16);
    expect(await clips(invite)).toBe(false);
    expect(await fontPx(panel.locator('.share-access-pick').first())).toBeGreaterThanOrEqual(16);
  });
});

test.describe('Messages', () => {
  test('a thread\'s head icons and the composer\'s buttons take 40px; the field is 16px', async ({ page }) => {
    const phone = page.viewportSize().width <= 640;
    await page.goto(`/?msgqa=1${phone ? '&phone=1' : ''}&conv=c-maya`);
    const field = page.locator('.msg-composer-input');
    await expect(field).toBeVisible({ timeout: 30000 });
    await expectFinger(page, ['.msg-composer-btn', '.msg-composer-send']);
    // The thread's own head: the list's is under it on a phone.
    const head = page.locator('.msg-panel-head').filter({ has: page.getByLabel('Search messages') });
    await expectFinger(page, ['.msg-panel-icon'], { scope: head });
    expect(await fontPx(field)).toBeGreaterThanOrEqual(16);
    expect(await clips(field)).toBe(false);

    // With Search open the head is a field: no icon's area lies over it.
    await head.getByLabel('Search messages').tap();
    const search = page.locator('.msg-search.is-head .msg-search-input');
    await expect(search).toBeVisible();
    const box = await hitBox(search);
    expect(box.covered).toBe(false);
    expect(box.h).toBeGreaterThanOrEqual(30);
    const own = await page.locator('.msg-search.is-head').evaluate((label) => {
      const r = label.getBoundingClientRect();
      const y = r.top + r.height / 2;
      return [r.left + 1, r.right - 2].map((x) => { const at = document.elementFromPoint(x, y); return !!at && label.contains(at); });
    });
    expect(own).toEqual([true, true]);
    expect(await fontPx(search)).toBeGreaterThanOrEqual(16);
  });

  test('an empty list says Tap +, not Click', async ({ page }) => {
    shellOnly(page);
    await bootSigned(page);
    await page.locator('.mb-nav-tab', { hasText: 'Messages' }).tap();
    const empty = page.locator('.msg-empty').first();
    await expect(empty).toBeVisible({ timeout: 15000 });
    await expect(empty).toContainText('Tap');
    await expect(empty).not.toContainText('Click');
  });
});
