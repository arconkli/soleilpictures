// POST /api/make/keep, driven end to end against a fake Supabase and a fake
// picture host: the real route, the real API routes it calls as the person,
// and the board it writes read back out of the stored document — which must
// be the board the page showed (lib/makeBoard.js), card for card.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { handleMakeKeep, readPictureSizes } from '../worker-make.js';
import { parseMakeFragment, makeLinkFor } from './makeLink.js';
import { composeMakeBoard } from './makeBoard.js';
import { b64ToBytes, readCards, readGroups } from './yhelpers.js';

const ORIGIN = 'https://clusters.test';
const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';
const ROOT = '33333333-3333-4333-8333-333333333333';

// A PNG's first 33 bytes: enough for its size to be read.
function png(width, height) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

let boards;        // id → { row, doc }
let roles;         // workspace id → role
let capacity;      // { is_capped, cap, used }
let pictures;      // url → { width, height } | number (a status to answer)
let stored;        // R2 keys put
let calls;
const realFetch = globalThis.fetch;
const realWebSocket = globalThis.WebSocket;

class NoRoom {
  constructor() { setTimeout(() => this._err?.(), 0); }
  addEventListener(type, fn) { if (type === 'error') this._err = fn; }
  close() {}
}

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const eqOf = (q, key) => (q.get(key) || '').replace(/^eq\./, '');

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  IMAGES: { put: async (key) => { stored.push(key); } },
};

beforeEach(() => {
  boards = new Map([[ROOT, { row: { id: ROOT, workspace_id: W1, parent_board_id: null, deleted_at: null, name: 'Root' }, doc: null }]]);
  roles = { [W1]: 'owner' };
  capacity = { is_capped: true, cap: 50, used: 0 };
  pictures = {};
  stored = [];
  calls = [];
  globalThis.WebSocket = NoRoom;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    if (u.hostname !== 'db.test') {
      const p = pictures[u.href];
      if (p == null) return new Response('nope', { status: 404 });
      if (typeof p === 'number') return new Response('nope', { status: p });
      return new Response(png(p.width, p.height), { headers: { 'content-type': 'image/png' } });
    }
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    calls.push({ method, path, body, query: u.searchParams });
    if (u.pathname === '/auth/v1/user') {
      const who = String(init.headers?.authorization || '').replace(/^Bearer /, '');
      return who === 'jwt-u1' ? reply({ id: 'u1', email: 'someone@example.com' }) : reply({}, 401);
    }
    if (path === 'rpc/get_or_create_personal_workspace') return reply([{ id: W1 }]);
    if (path === 'rpc/get_board_capacity') return reply([capacity]);
    if (path === 'rpc/can_write_board') return reply(boards.has(body.p_board_id));
    if (path === 'rpc/authorize_image_upload') return reply([{ allow: true }]);
    if (path === 'rpc/record_upload_intent') return reply(true);
    if (path === 'workspace_members') {
      const role = roles[eqOf(u.searchParams, 'workspace_id')];
      return reply(role ? [{ role }] : []);
    }
    if (path === 'boards' && method === 'GET') {
      const id = eqOf(u.searchParams, 'id');
      const ws = eqOf(u.searchParams, 'workspace_id');
      const rows = [...boards.values()].map((b) => b.row)
        .filter((r) => (!id || r.id === id) && (!ws || r.workspace_id === ws)
          && (u.searchParams.get('parent_board_id') !== 'is.null' || r.parent_board_id === null));
      return reply(rows);
    }
    if (path === 'boards' && method === 'POST') {
      for (const r of body) boards.set(r.id, { row: { deleted_at: null, ...r }, doc: null });
      return reply(undefined, 201);
    }
    if (path === 'board_state' && method === 'GET') {
      const id = eqOf(u.searchParams, 'board_id');
      return reply(boards.get(id)?.doc ? [{ doc: boards.get(id).doc }] : []);
    }
    if (path === 'board_state' && method === 'POST') {
      for (const r of body) if (boards.has(r.board_id)) boards.get(r.board_id).doc = r.doc;
      return reply(undefined, 201);
    }
    if (path === 'rpc/soft_delete_board') {
      const b = boards.get(body.p_board_id);
      if (b) b.row.deleted_at = '2026-10-28T00:00:00Z';
      return reply(null);
    }
    if (path.startsWith('rpc/')) return reply(null);
    return reply(method === 'GET' ? [] : null);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWebSocket;
});

// Each request from an address of its own, but where a test names one: the
// limit per address is held per isolate here, across the tests.
let nextIp = 0;
async function keep(body, { token = 'jwt-u1', ip = `198.51.100.${(nextIp += 1) % 250}` } = {}) {
  const url = new URL(`${ORIGIN}/api/make/keep`);
  const req = new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', 'cf-connecting-ip': ip,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const res = await handleMakeKeep(url, req, ENV, null);
  return { status: res.status, body: await res.json() };
}

function docOf(id) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, b64ToBytes(boards.get(id).doc));
  return { cards: readCards(doc), groups: readGroups(doc) };
}

const LINK = makeLinkFor({
  title: 'Tokyo noir',
  sections: [
    { name: 'Look', color: null, items: [
      { kind: 'picture', url: 'https://pics.example.com/1.png', caption: 'Wet street' },
      { kind: 'picture', url: 'https://pics.example.com/2.png', caption: null },
      { kind: 'picture', url: 'https://pics.example.com/3.png', caption: null },
      { kind: 'palette', title: 'Night', swatches: [{ hex: '#101820', name: 'Ink' }, { hex: '#f2aa4c', name: 'Sodium' }] },
    ] },
    { name: 'Story', color: null, items: [
      { kind: 'note', title: 'Logline', body: 'A night-shift cabbie and a singer.' },
      { kind: 'note', title: 'Characters', body: '- Kenji\n- Mariko' },
    ] },
  ],
});
const SIZES = [{ width: 1600, height: 1067 }, { width: 1000, height: 1500 }, { width: 1200, height: 800 }];
const fragment = LINK.slice(LINK.indexOf('#') + 1);

function serveAll() {
  SIZES.forEach((d, i) => { pictures[`https://pics.example.com/${i + 1}.png`] = d; });
}

test('keeping writes the board the page showed, card for card, under the workspace root', async () => {
  serveAll();
  const r = await keep({ source: fragment, kind: 'link', pictures: SIZES });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.cards, 6);
  assert.equal(r.body.pictures_failed, 0);
  assert.equal(r.body.room_left, 44);
  const id = r.body.board.id;
  assert.equal(r.body.board.url, `${ORIGIN}/?to=b:${id}`);
  assert.deepEqual(boards.get(id).row.parent_board_id, ROOT);
  assert.equal(boards.get(id).row.workspace_id, W1);
  assert.equal(boards.get(id).row.name, 'Tokyo noir');
  assert.equal(stored.length, 3);

  const shown = composeMakeBoard(parseMakeFragment(fragment), { pictures: SIZES });
  const { cards, groups } = docOf(id);
  assert.equal(cards.length, shown.cards.length);
  const byPlace = (list) => [...list].sort((a, b) => a.y - b.y || a.x - b.x);
  const got = byPlace(cards);
  byPlace(shown.cards).forEach((want, i) => {
    for (const k of ['kind', 'x', 'y', 'w', 'h', 'title', 'body', 'caption', 'html', 'swatches']) {
      assert.deepEqual(got[i][k], want[k], `${want.id}.${k}`);
    }
    if (want.kind === 'note') assert.equal(got[i].bgColor ?? null, want.bgColor);
    if (want.kind === 'image') assert.match(got[i].src, new RegExp(`^r2:${W1}/`));
  });
  assert.deepEqual(groups.map((g) => [g.name, g.color]).sort(), shown.groups.map((g) => [g.name, g.color]).sort());
});

test('a new account keeps into a workspace made for it', async () => {
  serveAll();
  const r = await keep({ source: fragment, kind: 'link', pictures: SIZES });
  assert.equal(r.status, 201);
  assert.ok(calls.some((c) => c.path === 'rpc/get_or_create_personal_workspace'));
});

test('signed out, or with a session that isn\'t one, nothing is made', async () => {
  for (const token of [null, 'jwt-stranger']) {
    const r = await keep({ source: fragment, pictures: SIZES }, { token });
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'unauthorized');
  }
  assert.equal(boards.size, 1);
});

test('over the card cap nothing is made until the person says to keep what fits', async () => {
  serveAll();
  capacity = { is_capped: true, cap: 50, used: 46 };
  const r = await keep({ source: fragment, pictures: SIZES });
  assert.equal(r.status, 402);
  assert.deepEqual([r.body.code, r.body.room, r.body.needed], ['limit_reached', 4, 6]);
  assert.equal(boards.size, 1);
  assert.equal(stored.length, 0);

  const fit = await keep({ source: fragment, pictures: SIZES, fit: true });
  assert.equal(fit.status, 201, JSON.stringify(fit.body));
  assert.equal(fit.body.cards, 4);
  assert.equal(fit.body.over, 2);
  assert.equal(fit.body.room_left, 0);
  // The first four: three pictures and the palette; the notes didn't fit.
  assert.deepEqual(docOf(fit.body.board.id).cards.map((c) => c.kind).sort(), ['image', 'image', 'image', 'palette']);

  capacity = { is_capped: true, cap: 50, used: 50 };
  const full = await keep({ source: fragment, pictures: SIZES, fit: true });
  assert.equal(full.status, 402);
});

test('a picture the page showed that can\'t be fetched now is left out, and the board laid out without it', async () => {
  serveAll();
  pictures['https://pics.example.com/2.png'] = 404;
  const r = await keep({ source: fragment, pictures: SIZES });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.cards, 5);
  assert.equal(r.body.pictures_failed, 1);
  const shown = composeMakeBoard(parseMakeFragment(fragment), { pictures: [SIZES[0], null, SIZES[2]] });
  const { cards } = docOf(r.body.board.id);
  const boxes = (list) => list.map((c) => [c.kind, c.x, c.y, c.w, c.h]).sort();
  assert.deepEqual(boxes(cards), boxes(shown.cards));
});

test('one the page couldn\'t show isn\'t fetched at all', async () => {
  serveAll();
  const r = await keep({ source: fragment, pictures: [SIZES[0], null, SIZES[2]] });
  assert.equal(r.status, 201);
  assert.equal(r.body.cards, 5);
  assert.equal(r.body.pictures_failed, 0);
  assert.equal(stored.length, 2);
});

test('a workspace the person can\'t add clusters to is refused', async () => {
  serveAll();
  roles[W2] = 'viewer';
  boards.set('44444444-4444-4444-8444-444444444444', { row: { id: '44444444-4444-4444-8444-444444444444', workspace_id: W2, parent_board_id: null, deleted_at: null }, doc: null });
  const r = await keep({ source: fragment, pictures: SIZES, workspace_id: W2 });
  assert.equal(r.status, 403);
  const none = await keep({ source: fragment, pictures: SIZES, workspace_id: '55555555-5555-4555-8555-555555555555' });
  assert.equal(none.status, 403);
  roles[W2] = 'editor';
  const ok = await keep({ source: fragment, pictures: SIZES, workspace_id: W2 });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.workspace_id, W2);
});

test('nothing to keep, or no body, is a 400; GET is a 405', async () => {
  assert.equal((await keep({ source: 'title=Only%20a%20title' })).status, 400);
  assert.equal((await keep({ nope: 1 })).status, 400);
  const url = new URL(`${ORIGIN}/api/make/keep`);
  const res = await handleMakeKeep(url, new Request(url), ENV, null);
  assert.equal(res.status, 405);
});

test('text pasted at /make keeps the same way', async () => {
  pictures['https://pics.example.com/a.png'] = { width: 800, height: 600 };
  const r = await keep({
    source: '# Pasted\n\n## Look\n![A](https://pics.example.com/a.png)\n\n## Words\n### Note\nHello.',
    kind: 'text', pictures: [{ width: 800, height: 600 }],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.board.name, 'Pasted');
  assert.equal(r.body.cards, 2);
});

test('keeping is limited per address', async () => {
  serveAll();
  const ip = '203.0.113.9';
  const answers = [];
  for (let i = 0; i < 11; i++) answers.push((await keep({ source: 'note=x' }, { ip })).status);
  assert.deepEqual(answers.slice(0, 10).filter((s) => s === 201).length, 10);
  assert.equal(answers[10], 429);
});

test('picture sizes from the page are read defensively', () => {
  assert.deepEqual(readPictureSizes([{ width: 10.4, height: 20 }, { width: -1, height: 5 }, 'x', null], 5),
    [{ width: 10, height: 20 }, null, null, null, null]);
  assert.deepEqual(readPictureSizes('nope', 2), [null, null]);
  assert.deepEqual(readPictureSizes([{ width: 1e9, height: 1 }], 1), [null]);
});
