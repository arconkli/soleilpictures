// The board's half of the drop rules (lib/dropRules.js, round 11): files
// dragged out of Files onto a board. Another cluster's move there, where they
// were let go, through the route (App.jsx moveFilesHere); the copy key copies;
// the board's own go where they're let go; and a board that can't take them
// says so before the drop, with no outline and a "none" cursor. Driven on the
// local board with ?filesrules=1, which hands the board a recorder in place of
// the route (window.__filesRulesQa.calls).
import { expect, test } from '@playwright/test';

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
