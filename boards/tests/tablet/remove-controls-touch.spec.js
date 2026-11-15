// Controls a mouse shows on hover, under a finger, which never hovers: a
// Schedule's Remove on a chip and on an item, a slot's Open and Add content,
// and a Vote's Delete (its author's). They show at rest under (hover: none),
// a finger's size or with an area that is, and a tap on each works. Removing
// and deleting still leave the Undo toast.
import { expect, test } from '@playwright/test';
import { bootSignedIn, USER_ID, WS_ID, ROOT_ID } from '../helpers/signedInStub.js';

// Shown without a hover, and the control's own at its middle.
async function shown(loc) {
  await expect(loc).toBeVisible();
  const s = await loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    // Opacity along the way up, since a parent can hide what it holds.
    let o = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { display: cs.display, opacity: o, events: cs.pointerEvents, w: r.width, h: r.height, hit: !!at && (at === el || el.contains(at)) };
  });
  expect(s.display).not.toBe('none');
  expect(s.opacity).toBe(1);
  expect(s.events).not.toBe('none');
  expect(s.hit).toBe(true);
  return s;
}
const paste = (page, text) => page.evaluate((t) => {
  const dt = new DataTransfer();
  dt.setData('text/plain', t);
  window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, text);

test('a Schedule\'s slot tools and Remove show without a hover, and Remove leaves an Undo', async ({ page }) => {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.locator('.cnv-tools').getByRole('button', { name: 'Add menu', exact: true }).tap();
  await page.locator('.cnv-add-menu').getByText('Schedule', { exact: true }).tap();
  await expect(page.locator('.schedc')).toBeVisible();
  await page.waitForTimeout(1200);
  await page.locator('.schedc').getByRole('button', { name: 'Month grid' }).tap();
  await page.waitForTimeout(500);
  // A day opened: its hours, where the tools and the Remove buttons are.
  await page.locator('.schedc .schedc-slot-day.is-today').dblclick();
  const panel = page.locator('.schedc-peekpanel');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(600);

  // An empty hour's tools, at rest.
  const row = panel.locator('.schedc-slot-hour:not(.is-band)').nth(2);
  const tool = row.locator('.schedc-slottools .schedc-mini');
  const t = await shown(tool);
  expect(t.w).toBeGreaterThanOrEqual(32);
  expect(t.h).toBeGreaterThanOrEqual(32);
  // It opens the slot's menu, which Escape puts away.
  await tool.tap();
  await expect(page.locator('.gridc-cell-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gridc-cell-menu')).toHaveCount(0);
  await expect(panel).toBeVisible();

  // One thing in the hour: an item, with its Remove.
  const rb = await row.boundingBox();
  await page.touchscreen.tap(Math.round(rb.x + 200), Math.round(rb.y + rb.height / 2));
  await page.waitForTimeout(300);
  await paste(page, 'keep me');
  const itemX = row.locator('.schedc-item-x');
  const ix = await shown(itemX);
  expect(ix.w).toBeGreaterThanOrEqual(32);
  expect(ix.h).toBeGreaterThanOrEqual(32);

  // Two: chips, each with its Remove, a finger wide.
  await paste(page, 'remove me');
  const chipX = row.locator('.schedc-chip-x');
  await expect(chipX).toHaveCount(2);
  const cx = await shown(chipX.last());
  expect(cx.w).toBeGreaterThanOrEqual(32);
  await shown(chipX.first());
  // The tools still take a tap beside the chips.
  await shown(tool);

  await row.locator('.schedc-chip', { hasText: 'remove me' }).locator('.schedc-chip-x').tap();
  await expect(row).not.toContainText('remove me');
  await expect(row).toContainText('keep me');
  const toast = page.locator('.toast', { hasText: 'Item removed' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).tap();
  // The tap on the toast is a tap outside the opened day, which closes it:
  // the item is back on the card.
  await expect(page.locator('.schedc')).toContainText('remove me');
});

test('a Vote\'s Delete shows to the person who made it without a hover, and leaves an Undo', async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch (_) {} });
  const vote = {
    id: '55555555-5555-4555-8555-555555555555', workspace_id: WS_ID, board_id: ROOT_ID, author: USER_ID,
    label: 'Golden hour or noon?', anchor_kind: 'point', anchor_id: null, anchor_x: 0, anchor_y: 0,
    offset_x: 0, offset_y: 0, hidden: false, resolved: false, deleted_at: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    up_count: 1, down_count: 0, my_value: 1,
  };
  let live = true;
  const { calls } = await bootSignedIn(page, {
    rpc: {
      get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }],
      list_vote_cards: () => (live ? [vote] : []),
      soft_delete_vote_card: () => { live = false; return null; },
      restore_vote_card: () => { live = true; return null; },
    },
  });
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 60000 });
  const card = page.locator('.canvas-vote');
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/is-mine/);
  await page.waitForTimeout(800);

  const del = card.locator('.canvas-vote-del');
  await shown(del);
  // The × is drawn small; the area around it is a finger's.
  const area = await del.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const b = getComputedStyle(el, '::before');
    const px = (v) => parseFloat(v) || 0;
    return { w: r.width - px(b.left) - px(b.right), h: r.height - px(b.top) - px(b.bottom) };
  });
  expect(area.w).toBeGreaterThanOrEqual(32);
  expect(area.h).toBeGreaterThanOrEqual(32);

  await del.tap();
  await expect(card).toHaveCount(0);
  const toast = page.locator('.toast', { hasText: 'Vote deleted' });
  await expect(toast).toBeVisible();
  expect(calls.some((c) => c.path === 'rpc/soft_delete_vote_card')).toBe(true);
  await toast.getByRole('button', { name: 'Undo' }).tap();
  await expect.poll(() => calls.some((c) => c.path === 'rpc/restore_vote_card')).toBe(true);
});
