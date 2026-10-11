// Cards made through /api/v1, MCP or a manifest import carry the fields the
// API writes, which are not always the fields the canvas reads.
//
// API-05: a link card stores its address as `url`; the canvas read only
// `source`, so the card had no address and no open button.
// API-04: a doc card stores `body`/`html` but no docPages; the legacy DocCard
// rendered only `lines`, so the text the caller sent was invisible.
//
// The cards are planted in the saved local session, then the page reloads.

import { expect, test } from '@playwright/test';

const KEY = 'soleil.boards.local.session.v1';

async function plant(page, cards) {
  await page.goto('/?local=1&reset=1&blank=1');
  await expect(page.locator('.canvas-wrap')).toBeVisible({ timeout: 15000 });
  await expect.poll(() => page.evaluate((k) => !!localStorage.getItem(k), KEY)).toBe(true);
  await page.evaluate(({ k, cards }) => {
    const s = JSON.parse(localStorage.getItem(k));
    const id = s.stack[s.stack.length - 1];
    const st = s.localState.boardState[id] || { cards: [], arrows: [], strokes: [] };
    st.cards = [...(st.cards || []), ...cards];
    s.localState.boardState[id] = st;
    localStorage.setItem(k, JSON.stringify(s));
  }, { k: KEY, cards });
}

const apiLink = { id: 'api-link', kind: 'link', x: 120, y: 120, w: 280, h: 120, title: 'Ref', url: 'https://example.com/treatment' };
const apiDoc = {
  id: 'api-doc', kind: 'doc', x: 460, y: 120, w: 300, h: 260, title: 'Treatment',
  body: 'Act one opens on the pier.',
  html: '<p>Act one opens on the <strong>pier</strong>.</p><p>Act two<img src="x" onerror="window.__apiDocXss=1"></p>',
};

for (const mode of ['editor', 'viewer']) {
  const url = mode === 'editor' ? '/?local=1' : '/?local=1&roqa=1';

  test(`${mode}: a link card made through the API shows its address and opens`, async ({ page }) => {
    await plant(page, [apiLink]);
    await page.goto(url);
    const card = page.locator('[data-card-id="api-link"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.lc-src')).toContainText('https://example.com/treatment');
    await expect(card.locator('.lc-open')).toHaveCount(1);
  });

  test(`${mode}: a doc card made through the API shows its text`, async ({ page }) => {
    await plant(page, [apiDoc]);
    await page.goto(url);
    const card = page.locator('[data-card-id="api-doc"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Act one opens on the pier.');
    await expect(card).toContainText('Act two');
    await expect(card.locator('strong')).toHaveText('pier');
    // Sanitized like every other note/doc html render.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__apiDocXss || 0)).toBe(0);
  });
}

test('a doc card with only a body shows the body', async ({ page }) => {
  await plant(page, [{ ...apiDoc, id: 'api-doc-body', html: undefined, body: 'Line one\nLine two <b>not bold</b>' }]);
  await page.goto('/?local=1');
  const card = page.locator('[data-card-id="api-doc-body"]');
  await expect(card).toContainText('Line one');
  await expect(card).toContainText('Line two <b>not bold</b>');
});
