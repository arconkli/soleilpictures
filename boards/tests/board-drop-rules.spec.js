// The board's half of the drop rules (lib/dropRules.js, round 11): files
// dragged out of Files onto a board. Another cluster's move there, where they
// were let go, through the route (App.jsx moveFilesHere); the copy key copies;
// the board's own go where they're let go; and a board that can't take them
// says so before the drop, with no outline and a "none" cursor. Driven on the
// local board with ?filesrules=1, which hands the board a recorder in place of
// the route (window.__filesRulesQa.calls).
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

async function open(page) {
  await page.goto('/?local=1&reset=1&filesrules=1');
  await page.waitForSelector('.canvas-wrap[data-drop-board="root"][data-drop-where="board"]');
}

const calls = (page) => page.evaluate(() => window.__filesRulesQa?.calls || []);
const wrap = (page) => page.locator('.canvas-wrap');

// A drag out of Files, as the sidebar starts one: the payload on the drag, and
// the drag session (lib/springLoad.js) a dragover reads, since it can't read
// the payload. Held over the board until letGo. Chrome ignores dropEffect on a
// DataTransfer made by script, so the events carry a stand-in that keeps what
// the board sets: the cursor a real drag would show.
async function holdOverBoard(page, { files, workspaceId = 'local-workspace', sourceName = '', alt = false, at = [640, 420] }) {
  return page.evaluate(async ({ files, workspaceId, sourceName, alt, at }) => {
    const { beginDragSession } = await import('/src/lib/springLoad.js');
    const data = {
      'application/x-soleil-files': JSON.stringify({
        v: 1, sourceBoardId: files[0].boardId, sourceName, intent: 'move',
        cards: files.map((f) => ({ id: f.id, kind: f.kind, title: f.name || '', sourceBoardId: f.boardId, w: 240, h: 180 })),
      }),
    };
    const dt = {
      types: Object.keys(data), items: [], files: [],
      getData: (t) => data[t] || '', setData: () => {}, setDragImage: () => {},
      dropEffect: 'none', effectAllowed: 'copyMove',
    };
    const fire = (type) => {
      const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: at[0], clientY: at[1], altKey: alt });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      document.querySelector('.canvas-wrap').dispatchEvent(ev);
    };
    beginDragSession(document.body, { kind: 'files', sourceBoardId: files[0].boardId, sourceName, workspaceId, thumbs: [], files });
    fire('dragover');
    window.__held = { fire, dt };
    return dt.dropEffect;
  }, { files, workspaceId, sourceName, alt, at });
}
async function letGo(page) {
  await page.evaluate(() => {
    window.__held.fire('drop');
    window.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
  });
}

const sundown = { id: 's-img1', kind: 'image', name: 'sundown-1.jpg', boardId: 'b-sundown', canMove: true };

test.describe('dropping files from Files onto a board', () => {
  test('another cluster\'s file moves onto the board where it is let go; the copy key copies it', async ({ page }) => {
    await open(page);
    expect(await holdOverBoard(page, { files: [sundown], sourceName: 'Sundown Highway' })).toBe('move');
    await expect(wrap(page)).toHaveClass(/is-drop-target/);
    await letGo(page);
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    const [mv] = await calls(page);
    expect(mv).toMatchObject({ from: 'b-sundown', cardIds: ['s-img1'], copy: false, what: 'sundown-1.jpg' });
    expect(Number.isFinite(mv.at.x) && Number.isFinite(mv.at.y)).toBe(true);

    // desktop-chrome reports Windows, where Alt copies as well as Ctrl.
    expect(await holdOverBoard(page, { files: [sundown], sourceName: 'Sundown Highway', alt: true })).toBe('copy');
    await letGo(page);
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    expect((await calls(page))[1]).toMatchObject({ from: 'b-sundown', cardIds: ['s-img1'], copy: true });
  });

  test('a file from another workspace gets no outline and a "none" cursor, and letting go does nothing', async ({ page }) => {
    await open(page);
    expect(await holdOverBoard(page, { files: [sundown], workspaceId: 'someone-elses' })).toBe('none');
    await expect(wrap(page)).not.toHaveClass(/is-drop-target/);
    await letGo(page);
    await page.waitForTimeout(150);
    expect(await calls(page)).toHaveLength(0);
  });

  test('a file from a cluster in another workspace is refused here too', async ({ page }) => {
    await open(page);
    expect(await holdOverBoard(page, { files: [{ ...sundown, workspaceId: 'someone-elses' }] })).toBe('none');
    await letGo(page);
    await page.waitForTimeout(150);
    expect(await calls(page)).toHaveLength(0);
  });

  test('its own file goes where it is let go, on the board, without the route', async ({ page }) => {
    await open(page);
    const card = page.locator('[data-card-id="home-image"]');
    await expect(card).toBeVisible();
    const before = await card.boundingBox();
    // Somewhere clear of where it is now.
    const at = [Math.round(before.x + before.width / 2 + 260), Math.round(before.y + before.height / 2 + 140)];
    expect(await holdOverBoard(page, { files: [{ id: 'home-image', kind: 'image', boardId: 'root' }], at })).toBe('move');
    await letGo(page);
    // Centred on the point it was let go of (to a pixel or two of rounding).
    await expect.poll(async () => {
      const b = await card.boundingBox();
      return Math.max(Math.abs(b.x + b.width / 2 - at[0]), Math.abs(b.y + b.height / 2 - at[1]));
    }).toBeLessThan(3);
    expect(await calls(page)).toHaveLength(0);
  });

  test('a selection from two clusters goes from each, one lot beside the other, not in a pile', async ({ page }) => {
    await open(page);
    const locs = { id: 'l-img1', kind: 'image', name: 'mojave.jpg', boardId: 'sb-locs', canMove: true };
    await holdOverBoard(page, { files: [sundown, locs] });
    await letGo(page);
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    const got = await calls(page);
    expect(got.map((c) => [c.from, c.cardIds.join()]).sort()).toEqual([['b-sundown', 's-img1'], ['sb-locs', 'l-img1']]);
    expect(got[0].at.y).toBe(got[1].at.y);
    expect(Math.abs(got[0].at.x - got[1].at.x)).toBeGreaterThan(200);
  });
});

// A submenu opens on hover (a click on an open one closes it again): hover,
// and wait for it.
async function openSub(page, label) {
  await page.locator('.ctx-menu .ctx-item', { hasText: label }).hover();
  await expect(page.locator('.ctx-submenu')).toBeVisible();
}

test.describe('the card menu and full Files, by the rules', () => {
  test('Move to cluster… and Copy to cluster… on a card go by the route', async ({ page }) => {
    await open(page);
    const card = page.locator('.card[data-card-id="home-image"]');
    await card.click({ button: 'right' });
    await openSub(page, 'Move to cluster…');
    await page.locator('.ctx-submenu').getByRole('button', { name: 'Sundown Highway', exact: true }).click();
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    expect((await calls(page))[0]).toMatchObject({ from: 'root', to: 'b-sundown', cardIds: ['home-image'], copy: false });

    await card.click({ button: 'right' });
    await openSub(page, 'Copy to cluster…');
    await page.locator('.ctx-submenu').getByRole('button', { name: 'Sundown Highway', exact: true }).click();
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    expect((await calls(page))[1]).toMatchObject({ from: 'root', to: 'b-sundown', cardIds: ['home-image'], copy: true });
  });

  test('a board you can only view still offers Copy to cluster…, and no Move', async ({ page }) => {
    await page.goto('/?local=1&reset=1&filesrules=1&viewonly=1');
    await page.waitForSelector('.canvas-wrap.is-readonly');
    await page.locator('.card[data-card-id="home-image"]').click({ button: 'right' });
    await expect(page.locator('.ctx-menu .ctx-item', { hasText: 'Move to cluster…' })).toHaveCount(0);
    await openSub(page, 'Copy to cluster…');
    await page.locator('.ctx-submenu').getByRole('button', { name: 'Sundown Highway', exact: true }).click();
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    expect((await calls(page))[0]).toMatchObject({ from: 'root', to: 'b-sundown', cardIds: ['home-image'], copy: true });
  });

  test('in full Files, a file dropped on a folder goes into that cluster\'s files; the copy key copies it', async ({ page }) => {
    await open(page);
    await openFullFiles(page);
    const folder = page.locator('.ft[data-folder-id="b-sundown"]');
    await expect(folder).toHaveAttribute('data-drop-board', 'b-sundown');
    await expect(page.locator('.list-wrap')).toHaveAttribute('data-drop-board', 'root');
    for (const alt of [false, true]) {
      await page.evaluate(({ alt }) => {
        const dt = new DataTransfer();
        const tile = document.querySelector('[data-item-id="home-image"]');
        tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        const f = document.querySelector('.ft[data-folder-id="b-sundown"]');
        const r = f.getBoundingClientRect();
        const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, altKey: alt };
        f.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
        window.__heldFolder = { dt, at };
      }, { alt });
      await expect(folder).toHaveClass(/is-drop-target/);
      await page.evaluate(() => {
        const { dt, at } = window.__heldFolder;
        document.querySelector('.ft[data-folder-id="b-sundown"]').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, ...at }));
        window.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      });
    }
    await expect.poll(async () => (await calls(page)).length).toBe(2);
    const got = await calls(page);
    expect(got[0]).toMatchObject({ from: 'root', to: 'b-sundown', cardIds: ['home-image'], copy: false });
    expect(got[1]).toMatchObject({ from: 'root', to: 'b-sundown', cardIds: ['home-image'], copy: true });
  });

  test('in full Files, every folder shows its name (the player\'s styles once hid them)', async ({ page }) => {
    await open(page);
    await openFullFiles(page);
    const name = page.locator('.ft[data-folder-id="b-sundown"] .ft-name');
    await expect(name).toBeVisible();
    const box = await name.boundingBox();
    const tile = await page.locator('.ft[data-folder-id="b-sundown"]').boundingBox();
    expect(box.width).toBeGreaterThan(40);
    expect(box.x).toBeGreaterThanOrEqual(tile.x);
    expect(box.y).toBeGreaterThanOrEqual(tile.y);
    expect(await name.evaluate((el) => getComputedStyle(el.parentElement).opacity)).toBe('1');
  });

  test('in full Files, a file\'s menu offers Copy to… beside Move to…', async ({ page }) => {
    await open(page);
    await openFullFiles(page);
    await page.evaluate(() => { (window.__filesRulesQa ||= { calls: [] }).pick = 'b-stills'; });
    await page.locator('[data-item-id="home-image"]').click({ button: 'right' });
    const menu = page.locator('.ctx-menu').last();
    await expect(menu.getByText('Move to…', { exact: true })).toBeVisible();
    await menu.getByText('Copy to…', { exact: true }).click();
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    expect((await calls(page))[0]).toMatchObject({ from: 'root', to: 'b-stills', cardIds: ['home-image'], copy: true });
  });
});

test.describe('a card dragged off the board onto a cluster in the sidebar', () => {
  // The mouse, held: down on the card, across the board, onto a stand-in row.
  async function dragCardTo(page, cardSel, rowSel, { release = true, steps = 12 } = {}) {
    const from = await page.locator(cardSel).boundingBox();
    const to = await page.locator(rowSel).boundingBox();
    const x0 = from.x + from.width / 2, y0 = from.y + from.height / 2;
    const x1 = to.x + 40, y1 = to.y + to.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
      await page.waitForTimeout(16);
    }
    // Held still a moment: the hit test runs at its own pace.
    await page.waitForTimeout(120);
    await page.mouse.move(x1 + 2, y1);
    if (release) await page.mouse.up();
  }

  test('over a cluster row the label says Move and the row lights; letting go moves it there by the route', async ({ page }) => {
    await open(page);
    const card = page.locator('.card[data-card-id="home-image"]');
    const before = await card.boundingBox();
    await dragCardTo(page, '.card[data-card-id="home-image"]', '.sbqa-rules-rows [data-drop-board="b-sundown"]', { release: false });
    await expect(page.locator('.sbf-draglabel')).toContainText('to Sundown Highway');
    await expect(page.locator('.sbf-draglabel')).toContainText('Into its files, not onto its board');
    await expect(page.locator('.sbqa-rules-rows [data-drop-board="b-sundown"]')).toHaveAttribute('data-card-drop', '');
    await page.mouse.up();
    await expect(page.locator('.sbf-draglabel')).toHaveCount(0);
    await expect(page.locator('[data-card-drop]')).toHaveCount(0);
    await expect.poll(async () => (await calls(page)).length).toBe(1);
    expect((await calls(page))[0]).toMatchObject({ from: 'root', to: 'b-sundown', cardIds: ['home-image'], copy: false });
    // It went back to its place on the board; the route takes it from there.
    const after = await card.boundingBox();
    expect(Math.round(after.x)).toBe(Math.round(before.x));
    expect(Math.round(after.y)).toBe(Math.round(before.y));
  });

  test('a cluster card and a file together are refused: they go separately', async ({ page }) => {
    await open(page);
    await page.locator('.card[data-card-id="home-image"]').click();
    await page.locator('.card[data-card-id="b-halcyon"]').click({ modifiers: ['Shift'] });
    await dragCardTo(page, '.card[data-card-id="home-image"]', '.sbqa-rules-rows [data-drop-board="b-sundown"]', { release: false });
    await expect(page.locator('.sbf-draglabel')).toContainText('Clusters and files go separately');
    await expect(page.locator('.sbqa-rules-rows [data-drop-board="b-sundown"]')).not.toHaveAttribute('data-card-drop', '');
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await calls(page)).toHaveLength(0);
  });

  test('a cluster you can only view says so and takes nothing; the card goes back', async ({ page }) => {
    await open(page);
    const card = page.locator('.card[data-card-id="home-image"]');
    const before = await card.boundingBox();
    await dragCardTo(page, '.card[data-card-id="home-image"]', '.sbqa-rules-rows [data-drop-board="b-stills"]', { release: false });
    await expect(page.locator('.sbf-draglabel')).toContainText('Stills is view only');
    await expect(page.locator('.sbqa-rules-rows [data-drop-board="b-stills"]')).not.toHaveAttribute('data-card-drop', '');
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await calls(page)).toHaveLength(0);
    const after = await card.boundingBox();
    expect(Math.round(after.x)).toBe(Math.round(before.x));
  });
});
