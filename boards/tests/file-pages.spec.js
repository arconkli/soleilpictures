// A text file's card is its first page, drawn from the file (direction A,
// FamilyFace.jsx): Markdown set as a document, a table under its header row,
// subtitle cues, a log as the file has it; a file that only says it's text
// keeps its glyph, and a card placed before keeps its size. Driven through
// the ?local=1 harness: each file is a blob served under its own key
// (r2.js setPrefixResolver), on cards added through __soleilFileLive.
import { expect, test } from '@playwright/test';
import { openFullFiles } from './files-helpers.js';

const LOG = Array.from({ length: 120 }, (_, i) => `B007C${String(i + 1).padStart(3, '0')}  long lens · PRINT`).join('\n');
const FILES = {
  'qa-files/notes.md': '# Night Swim\n\n## Day 4\n\n- **Dock** at 06:10\n- Long lens\n\n> Keep the light\n\n![still](https://example.com/still.jpg)\n',
  'qa-files/dailies.txt': LOG,
  'qa-files/calls.csv': 'Name,Role,Call\n"Ellison, Mara",Director,06:00\nPark,DP,06:15\n',
  'qa-files/night.srt': '1\n00:00:01,000 --> 00:00:03,500\n<i>Hello</i> there\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond\n',
  'qa-files/fake.txt': '\u0000\u0001\u0002binary',
};

async function board(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible();
  await page.evaluate(async (files) => {
    const urls = {};
    for (const [key, body] of Object.entries(files)) urls[key] = URL.createObjectURL(new Blob([body]));
    const r2 = await import('/src/lib/r2.js');
    r2.setPrefixResolver('qa-files/', { cached: (k) => urls[k] || null, resolve: async (k) => urls[k] || null });
    window.__qaSizes = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new Blob([v]).size]));
  }, FILES);
}

const add = (page, cards) => page.evaluate((list) => {
  for (const c of list) window.__soleilFileLive.addFile({ sizeBytes: window.__qaSizes[c.fileSrc.slice(3)], ...c });
}, cards);
const card = (page, id) => page.locator(`[data-card-id="${id}"]`);

test("a text file's card is its first page: Markdown set, a log in mono, a table, cues", async ({ page }) => {
  await board(page);
  await add(page, [
    { id: 'md', fileSrc: 'r2:qa-files/notes.md', fileName: 'Shot notes.md', ext: 'md', x: 60, y: 60, w: 300, h: 388 },
    { id: 'log', fileSrc: 'r2:qa-files/dailies.txt', fileName: 'Dailies log.txt', ext: 'txt', x: 400, y: 60, w: 300, h: 388 },
    { id: 'csv', fileSrc: 'r2:qa-files/calls.csv', fileName: 'Call times.csv', ext: 'csv', x: 740, y: 60, w: 400, h: 236 },
    { id: 'srt', fileSrc: 'r2:qa-files/night.srt', fileName: 'Night Swim.srt', ext: 'srt', x: 60, y: 480, w: 300, h: 388 },
  ]);
  const face = (id) => card(page, id).locator('.fpg');
  await expect(face('md').locator('h1')).toHaveText('Night Swim');
  await expect(face('md').locator('li strong')).toHaveText('Dock');
  await expect(face('md').locator('blockquote')).toContainText('Keep the light');
  // Markdown's pictures never load on a card: nothing from the web.
  await expect(face('md').locator('img')).toHaveCount(0);
  await expect(face('log').locator('pre')).toContainText('B007C001  long lens');
  await expect(face('csv').locator('th')).toHaveText(['Name', 'Role', 'Call']);
  await expect(face('csv').locator('td').first()).toHaveText('Ellison, Mara');
  await expect(face('srt').locator('.fpg-cue')).toHaveCount(2);
  await expect(face('srt').locator('.fpg-cue-t').first()).toHaveText('Hello there');
  await expect(face('srt').locator('.fpg-cue-tc').first()).toHaveText('00:00:01,000 → 00:00:03,500');
  // The strip keeps the name; the old small-text preview is gone.
  await expect(card(page, 'md').locator('.filec-info-name')).toHaveText('Shot notes.md');
  await expect(page.locator('.filec-preview')).toHaveCount(0);
  // The page is drawn at its design width and scaled to the card.
  const sheet = await face('md').locator('.fpg-sheet').evaluate((el) => ({ w: el.offsetWidth, t: getComputedStyle(el).transform }));
  expect(sheet.w).toBe(520);
  expect(sheet.t).toMatch(/^matrix\(0\.57/);
});

test("a file that only says it's text keeps its glyph; a card placed before keeps its size", async ({ page }) => {
  await board(page);
  await add(page, [
    { id: 'fake', fileSrc: 'r2:qa-files/fake.txt', fileName: 'fake.txt', ext: 'txt', x: 60, y: 60, w: 300, h: 388 },
    { id: 'old', fileSrc: 'r2:qa-files/notes.md', fileName: 'Old notes.md', ext: 'md', x: 400, y: 60, w: 240, h: 150 },
  ]);
  await expect(card(page, 'old').locator('.fpg h1')).toHaveText('Night Swim');
  await expect(card(page, 'fake').locator('.filec-glyph svg')).toBeVisible();
  await expect(card(page, 'fake').locator('.fpg')).toHaveCount(0);
  const box = await card(page, 'old').boundingBox();
  expect(Math.abs(box.width / box.height - 1.6)).toBeLessThan(0.04);
});

test("in the Files page a text file's tile is its first page too", async ({ page }) => {
  await board(page);
  await add(page, [
    { id: 'md', fileSrc: 'r2:qa-files/notes.md', fileName: 'Shot notes.md', ext: 'md', x: 60, y: 60, w: 300, h: 388 },
    { id: 'fake', fileSrc: 'r2:qa-files/fake.txt', fileName: 'fake.txt', ext: 'txt', x: 400, y: 60, w: 300, h: 388 },
  ]);
  await openFullFiles(page);
  await page.getByRole('button', { name: 'Grid layout' }).click();
  await expect(page.locator('.ct-tile[data-item-id="md"] .fpg h1')).toHaveText('Night Swim');
  // A file that only says it's text keeps its tile.
  await expect(page.locator('.ct-tile[data-item-id="fake"] .cbp-file-tile')).toBeVisible();
});
