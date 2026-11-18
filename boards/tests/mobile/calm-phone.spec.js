// The calm phone: inside a cluster on the mobile shell (phones and the upright
// iPad) the board has the whole screen.
//
//   - No tab bar, no tool rail, no "Add images" dock. One floating + at the
//     bottom centre opens the add sheet, which now lists Arrow after Draw.
//   - Comments is a top-bar button, with no count. The plan chip is off the
//     board and is the drawer's last row. Redo shows only when there is
//     something to redo. Unread messages put a dot on the menu button.
//   - Someone who can only view gets a + that places a comment.
//   - Writing mode: while a card's text is edited, the chrome steps back, the
//     format row docks on the keyboard and the top bar keeps Undo, Redo and
//     Done.
//   - A small note opened for typing glides in until its text is readable, and
//     a new note doesn't move twice.
//
// Outside a cluster the tab bar is as before. The sideways iPad keeps the
// desktop layout: tests/tablet/calm-phone-landscape.spec.js.
import { test, expect } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';

const KB = 300;
const CONV = '55555555-5555-4555-8555-555555555555';
const OTHER = '66666666-6666-4666-8666-666666666666';
const tier = (n) => [{ tier: 'demo', demo_card_count: n, onboarding: { seeded: true, done: true } }];
const comment = {
  id: '77777777-7777-4777-8777-777777777777', board_id: ROOT_ID, workspace_id: WS_ID,
  author: OTHER, author_name: 'Nora', body: 'Can we get the dusk shot too?', anchor_kind: 'board', anchor_id: null,
  reply_to: null, resolved: false, hidden: false, deleted_at: null, created_at: new Date(Date.now() - 60_000).toISOString(),
};
const MENU = '.topbar .tb-left > button.tb-icon';
const FAB = '.mb-add-fab';
const EYE = '.cnv-comments-eye';
const CHIP = '.upgrade-chip';
const BAR = '.tob.nb-a';
const DRAWER = 'aside.sidebar.is-mobile-open';
// The tab bar's old puck: a 56px circle, centred, 9px over the foot.
const PUCK_LIFT = 9;

async function boot(page, opts = {}) {
  await page.addInitScript((uid) => {
    try {
      sessionStorage.setItem('soleil.revealSession', '1');
      localStorage.setItem(`soleil_first_card_logged_${uid}`, '1');
    } catch {}
  }, USER_ID);
  await bootSignedIn(page, opts);
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(FAB)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-phone-cluster', '1');
}

const flag = (page) => page.evaluate(() => document.body.getAttribute('data-text-editing'));
const wrapHas = (page, cls) => page.evaluate((c) => document.querySelector('.canvas-wrap').classList.contains(c), cls);
const box = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden');
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom };
}, sel);
const apart = (a, b) => !a || !b || a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y;
// Where an element is, whether it shows, and whether a finger at its middle hits it.
const rectOf = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const at = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom, vis: cs.visibility, hit: !!at && (at === el || el.contains(at)) };
}, sel);
// What a finger at the +'s middle would hit.
const underFab = (page) => page.evaluate((sel) => {
  const f = document.querySelector(sel);
  if (!f) return 'none';
  const b = f.getBoundingClientRect();
  const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return el && f.contains(el) ? 'fab' : (el ? String(el.className).slice(0, 60) : 'nothing');
}, FAB);

const tile = (page, name) => page.locator('.mobile-add-tile').filter({ has: page.locator('.mobile-add-lbl', { hasText: new RegExp(`^${name}$`) }) });
async function openSheet(page) {
  await page.locator(FAB).tap();
  await expect(page.locator('.mobile-add-tile').first()).toBeVisible();
  // The sheet has slid up over the +.
  await expect.poll(() => underFab(page)).not.toBe('fab');
}
// The caret is in a card on the board.
const caretInCard = (page) => expect.poll(() => page.evaluate(() => {
  const a = document.activeElement;
  return !!a && a.isContentEditable && !!a.closest('.cards-layer');
})).toBe(true);
// An empty board's + goes straight to photos, so its first note comes from the
// empty panel's Note tile.
async function firstNote(page, ...lines) {
  await page.locator('.cnv-empty-tile').filter({ hasText: /note/i }).first().tap();
  await caretInCard(page);
  for (let i = 0; i < lines.length; i++) {
    if (i) await page.keyboard.press('Enter');
    await page.keyboard.type(lines[i]);
  }
  await expect.poll(() => flag(page)).toBe('1');
}
async function done(page) {
  await page.locator('.topbar .tb-done').tap();
  await expect.poll(() => flag(page)).toBeNull();
  await expect(page.locator(FAB)).toBeVisible();
}
// The on-screen keyboard, `px` tall (0 puts it away).
async function keyboard(page, px) {
  await page.evaluate((h) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - h });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
  }, px);
}
// The note's text size on screen, and where the note is.
const noteOnScreen = (page) => page.evaluate(() => {
  const card = document.querySelector('.cards-layer .card.card-kind-note');
  const body = card?.querySelector('.note-body');
  if (!card || !body) return null;
  const b = card.getBoundingClientRect();
  const zoom = b.width / card.offsetWidth;
  return { px: parseFloat(getComputedStyle(body).fontSize) * zoom, zoom, x: b.left, y: b.top, w: b.width, h: b.height };
});
// The note once the view has stopped moving: two readings 250ms apart that agree.
const noteAtRest = (page) => page.evaluate(async () => {
  const read = () => {
    const card = document.querySelector('.cards-layer .card.card-kind-note');
    const body = card.querySelector('.note-body');
    const b = card.getBoundingClientRect();
    const zoom = b.width / card.offsetWidth;
    return { px: parseFloat(getComputedStyle(body).fontSize) * zoom, zoom, x: b.left, y: b.top, w: b.width, h: b.height };
  };
  let was = read();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const now = read();
    if (Math.abs(now.zoom - was.zoom) < 0.0005 && Math.abs(now.x - was.x) < 0.5 && Math.abs(now.y - was.y) < 0.5) return now;
    was = now;
  }
  return was;
});
async function zoomOut(page, times) {
  for (let i = 0; i < times; i++) {
    await page.evaluate(() => {
      const el = document.querySelector('.canvas-wrap');
      const b = el.getBoundingClientRect();
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: 60, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 }));
    });
  }
}

test('inside a cluster: no tab bar, rail or dock; one + that opens the add sheet', async ({ page }, info) => {
  test.setTimeout(180_000);
  await boot(page, {
    rpc: { get_my_tier: tier(6), get_unread_counts: { [CONV]: 2 } },
    rest: {
      conversation_summary: [{ conversation_id: CONV, workspace_id: null, title: 'Crew', last_message_at: new Date().toISOString(), last_message_sender_id: 'x' }],
      conversation_participants: [{ conversation_id: CONV, user_id: USER_ID, joined_at: new Date().toISOString(), left_at: null, last_read_at: null }],
    },
  });
  const { iw, ih } = await page.evaluate(() => ({ iw: innerWidth, ih: innerHeight }));

  // At rest: the board has the screen.
  for (const sel of ['.mb-nav', '.cnv-tools', '.cnv-depth-dock']) await expect(page.locator(sel), sel).toHaveCount(0);
  const fab = page.locator(FAB);
  await expect(fab).toBeVisible();
  await expect(fab).toHaveClass(/mb-nav-create/);
  await expect(fab).toHaveAttribute('aria-label', 'Add a card');
  await expect(fab).toHaveAttribute('data-tour', 'mb-create');
  const fb = await box(page, FAB);
  expect(fb.w).toBe(56);
  expect(fb.h).toBe(56);
  expect(Math.abs(fb.x - (iw / 2 - 28))).toBeLessThanOrEqual(0.5);
  expect(Math.abs(fb.b - (ih - PUCK_LIFT))).toBeLessThanOrEqual(0.5);
  // Where the tab bar's puck was, to the pixel.
  if (info.project.name === 'mobile-safari') expect([Math.round(fb.x), Math.round(fb.y)]).toEqual([167, 599]);
  if (info.project.name === 'tablet') expect([Math.round(fb.x), Math.round(fb.y)]).toEqual([389, 1129]);

  // Unread messages: the dot on the menu button, and its name.
  await expect(page.locator(`${MENU} .tb-menu-dot`)).toBeVisible();
  await expect(page.locator(MENU)).toHaveAttribute('aria-label', 'Open menu, unread messages');
  expect((await page.locator('.tb-menu-dot').boundingBox()).width).toBe(8);

  // The first card on an empty board comes from the empty panel's Note tile;
  // the + is away while it is typed in.
  await firstNote(page, 'Location scout');
  await expect(fab).not.toBeVisible();
  await done(page);

  // The + opens the sheet; Arrow is right after Draw, Comment and Vote are there.
  await openSheet(page);
  const labels = await page.locator('.mobile-add-lbl').allTextContents();
  for (const l of ['Arrow', 'Comment', 'Vote', 'Draw']) expect(labels, l).toContain(l);
  expect(labels.indexOf('Arrow')).toBe(labels.indexOf('Draw') + 1);

  // Arrow arms the tool, with a hint and a way back.
  await tile(page, 'Arrow').tap();
  await expect.poll(() => wrapHas(page, 'tool-arrow')).toBe(true);
  const hint = page.locator('.cnv-hint').filter({ hasText: /arrow/i });
  await expect(hint).toBeVisible();
  expect(apart(await box(page, '.cnv-hint'), await box(page, FAB))).toBe(true);
  await hint.locator('button').tap();
  await expect.poll(() => wrapHas(page, 'tool-select')).toBe(true);

  // Comment and Vote keep their tiles; closing the sheet adds nothing.
  await openSheet(page);
  await tile(page, 'Vote').scrollIntoViewIfNeeded();
  await expect(tile(page, 'Comment')).toBeVisible();
  await expect(tile(page, 'Vote')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.mobile-add-tile')).toHaveCount(0);
  await expect(page.locator('.cards-layer .card')).toHaveCount(1);

  // Note from the sheet: it opens for typing at a readable size, and the + goes.
  await openSheet(page);
  await tile(page, 'Text note').tap();
  await expect(page.locator('.cards-layer .card.card-kind-note')).toHaveCount(2);
  await caretInCard(page);
  await page.keyboard.type('Old mill by the river');
  await expect.poll(() => flag(page)).toBe('1');
  await expect(fab).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const el = document.activeElement?.closest?.('.card');
    const b = el?.getBoundingClientRect();
    return b ? parseFloat(getComputedStyle(document.activeElement).fontSize) * (b.width / el.offsetWidth) : 0;
  }), 'the new note has the focus, at a readable size').toBeGreaterThanOrEqual(15);
  await done(page);
  await expect(page.locator('.cards-layer .card.card-kind-note').last()).toContainText('Old mill by the river');
  for (const sel of ['.mb-nav', '.cnv-tools', '.cnv-depth-dock']) await expect(page.locator(sel), sel).toHaveCount(0);

  // A card selected: its bar clears the +.
  const wb = await page.locator('.canvas-wrap').boundingBox();
  const bare = () => page.touchscreen.tap(wb.x + wb.width - 24, wb.y + wb.height * 0.5);
  await bare();
  const nb = await page.locator('.cards-layer .card.card-kind-note').last().boundingBox();
  await page.touchscreen.tap(nb.x + nb.width / 2, nb.y + Math.min(nb.height / 2, 40));
  await expect(page.locator('.cards-layer .card.is-selected')).toHaveCount(1);
  for (const s of ['.tob', '.sel-menu']) expect(apart(await box(page, s), await box(page, FAB)), `${s} clears the +`).toBe(true);
  await bare();

  // Draw: its options bar clears the +, and its hint has the way back.
  await expect(fab).toBeVisible();
  await openSheet(page);
  await tile(page, 'Draw').tap();
  await expect.poll(() => wrapHas(page, 'tool-draw')).toBe(true);
  await expect.poll(() => box(page, '.tob'), 'draw options bar').not.toBeNull();
  // Once the bar has settled in its place.
  await expect.poll(async () => apart(await box(page, '.tob'), await box(page, FAB)), 'draw options clear the +').toBe(true);
  await page.locator('.cnv-hint button').tap();
  await expect.poll(() => wrapHas(page, 'tool-select')).toBe(true);

  // The drawer doesn't bring the tab bar back, and the + steps aside.
  await page.locator(MENU).tap();
  await expect(page.locator(DRAWER)).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-phone-drawer', '1');
  await expect(page.locator('.mb-nav')).toHaveCount(0);
  await expect(fab).toHaveCount(0);

  // Home: the tab bar with its four tabs and the Messages badge; no +, no dot.
  await page.locator(DRAWER).getByText('Home', { exact: true }).first().tap();
  await expect(page.locator('.mb-nav')).toBeVisible();
  await expect(page.locator('.mb-nav [role="tab"]')).toHaveCount(4);
  expect(await page.locator('.mb-nav-lbl').allTextContents()).toEqual(['Home', 'Search', 'Messages', 'Settings']);
  await expect(page.locator('.mb-nav .mb-nav-badge')).toBeVisible();
  await expect(page.locator(FAB)).toHaveCount(0);
  await expect(page.locator('.mb-nav-create')).toHaveCount(0);
  await expect(page.locator('.tb-menu-dot')).toHaveCount(0);
});

test('top bar: Comments in the bar, the plan chip in the drawer, Redo only with something to redo', async ({ page }) => {
  test.setTimeout(180_000);
  await boot(page, { rpc: { get_my_tier: tier(22) }, rest: { comments: (url, method) => (method === 'GET' ? [comment] : []) } });
  const chip = page.locator(CHIP);
  await expect(chip).toHaveCount(1);

  // Comments: in the top bar, between Undo and the bell, a button the bell's size.
  const eye = page.locator(`.topbar .tb-right ${EYE}`);
  await expect(eye).toBeVisible();
  await expect(page.locator(EYE)).toHaveCount(1);
  await expect(page.locator(`.topbar .tb-comments-slot ${EYE}.is-in-bar`)).toHaveCount(1);
  await expect(eye).toHaveClass(/tb-icon/);
  const order = await page.evaluate(() => {
    const q = (s) => document.querySelector(`.topbar .tb-right ${s}`);
    const e = q('.cnv-comments-eye'); const b = q('.nb-bell'); const u = q('.tb-undo'); const s = q('.tb-share');
    const r = (el) => { const x = el.getBoundingClientRect(); return { x: x.left, y: x.top, w: x.width, h: x.height }; };
    const cs = (el) => ({ shadow: getComputedStyle(el).boxShadow, svg: el.querySelector('svg').getBoundingClientRect().width });
    return {
      beforeBell: !!(e.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
      afterUndo: !!(u.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING),
      eye: r(e), bell: r(b), undo: r(u), eyeCs: cs(e), bellCs: cs(b),
      count: e.querySelectorAll('.cnv-comments-eye-count').length,
      fits: s.getBoundingClientRect().right <= innerWidth,
    };
  });
  expect(order.beforeBell).toBe(true);
  expect(order.afterUndo).toBe(true);
  expect(order.eye.x).toBeGreaterThan(order.undo.x);
  expect(order.eye.x).toBeLessThan(order.bell.x);
  expect(order.eye.h).toBe(order.undo.h);
  expect(order.eye.w).toBe(order.undo.w);
  expect(order.eye.y).toBe(order.bell.y);
  expect(order.eyeCs.svg).toBe(order.bellCs.svg);
  expect(order.eyeCs.shadow).toBe('none');
  expect(order.count, 'no count badge in the bar').toBe(0);
  expect(order.fits).toBe(true);

  // Redo: only once there is something to redo.
  await expect(page.locator('.topbar .tb-undo')).toBeVisible();
  await expect(page.locator('.topbar .tb-redo')).toHaveCount(0);

  // The chip: off the board.
  await expect(chip).toHaveCSS('visibility', 'hidden');
  expect((await rectOf(page, CHIP)).hit).toBe(false);

  // The list opens from the button, inside the screen, and closes on a second tap.
  await eye.tap();
  await expect(page.locator('.cmt-list')).toBeVisible();
  await expect(page.locator(`${EYE}.is-on`)).toHaveCount(1);
  await expect.poll(async () => {
    const l = await rectOf(page, '.cmt-list');
    return !!l && l.x >= 0 && l.r <= (await page.evaluate(() => innerWidth)) + 0.5;
  }).toBe(true);
  const eb = await eye.boundingBox();
  await page.touchscreen.tap(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await expect(page.locator('.cmt-list')).toHaveCount(0);
  await expect(page.locator(`${EYE}.is-on`)).toHaveCount(0);

  // Writing mode hides it; Undo then brings Redo, and Redo goes once it is used up.
  await firstNote(page, 'Location scout');
  await expect(page.locator(EYE)).not.toBeVisible();
  await expect(page.locator('.topbar .tb-undo')).toBeVisible();
  await done(page);
  await expect(eye).toBeVisible();
  await expect(page.locator('.topbar .tb-redo')).toHaveCount(0);
  await page.locator('.topbar .tb-undo').tap();
  const redo = page.locator('.topbar .tb-redo');
  await expect(redo).toBeVisible();
  await expect(redo).toBeEnabled();
  expect(await page.evaluate(() => document.querySelector('.topbar .tb-share').getBoundingClientRect().right <= innerWidth)).toBe(true);
  await expect(async () => {
    if (await redo.count()) await redo.tap({ timeout: 1000 });
    await expect(redo).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator('.cards-layer .card.card-kind-note')).toHaveCount(1);

  // The drawer: the chip is its last row, on nothing else that takes a tap.
  await page.locator(MENU).tap();
  await expect(page.locator(DRAWER)).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-phone-drawer', '1');
  await expect(chip).toHaveCSS('visibility', 'visible');
  await expect.poll(async () => (await rectOf(page, CHIP)).hit).toBe(true);
  // Inside the drawer, once it has slid in.
  await expect.poll(async () => {
    const c = await rectOf(page, CHIP);
    const d = await rectOf(page, DRAWER);
    return c.x >= d.x && c.r <= d.r && c.b <= d.b;
  }).toBe(true);
  const over = await page.evaluate(() => {
    const chipEl = document.querySelector('.upgrade-chip');
    const cr = chipEl.getBoundingClientRect();
    return [...document.querySelectorAll('aside.sidebar button, aside.sidebar a, aside.sidebar input, aside.sidebar [role="button"], aside.sidebar .sb-row')].filter((el) => {
      const b = el.getBoundingClientRect();
      if (!(b.width > 0 && b.height > 0) || b.right <= cr.left || cr.right <= b.left || b.bottom <= cr.top || cr.bottom <= b.top) return false;
      // Where the two overlap, is the control really there (not clipped by its scroller)?
      const x = (Math.max(b.left, cr.left) + Math.min(b.right, cr.right)) / 2;
      const y = (Math.max(b.top, cr.top) + Math.min(b.bottom, cr.bottom)) / 2;
      chipEl.style.display = 'none';
      const at = document.elementFromPoint(x, y);
      chipEl.style.display = '';
      return !!at && (at === el || el.contains(at));
    }).map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);
  });
  expect(over).toEqual([]);

  // Home: the chip as before (under the bar, at the right).
  await page.locator(DRAWER).getByText('Home', { exact: true }).first().tap();
  await expect(page.locator('.mb-nav')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-phone-cluster');
  await expect(chip).toHaveCSS('visibility', 'visible');
  await expect.poll(async () => {
    const h = await rectOf(page, CHIP);
    return h.hit && h.r > (await page.evaluate(() => innerWidth)) - 12 && h.y < 80;
  }).toBe(true);

  // Back in the cluster, the chip in the drawer opens pricing.
  await page.goBack();
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-phone-cluster', '1');
  await expect(chip).toHaveCSS('visibility', 'hidden');
  await page.locator(MENU).tap();
  await expect(page.locator(DRAWER)).toBeVisible();
  await expect.poll(async () => (await rectOf(page, CHIP)).hit).toBe(true);
  await chip.tap();
  await expect(page.locator('.upgrade-modal')).toBeVisible();
});

test('view-only: the + places a comment', async ({ page }) => {
  test.setTimeout(120_000);
  const created = '2026-10-01T00:00:00Z';
  const ws = { id: WS_ID, name: 'Studio work', created_by: OTHER, org_id: null, created_at: created };
  await boot(page, {
    rpc: { get_my_tier: tier(6), get_or_create_personal_workspace: ws },
    rest: { workspace_members: [{ workspace_id: WS_ID, role: 'viewer', created_at: created, user_id: USER_ID, workspaces: ws }] },
  });
  // The stub booted someone who can only view.
  await expect(page.locator('.tb-viewonly, .readonly-banner').first()).toBeAttached();
  const fab = page.locator(FAB);
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('aria-label', 'Add comment');
  await fab.tap();
  await expect.poll(() => wrapHas(page, 'is-annot-place')).toBe(true);
  const hint = page.locator('.cnv-hint').filter({ hasText: /comment/i });
  await expect(hint).toBeVisible();
  await expect(page.locator('.mobile-add-tile')).toHaveCount(0);
  // The hint's button cancels.
  await hint.locator('button').tap();
  await expect.poll(() => wrapHas(page, 'is-annot-place')).toBe(false);
  // And again: a tap on the board opens the comment box.
  await fab.tap();
  await expect.poll(() => wrapHas(page, 'is-annot-place')).toBe(true);
  const wb = await page.locator('.canvas-wrap').boundingBox();
  await page.touchscreen.tap(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await expect(page.locator('.cmt-canvas-card, .cmt-sheet-host').first()).toBeVisible();
});

test('writing mode: the chrome steps back, the format row docks on the keyboard, Done ends it', async ({ page }, info) => {
  test.setTimeout(120_000);
  await boot(page, { rpc: { get_my_tier: tier(6) } });
  await firstNote(page, 'Location scout', 'Old mill by the river');
  await keyboard(page, KB);
  expect(await flag(page)).toBe('1');

  // Everything but Undo, Redo and Done steps back. Inside a cluster there is
  // no rail and no tab bar to hide.
  for (const sel of ['.cnv-tools', '.mb-nav', '.cnv-depth-dock']) await expect(page.locator(sel), sel).toHaveCount(0);
  for (const sel of [EYE, FAB, MENU, '.topbar .nb-bell', '.topbar .tb-share']) {
    const loc = page.locator(sel);
    expect(await loc.count(), `${sel} exists`).toBeGreaterThan(0);
    for (const el of await loc.all()) await expect(el, sel).not.toBeVisible();
  }
  await expect(page.locator('.topbar .tb-undo')).toBeVisible();
  const pillLoc = page.locator('.topbar .tb-done');
  await expect(pillLoc).toBeVisible();
  await expect(pillLoc).toHaveText('Done');

  // The format row: the window's width, flush on the keyboard.
  const bar = page.locator(info.project.name.startsWith('mobile') ? `${BAR}.is-phone.is-docked` : `${BAR}.is-docked`);
  await expect(bar).toHaveCount(1);
  const { iw, ih } = await page.evaluate(() => ({ iw: window.innerWidth, ih: window.innerHeight }));
  const foot = async () => { const r = await bar.boundingBox(); return r ? Math.abs(r.y + r.height - (ih - KB)) : 99; };
  await expect.poll(foot).toBeLessThanOrEqual(1);
  const r = await bar.boundingBox();
  expect(Math.abs(r.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.width - iw)).toBeLessThanOrEqual(1);
  // The Done pill: 32px to look at, at least 44px to hit.
  const pill = await pillLoc.evaluate((el) => ({ h: el.getBoundingClientRect().height, hit: parseFloat(getComputedStyle(el, '::before').height) }));
  expect(pill.h).toBe(32);
  expect(pill.hit).toBeGreaterThanOrEqual(44);

  // The keyboard down while still typing (a hardware keyboard): the row sits
  // on the bottom edge.
  await keyboard(page, 0);
  await expect.poll(async () => { const b = await bar.boundingBox(); return b ? Math.abs(b.y + b.height - ih) : 99; }).toBeLessThanOrEqual(1);
  expect(await flag(page)).toBe('1');
  await keyboard(page, KB);
  await expect.poll(foot).toBeLessThanOrEqual(1);

  // Done ends it: the words are kept and the board's chrome is back.
  await pillLoc.tap();
  await keyboard(page, 0);
  await expect.poll(() => flag(page)).toBeNull();
  expect(await page.evaluate(() => !!document.activeElement?.closest?.('.cards-layer'))).toBe(false);
  await expect(page.locator('.card .note-body[contenteditable="true"]')).toHaveCount(0);
  const note = page.locator('.cards-layer .card.card-kind-note').last();
  await expect(note).toContainText('Location scout');
  await expect(note).toContainText('Old mill by the river');
  await expect(page.locator('.cnv-tools')).toHaveCount(0);
  await expect(page.locator(FAB)).toBeVisible();
  await expect(page.locator(`.topbar ${EYE}`)).toBeVisible();
  await expect(page.locator(MENU)).toBeVisible();
  await expect(page.locator('.topbar .tb-share')).toBeVisible();
  await expect(pillLoc).not.toBeVisible();
});

test('a small note glides in when opened for typing', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { rpc: { get_my_tier: tier(6) } });
  await firstNote(page, 'Location scout');
  await done(page);
  const wb = await page.locator('.canvas-wrap').boundingBox();
  const bare = () => page.touchscreen.tap(wb.x + wb.width - 16, wb.y + wb.height - 120);
  const openNote = async () => {
    const n = await noteOnScreen(page);
    const at = { x: n.x + n.w / 2, y: n.y + Math.min(n.h / 2, 30 * n.zoom) };
    // The first tap selects; a second opens it if the first didn't.
    await expect(async () => {
      if (await flag(page) !== '1') await page.touchscreen.tap(at.x, at.y);
      await expect.poll(() => flag(page), { timeout: 600 }).toBe('1');
    }).toPass({ timeout: 10_000 });
    return noteAtRest(page);
  };
  await bare();

  // At a readable size, opening the note doesn't move the view.
  const rest = await noteAtRest(page);
  expect(rest.px).toBeGreaterThanOrEqual(15);
  const same = await openNote();
  expect(Math.abs(same.zoom - rest.zoom)).toBeLessThan(0.001);
  expect(Math.abs(same.x - rest.x)).toBeLessThan(1);
  expect(Math.abs(same.y - rest.y)).toBeLessThan(1);
  await done(page);
  await bare();

  // Zoomed out, it glides in until its text is readable, and stays on screen.
  await zoomOut(page, 14);
  const small = await noteAtRest(page);
  expect(small.px).toBeLessThan(15);
  const big = await openNote();
  expect(big.px).toBeGreaterThanOrEqual(15);
  expect(big.x).toBeGreaterThanOrEqual(0);
  expect(big.x + big.w).toBeLessThanOrEqual(wb.width + 1);
  // Settled: no second glide. (Nothing to wait for but time.)
  await page.waitForTimeout(600);
  const still = await noteOnScreen(page);
  expect(Math.abs(still.zoom - big.zoom)).toBeLessThan(0.001);
  expect(Math.abs(still.y - big.y)).toBeLessThan(1);
  // No zoom back out on Done.
  await done(page);
  expect(Math.abs((await noteAtRest(page)).zoom - big.zoom)).toBeLessThan(0.001);
});

test('writing mode: Undo and Redo act on the note being typed, not the board', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { rpc: { get_my_tier: tier(6) } });
  await firstNote(page, 'Location scout');
  await done(page);

  await openSheet(page);
  await tile(page, 'Text note').tap();
  const notes = page.locator('.cards-layer .card.card-kind-note');
  await expect(notes).toHaveCount(2);
  await caretInCard(page);
  await page.keyboard.type('hello');
  await expect.poll(() => flag(page)).toBe('1');
  const typing = page.locator('.cards-layer .card.card-kind-note:has(.note-body[contenteditable="true"])');
  await expect(typing).toHaveCount(1);
  await expect(typing).toContainText('hello');

  // Undo takes back the typing. The board's last step was adding this note:
  // the board's undo would have removed it.
  const undo = page.locator('.topbar .tb-undo');
  await expect(undo).toBeEnabled();
  await undo.tap();
  await expect(typing).not.toContainText('hello');
  await expect(notes).toHaveCount(2);
  await expect(notes.filter({ hasText: 'Location scout' })).toHaveCount(1);
  expect(await flag(page)).toBe('1');
  await caretInCard(page);

  // Redo shows now, and brings the typing back.
  const redo = page.locator('.topbar .tb-redo');
  await expect(redo).toBeVisible();
  await expect(redo).toBeEnabled();
  await redo.tap();
  await expect(typing).toContainText('hello');
  await expect(notes).toHaveCount(2);
  expect(await flag(page)).toBe('1');
  await caretInCard(page);
  await done(page);
  await expect(notes.filter({ hasText: 'hello' })).toHaveCount(1);
});

test('writing mode: a colour picked in the note bar lights Undo, and Undo takes it back', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { rpc: { get_my_tier: tier(6) } });
  await firstNote(page, 'Location scout');
  await done(page);

  await openSheet(page);
  await tile(page, 'Text note').tap();
  const notes = page.locator('.cards-layer .card.card-kind-note');
  await expect(notes).toHaveCount(2);
  await caretInCard(page);
  await expect.poll(() => flag(page)).toBe('1');
  const note = page.locator('.cards-layer .card.card-kind-note:has(.note-body[contenteditable="true"]) .note');
  await expect(note).toHaveCount(1);

  // Nothing done in this note yet.
  const undo = page.locator('.topbar .tb-undo');
  await expect(undo).toBeVisible();
  await expect(undo).toBeDisabled();
  const bg0 = await note.evaluate((el) => getComputedStyle(el).backgroundColor);

  // The note's background: a button of the bar where there's room, else in ⋯
  // (a phone's colours are ⋯'s own; elsewhere a row that opens them).
  const bar = page.locator('.tob');
  const bgBtn = bar.getByRole('button', { name: 'Card background' });
  if (await bgBtn.count()) {
    await bgBtn.tap();
  } else {
    await bar.getByRole('button', { name: 'More formatting' }).tap();
    await page.locator('.nb-more').waitFor();
    const row = page.locator('.nb-more').getByRole('menuitem', { name: 'Card background' });
    if (await row.count()) await row.tap();
  }
  await page.getByRole('menuitemradio', { name: 'Color #dbeafe' }).tap();
  await expect(note).toHaveCSS('background-color', 'rgb(219, 234, 254)');
  expect(await flag(page)).toBe('1');
  await caretInCard(page);

  // The pick lit Undo, and Undo takes the colour back: not the note.
  await expect(undo).toBeEnabled();
  await undo.tap();
  await expect(note).toHaveCSS('background-color', bg0);
  await expect(notes).toHaveCount(2);
  expect(await flag(page)).toBe('1');
});

test('writing mode in a field that is not a note: Done, and no Undo or Redo', async ({ page }) => {
  test.setTimeout(120_000);
  await boot(page, { rpc: { get_my_tier: tier(6) } });
  await firstNote(page, 'Location scout');
  await done(page);
  await expect(page.locator('.topbar .tb-undo')).toBeVisible();

  // A grid, and its first box opened for typing (a double-tap on an empty box).
  await openSheet(page);
  await tile(page, 'Grid').scrollIntoViewIfNeeded();
  await tile(page, 'Grid').tap();
  const cell = page.locator('.cards-layer .gridc-cell.is-empty').first();
  await expect(cell).toBeVisible();
  await cell.dblclick();
  await expect.poll(() => page.evaluate(() => {
    const a = document.activeElement;
    return !!a && a.isContentEditable && !!a.closest('.gridc-cell');
  })).toBe(true);
  await page.keyboard.type('Wide on the mill');

  await expect.poll(() => flag(page)).toBe('1');
  await expect(page.locator('.topbar .tb-done')).toBeVisible();
  await expect(page.locator('.topbar .tb-undo')).toHaveCount(0);
  await expect(page.locator('.topbar .tb-redo')).toHaveCount(0);

  // Done ends it, and the board's Undo is back.
  await done(page);
  await expect(page.locator('.topbar .tb-undo')).toBeVisible();
  await expect(page.locator('.cards-layer .gridc-cell')).toContainText(['Wide on the mill']);
});

test('comment-only: no + in the Files list, where there is no canvas to put a comment on', async ({ page }) => {
  test.setTimeout(120_000);
  const created = '2026-10-01T00:00:00Z';
  const ws = { id: WS_ID, name: 'Studio work', created_by: OTHER, org_id: null, created_at: created };
  // The cluster opens in Files for everyone (boards.view), and this person can
  // only view it, so only comment.
  const root = {
    id: ROOT_ID, workspace_id: WS_ID, parent_board_id: null, deleted_at: null, name: 'Studio',
    kind: 'canvas', view: 'list', created_by: OTHER, created_at: created,
  };
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch {} });
  await bootSignedIn(page, {
    rpc: { get_my_tier: tier(6), get_or_create_personal_workspace: ws },
    rest: {
      workspace_members: [{ workspace_id: WS_ID, role: 'viewer', created_at: created, user_id: USER_ID, workspaces: ws }],
      boards: (url, method) => (method === 'GET' ? [root] : []),
    },
  });
  await expect(page.locator('body')).toHaveAttribute('data-phone-cluster', '1', { timeout: 30_000 });
  await expect(page.locator('.tb-viewonly, .readonly-banner').first()).toBeAttached();
  // The Files list, with no canvas.
  await expect(page.locator('.list-wrap')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.canvas-wrap')).toHaveCount(0);
  await expect(page.locator(FAB)).toHaveCount(0);
});
