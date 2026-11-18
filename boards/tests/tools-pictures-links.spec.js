// The picture and link tools, as a person uses them: double-click a picture
// (the viewer opens once; a showing title edits instead), Enter on a selected
// picture, pasting a picture address / a page address / picture files / words
// that came with a picture, and a link card's preview line.
//
// ?local=1 harness (its seeded Studio has a picture card; the blank one is
// empty). Nothing leaves the machine: the picture and the link-preview
// requests are served by page.route.
//
//   cd boards && PW_PORT=5291 npx playwright test tests/tools-pictures-links.spec.js --project=desktop-chrome
import { expect, test } from '@playwright/test';
import { bootLocal, bootRealBoard, card, cardsOnCanvas, paste, pngFile, PNG } from './tools-helpers.js';

const PIC = 'https://img.example.test/photo.png';
const AT = { x: 520, y: 360 };

// The seeded picture's progressive image keeps animating, so a locator click
// never sees it stable: press at its centre with the mouse instead.
async function pictureCentre(page, id = 'home-image') {
  const img = card(page, id).locator('.ic-img');
  await expect(img).toBeVisible();
  const b = await img.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

test.describe('a picture card', () => {
  test('double-click on the picture opens the viewer once', async ({ page }) => {
    await bootLocal(page);
    const at = await pictureCentre(page);
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.locator('.lightbox-stage')).toHaveCount(1);
    await page.waitForTimeout(500);   // a second open would have landed by now
    await expect(page.locator('.lightbox-stage')).toHaveCount(1);
  });

  test('double-click on its showing title edits the title, and the viewer stays shut', async ({ page }) => {
    await bootLocal(page);
    const pic = card(page, 'home-image');
    // Give it a title the way a person does: Edit › Rename… in its menu.
    await pic.click({ button: 'right', position: { x: 40, y: 40 } });
    await page.locator('.ctx-menu:not(.ctx-submenu)').getByRole('menuitem', { name: 'Edit', exact: true }).hover();
    await page.locator('.ctx-submenu').getByRole('menuitem', { name: /^Rename/ }).click();
    const title = pic.locator('.ic-title');
    await expect(title).toHaveAttribute('contenteditable', 'true');
    await expect(title).toBeFocused();
    await page.keyboard.type('Key art');
    await page.keyboard.press('Enter');
    await expect(title).toHaveText('Key art');
    await expect(title).toHaveAttribute('contenteditable', 'false');

    await title.dblclick();
    await expect(title).toHaveAttribute('contenteditable', 'true');
    await expect(title).toBeFocused();
    await page.waitForTimeout(300);
    await expect(page.locator('.lightbox-stage')).toHaveCount(0);
  });

  test('select a picture and press Enter: the viewer opens', async ({ page }) => {
    await bootLocal(page);
    const at = await pictureCentre(page);
    await page.mouse.click(at.x, at.y);
    await expect(card(page, 'home-image')).toHaveClass(/is-selected/);
    await expect(page.locator('.lightbox-stage')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('.lightbox-stage')).toHaveCount(1);
  });
});

test.describe('paste', () => {
  test('a picture address ending .png becomes an image card', async ({ page }) => {
    await page.route(PIC, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await bootLocal(page, { blank: true });
    await paste(page, { at: AT, text: PIC });
    await expect(page.locator('.canvas-wrap .card-kind-image')).toHaveCount(1);
    await expect(page.locator('.canvas-wrap .card-kind-link')).toHaveCount(0);
  });

  test('a page address becomes a link card at once, without waiting on a picture probe', async ({ page }) => {
    // The preview is not what this is about: leave it hanging.
    await page.route('**/api/og**', () => {});
    await bootLocal(page, { blank: true });
    await paste(page, { at: AT, text: 'https://example.com/article' });
    await expect(page.locator('.canvas-wrap .card-kind-link')).toHaveCount(1, { timeout: 1000 });
    await expect(page.locator('.canvas-wrap .card-kind-image')).toHaveCount(0);
  });

  test('three picture files at once make three image cards that do not overlap', async ({ page }) => {
    await bootLocal(page, { blank: true });
    await paste(page, { at: AT, files: [pngFile('a.png'), pngFile('b.png'), pngFile('c.png')] });
    const images = page.locator('.canvas-wrap .card-kind-image');
    await expect(images).toHaveCount(3);
    // Their sizes settle as each one decodes.
    await page.waitForTimeout(600);
    const boxes = [];
    for (let i = 0; i < 3; i++) boxes.push(await images.nth(i).boundingBox());
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap, `image ${i} overlaps image ${j}: ${JSON.stringify([a, b])}`).toBe(false);
      }
    }
  });

  test('words that came with a picture (Q3 plan + HTML + a PNG) paste as a note, not a picture', async ({ page }) => {
    await bootLocal(page, { blank: true });
    await paste(page, { at: AT, text: 'Q3 plan', html: '<b>Q3 plan</b>', files: [pngFile('shot.png')] });
    await expect(page.locator('.canvas-wrap .card-kind-note')).toHaveCount(1);
    await expect(page.locator('.canvas-wrap .card-kind-note')).toContainText('Q3 plan');
    await page.waitForTimeout(500);
    await expect(page.locator('.canvas-wrap .card-kind-image')).toHaveCount(0);
    await expect(cardsOnCanvas(page)).toHaveCount(1);
  });
});

test.describe('a link card\'s preview line', () => {
  test('says "Getting preview…" while the preview is on its way', async ({ page }) => {
    await page.route('**/api/og**', () => {});   // never answers
    await bootLocal(page, { blank: true });
    await paste(page, { at: AT, text: 'https://example.com/article' });
    await expect(page.locator('.canvas-wrap .card-kind-link .lc-note')).toHaveText('Getting preview…');
  });

  test('says "No preview" when the page gave nothing to show', async ({ page }) => {
    await page.route('**/api/og**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    // The fallback is only tried when the worker route fails; keep it off the network anyway.
    await page.route('https://api.microlink.io/**', (route) => route.abort());
    // The real app: the ?local=1 harness has no updateCardSilent, so it never
    // writes a fetched preview (or its absence) onto a card.
    await bootRealBoard(page);
    await paste(page, { at: AT, text: 'https://example.com/article' });
    await expect(page.locator('.canvas-wrap .card-kind-link .lc-note')).toHaveText('No preview');
  });
});
