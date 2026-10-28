// The inline view (boards/mcp-app/, an MCP App show_board opens in ChatGPT
// and Claude): that the page served is the page in the source, that it stays
// small, that it only ever fetches the pictures it was handed and writes
// people's words as text, that it speaks the protocol as hosts expect, and
// the arithmetic and words it draws with.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { MCP_APP_HTML } from './mcpAppHtml.generated.js';
import { BOARD_VIEW } from './mcpTools.js';
import { draftAnswer } from './mcpDrafts.js';
import { buildPage, moduleText, OUT } from '../../scripts/build-mcp-app.mjs';
import { createBridge, PROTOCOL_VERSION } from '../../mcp-app/src/bridge.js';
import {
  VIEW_KEYS, ORIGINS, drawAs, fitScale, inlineStage, centred, ZOOM, zoomAbout, metaLine, askText,
  selectionContext, safeUrl, safeColour, picturesExpired, cardWords,
} from '../../mcp-app/src/layout.js';

const SRC = fileURLToPath(new URL('../../mcp-app/src/', import.meta.url));

// ── The page ─────────────────────────────────────────────────────────────────

test('the page served is the page the source builds (npm run mcp-app:build)', async () => {
  assert.equal(readFileSync(OUT, 'utf8'), moduleText(await buildPage()),
    'src/lib/mcpAppHtml.generated.js is stale: run `npm run mcp-app:build` and commit it.');
});

test('the page stays small: one host frame, read once per conversation', () => {
  const raw = Buffer.byteLength(MCP_APP_HTML);
  const br = brotliCompressSync(Buffer.from(MCP_APP_HTML)).length;
  // About 32 KB and 10 KB today. A dependency pulled in by mistake (the MCP
  // Apps SDK alone is over 300 KB) would blow through both.
  assert.ok(raw <= 48 * 1024, `${raw} bytes`);
  assert.ok(br <= 16 * 1024, `${br} bytes compressed`);
});

test('the page loads nothing of its own: no script, sheet or frame from anywhere', () => {
  assert.match(MCP_APP_HTML, /^<!doctype html>/);
  assert.doesNotMatch(MCP_APP_HTML, /<script[^>]+src=|<link\b|<iframe|<object|<embed|@import/i);
  // The addresses it names are where pictures come from and links go, and SVG's namespace.
  const urls = new Set(MCP_APP_HTML.match(/https?:\/\/[a-z0-9.-]+(?::\d+)?/gi) || []);
  for (const u of urls) {
    assert.ok(ORIGINS.includes(u) || u === 'http://www.w3.org', `the page names ${u}`);
  }
});

test('people\'s words go in as text, and nothing is fetched, stored or evaluated', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));
  assert.deepEqual(files.sort(), ['bridge.js', 'layout.js', 'main.js']);
  for (const f of files) {
    const code = readFileSync(join(SRC, f), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const banned of [/\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /\beval\(/,
      /new Function/, /\bfetch\(/, /XMLHttpRequest/, /localStorage/, /sessionStorage/, /\.cookie\b/, /window\.open\(/,
      /location\.(href|assign|replace)/]) {
      assert.doesNotMatch(code, banned, `${f} uses ${banned}`);
    }
  }
  // Every link it opens is checked against Clusters' origins first, over the
  // bridge or through ChatGPT's own openExternal.
  const main = readFileSync(join(SRC, 'main.js'), 'utf8');
  assert.equal([...main.matchAll(/'ui\/open-link'/g)].length, 1, 'one place opens links');
  assert.equal([...main.matchAll(/openExternal\(/g)].length, 1, 'and one through ChatGPT');
  const openLink = main.match(/function openLink\(url\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(openLink, /^function openLink\(url\) \{\s*const safe = safeUrl\(url\);\s*if \(!safe\) return;/);
  assert.match(openLink, /'ui\/open-link', \{ url: safe \}/);
  assert.match(openLink, /openExternal\(\{ href: safe, redirectUrl: false \}\)/);
});

test('the view reads the answer where the server writes it', () => {
  assert.equal(VIEW_KEYS.canvas, BOARD_VIEW.metaKey);
  const out = draftAnswer({ content: [] }, {
    origin: 'https://clusters.test', tokens: { key: 'dk_x', keep: '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e' }, expiresAt: 'x', created: false,
  });
  assert.ok(out._meta[VIEW_KEYS.draft], 'the draft\'s keep link');
  assert.equal(out._meta[VIEW_KEYS.draft].keep_url, 'https://clusters.test/keep/0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e');
  assert.deepEqual(ORIGINS, ['https://clusters.soleilpictures.com', 'https://main-soleil-boards.arconkli.workers.dev']);
});

// ── Speaking to the host ─────────────────────────────────────────────────────

// A host frame and the view's window, in memory.
function fakeFrame() {
  const sent = [];
  const handlers = [];
  const host = { postMessage: (msg, target) => sent.push({ msg, target }) };
  const win = { addEventListener: (type, fn) => { if (type === 'message') handlers.push(fn); } };
  const deliver = (data, source = host) => handlers.forEach((fn) => fn({ source, data }));
  return { sent, host, win, deliver };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('the view says hello as hosts expect, then that it is ready', async () => {
  const f = fakeFrame();
  const bridge = createBridge({ host: f.host, win: f.win, appInfo: { name: 'v', version: '1' }, appCapabilities: { availableDisplayModes: ['inline'] } });
  const connected = bridge.connect();
  assert.equal(f.sent.length, 1);
  const [{ msg: hello, target }] = f.sent;
  assert.equal(target, '*', 'a sandboxed frame has no origin to name');
  assert.equal(hello.method, 'ui/initialize');
  assert.equal(PROTOCOL_VERSION, '2026-01-26');
  assert.deepEqual(hello.params, {
    appInfo: { name: 'v', version: '1' }, appCapabilities: { availableDisplayModes: ['inline'] }, protocolVersion: '2026-01-26',
  });
  // Nothing more until the host answers, and then the notification, no params.
  f.deliver({ jsonrpc: '2.0', id: hello.id, result: { hostCapabilities: { message: {} }, hostContext: { theme: 'dark' } } });
  const init = await connected;
  assert.deepEqual(init.hostContext, { theme: 'dark' });
  assert.deepEqual(f.sent[1].msg, { jsonrpc: '2.0', method: 'ui/notifications/initialized' });
});

test('the view hears only its own host, answers what a host may ask, and refuses the rest', async () => {
  const f = fakeFrame();
  const bridge = createBridge({ host: f.host, win: f.win, appInfo: {} });
  const heard = [];
  bridge.on('ui/notifications/tool-result', (p) => heard.push(p));
  let tornDown = false;
  bridge.on('ui/resource-teardown', async () => { tornDown = true; });

  f.deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { forged: true } }, { postMessage() {} });
  f.deliver({ method: 'ui/notifications/tool-result', params: { notJsonRpc: true } });
  f.deliver('ui/notifications/tool-result');
  f.deliver({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [] } });
  assert.deepEqual(heard, [{ content: [] }], 'another window, or not JSON-RPC, is not the host');

  f.deliver({ jsonrpc: '2.0', id: 7, method: 'ui/resource-teardown', params: {} });
  f.deliver({ jsonrpc: '2.0', id: 8, method: 'ping' });
  f.deliver({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'x' } });
  await tick();
  assert.equal(tornDown, true);
  const replies = f.sent.map((s) => s.msg);
  assert.deepEqual(replies.find((m) => m.id === 7), { jsonrpc: '2.0', id: 7, result: {} });
  assert.deepEqual(replies.find((m) => m.id === 8), { jsonrpc: '2.0', id: 8, result: {} });
  assert.equal(replies.find((m) => m.id === 9).error.code, -32601);
});

test('a request the host refuses or never answers fails, rather than hanging', async () => {
  const f = fakeFrame();
  const bridge = createBridge({ host: f.host, win: f.win, appInfo: {}, timeoutMs: 20 });
  const refused = bridge.request('ui/open-link', { url: 'https://clusters.soleilpictures.com/' });
  f.deliver({ jsonrpc: '2.0', id: f.sent[0].msg.id, error: { code: -32000, message: 'no links' } });
  await assert.rejects(refused, (e) => e.code === -32000 && /no links/.test(e.message));
  await assert.rejects(bridge.request('ui/message', { role: 'user', content: [] }), /no answer/);
  // A late answer to a request already given up on is dropped.
  f.deliver({ jsonrpc: '2.0', id: f.sent[1].msg.id, result: {} });
});

// ── Drawing ──────────────────────────────────────────────────────────────────

test('what each card is drawn as', () => {
  assert.equal(drawAs({ kind: 'image', picture: {} }), 'pic');
  assert.equal(drawAs({ kind: 'board', picture: { url: 'x' } }), 'pic');
  assert.equal(drawAs({ kind: 'image' }), 'file', 'a picture the caller can\'t see is a file');
  assert.equal(drawAs({ kind: 'note' }), 'note');
  assert.equal(drawAs({ kind: 'palette' }), 'pal');
  assert.equal(drawAs({ kind: 'boardlink' }), 'board');
  assert.equal(drawAs({ kind: 'grid' }), 'card');
});

test('a board fits the stage: whole, centred, never drawn larger than itself', () => {
  const b = { x: 100, y: 50, w: 2000, h: 1000 };
  assert.equal(fitScale(b, 654, 400, 14), (654 - 28) / 2000);
  assert.equal(fitScale({ x: 0, y: 0, w: 100, h: 50 }, 654, 400, 14), 1, 'a few small cards keep their size');
  assert.equal(fitScale(null, 654, 400, 14), 1);
  assert.equal(fitScale({ x: 0, y: 0, w: 1e9, h: 1 }, 654, 400, 14), 0.01);

  const wide = inlineStage(b, 654);
  assert.equal(wide.height, Math.round(1000 * ((654 - 28) / 2000) + 28));
  assert.equal(wide.scale, (654 - 28) / 2000);
  const tall = inlineStage({ x: 0, y: 0, w: 500, h: 5000 }, 654);
  assert.equal(tall.height, 520, 'a tall board is fitted to the height');
  assert.ok(tall.scale * 5000 <= 520 - 28 + 1e-9);
  assert.equal(inlineStage({ x: 0, y: 0, w: 2000, h: 20 }, 654).height, 160, 'and a thin one keeps some stage');
  assert.equal(inlineStage(b, 654, { maxHeight: 200 }).height, 200);

  const at = centred(b, 654, 400, 0.25);
  assert.deepEqual(at, { x: (654 - 500) / 2 - 25, y: (400 - 250) / 2 - 12.5 });
});

test('zooming keeps the point under the pointer still, within limits', () => {
  const v = { scale: 0.5, x: 10, y: 20 };
  const z = zoomAbout(v, 2, 110, 220);
  assert.equal(z.scale, 1);
  // The board point under (110, 220) before is under it after.
  const before = { x: (110 - v.x) / v.scale, y: (220 - v.y) / v.scale };
  assert.deepEqual({ x: (110 - z.x) / z.scale, y: (220 - z.y) / z.scale }, before);
  assert.equal(zoomAbout(v, 1000, 0, 0).scale, ZOOM.max);
  assert.equal(zoomAbout(v, 1e-6, 0, 0).scale, ZOOM.min);
});

test('the line under the board\'s name', () => {
  const canvas = { board: { card_count: 33 }, picture_count: 26, hidden: 0 };
  assert.equal(metaLine(canvas, null, 'en-GB'), '33 cards · 26 pictures');
  assert.equal(metaLine({ board: { card_count: 1 }, picture_count: 1 }, null), '1 card · 1 picture');
  assert.equal(metaLine({ board: { card_count: 4 }, picture_count: 0 }, null), '4 cards');
  assert.equal(metaLine({ board: { card_count: 412 }, picture_count: 80, hidden: 12 }, null), '412 cards · 80 pictures · 12 not shown');
  assert.equal(metaLine(canvas, { expires_at: '2026-11-25T10:00:00Z' }, 'en-GB'), '33 cards · 26 pictures · free draft · keep it by 25 Nov');
  assert.equal(metaLine(canvas, { expires_at: 'garbage' }, 'en-GB'), '33 cards · 26 pictures · free draft');
  assert.match(metaLine(canvas, { expires_at: '2026-11-25T10:00:00Z' }, 'not a locale!'), /keep it by/);
});

test('asking about picked cards names them, with the ids a model needs', () => {
  const board = { id: 'b1', name: 'Tokyo noir, 1974' };
  const cards = [
    { id: 'i2', kind: 'image', title: 'Streets 2' },
    { id: 'n1', kind: 'note' },
  ];
  assert.equal(askText(board, cards),
    'About these 2 on “Tokyo noir, 1974”: “Streets 2” (picture), a note. (board b1; cards i2, n1)');
  assert.equal(askText(board, cards.slice(0, 1)), 'About this on “Tokyo noir, 1974”: “Streets 2” (picture). (board b1; cards i2)');
  const many = Array.from({ length: 15 }, (_, i) => ({ id: `c${i}`, kind: 'image' }));
  assert.match(askText({ id: 'b1' }, many), /on “Untitled”: (a picture, ){11}a picture, and 3 more\. \(board b1; cards c0, .*c14\)$/);
  assert.equal(selectionContext(board, []), 'Nothing is picked on “Tokyo noir, 1974”.');
  assert.equal(selectionContext(board, cards),
    'On “Tokyo noir, 1974” (board b1) the person has picked “Streets 2” (picture), a note (cards i2, n1).');
  assert.equal(cardWords({ kind: 'mystery' }), 'a card');
});

test('only Clusters\' own addresses are opened or loaded, and only hex colours drawn', () => {
  assert.equal(safeUrl('https://clusters.soleilpictures.com/?to=b:1'), 'https://clusters.soleilpictures.com/?to=b:1');
  assert.equal(safeUrl('https://main-soleil-boards.arconkli.workers.dev/api/img/a.b'), 'https://main-soleil-boards.arconkli.workers.dev/api/img/a.b');
  assert.equal(safeUrl('http://127.0.0.1:5999/api/img/a'), 'http://127.0.0.1:5999/api/img/a', 'a test\'s own server');
  for (const bad of ['http://clusters.soleilpictures.com/', 'https://clusters.soleilpictures.com.evil.test/',
    'https://evil.test/?https://clusters.soleilpictures.com', 'javascript:alert(1)', 'data:text/html,x', '//clusters.soleilpictures.com',
    'https://user@evil.test', 42, null]) {
    assert.equal(safeUrl(bad), null, String(bad));
  }
  assert.equal(safeUrl('https://elsewhere.test/a', ['https://elsewhere.test']), 'https://elsewhere.test/a');
  assert.equal(safeColour('#E8A33D'), '#E8A33D');
  for (const bad of ['red', 'url(x)', '#12', '#1234567', 'expression(1)', '', null]) assert.equal(safeColour(bad), null, String(bad));
});

test('pictures are asked for again a minute before their addresses run out', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(picturesExpired({ expires_at: '2026-10-27T13:00:00Z' }, now), false);
  assert.equal(picturesExpired({ expires_at: '2026-10-27T12:00:59Z' }, now), true);
  assert.equal(picturesExpired({ expires_at: '2026-10-27T11:00:00Z' }, now), true);
  assert.equal(picturesExpired({}, now), false, 'no time given is not a time passed');
});
