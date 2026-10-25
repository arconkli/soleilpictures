// Tags through /api/v1 and MCP, end to end: the real handleApiRoute against a
// fake PostgREST holding tags, entity_links and autotag_ignored with their
// policies (members read a workspace's tags, its writers write them; a
// duplicate is a 23505), and a room holding the board's cards and a group.
// What they pin: a workspace's tags and everything one tag is on read as the
// app shows them; a board's tags leave out what is no longer on it; tagging
// writes what the app's Tag… menu writes, in its order (a new name becomes a
// tag that then spreads, a deleted one comes back, a removal stays removed),
// changes nothing the second time, and writes nothing when refused or blind.
//
// Run: node --test src/lib/tagsRoute.test.mjs

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { handleApiRoute } from '../worker-api.js';
import { cardToYMap } from './yhelpers.js';

const ENV = {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'svc',
  PARTY_HOST: 'party.test',
};
const W1 = '99999999-9999-4999-8999-999999999999';
const W2 = '88888888-8888-4888-8888-888888888888';   // not U1's
const B1 = '11111111-1111-4111-8111-111111111111';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let rooms;
let db;          // { tags, entity_links, autotag_ignored }
let canWrite;    // may U1 edit W1
let log;         // every write and RPC, in order
let race;        // a link someone else writes just before ours
let countsDown;
const realFetch = globalThis.fetch;
const RealWS = globalThis.WebSocket;

const reply = (body, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const refused = (table) => reply({ code: '42501', message: `new row violates row-level security policy for table "${table}"` }, 403);
const duplicate = () => reply({ code: '23505', details: 'Key already exists.', hint: null, message: 'duplicate key value violates unique constraint' }, 409);

class FakeRoomSocket {
  constructor(url) {
    this.l = {};
    this.room = rooms.get(decodeURIComponent(/\/parties\/main\/([^?]+)/.exec(url)[1]));
    setTimeout(() => {
      if (!this.room || this.room.down) { this.emit('error'); return; }
      this.open = true;
      this.emit('open');
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      syncProtocol.writeSyncStep1(enc, this.room.doc);
      this.deliver(encoding.toUint8Array(enc));
    }, 0);
  }
  emit(type, evt = {}) { for (const f of [...(this.l[type] || [])]) f(evt); }
  deliver(b) {
    setTimeout(() => { if (this.open) this.emit('message', { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }); }, 0);
  }
  addEventListener(type, fn) { (this.l[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.l[type] = (this.l[type] || []).filter((f) => f !== fn); }
  send(data) {
    const bytes = new Uint8Array(data);
    setTimeout(() => {
      if (!this.open) return;
      const dec = decoding.createDecoder(bytes);
      if (decoding.readVarUint(dec) !== 0) return;
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 0);
      const step = decoding.readVarUint(dec);
      if (step === 0) syncProtocol.readSyncStep1(dec, enc, this.room.doc);
      else if (step === 1) syncProtocol.readSyncStep2(dec, this.room.doc, 'peer');
      else if (step === 2) syncProtocol.readUpdate(dec, this.room.doc, 'peer');
      if (encoding.length(enc) > 1) this.deliver(encoding.toUint8Array(enc));
    }, 0);
  }
  close() { if (!this.open) return; this.open = false; setTimeout(() => this.emit('close'), 0); }
}

// The board: an image, a note, a doc, and a group. Card "gone" was deleted
// from it and kept its tags.
function seedBoard({ down = false } = {}) {
  const doc = new Y.Doc();
  const cards = doc.getMap('cards');
  doc.transact(() => {
    cards.set('c1', cardToYMap({ id: 'c1', kind: 'image', title: 'Booth', x: 0, y: 0, w: 200, h: 200 }));
    cards.set('c2', cardToYMap({ id: 'c2', kind: 'note', title: 'Neon', x: 212, y: 0, w: 300, h: 300 }));
    cards.set('d1', cardToYMap({ id: 'd1', kind: 'doc', title: 'Treatment', x: 0, y: 400, w: 320, h: 240 }));
    doc.getMap('groups').set('g1', { id: 'g1', name: 'Stills' });
  });
  rooms.set(B1, { doc, down });
}

let clock = 0;
const tag = (fields) => {
  const t = {
    id: randomUUID(), workspace_id: W1, color: null, kind: 'user', created_by: U1,
    created_at: `2026-10-0${1 + (clock++ % 9)}T00:00:00Z`, description: null, entity_type: null,
    status: 'active', deleted_at: null, ...fields,
  };
  t.slug = t.name.toLowerCase();
  db.tags.push(t);
  return t;
};
const link = (fields) => {
  const l = {
    id: randomUUID(), source_kind: 'card', source_workspace: W1, source_board_id: B1, source_page_id: null,
    target_kind: 'tag', link_kind: 'applied', source: 'user', created_at: new Date(Date.UTC(2026, 9, 20, 0, clock++)).toISOString(),
    ...fields,
  };
  db.entity_links.push(l);
  return l;
};
const onCard = (t, cardId) => db.entity_links.filter((l) => l.target_id === t.id && l.source_kind === 'card' && l.source_id === cardId);

// PostgREST's filters as these routes use them.
function listOf(v) {
  const inner = v.slice(1, -1);
  const out = [];
  for (let i = 0; i < inner.length;) {
    if (inner[i] === '"') {
      let j = i + 1;
      let s = '';
      while (inner[j] !== '"') { if (inner[j] === '\\') j += 1; s += inner[j]; j += 1; }
      out.push(s);
      i = j + 2;
    } else {
      const j = inner.indexOf(',', i) < 0 ? inner.length : inner.indexOf(',', i);
      out.push(inner.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}
function matches(r, q) {
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const have = r[k] == null ? null : String(r[k]);
    if (v.startsWith('in.(')) { if (!listOf(v.slice(3)).includes(have)) return false; }
    else if (v === 'is.null') { if (have !== null) return false; }
    else if (v.startsWith('neq.')) { if (have === v.slice(4)) return false; }
    else if (v.startsWith('eq.')) { if (have !== v.slice(3)) return false; }
    else throw new Error(`the fake doesn't know ${k}=${v}`);
  }
  return true;
}
function page(rows, q) {
  const order = q.get('order');
  if (order) {
    const keys = order.split(',').map((o) => o.split('.')[0]);
    rows = [...rows].sort((a, b) => {
      for (const k of keys) { const c = String(a[k]).localeCompare(String(b[k])); if (c) return c; }
      return 0;
    });
  }
  const offset = Number(q.get('offset') || 0);
  const limit = q.has('limit') ? Number(q.get('limit')) : Infinity;
  return rows.slice(offset, offset + limit);
}
const sameLink = (a, b) => ['source_kind', 'source_id', 'source_page_id', 'target_kind', 'target_id', 'link_kind']
  .every((k) => (a[k] ?? null) === (b[k] ?? null));

beforeEach(() => {
  rooms = new Map();
  db = { tags: [], entity_links: [], autotag_ignored: [] };
  canWrite = true;
  log = [];
  race = null;
  countsDown = false;
  globalThis.WebSocket = FakeRoomSocket;
  globalThis.fetch = async (input, init = {}) => {
    const u = new URL(typeof input === 'string' ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    const path = u.pathname.replace(/^\/rest\/v1\//, '');
    const q = u.searchParams;
    if (path === 'rpc/api_token_resolve') {
      return reply([{ user_id: U1, token_id: 't1', scopes: ['read', 'write', 'delete'], req_limit: 1000, req_count: 1 }]);
    }
    if (path === 'rpc/api_session_begin') return reply([{ access_token: 'user-jwt' }]);
    if (path === 'boards' && method === 'GET') {
      return reply([...rooms.keys()].filter((id) => q.get('id') === `eq.${id}`).map((id) => ({
        id, name: 'Tokyo noir', workspace_id: W1, parent_board_id: null, view: 'canvas',
        created_at: '2026-10-01T00:00:00Z', updated_at: null, deleted_at: null,
      })));
    }
    if (path === 'workspaces') return reply([{ id: W1, name: 'Studio', created_at: '2026-01-01T00:00:00Z' }]);
    if (path === 'rpc/is_workspace_member') return reply(body.ws === W1);
    if (path === 'rpc/can_write_workspace') return reply(body.ws === W1 && canWrite);
    if (path === 'rpc/tag_item_counts') {
      if (countsDown) return reply({ code: '57014', message: 'canceling statement due to statement timeout' }, 500);
      const n = new Map();
      for (const l of db.entity_links) if (l.link_kind === 'applied') n.set(l.target_id, (n.get(l.target_id) || 0) + 1);
      return reply([...n].map(([tag_id, items]) => ({ tag_id, items })));
    }
    if (path === 'rpc/get_things_tagged') {
      log.push(['get_things_tagged', body.p_limit]);
      const t = db.tags.find((x) => x.id === body.p_tag_id);
      if (!t || t.workspace_id !== W1) return reply([]);
      const titles = { c1: ['image', 'Booth'], c2: ['note', 'Neon'] };
      const rows = db.entity_links.filter((l) => l.target_id === t.id && l.link_kind === 'applied')
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, body.p_limit)
        .filter((l) => l.source_kind !== 'card' || titles[l.source_id])
        .map((l) => (l.source_kind === 'card'
          ? { applied_at: l.created_at, applied_source: l.source, id: `${B1}:${l.source_id}`, kind: titles[l.source_id][0],
            title: titles[l.source_id][1], body: '', board_id: B1, card_id: l.source_id, board_name: 'Tokyo noir',
            card_body: 'Rain on glass', member_count: null, page_id: null }
          : { applied_at: l.created_at, applied_source: l.source, id: l.source_id, kind: 'board', title: 'Tokyo noir',
            board_id: l.source_id, card_id: null, member_count: null, page_id: null }));
      return reply(rows);
    }
    if (path === 'rpc/restore_tag' || path === 'rpc/backfill_tag_applications') {
      log.push([path.slice(4), body.p_tag_id]);
      const t = db.tags.find((x) => x.id === body.p_tag_id);
      if (path === 'rpc/restore_tag' && t?.status === 'deleted') Object.assign(t, { status: 'active', deleted_at: null });
      return reply(0);
    }
    if (path === 'tags') {
      if (method === 'GET') return reply(page(db.tags.filter((t) => t.workspace_id === W1 && matches(t, q)), q));
      if (method === 'POST') {
        log.push(['insert tags', body.map((t) => t.name)]);
        if (!canWrite || body.some((t) => t.workspace_id !== W1)) return refused('tags');
        if (body.some((t) => db.tags.some((x) => x.workspace_id === t.workspace_id && x.slug === t.name.toLowerCase()))) return duplicate();
        return reply(body.map((t) => tag(t)), 201);
      }
    }
    if (path === 'entity_links') {
      if (method === 'GET') return reply(page(db.entity_links.filter((l) => l.source_workspace === W1 && matches(l, q)), q));
      if (!canWrite) return refused('entity_links');
      if (method === 'POST') {
        if (race) { link(race); race = null; }
        log.push(['insert entity_links', body.length]);
        // One statement: a duplicate anywhere and none of it is written.
        if (body.some((r) => db.entity_links.some((l) => sameLink(l, r)))) return duplicate();
        for (const r of body) link(r);
        return reply(undefined, 201);
      }
      if (method === 'DELETE') {
        const gone = db.entity_links.filter((l) => matches(l, q));
        log.push(['delete entity_links', gone.length]);
        db.entity_links = db.entity_links.filter((l) => !gone.includes(l));
        return reply(undefined, 204);
      }
    }
    if (path === 'autotag_ignored') {
      if (!canWrite) return refused('autotag_ignored');
      if (method === 'POST') {
        assert.equal(q.get('on_conflict'), 'workspace_id,target_kind,target_id,tag_id');
        log.push(['upsert autotag_ignored', body.length]);
        for (const r of body) {
          db.autotag_ignored = db.autotag_ignored.filter((x) => !(x.workspace_id === r.workspace_id
            && x.target_kind === r.target_kind && x.target_id === r.target_id && x.tag_id === r.tag_id));
          db.autotag_ignored.push(r);
        }
        return reply(undefined, 201);
      }
      if (method === 'DELETE') {
        const gone = db.autotag_ignored.filter((r) => matches(r, q));
        log.push(['delete autotag_ignored', gone.length]);
        db.autotag_ignored = db.autotag_ignored.filter((r) => !gone.includes(r));
        return reply(undefined, 204);
      }
    }
    if (path.startsWith('rpc/')) return reply(null);
    return method === 'GET' ? reply([]) : reply(undefined, 201);
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = RealWS;
});

async function api(method, path, body, ctx = null) {
  const url = new URL(`https://clusters.test/api/v1${path}`);
  const req = new Request(url, {
    method,
    headers: {
      authorization: 'Bearer sk_live_test',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const res = await handleApiRoute(url, req, ENV, ctx);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const tool = async (name, args) => {
  const r = await api('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return r.body.result;
};

test('GET /workspaces/:id/tags: the live tags by name, each counted; name finds one', async () => {
  const diner = tag({ name: 'Diner', entity_type: 'setting' });
  const neon = tag({ name: 'neon' });
  tag({ name: 'Day', status: 'deleted', deleted_at: '2026-10-20T00:00:00Z' });
  tag({ name: 'Elsewhere', workspace_id: W2 });
  link({ source_id: 'c1', target_id: diner.id });
  link({ source_id: 'c2', target_id: diner.id });

  const r = await api('GET', `/workspaces/${W1}/tags`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tags.map((t) => [t.name, t.items]), [['Diner', 2], ['neon', 0]]);
  assert.deepEqual(r.body.tags[0], {
    id: diner.id, name: 'Diner', color: null, entity_type: 'setting', description: null, items: 2, created_at: diner.created_at,
  });
  assert.deepEqual([r.body.workspace_id, r.body.has_more], [W1, false]);

  const one = await api('GET', `/workspaces/${W1}/tags?name=${encodeURIComponent('#NEON')}`);
  assert.deepEqual(one.body.tags.map((t) => t.id), [neon.id]);
  const paged = await api('GET', `/workspaces/${W1}/tags?limit=1`);
  assert.deepEqual([paged.body.tags.length, paged.body.has_more], [1, true]);

  countsDown = true;
  assert.equal((await api('GET', `/workspaces/${W1}/tags`)).body.tags[0].items, null, 'uncounted, not zero');

  assert.equal((await api('GET', `/workspaces/${W2}/tags`)).status, 404, 'not a member: no such workspace');
  assert.equal((await api('GET', '/workspaces/nope/tags')).status, 400);
  assert.equal((await api('GET', `/workspaces/${W1}/tags?name=%23`)).status, 400);
  assert.equal((await api('POST', `/workspaces/${W1}/tags`, {})).status, 405);
});

test('GET /tags/:id: everything carrying it, newest first, asked for with room to spare', async () => {
  const diner = tag({ name: 'Diner' });
  link({ source_id: 'c1', target_id: diner.id, source: 'auto' });
  link({ source_id: 'gone', target_id: diner.id });
  link({ source_kind: 'board', source_id: B1, target_id: diner.id });
  const r = await api('GET', `/tags/${diner.id}?limit=1`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tag, { ...{ id: diner.id, name: 'Diner', color: null, entity_type: null, description: null,
    created_at: diner.created_at }, workspace_id: W1 });
  assert.deepEqual(r.body.items.map((i) => [i.kind, i.board_id]), [['board', B1]]);
  assert.equal(r.body.has_more, true);
  assert.deepEqual(log.at(-1), ['get_things_tagged', 3], 'twice the page and one, since a gone card is dropped after the limit');

  const all = await api('GET', `/tags/${diner.id}`);
  assert.deepEqual(all.body.items.map((i) => [i.kind, i.auto]), [['board', false], ['card', true]]);
  assert.deepEqual([all.body.items[1].card_id, all.body.items[1].excerpt, all.body.items[1].url],
    ['c1', 'Rain on glass', `https://clusters.test/?to=c:${B1}:c1`]);
  assert.equal(all.body.has_more, false);

  const gone = tag({ name: 'Day', status: 'deleted', deleted_at: '2026-10-20T00:00:00Z' });
  assert.equal((await api('GET', `/tags/${gone.id}`)).status, 404);
  assert.equal((await api('GET', `/tags/${tag({ name: 'Elsewhere', workspace_id: W2 }).id}`)).status, 404);
  assert.equal((await api('GET', '/tags/nope')).status, 400);
  assert.equal((await api('GET', `/tags/${diner.id}/items`)).status, 404);
  assert.equal((await api('DELETE', `/tags/${diner.id}`)).status, 405);
});

test('GET /boards/:id/tags: each tag with what carries it here; a deleted card isn\'t', async () => {
  seedBoard();
  const diner = tag({ name: 'Diner' });
  const night = tag({ name: 'Night' });
  const day = tag({ name: 'Day', status: 'deleted', deleted_at: '2026-10-20T00:00:00Z' });
  link({ source_id: 'c1', target_id: diner.id });
  link({ source_id: 'gone', target_id: diner.id });
  link({ source_kind: 'group', source_id: 'g1', target_id: diner.id });
  link({ source_kind: 'doc', source_id: 'd1', source_page_id: 'p1', target_id: diner.id });
  link({ source_kind: 'board', source_id: B1, target_id: night.id });
  link({ source_id: 'c2', target_id: day.id });
  const r = await api('GET', `/boards/${B1}/tags`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.tags.map((t) => [t.name, t.on_board, t.cards, t.groups, t.pages]), [
    ['Diner', false, ['c1'], ['g1'], [{ card_id: 'd1', page_id: 'p1' }]],
    ['Night', true, [], [], []],
  ]);
  assert.equal(r.body.note, undefined);
  assert.equal(r.body.url, `https://clusters.test/?to=b:${B1}`);

  rooms.get(B1).down = true;
  const blind = await api('GET', `/boards/${B1}/tags`);
  assert.deepEqual(blind.body.tags[0].cards, ['c1', 'gone']);
  assert.match(blind.body.note, /could not be read/);
  assert.equal((await api('GET', '/boards/22222222-2222-4222-8222-222222222222/tags')).status, 404);
});

test('POST /boards/:id/tags: on, as the Tag menu puts them — a new name made, then spread', async () => {
  seedBoard();
  const diner = tag({ name: 'Diner' });
  link({ source_id: 'c1', target_id: diner.id, source: 'auto' });
  db.autotag_ignored.push({ workspace_id: W1, target_kind: 'card', target_id: 'c2', tag_id: diner.id });
  const pending = [];
  const r = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1', 'c2', 'nope'], add: ['diner', '#Night exterior'] },
    { waitUntil: (p) => pending.push(p) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const night = db.tags.find((t) => t.name === 'Night exterior');
  assert.deepEqual([night.kind, night.color, night.created_by, night.workspace_id], ['user', null, U1, W1]);
  assert.deepEqual(r.body.added.map((a) => [a.name, a.created, a.card_ids]), [
    ['Diner', false, ['c2']],
    ['Night exterior', true, ['c1', 'c2']],
  ]);
  assert.deepEqual(r.body.removed, []);
  assert.deepEqual(r.body.not_found, { card_ids: ['nope'], tags: [] });
  assert.equal(r.body.url, `https://clusters.test/?to=b:${B1}`);

  assert.equal(onCard(diner, 'c1')[0].source, 'auto', 'one it already had stays as it was');
  assert.equal(onCard(diner, 'c2')[0].source, 'user');
  assert.deepEqual(onCard(night, 'c1').map((l) => [l.source, l.source_workspace, l.source_board_id, l.link_kind]),
    [['user', W1, B1, 'applied']]);
  assert.deepEqual(db.autotag_ignored, [], 'putting it on lifts "keep it off"');
  assert.deepEqual(log.map((x) => x[0]), [
    'insert tags', 'insert entity_links', 'delete autotag_ignored', 'backfill_tag_applications',
  ], 'the new tag spreads once this call\'s own are written');
  assert.equal(pending.length >= 1, true, 'and in the background');
  await Promise.all(pending);

  // The same call again changes nothing.
  log = [];
  const again = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1', 'c2'], add: ['Diner', 'night EXTERIOR'] });
  assert.deepEqual(again.body.added.map((a) => [a.name, a.created, a.card_ids]), [['Diner', false, []], ['Night exterior', false, []]]);
  assert.ok(!log.some(([w]) => w === 'insert entity_links' || w === 'insert tags' || w === 'backfill_tag_applications'));
});

test('POST /boards/:id/tags: off, whoever put it on, and kept off', async () => {
  seedBoard();
  const diner = tag({ name: 'Diner' });
  const neon = tag({ name: 'Neon' });
  link({ source_id: 'c1', target_id: diner.id, source: 'auto' });
  link({ source_id: 'c2', target_id: diner.id });
  link({ source_kind: 'group', source_id: 'g1', target_id: diner.id });
  link({ source_id: 'c1', target_id: neon.id });
  const r = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1', 'd1'], remove: [diner.id, 'Nowhere'], add: ['neon'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.removed.map((x) => [x.name, x.card_ids]), [['Diner', ['c1']]]);
  assert.deepEqual(r.body.added.map((x) => [x.name, x.card_ids]), [['Neon', ['d1']]]);
  assert.deepEqual(r.body.not_found.tags, ['Nowhere']);
  assert.equal(onCard(diner, 'c1').length, 0, 'an automatic one goes too');
  assert.equal(onCard(diner, 'c2').length, 1, 'cards not named keep it');
  assert.ok(db.entity_links.some((l) => l.source_kind === 'group' && l.target_id === diner.id), 'the group keeps it');
  assert.deepEqual(db.autotag_ignored, [{ workspace_id: W1, target_kind: 'card', target_id: 'c1', tag_id: diner.id, ignored_by: U1 }],
    'filed for the pair that carried it, and only that one');
});

test('POST /boards/:id/tags: a deleted tag\'s name brings it back, then it goes on', async () => {
  seedBoard();
  const day = tag({ name: 'Day', status: 'deleted', deleted_at: '2026-10-20T00:00:00Z' });
  const r = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1'], add: ['day'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.added.map((a) => [a.id, a.created, a.revived, a.card_ids]), [[day.id, false, true, ['c1']]]);
  assert.deepEqual(log.map((x) => x[0]), ['restore_tag', 'insert entity_links', 'delete autotag_ignored']);
  assert.equal(db.tags.filter((t) => t.slug === 'day').length, 1, 'no second tag of the name');
  // Taking off a deleted tag finds nothing to take off.
  day.status = 'deleted';
  day.deleted_at = '2026-10-21T00:00:00Z';
  const off = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1'], remove: ['Day'] });
  assert.deepEqual([off.body.removed, off.body.not_found.tags], [[], ['Day']]);
});

test('POST /boards/:id/tags: someone tagging the same card meanwhile is no failure', async () => {
  seedBoard();
  const diner = tag({ name: 'Diner' });
  race = { source_id: 'c2', target_id: diner.id, source: 'user' };
  const r = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1', 'c2'], add: ['Diner'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(onCard(diner, 'c1').length, 1);
  assert.equal(onCard(diner, 'c2').length, 1, 'once');
});

test('POST /boards/:id/tags: refused, blind or wrong, and nothing written', async () => {
  seedBoard();
  const diner = tag({ name: 'Diner' });
  const before = JSON.stringify(db);
  canWrite = false;
  const no = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1'], add: ['Diner', 'New one'] });
  assert.deepEqual([no.status, no.body.code], [403, 'forbidden']);
  canWrite = true;
  rooms.get(B1).down = true;
  const blind = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1'], add: ['New one'] });
  assert.deepEqual([blind.status, blind.body.code], [503, 'room_unavailable']);
  rooms.get(B1).down = false;
  for (const [b, status] of [
    [{ card_ids: ['nope'], add: ['Diner'] }, 404],
    [{ card_ids: ['c1'] }, 400],
    [{ card_ids: ['c1'], add: ['Diner'], remove: [diner.id] }, 400],
    [{ card_ids: ['c1'], add: ['x'.repeat(81)] }, 400],
    [{ card_ids: ['c1'], add: ['Diner'], color: 'red' }, 400],
  ]) {
    const r = await api('POST', `/boards/${B1}/tags`, b);
    assert.equal(r.status, status, JSON.stringify([b, r.body]).slice(0, 200));
  }
  assert.equal(JSON.stringify(db), before, 'nothing written for any of them');
  assert.equal((await api('POST', '/boards/22222222-2222-4222-8222-222222222222/tags', { card_ids: ['c1'], add: ['x'] })).status, 404);
  assert.equal((await api('PATCH', `/boards/${B1}/tags`, { card_ids: ['c1'], add: ['x'] })).status, 405);
  assert.equal((await api('POST', `/boards/${B1}/tags/extra`, { card_ids: ['c1'], add: ['x'] })).status, 404);

  // An id that isn't one of the workspace's tags is not found, never made.
  const ghost = '77777777-7777-4777-8777-777777777777';
  const r = await api('POST', `/boards/${B1}/tags`, { card_ids: ['c1'], add: [ghost] });
  assert.deepEqual([r.status, r.body.added, r.body.not_found.tags], [200, [], [ghost]]);
  assert.equal(JSON.stringify(db), before);
});

test('MCP: list_tags reads the workspace, a board or one tag; tag_cards is the POST', async () => {
  seedBoard();
  const diner = tag({ name: 'Diner' });
  link({ source_id: 'c1', target_id: diner.id });

  const all = await tool('list_tags', {});
  assert.equal(all.isError, undefined, JSON.stringify(all));
  assert.deepEqual(all.structuredContent.tags.map((t) => [t.name, t.items]), [['Diner', 1]], 'the only workspace, unnamed');

  const one = await tool('list_tags', { tag: 'diner', board_id: B1 });
  assert.deepEqual(one.structuredContent.items.map((i) => i.card_id), ['c1']);
  const byId = await tool('list_tags', { tag: diner.id.toUpperCase() });
  assert.equal(byId.structuredContent.tag.id, diner.id);

  const board = await tool('list_tags', { board_id: B1 });
  assert.deepEqual(board.structuredContent.tags.map((t) => [t.name, t.cards]), [['Diner', ['c1']]]);

  const missing = await tool('list_tags', { workspace_id: W1, tag: 'Nowhere' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /no tag named "Nowhere".*\[not_found\]/);

  const tagged = await tool('tag_cards', { board_id: B1, card_ids: ['c2'], add: ['Diner'], remove: [] });
  assert.equal(tagged.isError, undefined, JSON.stringify(tagged));
  assert.deepEqual(tagged.structuredContent.added.map((a) => [a.name, a.card_ids]), [['Diner', ['c2']]]);
  assert.equal(onCard(diner, 'c2')[0].source, 'user');
});
