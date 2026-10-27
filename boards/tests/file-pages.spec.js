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
  'qa-files/notes.md': '# Night Swim\n\n## Day 4\n\n- **Dock** at 06:10\n- Long lens\n\n> Keep the light\n\n![still](https://example.com/still.jpg)\n\nSee [the call sheet](https://example.com/calls).\n',
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
    window.__qaUrls = urls;
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

test("Quick look reads a text file's page with its numbers, a table under its header, and says when it shows only the start", async ({ page }) => {
  // Five files in Quick look, one of them 2 MB of lines.
  test.slow();
  await board(page);
  // A log past Quick look's 2 MB.
  await page.evaluate(() => {
    const body = `${'x'.repeat(79)}\n`.repeat(Math.ceil((2.2 * 1024 * 1024) / 80));
    window.__qaUrls['qa-files/huge.log'] = URL.createObjectURL(new Blob([body]));
    window.__qaSizes['qa-files/huge.log'] = body.length;
  });
  await add(page, [
    { id: 'log', fileSrc: 'r2:qa-files/dailies.txt', fileName: 'Dailies log.txt', ext: 'txt', x: 60, y: 60, w: 300, h: 388 },
    { id: 'csv', fileSrc: 'r2:qa-files/calls.csv', fileName: 'Call times.csv', ext: 'csv', x: 400, y: 60, w: 400, h: 236 },
    { id: 'huge', fileSrc: 'r2:qa-files/huge.log', fileName: 'Render farm.log', ext: 'log', x: 840, y: 60, w: 300, h: 388 },
    { id: 'md', fileSrc: 'r2:qa-files/notes.md', fileName: 'Shot notes.md', ext: 'md', x: 60, y: 480, w: 300, h: 388 },
    { id: 'srt', fileSrc: 'r2:qa-files/night.srt', fileName: 'Night Swim.srt', ext: 'srt', x: 400, y: 480, w: 300, h: 388 },
  ]);
  const ql = page.locator('.ql');
  const open = async (id) => {
    await card(page, id).locator('.filec-body').dblclick();
    await expect(ql).toBeVisible();
  };

  await open('log');
  const text = ql.locator('.fst-text');
  await expect(text.locator('.fst-gutter')).toContainText('120');
  await expect(text.locator('.fst-lines')).toContainText('B007C120  long lens');
  await expect(text.locator('.fst-top')).toHaveCount(0);
  await expect(ql.locator('.ql-meta')).toHaveText('Text');
  // The page takes the keyboard to scroll; Space still closes.
  await expect(text.locator('.fst-body')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(ql).toHaveCount(0);

  await open('csv');
  await expect(ql.locator('.fst-table thead th')).toHaveText(['', 'Name', 'Role', 'Call']);
  await expect(ql.locator('.fst-table tbody td').nth(1)).toHaveText('Ellison, Mara');
  await expect(ql.locator('.fst-count')).toHaveText('2 rows · 3 columns');
  await page.keyboard.press('Escape');

  await open('huge');
  await expect(ql.locator('.fst-top')).toContainText('Showing the first 2 MB of 2.2 MB.');
  const all = ql.getByRole('button', { name: 'Download all of it' });
  await expect(all).toBeVisible();
  const lines = await ql.locator('.fst-lines').evaluate((el) => el.textContent.split('\n').length);
  expect(lines).toBe(Math.floor((2 * 1024 * 1024) / 80));
  const download = page.waitForEvent('download');
  await all.click();
  expect((await download).suggestedFilename()).toBe('Render farm.log');
  await page.keyboard.press('Escape');

  await open('md');
  await expect(ql.locator('.fst-md h1')).toHaveText('Night Swim');
  const link = ql.locator('.fst-md a', { hasText: 'the call sheet' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(ql.locator('.fst-md img')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await open('srt');
  await expect(ql.locator('.fst-cues .fpg-cue')).toHaveCount(2);
  await expect(ql.locator('.fst-cues .fpg-cue-t').nth(1)).toHaveText('Second');
});

test("Quick look shows a file that only says it's text as its card", async ({ page }) => {
  await board(page);
  await add(page, [{ id: 'fake', fileSrc: 'r2:qa-files/fake.txt', fileName: 'fake.txt', ext: 'txt', x: 60, y: 60, w: 300, h: 388 }]);
  await card(page, 'fake').locator('.filec-body').dblclick();
  await expect(page.locator('.ql .ql-card-preview')).toBeVisible();
  await expect(page.locator('.ql .qpage')).toHaveCount(0);
});

// Courier Prime (OFL, public/fonts) is a font the app already serves.
async function addFonts(page) {
  await page.evaluate(() => {
    window.__qaUrls['qa-files/CourierPrime-Bold.woff2'] = '/fonts/CourierPrime-Bold.woff2';
    window.__qaSizes['qa-files/CourierPrime-Bold.woff2'] = 19348;
    window.__qaUrls['qa-files/broken.ttf'] = URL.createObjectURL(new Blob(['not a font at all']));
    window.__qaSizes['qa-files/broken.ttf'] = 17;
  });
  await add(page, [
    { id: 'font', fileSrc: 'r2:qa-files/CourierPrime-Bold.woff2', fileName: 'CourierPrime-Bold.woff2', ext: 'woff2', x: 60, y: 60, w: 320, h: 220 },
    { id: 'broken', fileSrc: 'r2:qa-files/broken.ttf', fileName: 'broken.ttf', ext: 'ttf', x: 420, y: 60, w: 320, h: 220 },
  ]);
}

test("a font's card is a specimen of itself, drawn in the font; a file that won't load as one keeps its icon", async ({ page }) => {
  await board(page);
  await addFonts(page);
  const spec = card(page, 'font').locator('.fpg-spec');
  await expect(spec.locator('.fpg-spec-fam')).toHaveText('Courier Prime Bold');
  await expect(spec.locator('.fpg-spec-sty')).toHaveText('Bold · WOFF2');
  await expect(spec.locator('.fpg-spec-aa')).toHaveText('Aa');
  // Drawn in the file itself, under a name of its own, never the font's.
  const family = await spec.locator('.fpg-spec-aa').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/^soleil-font-\d+,/);
  expect(await page.evaluate((f) => document.fonts.check(`16px ${f}`), family.split(',')[0])).toBe(true);
  await expect(card(page, 'font').locator('.filec-info-name')).toHaveText('CourierPrime-Bold.woff2');
  await expect(card(page, 'broken').locator('.filec-glyph svg')).toBeVisible();
  await expect(card(page, 'broken').locator('.fpg-spec')).toHaveCount(0);
});

test('Quick look opens a font as a page to try it on: type, change the size, see it at five sizes', async ({ page }) => {
  await board(page);
  await addFonts(page);
  await card(page, 'font').locator('.filec-body').dblclick();
  const ql = page.locator('.ql');
  const stage = ql.locator('.fst-font');
  await expect(stage.locator('.fst-font-fam')).toHaveText('Courier Prime Bold');
  await expect(stage.locator('.fst-font-facts')).toContainText('WOFF2 · 19 KB');
  await expect(ql.locator('.ql-meta')).toHaveText('Font');
  await expect(stage.locator('.fst-font-fall > div')).toHaveCount(5);
  await expect(stage.locator('.fst-font-glyphs span')).toHaveCount(66);
  const field = stage.getByLabel('Type to try it');
  await field.fill('Hello');
  await expect(stage.locator('.fst-font-fall span').first()).toHaveText('Hello');
  // Space types a space in the field; Quick look stays open.
  await field.press('End');
  await field.press('Space');
  await expect(field).toHaveValue('Hello ');
  await expect(ql).toBeVisible();
  await stage.getByLabel('Size').fill('120');
  await expect(stage.locator('.fst-font-size output')).toHaveText('120 px');
  expect(await field.evaluate((el) => getComputedStyle(el).fontSize)).toBe('120px');
  expect(await field.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^soleil-font-\d+,/);
  await field.press('Escape');
  await expect(ql).toHaveCount(0);
});

// The letter from lib/mailRead.test.mjs: a decoded subject, a plain and an
// HTML body (a picture inside the message and one from the web), and one
// attachment; a plain-text reply that quotes; and an Outlook message built
// in the page by the tests' own compound-file writer (lib/testCfb.mjs).
const EML = [
  'From: Ines Carvalho <ines@example.com>', 'To: Mara Ellison <mara@example.com>', 'Cc: Theo Park <theo@example.com>',
  'Subject: =?UTF-8?Q?Re:_Day_4_call_times_=E2=80=94_dock?=', 'Date: Mon, 13 Oct 2026 21:04:00 +0000',
  'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b1"', '',
  '--b1', 'Content-Type: multipart/alternative; boundary="b2"', '',
  '--b2', 'Content-Type: text/plain; charset=utf-8', '', 'Crew call is 05:30.', '', '> Can we push crew call?', '',
  '--b2', 'Content-Type: text/html; charset=utf-8', '', '<p>Crew call is <b>05:30</b>.</p><img src="cid:logo1"><img src="https://tracker.example/p.gif">', '',
  '--b2--',
  '--b1', 'Content-Type: image/png', 'Content-ID: <logo1>', 'Content-Disposition: inline', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=', '',
  '--b1', 'Content-Type: application/pdf; name="call-sheet.pdf"', 'Content-Disposition: attachment; filename="call-sheet.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQ=', '',
  '--b1--', '',
].join('\r\n');
const PLAIN = [
  'From: Iris Chen <iris@example.com>', 'To: Cast & crew <crew@example.com>', 'Subject: Day 5', 'Date: Tue, 14 Oct 2026 21:12:00 +0000',
  'Content-Type: text/plain; charset=utf-8', '',
  'Basecamp opens at 15:00.', '', 'On Mon 13 Oct 2026, Mara Ellison wrote:', '> Can we push crew call?', '',
].join('\r\n');

async function addMail(page) {
  await page.evaluate(async ({ eml, plain }) => {
    const { writeCfb, utf16le } = await import('/src/lib/testCfb.mjs');
    const msg = writeCfb({ name: 'Root Entry', children: [
      { name: '__substg1.0_0037001F', data: utf16le('Wrap notes') },
      { name: '__substg1.0_0C1A001F', data: utf16le('Theo Park') },
      { name: '__substg1.0_5D01001F', data: utf16le('theo@example.com') },
      { name: '__substg1.0_1000001F', data: utf16le('That is a wrap on the dock.') },
    ] }, { miniCutoff: 4096 });
    for (const [key, body] of [['qa-files/Re Day 4.eml', eml], ['qa-files/Day 5.eml', plain], ['qa-files/Wrap.msg', msg]]) {
      const blob = new Blob([body]);
      window.__qaUrls[key] = URL.createObjectURL(blob);
      window.__qaSizes[key] = blob.size;
    }
  }, { eml: EML, plain: PLAIN });
  await add(page, [
    { id: 'mail', fileSrc: 'r2:qa-files/Re Day 4.eml', fileName: 'Re Day 4.eml', ext: 'eml', x: 60, y: 60, w: 300, h: 388 },
    { id: 'plain', fileSrc: 'r2:qa-files/Day 5.eml', fileName: 'Day 5.eml', ext: 'eml', x: 400, y: 60, w: 300, h: 388 },
    { id: 'msg', fileSrc: 'r2:qa-files/Wrap.msg', fileName: 'Wrap.msg', ext: 'msg', x: 740, y: 60, w: 300, h: 388 },
  ]);
}

test("an email's card is a letter: its subject, who it's from, its first lines, and its attachments on its strip", async ({ page }) => {
  await board(page);
  await addMail(page);
  const letter = card(page, 'mail').locator('.fpg-mail');
  await expect(letter.locator('.fpg-mail-subj')).toHaveText('Re: Day 4 call times — dock');
  await expect(letter.locator('.fpg-mail-hdr')).toContainText('Ines Carvalho <ines@example.com>');
  await expect(letter.locator('.fpg-mail-hdr')).toContainText('Mara Ellison');
  // What it quotes isn't the letter.
  await expect(letter.locator('p')).toHaveText(['Crew call is 05:30.']);
  await expect(letter.locator('.fpg-mail-chip')).toContainText('call-sheet.pdf');
  // Nothing on a card loads from the web.
  await expect(letter.locator('img')).toHaveCount(0);
  await expect(card(page, 'mail').locator('.filec-info-size')).toHaveText('1 attachment');
  await expect(card(page, 'plain').locator('.fpg-mail p')).toHaveText(['Basecamp opens at 15:00.']);
  await expect(card(page, 'plain').locator('.filec-info-size')).toHaveText(/ B$/);
  // An Outlook message reads into the same letter.
  await expect(card(page, 'msg').locator('.fpg-mail-subj')).toHaveText('Wrap notes');
  await expect(card(page, 'msg').locator('.fpg-mail-hdr')).toContainText('Theo Park <theo@example.com>');
  await expect(card(page, 'msg').locator('.fpg-mail p')).toHaveText(['That is a wrap on the dock.']);
});

test('Quick look opens an email as it was sent: in a frame that runs nothing, its pictures from the web held until asked, its attachment onto the board', async ({ page }) => {
  await board(page);
  await addMail(page);
  await card(page, 'mail').locator('.filec-body').dblclick();
  const ql = page.locator('.ql');
  const stage = ql.locator('.fst-mail');
  await expect(stage.locator('.fst-mail-subj')).toHaveText('Re: Day 4 call times — dock');
  await expect(ql.locator('.ql-meta')).toHaveText('Email');
  await expect(stage.locator('.fst-mail-from')).toContainText('Ines Carvalho');
  await expect(stage.locator('.fst-mail-from')).toContainText('Cc Theo Park');
  await expect(stage.locator('.fst-mail-av')).toHaveText('IC');
  const frame = stage.locator('iframe.fst-mail-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
  const policy = async () => (await frame.getAttribute('srcdoc')).match(/Content-Security-Policy" content="([^"]*)"/)[1];
  expect(await policy()).toContain('img-src data:;');
  expect(await policy()).not.toContain('https:');
  // The picture inside the message is there as data; the one from the web waits.
  expect(await frame.getAttribute('srcdoc')).toContain('src="data:image/png;base64,iVBORw0KGgo="');
  await expect(stage.locator('.fst-top')).toHaveText('Pictures from the web are hidden in this email.Show pictures');
  await stage.getByRole('button', { name: 'Show pictures' }).click();
  await expect(stage.locator('.fst-top')).toHaveCount(0);
  expect(await policy()).toContain('img-src data: https: http:;');
  // Its attachment: to save, or onto the board, where it lands and Quick look closes.
  await expect(stage.locator('.fst-mail-lab')).toHaveText('1 attachment');
  await expect(stage.locator('.fst-mail-att')).toContainText('call-sheet.pdf');
  const download = page.waitForEvent('download');
  await stage.getByRole('button', { name: 'Download call-sheet.pdf' }).click();
  expect((await download).suggestedFilename()).toBe('call-sheet.pdf');
  const before = await page.locator('[data-card-id]').count();
  await stage.getByRole('button', { name: 'Put it on board' }).click();
  await expect(ql).toHaveCount(0);
  await expect(page.locator('[data-card-id]')).toHaveCount(before + 1);
});

test('Quick look sets a plain-text email on its page, its quote apart, with no frame and nothing to put on the board', async ({ page }) => {
  await board(page);
  await addMail(page);
  await card(page, 'plain').locator('.filec-body').dblclick();
  const stage = page.locator('.ql .fst-mail');
  await expect(stage.locator('.fst-mail-subj')).toHaveText('Day 5');
  await expect(stage.locator('.fst-mail-text > p')).toHaveText(['Basecamp opens at 15:00.']);
  await expect(stage.locator('.fst-mail-quote p')).toHaveText(['On Mon 13 Oct 2026, Mara Ellison wrote:', 'Can we push crew call?']);
  await expect(stage.locator('iframe')).toHaveCount(0);
  await expect(stage.locator('.fst-mail-atts')).toHaveCount(0);
  await expect(stage).not.toHaveClass(/is-html/);
});
