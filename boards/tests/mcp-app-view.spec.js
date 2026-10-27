// The inline view (boards/mcp-app/): what show_board draws in ChatGPT and
// Claude, framed the way they frame it (helpers/mcpAppHost.js: a sandboxed
// iframe that answers the ui/* protocol and logs both ways). The board is made
// by the Worker's own lib/canvasView.js and handed over as show_board's real
// answer (and a draft's, through draftAnswer), so the view is tested against
// what it will really get. No app and no server: the page is the host.
//
//   npx playwright test tests/mcp-app-view.spec.js --project=desktop-chrome
import { test, expect } from '@playwright/test';
import { MCP_APP_HTML } from '../src/lib/mcpAppHtml.generated.js';
import { TOOLS } from '../src/lib/mcpTools.js';
import { draftAnswer } from '../src/lib/mcpDrafts.js';
import { PICTURES, BOARD, boardCanvas, pictureSvg, installHost } from './helpers/mcpAppHost.js';

const ORIGIN = 'https://clusters.soleilpictures.com';
const CAPS = { openLinks: {}, serverTools: {}, message: {}, updateModelContext: {} };
const CONTEXT = { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'], locale: 'en-GB' };
const SHOW = TOOLS.find((t) => t.name === 'show_board');

// show_board's answer for a canvas: the summary and the model's shape, and the
// whole canvas in _meta for the view.
function answer(canvas) {
  const forModel = SHOW.forModel(canvas);
  return { content: [{ type: 'text', text: SHOW.summary(forModel) }], structuredContent: forModel, _meta: SHOW.view(canvas) };
}

// Frames the view and hands it `result` once it has said hello.
async function open(page, { result, refresh = null, caps = CAPS, context = CONTEXT, width = 720 } = {}) {
  await page.route(`${PICTURES}/**`, (r) => r.fulfill({
    contentType: 'image/svg+xml', body: pictureSvg(new URL(r.request().url()).pathname),
  }));
  await page.setContent('<!doctype html><html style="color-scheme:light"><body style="background:#faf9f5"></body></html>');
  await page.evaluate(installHost, { html: MCP_APP_HTML, caps, context, args: { board_id: BOARD }, result, refresh, width });
  return page.frameLocator('#view');
}

// What the view has sent the host, by method.
const sent = (page, method) => page.evaluate(
  (m) => window.__host.log.filter((x) => x.from === 'view' && x.method === m).map((x) => x.params ?? null),
  method,
);
const lastSent = async (page, method) => (await sent(page, method)).at(-1);
const loadedPictures = (view) => view.locator('img').evaluateAll(
  (imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
);

test('draws the board as it is laid out, and the frame follows its height', async ({ page }) => {
  const view = await open(page, { result: answer(await boardCanvas()) });

  await expect(view.locator('.w-title')).toHaveText('Tokyo noir, 1974');
  await expect(view.locator('.w-meta')).toHaveText('33 cards · 26 pictures');
  await expect(view.locator('.b-it')).toHaveCount(33);
  await expect(view.locator('.b-label')).toHaveText(['Streets', 'Interiors', 'Faces', 'Light']);
  await expect(view.getByRole('button', { name: 'Note: Sodium vapour, never daylight.' })).toBeVisible();
  await expect(view.locator('[data-id="p1"] .b-sw')).toHaveCount(5);
  await expect(view.locator('[data-id="p1"] .b-sw').first()).toHaveCSS('background-color', 'rgb(11, 26, 46)');
  await expect.poll(() => loadedPictures(view)).toBe(26);

  // Said hello as the spec has it, then told the host how tall it is.
  const said = await page.evaluate(() => window.__host.log.filter((m) => m.from === 'view').map((m) => m.method));
  expect(said.slice(0, 2)).toEqual(['ui/initialize', 'ui/notifications/initialized']);
  expect(await lastSent(page, 'ui/initialize')).toMatchObject({
    protocolVersion: '2026-01-26', appInfo: { name: 'clusters-board-view' },
  });
  await expect.poll(async () => {
    const size = await lastSent(page, 'ui/notifications/size-changed');
    const framed = await page.locator('#view').evaluate((f) => f.getBoundingClientRect().height);
    return Boolean(size) && size.height > 300 && Math.abs(size.height - framed) < 1;
  }).toBe(true);
});

test('picking cards tells the model, and Ask about these asks in the chat', async ({ page }) => {
  const view = await open(page, { result: answer(await boardCanvas()) });
  await expect(view.locator('.b-it')).toHaveCount(33);

  await view.locator('[data-id="i2"]').click();
  await view.locator('[data-id="n1"]').click();
  await expect(view.locator('[data-id="i2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('[data-id="n1"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(view.locator('footer')).toContainText('2 selected');
  await expect.poll(async () => (await lastSent(page, 'ui/update-model-context'))?.content?.[0]?.text ?? '')
    .toContain(`(board ${BOARD}) the person has picked “Streets 2” (picture)`);
  expect((await lastSent(page, 'ui/update-model-context')).content[0].text).toMatch(/\(cards i2, n1\)\.$/);

  await view.getByRole('button', { name: 'Ask about these' }).click();
  await expect.poll(() => sent(page, 'ui/message')).toHaveLength(1);
  const [ask] = await sent(page, 'ui/message');
  expect(ask.role).toBe('user');
  expect(ask.content).toHaveLength(1);
  expect(ask.content[0].type).toBe('text');
  expect(ask.content[0].text).toMatch(/^About these 2 on “Tokyo noir, 1974”: “Streets 2” \(picture\), /);
  expect(ask.content[0].text).toContain(`(board ${BOARD}; cards i2, n1)`);

  // Escape lets them go, and the model hears that nothing is picked.
  await page.keyboard.press('Escape');
  await expect(view.locator('[data-id="i2"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(view.locator('footer')).not.toContainText('selected');
  await expect.poll(async () => (await lastSent(page, 'ui/update-model-context'))?.content).toEqual([]);
  // Picking never opened anything.
  expect(await sent(page, 'ui/open-link')).toEqual([]);
});

test('Open in Clusters opens the board', async ({ page }) => {
  const view = await open(page, { result: answer(await boardCanvas()) });
  await view.getByRole('button', { name: 'Open in Clusters' }).click();
  await expect.poll(() => sent(page, 'ui/open-link')).toEqual([{ url: `${ORIGIN}/?to=b:${BOARD}` }]);
});

test('a draft offers Keep it free, which opens its keep link', async ({ page }) => {
  const keep = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e';
  const result = draftAnswer(answer(await boardCanvas()), {
    origin: ORIGIN, tokens: { key: `dk_${'a'.repeat(43)}`, keep }, expiresAt: '2026-11-26T10:00:00.000Z', created: true,
  });
  const view = await open(page, { result });
  await expect(view.locator('.w-meta')).toHaveText('33 cards · 26 pictures · free draft · keep it by 26 Nov');
  await expect(view.getByRole('button', { name: 'Open in Clusters' })).toHaveCount(0);
  await view.getByRole('button', { name: 'Keep it free' }).click();
  await expect.poll(() => sent(page, 'ui/open-link')).toEqual([{ url: `${ORIGIN}/keep/${keep}?b=${BOARD}` }]);
});

test('words are drawn as words, and nothing loads or opens outside Clusters', async ({ page }) => {
  const canvas = await boardCanvas();
  canvas.board.url = 'https://evil.example/?to=b:x';
  canvas.cards.find((c) => c.id === 'n2').text = '<img src="https://evil.example/n.png" onerror="alert(1)">';
  canvas.cards.find((c) => c.id === 'i1').picture.url = 'https://evil.example/i1.png';
  const asked = [];
  await page.route('https://evil.example/**', (r) => { asked.push(r.request().url()); return r.abort(); });
  page.on('dialog', (d) => { asked.push(`dialog ${d.message()}`); return d.dismiss(); });

  const view = await open(page, { result: answer(canvas) });
  await expect.poll(() => loadedPictures(view)).toBe(25);
  await expect(view.locator('[data-id="n2"]')).toContainText('<img src="https://evil.example/n.png"');
  await expect(view.locator('img[src*="evil"]')).toHaveCount(0);
  // A board whose link isn't Clusters' gets no way to open it.
  await expect(view.getByRole('button', { name: 'Open in Clusters' })).toHaveCount(0);
  await expect(view.getByRole('button', { name: 'View all' })).toBeVisible();
  expect(asked).toEqual([]);
});

test('View all goes full screen, where the board zooms and pans', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const view = await open(page, { result: answer(await boardCanvas()) });
  await view.getByRole('button', { name: 'View all' }).click();
  await expect.poll(() => sent(page, 'ui/request-display-mode')).toEqual([{ mode: 'fullscreen' }]);
  await expect(view.locator('html')).toHaveClass(/is-full/);
  // The board's action moves to the head; the frame is the host's to size now.
  await expect(view.locator('header').getByRole('button', { name: 'Open in Clusters' })).toBeVisible();
  const pct = view.locator('.b-pct');
  await expect(pct).toBeVisible();
  const sizes = (await sent(page, 'ui/notifications/size-changed')).length;
  const fitted = parseInt(await pct.textContent(), 10);

  await view.getByRole('button', { name: 'Zoom in' }).click();
  await view.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => parseInt(await pct.textContent(), 10)).toBeGreaterThan(fitted * 1.5);
  await page.keyboard.press('-');
  await expect.poll(async () => parseInt(await pct.textContent(), 10)).toBeLessThan(fitted * 1.4);
  await view.getByRole('button', { name: 'Fit the board' }).click();
  await expect(pct).toHaveText(`${fitted}%`);

  // A drag pans, even one that starts on a card, and doesn't pick it.
  const world = view.locator('.b-world');
  const before = await world.evaluate((w) => w.style.transform);
  const card = view.locator('[data-id="i5"]');
  const box = await card.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => world.evaluate((w) => w.style.transform)).not.toBe(before);
  await expect(card).toHaveAttribute('aria-pressed', 'false');
  await expect(view.locator('footer')).not.toContainText('selected');

  expect((await sent(page, 'ui/notifications/size-changed')).length).toBe(sizes);
});

test('pictures whose addresses ran out are asked for again, through the tool', async ({ page }) => {
  const view = await open(page, {
    result: answer(await boardCanvas({ expiresIn: -10 })),
    refresh: answer(await boardCanvas()),
  });
  await expect.poll(() => sent(page, 'tools/call')).toEqual([{ name: 'show_board', arguments: { board_id: BOARD } }]);
  await expect.poll(() => loadedPictures(view)).toBe(26);
  await expect(view.locator('.x-over')).toBeHidden();
});

test('when fresh pictures can\'t be had, it says so and can try again', async ({ page }) => {
  const view = await open(page, { result: answer(await boardCanvas({ expiresIn: -10 })) });
  await expect(view.locator('.x-over')).toContainText('The pictures didn’t load.');
  await view.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => page.evaluate(() => window.__host.refreshes)).toBe(2);
  await expect(view.locator('.x-over')).toContainText('The pictures didn’t load.');
  expect(await loadedPictures(view)).toBe(0);
  // The board itself is still drawn, in its tones.
  await expect(view.locator('.b-it')).toHaveCount(33);
});

test('a host that drops _meta still gets the board, through the tool', async ({ page }) => {
  const { _meta, ...bare } = answer(await boardCanvas());
  const view = await open(page, { result: bare, refresh: answer(await boardCanvas()) });
  await expect.poll(() => sent(page, 'tools/call')).toHaveLength(1);
  await expect(view.locator('.b-it')).toHaveCount(33);
  await expect(view.locator('.w-msg')).toBeHidden();
});

test('without _meta or the tool, it shows what the model got and a way in', async ({ page }) => {
  const { _meta, ...bare } = answer(await boardCanvas());
  const view = await open(page, { result: bare, caps: { openLinks: {} } });
  await expect(view.locator('.w-title')).toHaveText('Tokyo noir, 1974');
  await expect(view.locator('.w-meta')).toHaveText('33 cards · 26 pictures');
  await expect(view.locator('.w-msg')).toHaveText('Open it in Clusters to see it.');
  await view.getByRole('button', { name: 'Open in Clusters' }).click();
  await expect.poll(() => sent(page, 'ui/open-link')).toEqual([{ url: `${ORIGIN}/?to=b:${BOARD}` }]);
  expect(await sent(page, 'tools/call')).toEqual([]);
});

test('says what went wrong, a stop, and an empty board', async ({ page }) => {
  let view = await open(page, {
    result: { isError: true, content: [{ type: 'text', text: 'Error: Board not found, or you can\'t see it.\nTry search.' }] },
  });
  await expect(view.locator('.w-msg')).toHaveText('Board not found, or you can\'t see it.');
  await expect(view.locator('.w-title')).toHaveText('Clusters');
  await expect(view.locator('.b-stage')).toBeHidden();

  view = await open(page, { result: null });
  await expect.poll(() => sent(page, 'ui/notifications/initialized')).toHaveLength(1);
  await page.evaluate(() => window.__host.notify('ui/notifications/tool-cancelled', { reason: 'Stopped' }));
  await expect(view.locator('.w-msg')).toHaveText('Stopped before the board was shown.');

  const canvas = await boardCanvas();
  const empty = { ...canvas, board: { ...canvas.board, card_count: 0 }, bounds: null, cards: [], groups: [], picture_count: 0 };
  view = await open(page, { result: answer(empty) });
  await expect(view.locator('.w-msg')).toHaveText('Nothing on this board yet.');
  await expect(view.locator('.w-meta')).toHaveText('0 cards');
  await expect(view.getByRole('button', { name: 'Open in Clusters' })).toBeVisible();
  await expect(view.getByRole('button', { name: 'View all' })).toHaveCount(0);
});

test('wears the host\'s theme, variables and fonts', async ({ page }) => {
  const view = await open(page, {
    result: answer(await boardCanvas()),
    context: {
      ...CONTEXT,
      theme: 'dark',
      styles: {
        variables: { '--color-background-primary': '#123456', 'not a variable': 'red' },
        css: { fonts: '@font-face { font-family: Host; src: local(Arial); }' },
      },
    },
  });
  await expect(view.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => view.locator('html').evaluate(
    (h) => getComputedStyle(h).getPropertyValue('--color-background-primary').trim(),
  )).toBe('#123456');
  await expect(view.locator('#__mcp-host-fonts')).toHaveCount(1);
});

test('on a phone the buttons take a finger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const view = await open(page, { result: answer(await boardCanvas()), width: 360 });
  for (const name of ['Open in Clusters', 'View all']) {
    const box = await view.getByRole('button', { name }).boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});
