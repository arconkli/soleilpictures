// Shared by the tools-*.spec.js specs (the most-used tools: pictures, links,
// notes, select / copy). Not a spec itself; Playwright only collects *.spec.js.
import { expect } from '@playwright/test';
import { bootSignedIn } from './helpers/signedInStub.js';

// A real 1x1 PNG (the one files-audit.spec.js uses).
export const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
export const PNG = Buffer.from(PNG_B64, 'base64');

export const card = (page, id) => page.locator(`[data-card-id="${id}"]`);
export const cardsOnCanvas = (page) => page.locator('.canvas-wrap .card[data-card-id]');

// ?local=1 harness: the seeded Studio, or an empty one (blank). Same boot as menu-keyboard.spec.js.
export async function bootLocal(page, { blank = false } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/?local=1&reset=1${blank ? '&blank=1' : ''}`);
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 30000 });
  await page.addStyleTag({ content: '.dev-banner, .twk-gear { display: none !important; }' });
  if (blank) await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toBeVisible({ timeout: 30000 });
  else await expect(card(page, 'home-image')).toBeVisible({ timeout: 30000 });
}

// The real signed-in app (Supabase stubbed, helpers/signedInStub.js) on its empty
// Studio root: the production note editor, the top bar's crumbs, the real mutators.
// Same boot as note-editing-real.spec.js.
export async function bootRealBoard(page, opts = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  // A power reveal can hold the screen; mark this tab's as spent.
  await page.addInitScript(() => { try { sessionStorage.setItem('soleil.revealSession', '1'); } catch {} });
  const rpc = { get_my_tier: [{ tier: 'demo', demo_card_count: 0, onboarding: { seeded: true, done: true } }], ...(opts.rpc || {}) };
  const stub = await bootSignedIn(page, { ...opts, rpc });
  await page.waitForSelector('.canvas-wrap', { timeout: 30_000 });
  await page.waitForTimeout(3500); // a board's first 3s are the doc arriving
  return stub;
}

// A synthetic paste on the window at the pointer's spot (the mouse is moved
// there first: a paste lands under the last pointer position).
export async function paste(page, { at = null, text = null, html = null, files = [] } = {}) {
  if (at) await page.mouse.move(at.x, at.y);
  await page.evaluate(({ text, html, files }) => {
    const dt = new DataTransfer();
    if (text !== null) dt.setData('text/plain', text);
    if (html !== null) dt.setData('text/html', html);
    for (const f of files) {
      const bin = atob(f.b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { text, html, files });
}

export const pngFile = (name) => ({ name, type: 'image/png', b64: PNG_B64 });

// A toast that offers Undo.
export const undoToast = (page) => page.locator('.toast', { has: page.getByRole('button', { name: 'Undo' }) });
