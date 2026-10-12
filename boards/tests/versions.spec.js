// File versions (lib/cardVersions.js, lib/versionActions.js): drop a file onto
// a file of its kind and it becomes the next version; Info lists them, and
// Make current / Delete / Restore / Undo / Keep as separate file all work.
// Driven through the ?local=1 harness, where a version is the file's blob URL.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = (name) => readFileSync(new URL(`./fixtures/media/${name}`, import.meta.url)).toString('base64');

async function go(page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?local=1&reset=1');
  await page.evaluate(() => {
    try { localStorage.removeItem('soleil.files.dock'); localStorage.setItem('soleil.files.dockHint', '1'); } catch (_) {}
    window.history.replaceState(null, '', '/?local=1');
  });
  await page.reload();
  await expect(page.locator('.rail-brand')).toBeVisible();
  await expect(page.locator('[data-card-id="home-note"]')).toBeVisible();
}

// A clip on the board, from a fixture.
async function addClip(page, id, name = 'A001_C003.mp4') {
  await page.evaluate(({ data, id, name }) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    window.__soleilVideoLive.addVideo({ id, src: url, fileName: name, x: 900, y: 650 });
  }, { data: fixture('frames-vp9.mp4'), id, name });
  await expect(page.locator(`[data-card-id="${id}"]`)).toBeVisible();
}

// Drag a file from the desktop over `selector`, and (unless `hold`) drop it.
async function dropFile(page, selector, { name = 'A001_C003_v2.mp4', type = 'video/mp4', alt = false, hold = false } = {}) {
  await page.evaluate(({ selector, data, name, type, alt, hold }) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type }));
    const at = document.elementFromPoint(x, y);
    const fire = (t) => at.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, altKey: alt, dataTransfer: dt }));
    fire('dragenter'); fire('dragover');
    if (!hold) fire('drop');
  }, { selector, data: fixture('frames-vp9.mp4'), name, type, alt, hold });
}

const drawer = (page) => page.locator('.cb-detail.is-drawer');
const toast = (page, text) => page.locator('.toast', { hasText: text });

test('a file dropped on a clip becomes its next version, and Undo takes it back', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-a');
  const card = page.locator('[data-card-id="vid-a"]');

  // Held over the clip, it says what the drop will do.
  await dropFile(page, '[data-card-id="vid-a"]', { hold: true });
  await expect(card).toHaveClass(/is-version-drop/);
  await expect(card).toHaveAttribute('data-version-drop', 'Drop to add as v2');

  await dropFile(page, '[data-card-id="vid-a"]');
  await expect(toast(page, 'Added v2')).toBeVisible();
  await expect(card.locator('.card-version-chip')).toHaveText('v2');
  await expect(card).not.toHaveClass(/is-version-drop/);
  // No new card: it's the same file, newer.
  await expect(page.locator('.card.card-kind-video')).toHaveCount(1);

  await toast(page, 'Added v2').getByRole('button', { name: 'Undo' }).click();
  await expect(card.locator('.card-version-chip')).toHaveCount(0);
});

test('Keep as separate file turns the version into a card of its own', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-b');
  await dropFile(page, '[data-card-id="vid-b"]');
  await toast(page, 'Added v2').getByRole('button', { name: 'Keep as separate file' }).click();
  await expect(page.locator('.card.card-kind-video')).toHaveCount(2);
  await expect(page.locator('[data-card-id="vid-b"] .card-version-chip')).toHaveCount(0);
});

test('holding ⌥ adds the file as a separate card straight away', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-c');
  await dropFile(page, '[data-card-id="vid-c"]', { alt: true, hold: true });
  await expect(page.locator('[data-card-id="vid-c"]')).not.toHaveClass(/is-version-drop/);
});

test('Info lists the versions: make an old one current, delete one, restore it', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-d');
  await dropFile(page, '[data-card-id="vid-d"]', { name: 'cut2.mp4' });
  await expect(toast(page, 'Added v2')).toBeVisible();
  await page.locator('[data-card-id="vid-d"] .card-version-chip').click();
  const versions = drawer(page).locator('.cbd-versions');
  await expect(versions.locator('.cbd-count')).toHaveText('2');
  await expect(versions.locator('.cbd-ver.is-current .cbd-ver-n')).toHaveText('v2');

  // Make v1 current again.
  await versions.locator('.cbd-ver', { has: page.locator('.cbd-ver-n', { hasText: 'v1' }) }).locator('.cbd-ver-more').click();
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Make current' }).click();
  await expect(versions.locator('.cbd-ver.is-current .cbd-ver-n')).toHaveText('v1');
  await expect(page.locator('[data-card-id="vid-d"] .card-version-chip')).toHaveText('v1');

  // Delete v2: it waits under Recently deleted, and comes back.
  await versions.locator('.cbd-ver', { has: page.locator('.cbd-ver-n', { hasText: 'v2' }) }).locator('.cbd-ver-more').click();
  await page.locator('.ctx-menu .ctx-item', { hasText: 'Delete version' }).click();
  await expect(versions.locator('.cbd-count')).toHaveText('1');
  await expect(page.locator('[data-card-id="vid-d"] .card-version-chip')).toHaveCount(0);
  await versions.getByRole('button', { name: /Recently deleted/ }).click();
  await versions.getByRole('button', { name: 'Restore' }).click();
  await expect(versions.locator('.cbd-count')).toHaveText('2');
});

test('a file of another kind is not a version', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-e');
  await dropFile(page, '[data-card-id="vid-e"]', { name: 'notes.pdf', type: 'application/pdf', hold: true });
  await expect(page.locator('[data-card-id="vid-e"]')).not.toHaveClass(/is-version-drop/);
});

test('Files offers Upload new version… and takes a version dropped on a tile', async ({ page }) => {
  await go(page);
  await addClip(page, 'vid-f', 'take1.mp4');
  await page.locator('.canvas-wrap').click({ position: { x: 30, y: 300 } });
  await page.keyboard.press('f');
  const panel = page.locator('.list-wrap.is-panel');
  await expect(panel).toBeVisible();
  const tile = panel.locator('[data-item-id="vid-f"]');
  await expect(tile).toBeVisible();
  await tile.click({ button: 'right' });
  await expect(page.locator('.ctx-menu .ctx-item', { hasText: 'Upload new version…' })).toBeVisible();
  await page.keyboard.press('Escape');

  await dropFile(page, '.list-wrap.is-panel [data-item-id="vid-f"]', { hold: true });
  await expect(tile).toHaveClass(/is-version-drop/);
  await dropFile(page, '.list-wrap.is-panel [data-item-id="vid-f"]');
  await expect(toast(page, 'Added v2')).toBeVisible();
  await expect(tile.locator('.ct-version-chip')).toHaveText('v2');
});
