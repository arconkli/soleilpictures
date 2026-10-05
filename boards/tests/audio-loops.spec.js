// End-to-end for the loop-library work, driven through ?local=1 so there is no
// backend involved. The pure logic (peaks, tempo/key parsing, zip bytes,
// filenames) is unit-tested; what only a browser can prove is that the card
// renders, the waveform is drawn from the REAL FILE, the transport works, the
// list swaps to loop-browser columns, and auditioning runs a pack.
//
// The fixture is a 2.000s WAV of four decaying hits at 120 BPM, served
// statically. Four hits means the decoded waveform has an obviously correct
// shape: four tall regions with near-silence between them. A test asserting
// only "96 bytes came back" would have passed against the old waveform, which
// was a hash of the filename.
import { expect, test } from '@playwright/test';

const isNoise = (t) => /ERR_NAME_NOT_RESOLVED|Failed to load resource|WebSocket connection/.test(t);

async function boot(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (!isNoise(String(e))) errors.push(String(e)); });
  // NOT followed by a replaceState to '/?local=1' the way the other local
  // specs do it: rewriting the URL away from blank=1 makes the harness
  // re-seed the demo board underneath you, and every count in this file is
  // then off by the five demo cards.
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.rail-brand')).toBeVisible();
  await page.waitForFunction(() => !!window.__soleilAudioLive);
  return errors;
}

async function addAudio(page, n = 1) {
  await page.evaluate((count) => {
    for (let i = 0; i < count; i++) window.__soleilAudioLive.addAudio({ x: 200 + i * 40, y: 160 + i * 40 });
  }, n);
  await expect(page.locator('.ac').first()).toBeVisible();
}

const goList = async (page) => {
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('.list-wrap')).toBeVisible();
};

test('an audio card renders a waveform drawn from the actual file', async ({ page }) => {
  const errors = await boot(page);
  await addAudio(page);

  // Two layered paths (muted + gold-clipped), not one rect per bar.
  const paths = page.locator('.ac-wave path');
  await expect(paths).toHaveCount(2);

  // The card seeds with no peaks; analysis has to produce them from the file.
  // The shape must match the fixture: four loud regions, quiet between.
  await page.waitForFunction(() => {
    const el = document.querySelector('.ac-wave path');
    return el && (el.getAttribute('d') || '').length > 200;
  }, { timeout: 15000 });

  const d = await paths.first().getAttribute('d');
  expect(d).not.toMatch(/NaN|Infinity|undefined/);
  // One subpath per bucket.
  expect((d.match(/M/g) || []).length).toBeGreaterThan(40);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('tempo, key and format show on the card and are editable', async ({ page }) => {
  await boot(page);
  await addAudio(page);
  const meta = page.locator('.ac-meta').first();
  await expect(meta).toContainText('120');
  await expect(meta).toContainText('A min');
  await expect(meta).toContainText('WAV');

  // Typing a key folds through the same canonicalizer the filename uses.
  const keyField = meta.locator('.ac-meta-field').nth(1);
  await keyField.click();
  // ControlOrMeta, not Control: on macOS Control+A moves to line start, so the
  // typed value lands beside the old one and canonicalKey rejects the pair.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('f#m');
  await page.keyboard.press('Enter');
  await expect(meta).toContainText('F♯ min');
});

test('the transport plays, and Enter drives the selected card', async ({ page }) => {
  await boot(page);
  await addAudio(page);
  const card = page.locator('.card-kind-audio').first();

  await page.locator('.ac-play').first().click();
  await expect(page.locator('.ac-play[aria-label="Pause"]')).toHaveCount(1);
  await page.locator('.ac-play').first().click();
  await expect(page.locator('.ac-play[aria-label="Play"]')).toHaveCount(1);

  // Enter, not Space — Space is the canvas pan modifier.
  await card.click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Enter');
  await expect(page.locator('.ac-play[aria-label="Pause"]')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ac-play[aria-label="Play"]')).toHaveCount(1);
});

test('only one clip plays at a time', async ({ page }) => {
  await boot(page);
  await addAudio(page, 2);
  await expect(page.locator('.ac')).toHaveCount(2);
  await page.locator('.ac-play').nth(0).click();
  await expect(page.locator('.ac-play[aria-label="Pause"]')).toHaveCount(1);
  await page.locator('.ac-play').nth(1).click();
  // Starting the second must stop the first — one pause button, not two.
  await expect(page.locator('.ac-play[aria-label="Pause"]')).toHaveCount(1);
});

test('a download button is on the card, and on a read-only surface too', async ({ page }) => {
  await boot(page);
  await addAudio(page);
  // Present in the DOM regardless of hover; CSS hides it until hover, and it
  // is wired on `src` alone rather than behind canEdit — which is what makes
  // it work on a public board, where the context menu is disabled entirely.
  await expect(page.locator('.ac-download')).toHaveCount(1);
  await expect(page.locator('.ac-download')).toHaveAttribute('aria-label', 'Download audio');
});

test('list view swaps to loop-browser columns and sorts by them', async ({ page }) => {
  const errors = await boot(page);
  await addAudio(page, 3);
  await goList(page);

  // Majority-audio → Time / BPM / Key / Format replace Type + Size.
  const table = page.locator('.ct-table');
  await expect(table).toHaveAttribute('data-cols', 'audio');
  await expect(page.getByRole('button', { name: /^Time/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^BPM/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Key/ })).toBeVisible();
  // Scoped to .ct-cell: the header buttons carry the same column classes.
  await expect(page.locator('.ct-cell.ct-c-dur').first()).toContainText('0:02');
  await expect(page.locator('.ct-cell.ct-c-bpm').first()).toContainText('120');
  await expect(page.locator('.ct-cell.ct-c-key').first()).toContainText('A min');
  await expect(page.locator('.ct-cell.ct-c-fmt').first()).toContainText('WAV');

  // The audio-only sort keys are offered.
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await expect(page.locator('.cbt-menu')).toContainText('Tempo');
  await expect(page.locator('.cbt-menu')).toContainText('Key');
  await page.keyboard.press('Escape');

  expect(errors, errors.join('\n')).toEqual([]);
});

test('list rows audition, and the keyboard moves through them', async ({ page }) => {
  await boot(page);
  await addAudio(page, 3);
  await goList(page);

  await expect(page.locator('.ct-row')).toHaveCount(3);
  // The row thumbnail is the play button.
  await page.locator('.ct-play').first().click();
  await expect(page.locator('.ct-row.is-playing')).toHaveCount(1);

  // Arrows move a cursor that is separate from selection.
  await page.locator('.cb-main, .list-inner').first().click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ct-row.is-active')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.ct-row.is-active')).toHaveCount(1);
});

test('when a clip ends the next row starts on its own', async ({ page }) => {
  // The feature that turns the list into a loop browser — and the one that was
  // silently dead, because notifyEnded read the source off the bus AFTER
  // release had cleared it, so auto-advance always saw null and bailed.
  await boot(page);
  await addAudio(page, 3);
  await goList(page);

  const rows = page.locator('.ct-row');
  await page.locator('.ct-play').nth(0).click();
  await expect(rows.nth(0)).toHaveClass(/is-playing/);

  // Drive the clip to its end rather than waiting it out in real time. The
  // list's element is in the document precisely so this is reachable.
  await page.waitForFunction(() => {
    const el = document.querySelector('audio[data-list-audio]');
    return el && Number.isFinite(el.duration) && el.duration > 0;
  });
  await page.evaluate(() => {
    const el = document.querySelector('audio[data-list-audio]');
    el.currentTime = Math.max(0, el.duration - 0.05);
  });

  // The SECOND row takes over — the cursor moves with it, and the first stops.
  await expect(rows.nth(1)).toHaveClass(/is-playing/, { timeout: 10000 });
  await expect(rows.nth(1)).toHaveClass(/is-active/);
  await expect(rows.nth(0)).not.toHaveClass(/is-playing/);
});

test('shift-click selects a range, and the bar offers a download', async ({ page }) => {
  await boot(page);
  await addAudio(page, 3);
  await goList(page);

  await page.locator('.ct-row').nth(0).click();
  await expect(page.locator('.ct-row.is-selected')).toHaveCount(1);
  // Shift used to TOGGLE one row; it ranges now.
  await page.locator('.ct-row').nth(2).click({ modifiers: ['Shift'] });
  await expect(page.locator('.ct-row.is-selected')).toHaveCount(3);

  const bar = page.locator('.list-selbar');
  await expect(bar).toContainText('3 selected');
  await expect(bar.getByRole('button', { name: /Download 3/ })).toBeVisible();
});

test('gallery tiles audition and download too', async ({ page }) => {
  await boot(page);
  await addAudio(page, 2);
  await goList(page);
  await page.getByRole('button', { name: 'Gallery view' }).click();
  await expect(page.locator('.ct-gallery')).toBeVisible();
  await expect(page.locator('.ct-tile-dl')).toHaveCount(2);
  await page.locator('.ct-tile-play').first().click();
  await expect(page.locator('.ct-tile.is-playing')).toHaveCount(1);
  // The meta line stands in for the type badge once a card has one.
  await expect(page.locator('.ct-tile-type').first()).toContainText('120');
});

test('every row carries a download button', async ({ page }) => {
  await boot(page);
  await addAudio(page, 2);
  await goList(page);
  await expect(page.locator('.ct-dl')).toHaveCount(2);
});

test('one unreadable file does not take the whole archive down with it', async ({ page }) => {
  // The bug this covers: the bulk path fetched every asset inside a single
  // Promise.all, which rejects on the FIRST throw — so one dead R2 key turned
  // "download these two" into "Download failed: Failed to fetch" and no
  // archive, discarding the file that had already come back fine.
  //
  // R2 also sends no access-control-allow-origin on an ERROR response, so a
  // dead signature reaches the browser as a bare TypeError and is
  // indistinguishable from a blocked origin. That is why the surviving error
  // names the origin instead of guessing between the two.
  await boot(page);
  // Aborted at the network layer rather than pointed at a missing path: the
  // dev server answers an unknown path with the SPA's index.html, so a 404
  // fixture would have come back 200 and proved nothing.
  await page.route('**/gone-loop.wav', (route) => route.abort());
  await page.evaluate(() => {
    window.__soleilAudioLive.addAudio({ x: 200, y: 160 }, { fileName: 'good-loop.wav' });
    window.__soleilAudioLive.addAudio({ x: 260, y: 220 },
      { fileName: 'gone-loop.wav', src: '/gone-loop.wav' });
  });
  await expect(page.locator('.ac')).toHaveCount(2);
  await goList(page);

  await page.locator('.ct-row').nth(0).click();
  await page.locator('.ct-row').nth(1).click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('.ct-row.is-selected')).toHaveCount(2);

  const download = page.waitForEvent('download');
  await page.locator('.list-selbar-act').click();

  // The archive still arrives, holding the one file that could be read…
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.zip$/);
  // …and the shortfall is reported rather than silently shipped.
  await expect(page.locator('.toast')).toContainText('Downloaded 1 file');
  await expect(page.locator('.toast')).toContainText('could not be read from storage');
});

test('when storage hands back nothing, the error names the origin', async ({ page }) => {
  // R2 sends no access-control-allow-origin on an ERROR response — verified
  // against the live bucket — so an expired signature, a deleted object and an
  // origin the bucket refuses all reach the browser as the same bare
  // `TypeError: Failed to fetch`. The message cannot attribute the cause, so it
  // names the origin instead and leaves the check to whoever reads it.
  await boot(page);
  await page.route('**/*.wav', (route) => route.abort());
  await page.evaluate(() => {
    window.__soleilAudioLive.addAudio({ x: 200, y: 160 }, { fileName: 'a.wav' });
    window.__soleilAudioLive.addAudio({ x: 260, y: 220 }, { fileName: 'b.wav' });
  });
  await expect(page.locator('.ac')).toHaveCount(2);
  await goList(page);

  await page.locator('.ct-row').nth(0).click();
  await page.locator('.ct-row').nth(1).click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.list-selbar-act').click();

  const toast = page.locator('.toast');
  await expect(toast).toContainText('Storage would not hand those files back');
  await expect(toast).toContainText('http://127.0.0.1');
  // Not the raw "Failed to fetch", which said nothing anyone could act on.
  await expect(toast).not.toContainText('Failed to fetch');
});
