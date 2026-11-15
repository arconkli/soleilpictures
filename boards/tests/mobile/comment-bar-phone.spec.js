// A comment on a phone is written in a bar on top of the keyboard.
//
// The draft used to open on the canvas beside its card, inside the canvas's
// zoom: at a phone's opening zoom it was a few px tall and could open past
// the screen's edge. On the phone shell (phones and upright iPads) it is now
// form.canvas-comment-bar, fixed across the foot of the screen and riding the
// top of the keyboard (CanvasComment.jsx). The posted comment still lands on
// the card it was made for. And nothing a finger reads names a key: no
// "Enter to post · Esc to cancel", no Cmd+Z in the delete question.

import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chrome', 'the phone shell');
});

const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
const menu = (page) => page.locator('.ctx-menu');
const bar = (page) => page.locator('form.canvas-comment-bar');

async function bootLocal(page) {
  await page.goto('/?local=1&reset=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  // What only the dev harness draws, over the corner a menu opens in.
  await page.addStyleTag({ content: '.twk-gear { display: none !important; }' });
  await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
}

// A card's menu, the way a finger gets it: tap the card, then its ⋯.
async function openCardMenu(page, locator) {
  const b = await locator.boundingBox();
  // Its foot: a note's middle is its text.
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height - 6);
  const more = page.locator('.sel-menu .card-menu-btn');
  await expect(more).toBeVisible();
  await more.tap();
  await expect(menu(page)).toBeVisible();
}

async function addComment(page, locator) {
  await openCardMenu(page, locator);
  await menu(page).getByRole('menuitem', { name: 'Add comment', exact: true }).tap();
  await expect(bar(page)).toBeVisible();
}

// A keyboard `h` px tall: the visual viewport gives up its foot, the way iOS
// and Android report one, and says so.
async function stubKeyboard(page, h) {
  await page.evaluate((kb) => {
    const vv = window.visualViewport;
    Object.defineProperty(vv, 'height', { configurable: true, get: () => window.innerHeight - kb });
    Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
    vv.dispatchEvent(new Event('resize'));
  }, h);
}

test('Add comment opens a bar across the screen with finger-sized buttons', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));

  const vw = page.viewportSize().width;
  const b = await bar(page).boundingBox();
  expect(Math.abs(b.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(b.width - vw)).toBeLessThanOrEqual(0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(page.viewportSize().height + 0.5);
  // Out of the canvas's zoom, and the old box is not drawn too.
  expect(await bar(page).evaluate((el) => el.parentElement === document.body)).toBe(true);
  await expect(page.locator('.canvas-comment-draft')).toHaveCount(0);

  const input = bar(page).locator('textarea');
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');

  const cancel = bar(page).getByRole('button', { name: 'Cancel', exact: true });
  const post = bar(page).getByRole('button', { name: 'Post', exact: true });
  expect((await cancel.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const pb = await post.boundingBox();
  expect(pb.height).toBeGreaterThanOrEqual(44);
  expect(pb.width).toBeGreaterThanOrEqual(64);
  expect((await bar(page).locator('.canvas-comment-bar-field').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(post).toBeDisabled();

  // Post is ink, never gold.
  const { bg, gold, ink } = await post.evaluate((el) => {
    const probe = (v) => {
      const d = document.createElement('div');
      d.style.background = `var(${v})`;
      document.body.appendChild(d);
      const c = getComputedStyle(d).backgroundColor;
      d.remove();
      return c;
    };
    return { bg: getComputedStyle(el).backgroundColor, gold: probe('--soleil'), ink: probe('--ink-0') };
  });
  expect(bg).not.toBe(gold);
  expect(bg).toBe(ink);

  // Nothing here names a key.
  await expect(bar(page).locator('.canvas-comment-draft-hint')).toHaveCount(0);
  expect(await bar(page).innerText()).not.toMatch(/Enter|Esc/);
  expect(await input.getAttribute('placeholder')).not.toMatch(/Enter|Esc/);

  await input.fill('Hold this a beat longer');
  await expect(post).toBeEnabled();

  // What happens in the bar stays in the bar: a double tap on a word is not
  // the canvas's quick add, a right-click on its padding not the canvas menu.
  await input.dblclick();
  await expect(page.locator('.cnv-quick-add')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
  await expect(input).toHaveValue('Hold this a beat longer');
  const bb = await bar(page).boundingBox();
  await page.mouse.click(bb.x + 3, bb.y + 3, { button: 'right' });
  await expect(page.locator('.ctx-menu')).toHaveCount(0);
  await expect(bar(page)).toBeVisible();
});

test('the bar rides the top of the keyboard', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  const vh = page.viewportSize().height;

  await stubKeyboard(page, 291);
  await expect.poll(async () => {
    const b = await bar(page).boundingBox();
    return Math.round(b.y + b.height);
  }).toBe(vh - 291);

  // A taller one (the emoji keys), then none.
  await stubKeyboard(page, 340);
  await expect.poll(async () => {
    const b = await bar(page).boundingBox();
    return Math.round(b.y + b.height);
  }).toBe(vh - 340);

  await stubKeyboard(page, 0);
  await expect.poll(async () => {
    const b = await bar(page).boundingBox();
    return Math.round(b.y + b.height);
  }).toBeGreaterThan(vh - 120);
  const b = await bar(page).boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(vh + 0.5);
});

test('Cancel and Escape close the bar without posting', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  await bar(page).locator('textarea').fill('Not this one');
  await bar(page).getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.canvas-comment')).toHaveCount(0);
  await expect(page.locator('.toast-msg').filter({ hasText: 'Comment' })).toHaveCount(0);

  await addComment(page, card(page, 'home-image'));
  await expect(bar(page).locator('textarea')).toHaveValue('');
  await bar(page).locator('textarea').fill('Nor this');
  await page.keyboard.press('Escape');
  await expect(bar(page)).toHaveCount(0);
  await expect(page.locator('.canvas-comment')).toHaveCount(0);
});

// ?local=1 has no Supabase, so a post there fails: the bar stays with its text
// (comment-draft-keeps-text.spec.js, for the bar).
test('a post that fails keeps the bar and its text', async ({ page }) => {
  await bootLocal(page);
  await addComment(page, card(page, 'home-image'));
  const input = bar(page).locator('textarea');
  await input.fill('The cut at 01:12 is late');
  await bar(page).getByRole('button', { name: 'Post', exact: true }).tap();
  await expect(page.locator('.toast-msg').filter({ hasText: 'your text is still there' })).toBeVisible();
  await expect(input).toHaveValue('The cut at 01:12 is late');
  await expect(bar(page).getByRole('button', { name: 'Post', exact: true })).toBeEnabled();
});

// The real app, every request stubbed, so the post goes through.
test('Post puts the comment on the card it was made for, and the bar closes', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  const posted = [];
  const ctx = {};
  ctx.boot = await bootSignedIn(page, {
    rpc: { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }] },
    rest: {
      comments: (url, method) => {
        if (method !== 'POST') return posted;
        const sent = ctx.boot.calls[ctx.boot.calls.length - 1].body;
        const row = {
          id: `55555555-5555-4555-8555-00000000000${posted.length + 1}`,
          created_at: new Date().toISOString(), updated_at: null, deleted_at: null,
          resolved: false, hidden: false,
          ...(Array.isArray(sent) ? sent[0] : sent),
        };
        posted.push(row);
        return row;
      },
    },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.mb-nav')).toBeVisible({ timeout: 30000 });

  const wrap = await page.locator('.canvas-wrap').boundingBox();
  await page.getByRole('button', { name: 'Add note tool', exact: true }).tap();
  await page.touchscreen.tap(wrap.x + wrap.width * 0.45, wrap.y + wrap.height * 0.3);
  await page.keyboard.type('Opening shot');
  const note = page.locator('.card').first();
  await expect(note).toBeVisible();
  // Out of the note, and nothing selected.
  // (The first tap on bare board may only end the typing.)
  await expect(async () => {
    await page.touchscreen.tap(wrap.x + wrap.width * 0.85, wrap.y + wrap.height * 0.9);
    await expect(page.locator('.note.is-editing, .sel-menu')).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  const cardId = await note.getAttribute('data-card-id');

  await addComment(page, note);
  // No keyboard in a test browser: the bar stands on the tab bar.
  const navTop = (await page.locator('.mb-nav').boundingBox()).y;
  await expect.poll(async () => {
    const b = await bar(page).boundingBox();
    return Math.abs(b.y + b.height - navTop);
  }).toBeLessThanOrEqual(1);

  await bar(page).locator('textarea').fill('Hold this a beat longer');
  await bar(page).getByRole('button', { name: 'Post', exact: true }).tap();
  await expect(bar(page)).toHaveCount(0);

  // What was sent names the card.
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({
    workspace_id: WS_ID, board_id: ROOT_ID, author: USER_ID,
    body: 'Hold this a beat longer', anchor_kind: 'card', anchor_id: cardId,
  });

  // And it is drawn on or beside that card.
  const bubble = page.locator('.canvas-comment:not(.canvas-comment-draft)').filter({ hasText: 'Hold this a beat longer' });
  await expect(bubble).toBeVisible();
  const c = await note.boundingBox();
  const m = await bubble.boundingBox();
  const gapX = Math.max(0, c.x - (m.x + m.width), m.x - (c.x + c.width));
  const gapY = Math.max(0, c.y - (m.y + m.height), m.y - (c.y + c.height));
  expect(gapX).toBeLessThanOrEqual(48);
  expect(gapY).toBeLessThanOrEqual(48);
});

test('deleting a cluster card asks with the top bar, not Cmd+Z', async ({ page }) => {
  await bootLocal(page);
  await openCardMenu(page, card(page, 'b-sundown'));
  await menu(page).getByRole('menuitem', { name: /^Delete/ }).tap();
  const msg = page.locator('.feedback-dialog .feedback-message');
  await expect(msg).toContainText('You can undo this from the top bar.');
  await expect(msg).not.toContainText('Cmd+Z');
});
